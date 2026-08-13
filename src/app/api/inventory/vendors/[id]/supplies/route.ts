/**
 * Vendor supplies attach (snap-and-buy item 01).
 *
 * POST /api/inventory/vendors/[id]/supplies
 *   { items: [{ text, qty_hint? }] }   (a bare array is also accepted)
 *
 * "This vendor carries: …" — free-text supply lines (e.g. off a business card or
 * a sales conversation) are fuzzy-matched against the catalog via the same
 * deterministic matcher the shopping list uses (matchCatalogLines):
 *   - matched   → upserted as supply_chain.vendor_items rows (no price,
 *                 vendor_address_id null = company-wide) so the buying flows
 *                 (vendor split, buyable groups, PO prefill) see the coverage.
 *   - unmatched → appended to the vendor's notes as "Carries: …". Deliberate
 *                 call: a card scan must NOT force catalog-item creation.
 *
 *   → 200 { data: { matched, unmatched, vendor_items_upserted, notes_updated } }
 */

import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';
import { matchCatalogLines, type CatalogMatch } from '@/lib/shopping-list';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const SupplyLineSchema = z.object({
  text: z.string().min(1).max(300),
  qty_hint: z.number().positive().optional(),
});
const SuppliesSchema = z.object({
  items: z.array(SupplyLineSchema).min(1).max(50),
});

function extractVendorId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('vendors') + 1];
  if (!id) throw AppError.badRequest('Missing vendor id');
  return z.string().uuid().parse(id);
}

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'vendors.manage');
  const vendorId = extractVendorId(req);
  const raw = await req.json();
  // The documented body is { items: [...] }; accept a bare array too since the
  // prompt-level contract is just "a list of { text, qty_hint? }".
  const { items } = SuppliesSchema.parse(Array.isArray(raw) ? { items: raw } : raw);

  const sc = (supabase as any).schema('supply_chain');
  const { data: vendor, error: vendorErr } = await sc
    .from('vendors')
    .select('id, name, notes')
    .eq('id', vendorId)
    .maybeSingle();
  if (vendorErr) { log.error('vendor.supplies_lookup_failed', { error: vendorErr.message }); throw AppError.internal(vendorErr.message); }
  if (!vendor) throw AppError.notFound('Vendor not found');

  // Same deterministic free-text → catalog matcher the shopping list uses.
  const matches = await matchCatalogLines(
    supabase,
    items.map((i) => ({ qty: i.qty_hint ?? 1, query: i.text })),
  );

  const matched: CatalogMatch[] = [];
  const unmatched: Array<{ text: string; qty_hint: number | null }> = [];
  const seenItemIds = new Set<string>();
  matches.forEach((m, idx) => {
    if (m.catalog_item_id && m.match_kind !== 'none') {
      // Two lines resolving to the same catalog item collapse to one vendor_items row.
      if (!seenItemIds.has(m.catalog_item_id)) {
        seenItemIds.add(m.catalog_item_id);
        matched.push(m);
      }
    } else {
      unmatched.push({ text: items[idx].text.trim(), qty_hint: items[idx].qty_hint ?? null });
    }
  });

  // Matched → vendor_items (no price, company-wide). Upsert on the natural key
  // so retries and already-known items are no-ops; unit_cost is deliberately
  // absent from the payload so an existing priced row keeps its price.
  let upserted = 0;
  if (matched.length > 0) {
    const rows = matched.map((m) => ({
      tenant_id: ctx.tenantId,
      vendor_id: vendorId,
      catalog_item_id: m.catalog_item_id,
      vendor_address_id: null,
      last_event_id: idempotencyKey,
    }));
    const { data: upsertedRows, error: upsertErr } = await sc
      .from('vendor_items')
      .upsert(rows, { onConflict: 'tenant_id,vendor_id,catalog_item_id,vendor_address_id' })
      .select('id');
    if (upsertErr) { log.error('vendor.supplies_upsert_failed', { error: upsertErr.message }); throw AppError.internal(upsertErr.message); }
    upserted = (upsertedRows ?? []).length;
  }

  // Unmatched → note on the vendor ("Carries: …") so nothing is silently lost.
  // Skip lines the notes already mention (idempotent-ish on retype/rescan).
  let notesUpdated = false;
  const existingNotes: string = vendor.notes ?? '';
  const newLines = unmatched
    .map((u) => u.text)
    .filter((t) => t && !existingNotes.toLowerCase().includes(t.toLowerCase()));
  if (newLines.length > 0) {
    const carriesLine = `Carries: ${newLines.join(', ')}`;
    const nextNotes = existingNotes.trim() ? `${existingNotes.trimEnd()}\n${carriesLine}` : carriesLine;
    const { error: notesErr } = await sc
      .from('vendors')
      .update({ notes: nextNotes.slice(0, 8000), last_event_id: idempotencyKey })
      .eq('id', vendorId);
    if (notesErr) {
      // Non-fatal: the vendor_items writes already landed; surface via log only.
      log.error('vendor.supplies_notes_failed', { error: notesErr.message });
    } else {
      notesUpdated = true;
    }
  }

  log.info('vendor.supplies_attached', {
    vendor_id: vendorId,
    matched: matched.length,
    unmatched: unmatched.length,
    vendor_items_upserted: upserted,
    notes_updated: notesUpdated,
  });

  return {
    data: {
      matched,
      unmatched,
      vendor_items_upserted: upserted,
      notes_updated: notesUpdated,
    },
    status: 200,
    // supply_chain triggers (trigger_vendor_events / vendor_items trigger) own
    // outbox emission — same as POST /api/inventory/vendor-items.
    events: [],
  };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/vendors/[id]/supplies' });
