import { z } from 'zod';
import { SignJWT } from 'jose';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-one-inventory-management';

/**
 * Fleet shop-request → PO post-back (inventory half of item 16 / item 20).
 *
 * After the create page finalizes a DRAFT PO that originated from a fleet shop
 * request (?source=fleet_shop_request&source_ref=<fleet request id>), it POSTs
 * here with the drafted PO id/number. This route forwards a PATCH to fleet's
 * `PATCH /api/fleet/shop-requests/:id` with `{ linked_po_ref: { status:'drafted',
 * po_id, po_number, at } }` so the fleet shop board's "PO drafting…" chip flips
 * to the real "PO 26-00XX drafted".
 *
 * Why a server route and not a browser fetch: the SSO access-token cookie is
 * host-only + httpOnly + SameSite=Lax, so a cross-origin browser fetch from the
 * inventory host to the fleet host would NOT carry the fleet session — and JS
 * can't read the httpOnly token to forward it. So the browser stays out of it
 * and this route mints a fleet-audience receiver-shaped internal JWT instead
 * (same trust shape as fleet→ops in fleet's org-chart.ts: sign with the
 * RECEIVER's secret + issuer, carry our identity in `sub`).
 *
 * ⚠️ REMAINING ENV / FLEET-SIDE GAP (documented, non-blocking per item 20):
 *   1. This repo has no fleet S2S config yet — set these in inventory env to
 *      arm the post-back:
 *        - FLEET_SERVICE_URL              (e.g. https://stage.fleet.summit-one.app)
 *        - FLEET_INTERNAL_JWT_SECRET      (fleet's INTERNAL_JWT_SECRET)
 *        - FLEET_INTERNAL_JWT_ISSUER      (default 'summit-one-fleet-management')
 *        - FLEET_INTERNAL_JWT_AUDIENCE    (default 'summit-internal-services')
 *   2. Fleet's `PATCH /api/fleet/shop-requests/:id` is currently a
 *      `createSessionWriteRoute` (COOKIE session auth) — it does NOT yet accept
 *      an internal S2S JWT. For this forward to land, fleet must either expose an
 *      internal-JWT variant of that PATCH (createInternalRoute) or teach the
 *      existing route to accept `requireInternalServiceJwt`. Until then this
 *      route returns `{ posted: false, reason }` and the create page still
 *      succeeds (the draft PO exists; only the chip flip is deferred).
 *
 * When both are in place this route works unchanged.
 */
const BodySchema = z.object({
  source_ref: z.string().min(1, 'source_ref (fleet shop-request id) is required'),
  po_id: z.string().min(1),
  po_number: z.string().nullable().optional(),
});

/**
 * Mint a fleet-audience internal JWT. Chassis verify checks a token against the
 * RECEIVER's own INTERNAL_JWT_* config, so we sign with fleet's secret + issuer
 * and carry our identity in `sub`. Returns null when the fleet secret isn't set.
 */
async function mintFleetInternalJwt(tenantId: string): Promise<string | null> {
  const secretValue = (process.env.FLEET_INTERNAL_JWT_SECRET || '').trim();
  if (!secretValue) return null;
  return new SignJWT({ tenant_id: tenantId, email: null, scopes: [] })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(SERVICE_NAME)
    .setIssuer(process.env.FLEET_INTERNAL_JWT_ISSUER || 'summit-one-fleet-management')
    .setAudience(process.env.FLEET_INTERNAL_JWT_AUDIENCE || 'summit-internal-services')
    .setIssuedAt()
    .setExpirationTime('300s')
    .sign(new TextEncoder().encode(secretValue));
}

type PostbackResult = {
  posted: boolean;
  reason?: string;
  po_id?: string;
  po_number?: string | null;
};

export const POST = createSessionWriteRoute<PostbackResult>(async ({ ctx, req, log, fetch, idempotencyKey }) => {
  const body = BodySchema.parse(await req.json());

  const base = (process.env.FLEET_SERVICE_URL || '').trim().replace(/\/+$/, '');
  const token = base ? await mintFleetInternalJwt(ctx.tenantId!) : null;

  // Env not armed yet (see the header block): don't fail the create — the draft
  // PO is already saved. Return a soft result the create page ignores.
  if (!base || !token) {
    const reason = !base ? 'FLEET_SERVICE_URL not configured' : 'FLEET_INTERNAL_JWT_SECRET not configured';
    log.warn('fleet_shop_request.postback.skipped', { source_ref: body.source_ref, po_id: body.po_id, reason });
    return {
      data: { posted: false, reason },
      status: 202,
      events: [{
        event_name: 'fleet_shop_request.postback_skipped',
        payload: { source_ref: body.source_ref, po_id: body.po_id, reason, tenant_id: ctx.tenantId },
        last_event_id: idempotencyKey,
      }],
    };
  }

  const linkedPoRef = {
    status: 'drafted' as const,
    po_id: body.po_id,
    po_number: body.po_number ?? null,
    at: new Date().toISOString(),
    by: SERVICE_NAME,
  };

  const res = await fetch(`${base}/api/internal/fleet/shop-requests/${encodeURIComponent(body.source_ref)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      // Fleet's PATCH is a write route — hand it a stable idempotency key so a
      // retry of THIS post-back doesn't re-stamp / re-emit downstream.
      'X-Idempotency-Key': `fleet-shop-po:${body.source_ref}:${body.po_id}`,
    },
    body: JSON.stringify({ linked_po_ref: linkedPoRef }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // Non-fatal upstream: the draft PO already exists. Surface it as a soft
    // result (not a thrown 5xx) so the create flow still reports success — the
    // chip flip can be retried later.
    log.warn('fleet_shop_request.postback.failed', {
      source_ref: body.source_ref, po_id: body.po_id, status: res.status, detail: detail.slice(0, 300),
    });
    return {
      data: { posted: false, reason: `fleet PATCH ${res.status}` },
      status: 202,
      events: [{
        event_name: 'fleet_shop_request.postback_failed',
        payload: { source_ref: body.source_ref, po_id: body.po_id, status: res.status, tenant_id: ctx.tenantId },
        last_event_id: idempotencyKey,
      }],
    };
  }

  log.info('fleet_shop_request.postback.ok', { source_ref: body.source_ref, po_id: body.po_id, po_number: body.po_number ?? null });
  return {
    data: { posted: true, po_id: body.po_id, po_number: body.po_number ?? null },
    status: 200,
    events: [{
      event_name: 'fleet_shop_request.po_drafted',
      payload: { source_ref: body.source_ref, po_id: body.po_id, po_number: body.po_number ?? null, tenant_id: ctx.tenantId },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/fleet-callback/shop-request-po' });
