// Unit tests for Isabelle's Draft-PO preview builder (sprint item 02).
//
// buildDraftPoPreview is DB-coupled, so we drive it with a per-schema / per-table
// object stub — the same "mock Supabase via object stubs" approach CLAUDE.md
// mandates — and assert the assembled card: priced lines + price_basis, on-hand
// here vs elsewhere advisories, the open-PO warning, the min-order nudge, the
// estimated total / unpriced count, and the GV-candidate pending_adopt path.
//
// The GV + catalog SDK clients are mocked to no-op so the builder degrades
// gracefully (default 'EA' label, best-effort catalog name) exactly as in prod
// when those services are unreachable.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// resolveItem lives in recommend-vendor; stub it so we don't need the catalog_items
// matcher here — these tests are about the preview assembly, not item resolution.
vi.mock('@/lib/ai/recommend-vendor', () => ({
  resolveItem: vi.fn(),
}));
vi.mock('@/lib/gv', () => ({
  getGVClient: () => ({ displayLabels: vi.fn().mockResolvedValue([]) }),
}));
vi.mock('@/lib/vendors', () => ({
  getCatalogClient: () => ({ getById: vi.fn().mockResolvedValue({ name: 'Catalog Co' }) }),
}));

import { buildDraftPoPreview } from '@/lib/ai/draft-po-preview';
import { resolveItem } from '@/lib/ai/recommend-vendor';

const TENANT = '052abee2-ffdc-470e-975a-b917dde72b8e';
const VENDOR = '17315130-e883-4349-9b7d-d49a935d2b45';
const ITEM = '591d8f89-1ea5-4ab6-887b-43b8cd8bd2ef';
const HERE = 'aaaaaaaa-0000-0000-0000-000000000001'; // default ship-to
const THERE = 'bbbbbbbb-0000-0000-0000-000000000002';

// ── A tiny Supabase query stub ────────────────────────────────────────────────
// Each table returns a fixed row set; the chainable filter methods are no-ops that
// return `this`, and the terminal awaits resolve to { data }. Good enough for the
// builder's read-only queries (it never inspects filter args beyond correctness).

type Rows = any[];

function makeQuery(rows: Rows) {
  const q: any = {
    _rows: rows,
    select: () => q,
    eq: () => q,
    in: () => q,
    gt: () => q,
    not: () => q,
    limit: () => q,
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null }),
    then: (resolve: any) => resolve({ data: rows }),
  };
  return q;
}

interface TableData {
  [table: string]: Rows;
}

function makeSchema(tables: TableData) {
  return {
    from: (table: string) => makeQuery(tables[table] ?? []),
  };
}

function makeSupabase(schemas: { supply_chain: TableData; inventory: TableData }) {
  return {
    schema: (name: 'supply_chain' | 'inventory') => makeSchema(schemas[name]),
  };
}

const mockResolveItem = resolveItem as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildDraftPoPreview', () => {
  it('prices a vendor_items line as fixed and sums the estimated total', async () => {
    mockResolveItem.mockResolvedValue({ id: ITEM, name: 'Fuel Can', uom_term_id: null, category_id: null });

    const supabase = makeSupabase({
      supply_chain: {
        vendors: [{ id: VENDOR, name: 'ACME Fuels', code: 'ACME' }],
        vendor_items: [{ unit_cost: 50, min_order_qty: null, vendor_address_id: null, active: true, last_known_price: null }],
        purchase_order_lines: [],
        purchase_orders: [],
      },
      inventory: {
        locations: [{ id: HERE }],
        stock_balances: [],
      },
    });

    const res = await buildDraftPoPreview(supabase, TENANT, {
      vendor_id: VENDOR,
      lines: [{ item_ref: 'Fuel Can', qty: 5 }],
    });

    expect(res.ok).toBe(true);
    expect(res.vendor.vendor_id).toBe(VENDOR);
    expect(res.vendor.pending_adopt).toBe(false);
    expect(res.lines).toHaveLength(1);
    const line = res.lines[0];
    expect(line.catalog_item_id).toBe(ITEM);
    expect(line.unit_cost).toBe(50);
    expect(line.price_basis).toBe('fixed');
    expect(line.line_total).toBe(250);
    expect(res.estimated_total).toBe(250);
    expect(res.unpriced_line_count).toBe(0);
  });

  it('emits on-hand-here and surplus-elsewhere advisories from stock_balances', async () => {
    mockResolveItem.mockResolvedValue({ id: ITEM, name: 'Fuel Can', uom_term_id: null, category_id: null });

    const supabase = makeSupabase({
      supply_chain: {
        vendors: [{ id: VENDOR, name: 'ACME Fuels', code: 'ACME' }],
        vendor_items: [{ unit_cost: 50, min_order_qty: null, vendor_address_id: null, active: true, last_known_price: null }],
        purchase_order_lines: [],
        purchase_orders: [],
      },
      inventory: {
        // maybeSingle() returns rows[0] → resolveDeliveryLocation picks HERE;
        // locationName() also reads locations (rows[0].name).
        locations: [{ id: HERE, name: 'Reno' }],
        stock_balances: [
          { location_id: HERE, qty_on_hand: 12 },
          { location_id: THERE, qty_on_hand: 8 },
        ],
      },
    });

    const res = await buildDraftPoPreview(supabase, TENANT, {
      vendor_id: VENDOR,
      delivery_location_id: HERE,
      lines: [{ item_ref: 'Fuel Can', qty: 5 }],
    });

    const kinds = res.lines[0].advisories.map((a) => a.kind);
    expect(kinds).toContain('on_hand');
    expect(kinds).toContain('surplus_elsewhere');
    const onHand = res.lines[0].advisories.find((a) => a.kind === 'on_hand')!;
    expect(onHand.text).toContain('12');
  });

  it('warns about an open PO already covering the item', async () => {
    mockResolveItem.mockResolvedValue({ id: ITEM, name: 'Fuel Can', uom_term_id: null, category_id: null });

    const supabase = makeSupabase({
      supply_chain: {
        vendors: [{ id: VENDOR, name: 'ACME Fuels', code: 'ACME' }],
        vendor_items: [{ unit_cost: 50, min_order_qty: null, vendor_address_id: null, active: true, last_known_price: null }],
        purchase_order_lines: [{ po_id: 'po-1', qty_ordered: 10 }],
        purchase_orders: [{ id: 'po-1', po_number: '26-0047', status: 'approved' }],
      },
      inventory: {
        locations: [{ id: HERE, name: 'Reno' }],
        stock_balances: [],
      },
    });

    const res = await buildDraftPoPreview(supabase, TENANT, {
      vendor_id: VENDOR,
      lines: [{ item_ref: 'Fuel Can', qty: 5 }],
    });

    expect(res.warnings.some((w) => w.kind === 'open_po' && w.text.includes('26-0047'))).toBe(true);
    expect(res.lines[0].advisories.some((a) => a.kind === 'open_po')).toBe(true);
  });

  it('nudges when the order is below the vendor minimum', async () => {
    mockResolveItem.mockResolvedValue({ id: ITEM, name: 'Fuel Can', uom_term_id: null, category_id: null });

    const supabase = makeSupabase({
      supply_chain: {
        vendors: [{ id: VENDOR, name: 'ACME Fuels', code: 'ACME' }],
        vendor_items: [{ unit_cost: 50, min_order_qty: 25, vendor_address_id: null, active: true, last_known_price: null }],
        purchase_order_lines: [],
        purchase_orders: [],
      },
      inventory: {
        locations: [{ id: HERE, name: 'Reno' }],
        stock_balances: [],
      },
    });

    const res = await buildDraftPoPreview(supabase, TENANT, {
      vendor_id: VENDOR,
      lines: [{ item_ref: 'Fuel Can', qty: 5 }],
    });

    const moq = res.lines[0].advisories.find((a) => a.kind === 'min_order');
    expect(moq).toBeTruthy();
    expect(moq!.text).toContain('25');
  });

  it('keeps an unresolved item as an unpriced free-text line', async () => {
    mockResolveItem.mockResolvedValue(null);

    const supabase = makeSupabase({
      supply_chain: {
        vendors: [{ id: VENDOR, name: 'ACME Fuels', code: 'ACME' }],
        vendor_items: [],
        purchase_order_lines: [],
        purchase_orders: [],
      },
      inventory: { locations: [{ id: HERE }], stock_balances: [] },
    });

    const res = await buildDraftPoPreview(supabase, TENANT, {
      vendor_id: VENDOR,
      lines: [{ item_ref: 'Mystery Widget', qty: 3 }],
    });

    expect(res.lines).toHaveLength(1);
    expect(res.lines[0].catalog_item_id).toBeNull();
    expect(res.lines[0].item_description).toBe('Mystery Widget');
    expect(res.lines[0].price_basis).toBe('unknown');
    expect(res.unpriced_line_count).toBe(1);
    expect(res.estimated_total).toBe(0);
  });

  it('marks a GV-only vendor pending_adopt and still renders lines', async () => {
    mockResolveItem.mockResolvedValue({ id: ITEM, name: 'Fuel Can', uom_term_id: null, category_id: null });

    const CATALOG_VENDOR = 'cccccccc-0000-0000-0000-000000000003';
    const supabase = makeSupabase({
      supply_chain: {
        // Not adopted: vendors lookup by catalog_vendor_id returns nothing.
        vendors: [],
        vendor_items: [],
        purchase_order_lines: [],
        purchase_orders: [],
      },
      inventory: { locations: [{ id: HERE }], stock_balances: [] },
    });

    const res = await buildDraftPoPreview(supabase, TENANT, {
      catalog_vendor_id: CATALOG_VENDOR,
      lines: [{ item_ref: 'Fuel Can', qty: 5 }],
    });

    expect(res.vendor.pending_adopt).toBe(true);
    expect(res.vendor.vendor_id).toBeNull();
    expect(res.vendor.catalog_vendor_id).toBe(CATALOG_VENDOR);
    expect(res.lines).toHaveLength(1);
    // No tenant vendor → no vendor_items price → unpriced line, still rendered.
    expect(res.lines[0].catalog_item_id).toBe(ITEM);
  });

  // ── Amazon punchout detection (sprint item 08) ──────────────────────────────

  it('flags an Amazon vendor as fulfillment=amazon_punchout with a mapped line + ASIN', async () => {
    mockResolveItem.mockResolvedValue({ id: ITEM, name: 'Fuel Can', uom_term_id: null, category_id: null });

    const supabase = makeSupabase({
      supply_chain: {
        // ordering_mode is the canonical Amazon flag (also code='AMAZON-BIZ').
        vendors: [{ id: VENDOR, name: 'Amazon Business', code: 'AMAZON-BIZ', ordering_mode: 'amazon_punchout' }],
        // vendor_sku carries the ASIN — this is what punchout/start resolves.
        vendor_items: [{
          unit_cost: 50, min_order_qty: null, vendor_address_id: null,
          active: true, last_known_price: null, vendor_sku: 'B0ABCD1234',
        }],
        purchase_order_lines: [],
        purchase_orders: [],
      },
      inventory: {
        locations: [{ id: HERE }],
        stock_balances: [],
      },
    });

    const res = await buildDraftPoPreview(supabase, TENANT, {
      vendor_id: VENDOR,
      lines: [{ item_ref: 'Fuel Can', qty: 5 }],
    });

    expect(res.vendor.fulfillment).toBe('amazon_punchout');
    expect(res.lines).toHaveLength(1);
    expect(res.lines[0].amazon_mapped).toBe(true);
    expect(res.lines[0].asin).toBe('B0ABCD1234');
  });

  it('marks an Amazon line unmapped when the vendor_item has no ASIN', async () => {
    mockResolveItem.mockResolvedValue({ id: ITEM, name: 'Fuel Can', uom_term_id: null, category_id: null });

    const supabase = makeSupabase({
      supply_chain: {
        vendors: [{ id: VENDOR, name: 'Amazon Business', code: 'AMAZON-BIZ', ordering_mode: 'amazon_punchout' }],
        // Priced but no vendor_sku → not orderable through Amazon yet.
        vendor_items: [{
          unit_cost: 50, min_order_qty: null, vendor_address_id: null,
          active: true, last_known_price: null, vendor_sku: null,
        }],
        purchase_order_lines: [],
        purchase_orders: [],
      },
      inventory: { locations: [{ id: HERE }], stock_balances: [] },
    });

    const res = await buildDraftPoPreview(supabase, TENANT, {
      vendor_id: VENDOR,
      lines: [{ item_ref: 'Fuel Can', qty: 5 }],
    });

    expect(res.vendor.fulfillment).toBe('amazon_punchout');
    expect(res.lines[0].amazon_mapped).toBe(false);
    expect(res.lines[0].asin).toBeNull();
  });

  it('leaves a standard vendor as fulfillment=standard with no amazon fields set', async () => {
    mockResolveItem.mockResolvedValue({ id: ITEM, name: 'Fuel Can', uom_term_id: null, category_id: null });

    const supabase = makeSupabase({
      supply_chain: {
        vendors: [{ id: VENDOR, name: 'ACME Fuels', code: 'ACME', ordering_mode: 'email' }],
        // Even a vendor_sku here must NOT flip amazon_mapped for a non-Amazon vendor.
        vendor_items: [{
          unit_cost: 50, min_order_qty: null, vendor_address_id: null,
          active: true, last_known_price: null, vendor_sku: 'SOME-SKU',
        }],
        purchase_order_lines: [],
        purchase_orders: [],
      },
      inventory: { locations: [{ id: HERE }], stock_balances: [] },
    });

    const res = await buildDraftPoPreview(supabase, TENANT, {
      vendor_id: VENDOR,
      lines: [{ item_ref: 'Fuel Can', qty: 5 }],
    });

    expect(res.vendor.fulfillment).toBe('standard');
    // Otherwise unchanged: still priced fixed at 50, total 250.
    expect(res.lines[0].amazon_mapped).toBe(false);
    expect(res.lines[0].asin).toBeNull();
    expect(res.lines[0].unit_cost).toBe(50);
    expect(res.lines[0].price_basis).toBe('fixed');
    expect(res.estimated_total).toBe(250);
  });
});
