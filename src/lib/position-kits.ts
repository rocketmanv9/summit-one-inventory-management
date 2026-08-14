/**
 * Position kits — shared resolution + fulfillment planning.
 *
 * Kits are the "what every new hire in this position gets" recipe
 * (supply_chain.position_kits / position_kit_items, migration
 * 20260814000004). This module is the single place that answers the two
 * questions the feature keeps asking:
 *
 *   resolveKitForHire()   — which kit applies to a hire (position + location)?
 *   planKitFulfillment()  — for that kit at that location, what's on hand vs
 *                           what has to be bought?
 *
 * The settings UI calls both for its read-only "preview a hire" dry run; item
 * 04's automation calls the SAME functions before it reserves stock and drafts
 * the PO, so the preview a human sees and the plan the robot executes can't
 * drift apart.
 */

import { AppError } from '@rocketmanv9/chassis/errors';

export type KitOrderMode = 'draft' | 'auto_submit';

export interface PositionKitItem {
  id: string;
  catalog_item_id: string;
  qty: number;
  preferred_vendor_id: string | null;
  note: string | null;
  sort_order: number;
}

export interface PositionKit {
  id: string;
  tenant_id: string;
  hr_position_id: string;
  location_id: string | null;
  name: string;
  description: string | null;
  active: boolean;
  order_mode: KitOrderMode;
  items: PositionKitItem[];
}

export interface KitPlanLine {
  catalog_item_id: string;
  name: string | null;
  sku: string | null;
  note: string | null;
  needed: number;
  /** qty_available at the planning location (0 when there's no balance row). */
  have: number;
  /** What can be pulled from that location's shelf right now. */
  reserve: number;
  /** What has to be ordered (needed - reserve). */
  shortfall: number;
  preferred_vendor_id: string | null;
}

export interface KitPlan {
  kit_id: string;
  kit_name: string;
  order_mode: KitOrderMode;
  /** Location the plan was computed against (the hire's location). */
  location_id: string;
  lines: KitPlanLine[];
  total_needed: number;
  total_reserve: number;
  total_shortfall: number;
}

/** Rows come back as `any` from the untyped cross-schema Supabase client. */
type AnyClient = any;

/**
 * Which kit applies to a hire?
 *
 * Resolution rule (the one the migration comment states, implemented once
 * here): the kit scoped to the hire's exact location wins; otherwise the
 * all-locations kit (location_id IS NULL); otherwise nothing. Only ACTIVE kits
 * are considered — deactivating a location kit falls back to the general one,
 * which is the behaviour admins expect from an "active" toggle.
 *
 * Keys on hr_position_id (stable UUID), never on title.
 */
export async function resolveKitForHire(
  supabase: AnyClient,
  params: { tenantId: string; hrPositionId: string; locationId?: string | null },
): Promise<PositionKit | null> {
  const sc = supabase.schema('supply_chain');

  const { data: kits, error } = await sc
    .from('position_kits')
    .select('id, tenant_id, hr_position_id, location_id, name, description, active, order_mode')
    .eq('tenant_id', params.tenantId)
    .eq('hr_position_id', params.hrPositionId)
    .eq('active', true)
    .limit(100);
  if (error) throw AppError.internal(`position_kits lookup failed: ${error.message}`);

  const candidates = kits ?? [];
  const exact = params.locationId
    ? candidates.find((k: any) => k.location_id === params.locationId)
    : undefined;
  const general = candidates.find((k: any) => k.location_id === null);
  const kit = exact ?? general;
  if (!kit) return null;

  const { data: items, error: iErr } = await sc
    .from('position_kit_items')
    .select('id, catalog_item_id, qty, preferred_vendor_id, note, sort_order')
    .eq('kit_id', kit.id)
    .order('sort_order', { ascending: true })
    .limit(500);
  if (iErr) throw AppError.internal(`position_kit_items lookup failed: ${iErr.message}`);

  return { ...kit, items: (items ?? []) as PositionKitItem[] } as PositionKit;
}

/**
 * For a kit at a location: how much of each line is already on the shelf, and
 * how much has to be ordered?
 *
 * Plans against inventory.stock_balances.qty_available (available, not on-hand
 * — stock already reserved for a job isn't ours to take). Missing balance row
 * = zero available, so every unit is a shortfall. This function only READS;
 * reserving and PO drafting is item 04's job.
 */
export async function planKitFulfillment(
  supabase: AnyClient,
  params: { tenantId: string; kit: PositionKit; locationId: string },
): Promise<KitPlan> {
  const { kit, locationId } = params;
  const catalogIds = kit.items.map((i) => i.catalog_item_id);

  const availableByItem = new Map<string, number>();
  const catalogById = new Map<string, { name: string | null; sku: string | null }>();

  if (catalogIds.length > 0) {
    const inv = supabase.schema('inventory');

    const { data: balances, error: bErr } = await inv
      .from('stock_balances')
      .select('catalog_item_id, qty_available')
      .eq('location_id', locationId)
      .in('catalog_item_id', catalogIds)
      .limit(1000);
    if (bErr) throw AppError.internal(`stock_balances lookup failed: ${bErr.message}`);
    for (const b of balances ?? []) {
      // One row per (item, location), but sum defensively — a lot-tracked
      // catalog can produce more than one balance row per location.
      const prev = availableByItem.get(b.catalog_item_id) ?? 0;
      availableByItem.set(b.catalog_item_id, prev + Number(b.qty_available ?? 0));
    }

    const { data: catalog, error: cErr } = await inv
      .from('catalog_items')
      .select('id, name, sku')
      .in('id', catalogIds)
      .limit(1000);
    if (cErr) throw AppError.internal(`catalog_items lookup failed: ${cErr.message}`);
    for (const c of catalog ?? []) catalogById.set(c.id, { name: c.name ?? null, sku: c.sku ?? null });
  }

  const lines: KitPlanLine[] = kit.items.map((it) => {
    const needed = Number(it.qty ?? 0);
    // Fractional availability can't be issued as a whole unit — floor it.
    const have = Math.max(0, Math.floor(availableByItem.get(it.catalog_item_id) ?? 0));
    const reserve = Math.min(needed, have);
    const cat = catalogById.get(it.catalog_item_id);
    return {
      catalog_item_id: it.catalog_item_id,
      name: cat?.name ?? null,
      sku: cat?.sku ?? null,
      note: it.note ?? null,
      needed,
      have,
      reserve,
      shortfall: Math.max(0, needed - reserve),
      preferred_vendor_id: it.preferred_vendor_id ?? null,
    };
  });

  return {
    kit_id: kit.id,
    kit_name: kit.name,
    order_mode: kit.order_mode,
    location_id: locationId,
    lines,
    total_needed: lines.reduce((s, l) => s + l.needed, 0),
    total_reserve: lines.reduce((s, l) => s + l.reserve, 0),
    total_shortfall: lines.reduce((s, l) => s + l.shortfall, 0),
  };
}
