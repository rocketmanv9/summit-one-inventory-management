import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { resolveCallerPurchaseIdentity } from '@/lib/purchase-links';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Item 06 — External order sessions ────────────────────────────────────────
// Start a guided-purchase session against an item-04 external purchase link. The
// mobile guided browser (item 07) calls this first, then streams screenshots to
// .../[id]/captures, then finishes with .../[id]/complete.
//
// CONTRACT (item 07):
//   POST /api/inventory/external-orders   { link_id }
//     → 201 { data: { session_id, link: { id, name, url, requires_po } } }
//   Auth: session (chassis createSessionWriteRoute) — same session cookie/JWT the
//   rest of the inventory mobile API uses. Idempotent (Idempotency-Key header).
//   The caller must be ALLOWED that link — same position gate as item-04's /mine.

const CreateSchema = z.object({
  link_id: z.string().uuid(),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, idempotencyKey }) => {
  const body = CreateSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;
  const userId = ctx.userId!;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  const sc = (supabase as any).schema('supply_chain');

  // Load the link and confirm the caller is allowed it (same check as /mine:
  // admins see all; everyone else needs their HR position in allowed_positions).
  const { data: link, error: linkErr } = await sc
    .from('external_purchase_links')
    .select('id, name, url, requires_po, vendor_id, allowed_positions, active')
    .eq('id', body.link_id)
    .maybeSingle();
  if (linkErr) { log.error('external_order.link_lookup_failed', { error: linkErr.message }); throw AppError.internal(linkErr.message); }
  if (!link || !link.active) throw AppError.notFound('Purchase link not found.');

  const { isAdmin, positionTitle } = await resolveCallerPurchaseIdentity(supabase, tenantId, userId);
  const allowed = isAdmin
    || (positionTitle && Array.isArray(link.allowed_positions) && link.allowed_positions.includes(positionTitle));
  if (!allowed) throw AppError.forbidden('You are not allowed to purchase from this link.');

  // Idempotency-key doubles as the session's last_event_id (unique per tenant on
  // the outbox), so a retried create returns the same logical session.
  const { data: sessionRow, error: insErr } = await sc
    .from('external_order_sessions')
    .upsert(
      {
        tenant_id: tenantId,
        link_id: link.id,
        user_id: userId,
        status: 'active',
        last_event_id: idempotencyKey,
      },
      { onConflict: 'tenant_id,last_event_id' },
    )
    .select('id')
    .single();
  if (insErr) { log.error('external_order.create_failed', { error: insErr.message }); throw AppError.internal(insErr.message); }

  return {
    data: {
      session_id: sessionRow.id,
      link: { id: link.id, name: link.name, url: link.url, requires_po: link.requires_po },
    },
    status: 201,
    events: [{
      event_name: 'external_order_session.started',
      payload: { session_id: sessionRow.id, link_id: link.id, user_id: userId },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/external-orders' });
