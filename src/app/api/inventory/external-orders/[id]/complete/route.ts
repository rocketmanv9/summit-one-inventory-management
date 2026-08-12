import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import {
  CAPTURES_BUCKET,
  extractOrderFromCaptures,
  loadOwnedSession,
  resolveDefaultShipToLocationId,
  resolveEachUomTermId,
  resolveGuidedPurchaseVendorId,
  type ExtractionResult,
} from '@/lib/external-orders';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Item 06 — complete a session: AI extraction → draft PO ───────────────────
// CONTRACT (item 07):
//   POST /api/inventory/external-orders/{id}/complete
//     { place_order_confirmed?: boolean, notes?: string }
//     → 200 { data: { extracted, draft_po_id, po_number, status } }
//        extracted: {
//          site, items: [{ description, qty, unit_price, confidence }],
//          order_total, order_number, confidence: { vendor, items, total },
//          notes: string[], ai_ran: boolean
//        }
//        draft_po_id / po_number / status are null when the link has requires_po=false.
//   Auth: session, gated to the OWNER. Idempotent (Idempotency-Key): a retry
//   returns the same result and never drafts a second PO.
//
// Runs AI vision over the captured screenshots (vendor/site, lines, total, order
// number, per-field confidence), stores `extracted`, and — if the link requires a
// PO — drafts one via rpc_create_purchase_order (so it flows through the normal
// approval gate; we NEVER bypass it) with the screenshots attached. The human
// already placed the real order on the site; this is the internal record.

const CompleteSchema = z.object({
  place_order_confirmed: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});

function extractSessionId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('external-orders') + 1];
  if (!id) throw AppError.badRequest('Missing session id');
  return z.string().uuid().parse(id);
}

/** Turn extraction lines into rpc_create_purchase_order free-text lines. Every
 *  non-catalog line needs a uom_term_id (chk_noncatalog_has_uom) — default Each. */
function toPoLines(extracted: ExtractionResult, uomTermId: string) {
  return extracted.items.map((it) => ({
    item_description: it.description,
    uom_term_id: uomTermId,
    qty_ordered: it.qty && it.qty > 0 ? it.qty : 1,
    unit_cost: it.unit_price ?? undefined,
    estimated_unit_cost: it.unit_price ?? undefined,
    price_basis: it.unit_price != null ? 'estimated' : 'unknown',
    is_approximate_qty: it.qty == null,
    line_notes: it.confidence !== 'high' ? `AI confidence: ${it.confidence}` : undefined,
  }));
}

/** Compose the PO notes: guided-purchase provenance + any low-confidence caveats. */
function buildPoNotes(site: string | null, extracted: ExtractionResult, userNotes?: string): string {
  const siteName = site || extracted.site || 'an external site';
  const parts = [
    `Ordered on ${siteName} via guided purchase — verify against confirmation email.`,
  ];
  if (extracted.order_number) parts.push(`Order/confirmation #: ${extracted.order_number}`);
  if (extracted.confidence.total !== 'high' || extracted.order_total == null) {
    parts.push('Total unclear from screenshots — confirm before approving.');
  }
  for (const n of extracted.notes) parts.push(n);
  if (!extracted.ai_ran || extracted.items.length === 0) {
    parts.push('No line items were auto-extracted — enter them manually from the attached screenshots.');
  }
  if (userNotes && userNotes.trim()) parts.push(`Buyer notes: ${userNotes.trim()}`);
  return parts.join('\n');
}

export const POST = createSessionWriteRoute(async ({ ctx, req, log, idempotencyKey }) => {
  const sessionId = extractSessionId(req);
  const body = CompleteSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;
  const userId = ctx.userId!;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  const sc = (supabase as any).schema('supply_chain');

  const session = await loadOwnedSession(supabase, tenantId, userId, sessionId);

  // Idempotent replay: an already-completed session returns its stored result.
  if (session.status === 'completed') {
    let po_number: string | null = null;
    let po_status: string | null = null;
    if (session.draft_po_id) {
      const { data: po } = await sc.from('purchase_orders').select('po_number, status').eq('id', session.draft_po_id).maybeSingle();
      po_number = po?.po_number ?? null;
      po_status = po?.status ?? null;
    }
    return {
      data: { extracted: session.extracted, draft_po_id: session.draft_po_id, po_number, status: po_status },
      status: 200,
      events: [],
    };
  }
  if (session.status !== 'active') {
    throw AppError.conflict(`Session is "${session.status}" — only an active session can be completed.`);
  }

  // Load the link (requires_po + vendor_id) and the captures.
  const { data: link } = await sc
    .from('external_purchase_links')
    .select('id, name, requires_po, vendor_id')
    .eq('id', session.link_id)
    .maybeSingle();
  if (!link) throw AppError.notFound('Purchase link for this session no longer exists.');

  const { data: captures } = await sc
    .from('external_order_captures')
    .select('id, storage_path, sort')
    .eq('session_id', sessionId)
    .eq('tenant_id', tenantId)
    .order('sort', { ascending: true })
    .limit(50);

  // Download each capture and build a base64 data URL for the vision model.
  const images: string[] = [];
  for (const cap of captures ?? []) {
    const { data: blob, error: dlErr } = await supabase.storage.from(CAPTURES_BUCKET).download(cap.storage_path);
    if (dlErr || !blob) { log.warn('external_order.capture_download_failed', { path: cap.storage_path }); continue; }
    const buf = Buffer.from(await blob.arrayBuffer());
    const ext = cap.storage_path.endsWith('.png') ? 'png' : cap.storage_path.endsWith('.webp') ? 'webp' : 'jpeg';
    images.push(`data:image/${ext};base64,${buf.toString('base64')}`);
  }

  const extracted = await extractOrderFromCaptures(images, link.name);
  log.info('external_order.extracted', {
    session_id: sessionId, ai_ran: extracted.ai_ran, item_count: extracted.items.length,
    total: extracted.order_total, order_number: extracted.order_number,
  });

  // Draft a PO only when the link requires one. Even with zero extracted lines we
  // draft an empty shell (so the record + screenshots exist) rather than nothing.
  let draftPoId: string | null = null;
  let poNumber: string | null = null;
  let poStatus: string | null = null;

  if (link.requires_po) {
    const vendorId = await resolveGuidedPurchaseVendorId(supabase, tenantId, link.vendor_id ?? null);
    // Guided purchases don't collect a location; default to the tenant's ship-to
    // yard (same convention as the AI restock draft) so the RPC's location guard
    // is satisfied. A buyer can re-point it in the hub before approving.
    const deliveryLocationId = await resolveDefaultShipToLocationId(supabase, tenantId);
    if (!deliveryLocationId) {
      throw AppError.badRequest('No delivery location is configured for this tenant — add a location before drafting guided-purchase POs.');
    }
    // Free-text lines need a UOM; guided-purchase items default to Each.
    const uomTermId = await resolveEachUomTermId(tenantId);
    if (!uomTermId && extracted.items.length > 0) {
      throw AppError.internal('Could not resolve a default unit of measure for the draft lines.');
    }
    const attachments = (captures ?? []).map((c: any) => ({
      kind: 'guided_capture',
      storage_path: c.storage_path,
      bucket: CAPTURES_BUCKET,
      sort: c.sort,
    }));

    const { data: poResult, error: poErr } = await sc.rpc('rpc_create_purchase_order', {
      p_vendor_id: vendorId,
      p_delivery_method: 'ship',
      p_delivery_location_id: deliveryLocationId,
      p_cost_context: 'overhead',
      p_notes: buildPoNotes(extracted.site, extracted, body.notes),
      p_attachments: attachments,
      p_lines: toPoLines(extracted, uomTermId!),
      p_initiated_by: 'user',
      p_tenant_id: tenantId,
      p_acting_user_id: userId,
    });
    if (poErr) throw AppError.internal(`Draft PO creation failed: ${poErr.message}`);

    draftPoId = poResult?.po_id ?? null;
    poNumber = poResult?.po_number ?? null;
    poStatus = poResult?.status ?? null;

    // Badge it as guided-purchase (rpc_create_purchase_order defaults origin='user').
    if (draftPoId) {
      await sc.from('purchase_orders')
        .update({ origin: 'guided_purchase' })
        .eq('id', draftPoId)
        .eq('tenant_id', tenantId);
    }
  }

  await sc
    .from('external_order_sessions')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      extracted,
      draft_po_id: draftPoId,
      notes: body.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .eq('tenant_id', tenantId);

  return {
    data: { extracted, draft_po_id: draftPoId, po_number: poNumber, status: poStatus },
    status: 200,
    events: [{
      event_name: 'external_order_session.completed',
      payload: { session_id: sessionId, draft_po_id: draftPoId, item_count: extracted.items.length, ai_ran: extracted.ai_ran },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/external-orders/[id]/complete' });
