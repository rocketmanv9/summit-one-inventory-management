import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import {
  matchCatalogLines,
  parseListLine,
  computeVendorSplit,
  type CatalogMatch,
  type SplitLineInput,
} from '@/lib/shopping-list';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Shopping list → vendor suggestions (item 15) ─────────────────────────────
//   POST /api/inventory/purchasing/shopping-list/suggest
//     body {
//       items?: [ { catalog_item_id, qty } ],   // added via catalog search
//       text?: string                            // pasted list, one item per line
//     }
//     → 200 { data: {
//         matches: [ CatalogMatch ],             // one per pasted line (flags unmatched)
//         items: [ {                             // per resolved catalog item
//           catalog_item_id, name, sku, uom, qty,
//           options: [ { vendor_id, vendor_name, unit_cost, is_preferred } ],
//           recommended_vendor_id | null,
//           last_paid: { unit_cost, date, vendor_name } | null,
//           has_vendor: boolean
//         } ],
//         split: SplitResult                     // recommended + consolidated + note
//       } }
//
// Read-only (no writes) but takes a body, so it's a session READ route that reads
// req.json() — same shape the AI item-suggest route uses. Per-item vendor options
// come from supply_chain.vendor_items (active rows), ranked exactly like the
// draft-PO resolver (preferred, then cheapest). last_paid is the most recent
// placed/received PO line, the same honest signal the Create-PO order-context
// surface shows. The whole-list split is computed in @/lib/shopping-list.

const SuggestSchema = z.object({
  items: z
    .array(z.object({ catalog_item_id: z.string().uuid(), qty: z.number().positive().max(100000) }))
    .max(200)
    .optional()
    .default([]),
  text: z.string().max(20000).optional().default(''),
});

// PO statuses that mean the order was actually placed — same list order-context uses.
const PLACED_STATUSES = [
  'sent', 'placed', 'acknowledged', 'ordered', 'in_transit',
  'partially_received', 'fully_received', 'closed',
];

export const POST = createSessionReadRoute(async ({ req, session, log }) => {
  const body = SuggestSchema.parse(await req.json());
  const tenantId = session.tenantId!;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  const sc = (supabase as any).schema('supply_chain');
  const inv = (supabase as any).schema('inventory');

  // 1) Match pasted lines to the catalog (deterministic; flags unmatched).
  const rawLines = body.text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 200)
    .map(parseListLine);
  const matches: CatalogMatch[] = rawLines.length > 0 ? await matchCatalogLines(supabase, rawLines) : [];

  // 2) Merge explicit catalog items + matched pasted lines into one qty map.
  //    Explicit items (from search) win the item name from the catalog fetch below.
  const qtyByItem = new Map<string, number>();
  for (const it of body.items) {
    qtyByItem.set(it.catalog_item_id, (qtyByItem.get(it.catalog_item_id) ?? 0) + it.qty);
  }
  for (const m of matches) {
    if (m.catalog_item_id) {
      qtyByItem.set(m.catalog_item_id, (qtyByItem.get(m.catalog_item_id) ?? 0) + m.qty);
    }
  }
  const catalogIds = [...qtyByItem.keys()];

  if (catalogIds.length === 0) {
    return Response.json({ data: { matches, items: [], split: computeVendorSplit([]) } });
  }

  // 3) Catalog metadata (name/sku/uom) for every resolved item.
  const { data: catRows, error: catErr } = await inv
    .from('catalog_items')
    .select('id, name, sku, uom_term_id')
    .in('id', catalogIds)
    .limit(5000);
  if (catErr) { log.error('shopping_list.catalog_failed', { error: catErr.message }); throw AppError.internal(catErr.message); }
  const catById = new Map<string, any>((catRows ?? []).map((c: any) => [c.id, c]));

  // 4) All active vendor_items rows for these items → per-item options, ranked
  //    the way PO resolution ranks (preferred, then cheapest). Deduped per vendor.
  const { data: viRows, error: viErr } = await sc
    .from('vendor_items')
    .select('catalog_item_id, vendor_id, unit_cost, is_preferred, active')
    .in('catalog_item_id', catalogIds)
    .limit(5000);
  if (viErr) { log.error('shopping_list.vendor_items_failed', { error: viErr.message }); throw AppError.internal(viErr.message); }
  const activeVi = (viRows ?? []).filter((r: any) => r.active !== false && r.vendor_id);

  const vendorIds = new Set<string>(activeVi.map((r: any) => r.vendor_id));
  const vendorNames = new Map<string, string>();
  if (vendorIds.size > 0) {
    const { data: vendors } = await sc.from('vendors').select('id, name').in('id', [...vendorIds]).limit(5000);
    for (const v of vendors ?? []) vendorNames.set(v.id, v.name);
  }

  // Dedupe per (item, vendor): keep preferred, else cheapest.
  const optionsByItem = new Map<string, Map<string, { vendor_id: string; vendor_name: string | null; unit_cost: number | null; is_preferred: boolean }>>();
  for (const r of activeVi) {
    let byVendor = optionsByItem.get(r.catalog_item_id);
    if (!byVendor) { byVendor = new Map(); optionsByItem.set(r.catalog_item_id, byVendor); }
    const opt = {
      vendor_id: r.vendor_id,
      vendor_name: vendorNames.get(r.vendor_id) ?? null,
      unit_cost: r.unit_cost != null ? Number(r.unit_cost) : null,
      is_preferred: !!r.is_preferred,
    };
    const cur = byVendor.get(r.vendor_id);
    const better =
      !cur ||
      (opt.is_preferred && !cur.is_preferred) ||
      (opt.is_preferred === cur.is_preferred && (opt.unit_cost ?? Infinity) < (cur.unit_cost ?? Infinity));
    if (better) byVendor.set(r.vendor_id, opt);
  }

  // 5) Last-paid signal: most recent placed/received PO line per item.
  const { data: poLines } = await sc
    .from('purchase_order_lines')
    .select('catalog_item_id, unit_cost, po_id')
    .eq('tenant_id', tenantId)
    .in('catalog_item_id', catalogIds)
    .not('unit_cost', 'is', null)
    .gt('unit_cost', 0)
    .limit(1000);
  const poIds = [...new Set((poLines ?? []).map((l: any) => l.po_id))];
  const poById = new Map<string, any>();
  if (poIds.length > 0) {
    const { data: pos } = await sc
      .from('purchase_orders')
      .select('id, status, vendor_id, vendor_name_snapshot, ordered_at, sent_at, order_date, created_at')
      .in('id', poIds)
      .in('status', PLACED_STATUSES)
      .limit(1000);
    for (const po of pos ?? []) poById.set(po.id, po);
  }
  const placedAt = (po: any): string | null => po.ordered_at || po.sent_at || po.order_date || po.created_at || null;
  const lastPaidByItem = new Map<string, { unit_cost: number; date: string | null; vendor_name: string | null }>();
  const candidates = (poLines ?? [])
    .map((l: any) => ({ line: l, po: poById.get(l.po_id) }))
    .filter((c: any) => c.po)
    .sort((a: any, b: any) => (placedAt(b.po) || '').localeCompare(placedAt(a.po) || ''));
  for (const c of candidates) {
    if (lastPaidByItem.has(c.line.catalog_item_id)) continue;
    lastPaidByItem.set(c.line.catalog_item_id, {
      unit_cost: Number(c.line.unit_cost),
      date: placedAt(c.po),
      vendor_name: c.po.vendor_name_snapshot ?? (c.po.vendor_id ? vendorNames.get(c.po.vendor_id) ?? null : null),
    });
  }

  // 6) Assemble per-item payload + split input.
  const splitInput: SplitLineInput[] = [];
  const items = catalogIds.map((id) => {
    const cat = catById.get(id);
    const opts = [...(optionsByItem.get(id)?.values() ?? [])].sort((a, b) => {
      if (a.is_preferred !== b.is_preferred) return a.is_preferred ? -1 : 1;
      return (a.unit_cost ?? Number.MAX_VALUE) - (b.unit_cost ?? Number.MAX_VALUE);
    });
    const qty = qtyByItem.get(id) ?? 1;
    splitInput.push({ catalog_item_id: id, qty, name: cat?.name ?? null, options: opts });
    return {
      catalog_item_id: id,
      name: cat?.name ?? null,
      sku: cat?.sku ?? null,
      uom_term_id: cat?.uom_term_id ?? null,
      qty,
      options: opts,
      recommended_vendor_id: opts[0]?.vendor_id ?? null,
      last_paid: lastPaidByItem.get(id) ?? null,
      has_vendor: opts.length > 0,
    };
  });

  const split = computeVendorSplit(splitInput);

  log.info('shopping_list.suggest', {
    item_count: items.length,
    matched: matches.filter((m) => m.catalog_item_id).length,
    unmatched: matches.filter((m) => !m.catalog_item_id).length,
    no_vendor: split.recommended.unassigned_item_ids.length,
    rec_vendors: split.recommended.vendor_count,
  });

  return Response.json({ data: { matches, items, split } });
}, { serviceName: SERVICE_NAME });
