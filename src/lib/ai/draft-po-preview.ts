// Isabelle's Draft-PO preview builder — shared server logic (sprint item 02).
//
// Turns "order 10 wheelstops from Vendor X" into a complete, REVIEWABLE Draft-PO
// payload — vendor, priced lines, delivery, estimated total — plus the smart
// warnings a good buyer would give ("you already have 20 on hand at Reno", "PO
// 26-0031 for this is already open"). It CREATES NOTHING. It produces the object
// the confirmation card (item 03) renders verbatim.
//
// Read-only. It never calls rpc_create_purchase_order or the purchasing write
// path — pricing is resolved the same way those paths resolve it (vendor_items
// branch row wins over the company default; last-paid PO line as the fallback),
// but here it's for display only.
//
// SERVER-ONLY. Pass a tenant-scoped service-role supabase client.

import { getCatalogClient } from '@/lib/vendors';
import { getGVClient } from '@/lib/gv';
import { resolveItem } from './recommend-vendor';

// PO statuses that mean the order is still "open" for this item — used to warn
// about a PO that already covers what the user is about to order. Mirrors the
// open-order set the shortage/on-order flows use (draft through partially
// received; excludes voided/cancelled/fully_received).
const OPEN_PO_STATUSES = [
  'draft', 'awaiting_approval', 'approved', 'sent',
  'acknowledged', 'placed', 'partially_received',
];

// PO statuses that mean the order was actually placed — for the last-paid price
// fallback. Same list recommend-vendor uses.
const PLACED_STATUSES = [
  'sent', 'placed', 'acknowledged', 'ordered', 'in_transit',
  'partially_received', 'fully_received', 'closed',
];

export type PriceBasis = 'fixed' | 'estimated' | 'market' | 'unknown';

export type AdvisoryKind = 'on_hand' | 'surplus_elsewhere' | 'open_po' | 'min_order';

export interface Advisory {
  kind: AdvisoryKind;
  text: string;
}

export interface DraftPoPreviewLine {
  catalog_item_id: string | null;
  /** Free-text description when the ref didn't resolve to a catalog item. */
  item_description: string | null;
  name: string;
  qty: number;
  uom_term_id: string | null;
  uom_label: string;
  unit_cost: number | null;
  price_basis: PriceBasis;
  line_total: number | null;
  advisories: Advisory[];
  /**
   * Amazon punchout only (sprint item 08). True when a `vendor_items` ASIN row
   * exists for this catalog item + the Amazon vendor, so the card can warn about
   * unmapped lines BEFORE the buyer clicks "Shop on Amazon". Always false for
   * standard vendors (there's nothing to map).
   */
  amazon_mapped: boolean;
  /** The mapped ASIN when `amazon_mapped`, else null. */
  asin: string | null;
}

/** How the card's "Create" acts on this vendor (sprint item 08). */
export type VendorFulfillment = 'standard' | 'amazon_punchout';

export interface DraftPoPreviewVendor {
  vendor_id: string | null;
  name: string | null;
  code: string | null;
  address_id: string | null;
  /** True when only a GV catalog candidate was given — item 04 offers "Add & use". */
  pending_adopt: boolean;
  /** Echoed GV identity when pending_adopt, so item 04 can adopt it. */
  catalog_vendor_id: string | null;
  /**
   * 'amazon_punchout' when the resolved vendor orders through Amazon Business
   * (`ordering_mode='amazon_punchout'` or `code='AMAZON-BIZ'`); 'standard' for
   * everyone else. The card routes Amazon "Create" through the punchout start
   * flow (human finishes the cart on Amazon) instead of the normal PO create.
   */
  fulfillment: VendorFulfillment;
}

export interface DraftPoPreviewResult {
  ok: boolean;
  vendor: DraftPoPreviewVendor;
  delivery_location_id: string | null;
  needed_by_date: string | null;
  cost_context: string;
  lines: DraftPoPreviewLine[];
  estimated_total: number;
  unpriced_line_count: number;
  /** PO-level warnings (open POs for these items, etc.). */
  warnings: Advisory[];
  /** Short human-readable summary Isabelle can read back verbatim. */
  message: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DraftPoPreviewInput {
  vendor_id?: string;
  /** GV vendor candidate not yet adopted by the tenant. */
  catalog_vendor_id?: string;
  delivery_location_id?: string;
  needed_by_date?: string;
  cost_context?: string;
  lines: Array<{ item_ref: string; qty: number }>;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve the vendor identity for the preview. A tenant vendor_id wins; otherwise
 * a GV catalog_vendor_id is echoed as a pending-adopt candidate (item 04 owns the
 * actual adoption). Never throws — an unresolved vendor still yields a card the UI
 * can render with a "pick a vendor" hint.
 */
async function resolveVendor(
  supabase: any,
  tenantId: string,
  input: DraftPoPreviewInput,
): Promise<DraftPoPreviewVendor> {
  const sc = supabase.schema('supply_chain');

  if (input.vendor_id && UUID_RE.test(input.vendor_id)) {
    const { data } = await sc
      .from('vendors')
      .select('id, name, code, ordering_mode')
      .eq('tenant_id', tenantId)
      .eq('id', input.vendor_id)
      .limit(1)
      .maybeSingle();
    if (data) {
      return {
        vendor_id: data.id,
        name: data.name ?? null,
        code: data.code ?? null,
        address_id: null,
        pending_adopt: false,
        catalog_vendor_id: null,
        fulfillment: vendorFulfillment(data.ordering_mode, data.code),
      };
    }
  }

  if (input.catalog_vendor_id) {
    // Maybe the tenant already adopted this catalog vendor — prefer the real row.
    const { data: adopted } = await sc
      .from('vendors')
      .select('id, name, code, ordering_mode')
      .eq('tenant_id', tenantId)
      .eq('catalog_vendor_id', input.catalog_vendor_id)
      .limit(1)
      .maybeSingle();
    if (adopted) {
      return {
        vendor_id: adopted.id,
        name: adopted.name ?? null,
        code: adopted.code ?? null,
        address_id: null,
        pending_adopt: false,
        catalog_vendor_id: input.catalog_vendor_id,
        fulfillment: vendorFulfillment(adopted.ordering_mode, adopted.code),
      };
    }
    // Not adopted — echo the GV identity so item 04's card can offer "Add & use".
    let name: string | null = null;
    try {
      const catalog = getCatalogClient();
      const cv = await catalog.getById(input.catalog_vendor_id);
      name = cv?.name ?? null;
    } catch {
      /* catalog optional — still render the card */
    }
    return {
      vendor_id: null,
      name,
      code: null,
      address_id: null,
      pending_adopt: true,
      catalog_vendor_id: input.catalog_vendor_id,
      // A not-yet-adopted GV candidate has no ordering_mode on file — treat as
      // standard until it's a real tenant vendor row with an Amazon flag.
      fulfillment: 'standard',
    };
  }

  return {
    vendor_id: null,
    name: null,
    code: null,
    address_id: null,
    pending_adopt: false,
    catalog_vendor_id: null,
    fulfillment: 'standard',
  };
}

/**
 * How the card's "Create" acts on a vendor (sprint item 08). Amazon Business
 * vendors carry `ordering_mode = 'amazon_punchout'` (canonically) or the
 * `code = 'AMAZON-BIZ'` — the same flags findAmazonVendorId and the punchout
 * start route key off. Everyone else is 'standard'.
 */
function vendorFulfillment(
  orderingMode: string | null | undefined,
  code: string | null | undefined,
): VendorFulfillment {
  if (orderingMode === 'amazon_punchout') return 'amazon_punchout';
  if ((code ?? '').toUpperCase() === 'AMAZON-BIZ') return 'amazon_punchout';
  return 'standard';
}

/**
 * The vendor_items price for (vendor, item): the branch row for the chosen
 * delivery/address wins over the company default (vendor_address_id IS NULL).
 * Returns the best row or null. Mirrors the branch-wins rule the draft-PO /
 * shopping-list resolver uses — read-only here.
 */
function pickVendorItem(rows: any[], vendorAddressId: string | null): any | null {
  const active = rows.filter((r) => r.active !== false);
  if (active.length === 0) return null;
  if (vendorAddressId) {
    const branch = active.find((r) => r.vendor_address_id === vendorAddressId);
    if (branch) return branch;
  }
  // Prefer the company default (null address), else any branch, cheapest wins.
  const company = active.filter((r) => r.vendor_address_id == null);
  const pool = company.length > 0 ? company : active;
  return [...pool].sort(
    (a, b) => (num(a.unit_cost) ?? Infinity) - (num(b.unit_cost) ?? Infinity),
  )[0];
}

/** Most recent placed-PO unit_cost for an item (the last-paid fallback). */
async function fetchLastPaid(sc: any, tenantId: string, catalogItemId: string): Promise<number | null> {
  const { data: poLines } = await sc
    .from('purchase_order_lines')
    .select('unit_cost, po_id')
    .eq('tenant_id', tenantId)
    .eq('catalog_item_id', catalogItemId)
    .not('unit_cost', 'is', null)
    .gt('unit_cost', 0)
    .limit(1000);
  const poIds = [...new Set((poLines ?? []).map((l: any) => l.po_id))];
  if (poIds.length === 0) return null;
  const { data: pos } = await sc
    .from('purchase_orders')
    .select('id, status, ordered_at, sent_at, order_date, created_at')
    .in('id', poIds)
    .in('status', PLACED_STATUSES)
    .limit(1000);
  const poById = new Map<string, any>((pos ?? []).map((p: any) => [p.id, p]));
  const placedAt = (po: any): string => po.ordered_at || po.sent_at || po.order_date || po.created_at || '';
  const candidates = (poLines ?? [])
    .map((l: any) => ({ line: l, po: poById.get(l.po_id) }))
    .filter((c: any) => c.po)
    .sort((a: any, b: any) => placedAt(b.po).localeCompare(placedAt(a.po)));
  const winner = candidates[0];
  return winner ? num(winner.line.unit_cost) : null;
}

/**
 * Core preview builder. Resolves each line's catalog item, price + basis, UOM
 * label, and per-line advisories (on-hand here/elsewhere, open POs, min-order
 * nudge), then assembles the vendor + totals. Never throws on "not found" — an
 * unresolved item becomes a free-text line the card still renders.
 */
export async function buildDraftPoPreview(
  supabase: any,
  tenantId: string,
  input: DraftPoPreviewInput,
): Promise<DraftPoPreviewResult> {
  const inv = supabase.schema('inventory');
  const sc = supabase.schema('supply_chain');

  const vendor = await resolveVendor(supabase, tenantId, input);

  const rawLines = (input.lines ?? []).filter((l) => l && (l.item_ref ?? '').trim());

  // Resolve delivery location: given → verified; else tenant default ship-to;
  // else any active location. Read-only, best effort.
  const deliveryLocationId = await resolveDeliveryLocation(inv, tenantId, input.delivery_location_id);

  const lines: DraftPoPreviewLine[] = [];
  const warnings: Advisory[] = [];
  const uomTermIds = new Set<string>();

  // Amazon punchout only (item 08): once the resolved vendor is Amazon, each line
  // needs an ASIN mapping (vendor_items.vendor_sku for the Amazon vendor) before
  // the card's "Shop on Amazon" can preload it. We surface amazon_mapped/asin so
  // the card can warn about unmapped lines BEFORE the buyer clicks.
  const isAmazon = vendor.fulfillment === 'amazon_punchout';

  for (const raw of rawLines) {
    const qty = num(raw.qty) ?? 0;
    const item = await resolveItem(supabase, raw.item_ref);

    if (!item) {
      lines.push({
        catalog_item_id: null,
        item_description: raw.item_ref.trim(),
        name: raw.item_ref.trim(),
        qty,
        uom_term_id: null,
        uom_label: 'EA',
        unit_cost: null,
        price_basis: 'unknown',
        line_total: null,
        advisories: [],
        amazon_mapped: false,
        asin: null,
      });
      continue;
    }

    if (item.uom_term_id) uomTermIds.add(item.uom_term_id);

    // ── Price + basis ──────────────────────────────────────────────────────
    let unitCost: number | null = null;
    let basis: PriceBasis = 'unknown';
    let asin: string | null = null;
    if (vendor.vendor_id) {
      const { data: viRows } = await sc
        .from('vendor_items')
        .select('unit_cost, min_order_qty, vendor_address_id, active, last_known_price, vendor_sku')
        .eq('vendor_id', vendor.vendor_id)
        .eq('catalog_item_id', item.id)
        .limit(200);
      const vi = pickVendorItem(viRows ?? [], vendor.address_id);
      if (vi) {
        unitCost = num(vi.unit_cost);
        if (unitCost != null) {
          basis = 'fixed';
        } else if (num(vi.last_known_price) != null) {
          unitCost = num(vi.last_known_price);
          basis = 'market';
        }
      }
      // For Amazon, the vendor_sku on the matched vendor_item IS the ASIN —
      // exactly what punchout/start resolves against. Only an active row with a
      // non-empty sku counts as mapped (matches the start route's resolution).
      if (isAmazon) {
        const mappedRow = (viRows ?? []).find(
          (r: any) => r.active !== false && typeof r.vendor_sku === 'string' && r.vendor_sku.trim(),
        );
        asin = mappedRow ? String(mappedRow.vendor_sku).trim() : null;
      }
    }
    if (unitCost == null) {
      const lastPaid = await fetchLastPaid(sc, tenantId, item.id);
      if (lastPaid != null) {
        unitCost = lastPaid;
        basis = 'estimated';
      }
    }

    // ── Advisories ─────────────────────────────────────────────────────────
    const advisories = await buildLineAdvisories(
      inv, sc, tenantId, item, qty, deliveryLocationId, vendor,
    );

    lines.push({
      catalog_item_id: item.id,
      item_description: null,
      name: item.name ?? raw.item_ref.trim(),
      qty,
      uom_term_id: item.uom_term_id,
      uom_label: 'EA', // resolved from GV below in a batch
      unit_cost: unitCost,
      price_basis: basis,
      line_total: unitCost != null ? Number((unitCost * qty).toFixed(4)) : null,
      advisories: advisories.lineAdvisories,
      amazon_mapped: isAmazon ? asin != null : false,
      asin: isAmazon ? asin : null,
    });

    for (const w of advisories.warnings) warnings.push(w);
  }

  // ── Batch-resolve UOM display labels from GV ──────────────────────────────
  if (uomTermIds.size > 0) {
    try {
      const gv = getGVClient();
      // displayLabels expects branded TermId[]; the repo casts raw ids (see the
      // items route / buyable-groups). uom_term_id values are already valid ids.
      const results = await gv.displayLabels(tenantId, [...uomTermIds] as any);
      const labelMap = new Map<string, string>();
      for (const r of results) labelMap.set(r.term_id, r.short_label || r.label);
      for (const line of lines) {
        if (line.uom_term_id && labelMap.has(line.uom_term_id)) {
          line.uom_label = labelMap.get(line.uom_term_id)!;
        }
      }
    } catch {
      /* GV optional — leave default 'EA' labels */
    }
  }

  const estimatedTotal = lines.reduce((sum, l) => sum + (l.line_total ?? 0), 0);
  const unpricedLineCount = lines.filter((l) => l.unit_cost == null).length;

  const vendorLabel = vendor.name ?? (vendor.pending_adopt ? 'a catalog vendor' : 'a vendor');
  const lineCount = lines.length;
  const totalStr = estimatedTotal > 0 ? ` — about $${estimatedTotal.toFixed(2)}` : '';
  const unpricedStr =
    unpricedLineCount > 0
      ? ` ${unpricedLineCount} line${unpricedLineCount === 1 ? ' has' : 's have'} no price yet.`
      : '';
  const message =
    lineCount === 0
      ? 'No lines to preview — tell me what to order.'
      : `Draft PO to ${vendorLabel}: ${lineCount} line${lineCount === 1 ? '' : 's'}${totalStr}.${unpricedStr}` +
        (vendor.pending_adopt ? ' This vendor isn\'t on file yet — I can add them when you confirm.' : '') +
        (warnings.length > 0 ? ` Heads up: ${warnings.map((w) => w.text).join('; ')}.` : '');

  return {
    ok: lineCount > 0,
    vendor,
    delivery_location_id: deliveryLocationId,
    needed_by_date: input.needed_by_date ?? null,
    cost_context: input.cost_context ?? 'overhead',
    lines,
    estimated_total: Number(estimatedTotal.toFixed(2)),
    unpriced_line_count: unpricedLineCount,
    warnings,
    message,
  };
}

/**
 * Per-line advisory chips + PO-level warnings for one item:
 *  - on_hand:          "12 on hand at Portland" (delivery location)
 *  - surplus_elsewhere:"20 more on hand across other yards"
 *  - open_po:          "PO 26-0031 for Fuel Can is already open" (also a warning)
 *  - min_order:        "Vendor's minimum is 25" when qty < min_order_qty
 */
async function buildLineAdvisories(
  inv: any,
  sc: any,
  tenantId: string,
  item: { id: string; name: string | null },
  qty: number,
  deliveryLocationId: string | null,
  vendor: DraftPoPreviewVendor,
): Promise<{ lineAdvisories: Advisory[]; warnings: Advisory[] }> {
  const lineAdvisories: Advisory[] = [];
  const warnings: Advisory[] = [];
  const itemName = item.name ?? 'this item';

  // On-hand here vs elsewhere.
  const { data: balances } = await inv
    .from('stock_balances')
    .select('location_id, qty_on_hand')
    .eq('tenant_id', tenantId)
    .eq('catalog_item_id', item.id)
    .gt('qty_on_hand', 0)
    .limit(500);
  let hereQty = 0;
  let elsewhereQty = 0;
  const locIds = new Set<string>();
  for (const b of balances ?? []) {
    const q = num(b.qty_on_hand) ?? 0;
    if (deliveryLocationId && b.location_id === deliveryLocationId) hereQty += q;
    else { elsewhereQty += q; if (b.location_id) locIds.add(b.location_id); }
  }
  if (hereQty > 0) {
    const locName = await locationName(inv, tenantId, deliveryLocationId);
    lineAdvisories.push({
      kind: 'on_hand',
      text: `${fmtQty(hereQty)} on hand${locName ? ` at ${locName}` : ''}`,
    });
  }
  if (elsewhereQty > 0) {
    const where =
      locIds.size === 1
        ? (await locationName(inv, tenantId, [...locIds][0])) || 'another yard'
        : `${locIds.size} other yards`;
    lineAdvisories.push({
      kind: 'surplus_elsewhere',
      text: `${fmtQty(elsewhereQty)} more on hand at ${where}`,
    });
  }

  // Open POs already covering this item.
  const { data: openLines } = await sc
    .from('purchase_order_lines')
    .select('po_id, qty_ordered')
    .eq('tenant_id', tenantId)
    .eq('catalog_item_id', item.id)
    .limit(1000);
  const poIds = [...new Set((openLines ?? []).map((l: any) => l.po_id))];
  if (poIds.length > 0) {
    const { data: pos } = await sc
      .from('purchase_orders')
      .select('id, po_number, status')
      .in('id', poIds)
      .in('status', OPEN_PO_STATUSES)
      .limit(1000);
    const openPoNumbers = (pos ?? []).map((p: any) => p.po_number).filter(Boolean);
    if (openPoNumbers.length > 0) {
      const list = openPoNumbers.slice(0, 3).join(', ');
      const text =
        openPoNumbers.length === 1
          ? `PO ${list} for ${itemName} is already open`
          : `${openPoNumbers.length} open POs for ${itemName} (${list})`;
      lineAdvisories.push({ kind: 'open_po', text });
      warnings.push({ kind: 'open_po', text });
    }
  }

  // Min-order nudge from the chosen vendor's vendor_item.
  if (vendor.vendor_id && qty > 0) {
    const { data: viRows } = await sc
      .from('vendor_items')
      .select('min_order_qty, vendor_address_id, active')
      .eq('vendor_id', vendor.vendor_id)
      .eq('catalog_item_id', item.id)
      .limit(200);
    const vi = pickVendorItem(viRows ?? [], vendor.address_id);
    const moq = vi ? num(vi.min_order_qty) : null;
    if (moq != null && qty < moq) {
      lineAdvisories.push({
        kind: 'min_order',
        text: `Vendor's minimum order is ${fmtQty(moq)} — you asked for ${fmtQty(qty)}`,
      });
    }
  }

  return { lineAdvisories, warnings };
}

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

const locNameCache = new Map<string, string | null>();
async function locationName(inv: any, tenantId: string, locationId: string | null): Promise<string | null> {
  if (!locationId) return null;
  const key = `${tenantId}:${locationId}`;
  if (locNameCache.has(key)) return locNameCache.get(key)!;
  const { data } = await inv
    .from('locations')
    .select('name')
    .eq('tenant_id', tenantId)
    .eq('id', locationId)
    .limit(1)
    .maybeSingle();
  const name = data?.name ?? null;
  locNameCache.set(key, name);
  return name;
}

/** Given → verified; else default ship-to; else any active location. */
async function resolveDeliveryLocation(
  inv: any,
  tenantId: string,
  given: string | undefined,
): Promise<string | null> {
  if (given && UUID_RE.test(given)) {
    const { data } = await inv
      .from('locations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', given)
      .limit(1)
      .maybeSingle();
    if (data) return data.id;
  }
  const { data: def } = await inv
    .from('locations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_default_ship_to', true)
    .eq('active', true)
    .limit(1)
    .maybeSingle();
  if (def) return def.id;
  const { data: any1 } = await inv
    .from('locations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .limit(1)
    .maybeSingle();
  return any1?.id ?? null;
}
