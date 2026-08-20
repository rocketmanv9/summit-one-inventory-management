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

import { resolveGuidedPurchaseVendorId } from '@/lib/external-orders';
import { resolveHRLocationName } from '@/lib/hr';

export type KitOrderMode = 'draft' | 'auto_submit';

/** The slice of the chassis route logger this module actually uses. */
export interface KitLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
}

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

/* ────────────────────────────────────────────────────────────────────────────
 * Item 04 — the automation half: provision a new hire.
 *
 * One person arrives in HR. This is everything that happens next:
 *
 *   resolve their location  → resolve their kit → freeze the plan
 *   → reserve what's on the shelf → draft PO(s) for the shortfall
 *   → (order_mode auto_submit) route the PO into the approval inbox
 *   → write it all down in supply_chain.position_kit_provisions
 *
 * NOTHING is ever ordered from a vendor here. "Auto ordering" ends at
 * awaiting_approval — a human still approves, and sending is a separate step.
 *
 * Idempotency is the whole ballgame: the hub webhook fires in realtime and
 * runHRSync sweeps nightly, so provisionHire() WILL be called more than once
 * for the same person. The ledger's partial unique indexes
 * (uq_kit_provision_person_kit / uq_kit_provision_person_nokit, migration
 * 20260814000005) make the second call a no-op instead of a second laptop.
 * ──────────────────────────────────────────────────────────────────────────── */

export type ProvisionSource = 'webhook' | 'sync' | 'manual';

export type ProvisionStatus =
  | 'provisioned'
  | 'skipped_no_kit'
  | 'skipped_backfill'
  | 'planned'
  | 'error';

export interface ProvisionOutcome {
  provision_id: string | null;
  hr_person_id: string;
  person_name: string | null;
  /** `noop` = a ledger row already settled this person; nothing was done. */
  status: ProvisionStatus | 'noop' | 'skipped_inactive';
  kit_id: string | null;
  kit_name: string | null;
  order_mode: KitOrderMode | null;
  location_id: string | null;
  reservation_ids: string[];
  purchase_order_ids: string[];
  plan: KitPlan | null;
  message: string;
}

interface HirePerson {
  hr_person_id: string;
  hr_position_id: string | null;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  location_name: string | null;
  hr_location_id: string | null;
  is_active: boolean;
}

export function hireDisplayName(p: {
  preferred_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}): string | null {
  const name = `${p.preferred_name || p.first_name || ''} ${p.last_name || ''}`.trim();
  return name || null;
}

/**
 * HR location → inventory location.
 *
 * There is no mapping table: HR carries `hr_people.location_name` (mirrored by
 * src/lib/hr.ts) and inventory carries `inventory.locations.name`, and on stage
 * they are the same four strings (Auburn / Portland / Kingston / Reno). So we
 * match by name, case-insensitively, active locations only. A hire whose HR
 * location doesn't match anything is recorded as an `error` provision (visible
 * and retryable in the onboarding queue) rather than being silently kitted at
 * the wrong yard — shipping someone's boots to the wrong state is worse than
 * waiting for a human to fix the location.
 *
 * `hrLocationId` is the belt to the name's braces: an ingress that only stamped
 * the HR location UUID (the webhook did exactly this) still resolves, because
 * any other mirrored person at that yard knows its name.
 */
export async function resolveHireLocationId(
  supabase: AnyClient,
  params: { tenantId: string; locationName: string | null; hrLocationId?: string | null },
): Promise<{ id: string; name: string } | null> {
  let name = params.locationName?.trim() || null;
  if (!name && params.hrLocationId) {
    name = await resolveHRLocationName(supabase, params.tenantId, params.hrLocationId);
  }
  if (!name) return null;

  const { data, error } = await supabase
    .schema('inventory')
    .from('locations')
    .select('id, name, active')
    .eq('tenant_id', params.tenantId)
    .eq('active', true)
    .ilike('name', name)
    .limit(5);
  if (error) throw AppError.internal(`locations lookup failed: ${error.message}`);

  const exact = (data ?? []).find(
    (l: any) => (l.name ?? '').trim().toLowerCase() === name.toLowerCase(),
  );
  const hit = exact ?? (data ?? [])[0];
  return hit ? { id: hit.id, name: hit.name } : null;
}

/**
 * Machine-created POs still need an author (spend limits, budgets and approval
 * routing all key on the buyer). Same fallback the nightly reorder generator
 * uses: the most recent human PO creator in this tenant.
 */
async function resolveFallbackBuyer(supabase: AnyClient, tenantId: string): Promise<string | null> {
  const { data } = await supabase
    .schema('supply_chain')
    .from('purchase_orders')
    .select('created_by_user_id')
    .eq('tenant_id', tenantId)
    .not('created_by_user_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.created_by_user_id) return data.created_by_user_id;

  const { data: anyUser } = await supabase
    .from('local_users')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .not('email', 'is', null)
    .limit(1)
    .maybeSingle();
  return anyUser?.user_id ?? null;
}

async function writeLedger(
  supabase: AnyClient,
  row: Record<string, unknown>,
  existingId: string | null,
): Promise<string | null> {
  const sc = supabase.schema('supply_chain');
  if (existingId) {
    const { data, error } = await sc
      .from('position_kit_provisions')
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq('id', existingId)
      .select('id')
      .maybeSingle();
    if (error) throw AppError.internal(`provision ledger update failed: ${error.message}`);
    return data?.id ?? existingId;
  }
  const { data, error } = await sc
    .from('position_kit_provisions')
    .insert(row)
    .select('id')
    .maybeSingle();
  if (error) throw AppError.internal(`provision ledger insert failed: ${error.message}`);
  return data?.id ?? null;
}

/**
 * Provision one hire. Safe to call repeatedly.
 *
 * `force` (the queue's "Provision now" button) re-runs a row that ended in
 * `error` or got stuck in `planned` — it never re-runs a `provisioned` row, so
 * a frustrated double-click can't double-order.
 */
export async function provisionHire(
  supabase: AnyClient,
  params: {
    tenantId: string;
    hrPersonId: string;
    source: ProvisionSource;
    actingUserId?: string | null;
    force?: boolean;
    log?: KitLogger;
  },
): Promise<ProvisionOutcome> {
  const { tenantId, hrPersonId, source } = params;
  const log = params.log;
  const sc = supabase.schema('supply_chain');
  const inv = supabase.schema('inventory');

  const base: ProvisionOutcome = {
    provision_id: null,
    hr_person_id: hrPersonId,
    person_name: null,
    status: 'noop',
    kit_id: null,
    kit_name: null,
    order_mode: null,
    location_id: null,
    reservation_ids: [],
    purchase_order_ids: [],
    plan: null,
    message: '',
  };

  // ── The person ────────────────────────────────────────────────────────────
  const { data: person, error: pErr } = await supabase
    .from('hr_people')
    .select(
      'hr_person_id, hr_position_id, first_name, last_name, preferred_name, location_name, hr_location_id, is_active',
    )
    .eq('tenant_id', tenantId)
    .eq('hr_person_id', hrPersonId)
    .maybeSingle();
  if (pErr) throw AppError.internal(`hr_people lookup failed: ${pErr.message}`);
  if (!person) throw AppError.notFound(`No HR person ${hrPersonId} in the roster`);

  const hire = person as HirePerson;
  base.person_name = hireDisplayName(hire);

  if (!hire.is_active) {
    return { ...base, status: 'skipped_inactive', message: 'HR record is not active — no kit provisioned.' };
  }

  // ── Prior ledger rows = the idempotency gate ──────────────────────────────
  const { data: priorRows, error: lErr } = await sc
    .from('position_kit_provisions')
    .select('id, kit_id, status')
    .eq('tenant_id', tenantId)
    .eq('hr_person_id', hrPersonId)
    .limit(50);
  if (lErr) throw AppError.internal(`provision ledger read failed: ${lErr.message}`);

  const prior = priorRows ?? [];
  const settled = prior.filter(
    (r: any) => r.status === 'provisioned' || r.status === 'skipped_backfill' || r.status === 'skipped_no_kit',
  );
  const retryable = prior.find((r: any) => r.status === 'error' || r.status === 'planned');

  // Already handled — this is where the nightly sync re-seeing a hire lands,
  // and where a replayed webhook stops. A 'provisioned' row is never re-run,
  // force or not.
  if (settled.some((r: any) => r.status === 'provisioned')) {
    const done = settled.find((r: any) => r.status === 'provisioned');
    return {
      ...base,
      provision_id: done.id,
      kit_id: done.kit_id ?? null,
      status: 'noop',
      message: 'Already provisioned.',
    };
  }
  if (settled.length > 0 && !params.force) {
    return {
      ...base,
      provision_id: settled[0].id,
      kit_id: settled[0].kit_id ?? null,
      status: 'noop',
      message: `Already handled (${settled[0].status}).`,
    };
  }

  // Re-runnable rows (an 'error' or a crashed 'planned' claim) are updated in
  // place; a settled skip that a human explicitly forces reuses its row too, so
  // the partial unique indexes never fire.
  const existingId: string | null = retryable?.id ?? settled[0]?.id ?? null;
  const nowIso = new Date().toISOString();

  const positionTitleRow = hire.hr_position_id
    ? (
        await supabase
          .from('positions')
          .select('title')
          .eq('tenant_id', tenantId)
          .eq('hr_position_id', hire.hr_position_id)
          .maybeSingle()
      ).data
    : null;
  const positionTitle: string | null = positionTitleRow?.title ?? null;

  const stamp = {
    tenant_id: tenantId,
    hr_person_id: hrPersonId,
    person_name: base.person_name,
    position_title: positionTitle,
    hr_position_id: hire.hr_position_id,
    location_name: hire.location_name,
    source,
  };

  // ── No position on the HR record → nothing to resolve ─────────────────────
  if (!hire.hr_position_id) {
    const id = await writeLedger(
      supabase,
      { ...stamp, kit_id: null, status: 'skipped_no_kit', processed_at: nowIso, error: null, plan: null },
      existingId,
    );
    return {
      ...base,
      provision_id: id,
      status: 'skipped_no_kit',
      message: 'HR record has no position — no kit to resolve.',
    };
  }

  // ── Location ──────────────────────────────────────────────────────────────
  const location = await resolveHireLocationId(supabase, {
    tenantId,
    locationName: hire.location_name,
    hrLocationId: hire.hr_location_id,
  });
  if (location && !hire.location_name) {
    // Resolved via the hr_location_id fallback: heal the mirror so the roster,
    // the onboarding queue and every later run read a real name.
    hire.location_name = location.name;
    stamp.location_name = location.name;
    await supabase
      .from('hr_people')
      .update({ location_name: location.name })
      .eq('tenant_id', tenantId)
      .eq('hr_person_id', hrPersonId);
  }
  if (!location) {
    const msg = hire.location_name
      ? `No active inventory location matches the HR location "${hire.location_name}" — kit held.`
      : 'HR record has no location — kit held until one is set.';
    const id = await writeLedger(
      supabase,
      { ...stamp, kit_id: null, status: 'error', error: msg, processed_at: null, plan: null },
      existingId,
    );
    log?.warn('kit_provision.location_unresolved', {
      hr_person_id: hrPersonId,
      location_name: hire.location_name,
    });
    return { ...base, provision_id: id, status: 'error', message: msg };
  }
  base.location_id = location.id;

  // ── Kit ───────────────────────────────────────────────────────────────────
  const kit = await resolveKitForHire(supabase, {
    tenantId,
    hrPositionId: hire.hr_position_id,
    locationId: location.id,
  });
  if (!kit) {
    const id = await writeLedger(
      supabase,
      {
        ...stamp,
        kit_id: null,
        location_id: location.id,
        status: 'skipped_no_kit',
        processed_at: nowIso,
        error: null,
        plan: null,
      },
      existingId,
    );
    return {
      ...base,
      provision_id: id,
      status: 'skipped_no_kit',
      message: `No kit configured for ${positionTitle ?? 'this position'} at ${location.name}.`,
    };
  }
  base.kit_id = kit.id;
  base.kit_name = kit.name;
  base.order_mode = kit.order_mode;

  // ── Plan, then CLAIM before acting ────────────────────────────────────────
  // Ledger row first (status 'planned'), work second, finalize third. A crash
  // in the middle leaves a 'planned' row the queue can retry — never a silent
  // half-provision.
  const plan = await planKitFulfillment(supabase, { tenantId, kit, locationId: location.id });
  base.plan = plan;

  const claimId = await writeLedger(
    supabase,
    {
      ...stamp,
      kit_id: kit.id,
      location_id: location.id,
      order_mode: kit.order_mode,
      status: 'planned',
      plan,
      error: null,
      processed_at: null,
    },
    existingId,
  );
  base.provision_id = claimId;

  try {
    // ── Reserve what's on the shelf ─────────────────────────────────────────
    const reservationIds: string[] = [];
    for (const line of plan.lines) {
      if (line.reserve <= 0) continue;
      const { data: res, error: rErr } = await inv
        .from('reservations')
        .insert({
          tenant_id: tenantId,
          catalog_item_id: line.catalog_item_id,
          location_id: location.id,
          qty: line.reserve,
          status: 'active',
          reservation_type: 'fungible',
          allocation_type: 'onboarding',
          commitment_level: 'hard',
          job_ref: {
            hr_person_id: hrPersonId,
            kit_id: kit.id,
            person_name: base.person_name,
            position_title: positionTitle,
          },
          notes: `New hire kit — ${base.person_name ?? 'incoming employee'} (${kit.name})`,
          last_event_id: crypto.randomUUID(),
        })
        .select('id')
        .maybeSingle();
      if (rErr) {
        // Stock moved between planning and reserving (someone consumed it).
        // Don't fail the whole provisioning — order that quantity instead.
        log?.warn('kit_provision.reserve_failed', {
          hr_person_id: hrPersonId,
          catalog_item_id: line.catalog_item_id,
          qty: line.reserve,
          error: rErr.message,
        });
        line.shortfall += line.reserve;
        line.reserve = 0;
        continue;
      }
      if (res?.id) reservationIds.push(res.id);
    }
    plan.total_reserve = plan.lines.reduce((s, l) => s + l.reserve, 0);
    plan.total_shortfall = plan.lines.reduce((s, l) => s + l.shortfall, 0);

    // ── Draft PO(s) for the shortfall, grouped by preferred vendor ──────────
    const purchaseOrderIds: string[] = [];
    const shortLines = plan.lines.filter((l) => l.shortfall > 0);

    if (shortLines.length > 0) {
      const buyerUserId = params.actingUserId ?? (await resolveFallbackBuyer(supabase, tenantId));

      // Vendor pricing, so an auto_submit PO isn't rejected for unpriced lines.
      const priceKey = (v: string, c: string) => `${v}::${c}`;
      const priceByVendorItem = new Map<string, number>();
      const vendorIds = [
        ...new Set(shortLines.map((l) => l.preferred_vendor_id).filter(Boolean)),
      ] as string[];
      if (vendorIds.length > 0) {
        const { data: vItems } = await sc
          .from('vendor_items')
          .select('vendor_id, catalog_item_id, unit_cost, last_known_price')
          .eq('tenant_id', tenantId)
          .in('vendor_id', vendorIds)
          .in(
            'catalog_item_id',
            shortLines.map((l) => l.catalog_item_id),
          )
          .limit(500);
        for (const vi of vItems ?? []) {
          const cost = vi.unit_cost ?? vi.last_known_price;
          if (cost != null) priceByVendorItem.set(priceKey(vi.vendor_id, vi.catalog_item_id), Number(cost));
        }
      }

      const groups = new Map<string, KitPlanLine[]>();
      for (const l of shortLines) {
        const key = l.preferred_vendor_id ?? 'none';
        groups.set(key, [...(groups.get(key) ?? []), l]);
      }

      for (const [vendorKey, lines] of groups) {
        const realVendorId = vendorKey === 'none' ? null : vendorKey;
        // No vendor on file → guided-purchase placeholder, the same convention
        // snap-a-list and the shortfall drafts use. Lines stay catalog-mapped
        // so receiving still works once a buyer assigns the real vendor.
        const vendorId = realVendorId ?? (await resolveGuidedPurchaseVendorId(supabase, tenantId, null));

        const poLines = lines.map((l) => {
          const cost = realVendorId
            ? priceByVendorItem.get(priceKey(realVendorId, l.catalog_item_id))
            : undefined;
          return {
            catalog_item_id: l.catalog_item_id,
            qty_ordered: l.shortfall,
            unit_cost: cost,
            price_basis: cost != null ? 'fixed' : 'unknown',
            line_notes: [`New hire kit: ${base.person_name ?? 'incoming employee'}`, l.note]
              .filter(Boolean)
              .join(' — '),
          };
        });

        const { data: poResult, error: poErr } = await sc.rpc('rpc_create_purchase_order', {
          p_vendor_id: vendorId,
          p_delivery_method: 'ship',
          p_delivery_location_id: location.id,
          p_needed_by_date: null,
          p_cost_context: 'overhead',
          p_notes:
            `New hire kit — ${base.person_name ?? 'incoming employee'}` +
            `${positionTitle ? `, ${positionTitle}` : ''} at ${location.name}. Kit: ${kit.name}.` +
            (realVendorId ? '' : ' No vendor on file; assign a vendor before approving.'),
          p_lines: poLines,
          p_initiated_by: 'user',
          p_tenant_id: tenantId,
          p_acting_user_id: buyerUserId,
        });
        if (poErr) throw AppError.internal(`Kit PO creation failed: ${poErr.message}`);

        const poId = poResult?.po_id ?? null;
        if (!poId) continue;
        purchaseOrderIds.push(poId);

        // Badge it — rpc_create_purchase_order defaults origin='user'.
        await sc.from('purchase_orders').update({ origin: 'onboarding' }).eq('id', poId).eq('tenant_id', tenantId);

        // Always route the shortfall PO into the approval inbox through item
        // 02's resolver, so a new hire's needs surface for a decision in ONE
        // place instead of sitting as an invisible draft. (Grant, 2026-08-20:
        // "if we don't have it, it offers to create a PO that shows up in the
        // inbox.") order_mode only tweaks the wording; approval is still a human
        // step and nothing is sent to a vendor here.
        if (poResult?.status === 'draft') {
          const { data: approver } = await sc.rpc('resolve_po_approver', {
            p_tenant_id: tenantId,
            p_buyer_user_id: buyerUserId,
            p_delivery_location_id: location.id,
          });
          const { error: subErr } = await sc
            .from('purchase_orders')
            .update({
              status: 'awaiting_approval',
              approval_reason:
                `New hire kit (${kit.name}) for ${base.person_name ?? 'an incoming employee'}` +
                (realVendorId ? '' : ' — no vendor on file, assign one before approving'),
              approver_user_id: approver ?? null,
            })
            .eq('id', poId)
            .eq('tenant_id', tenantId);
          if (subErr) log?.warn('kit_provision.submit_failed', { po_id: poId, error: subErr.message });
        }
      }
    }

    const doneId = await writeLedger(
      supabase,
      {
        ...stamp,
        kit_id: kit.id,
        location_id: location.id,
        order_mode: kit.order_mode,
        status: 'provisioned',
        plan,
        reservation_ids: reservationIds,
        purchase_order_ids: purchaseOrderIds,
        error: null,
        processed_at: new Date().toISOString(),
      },
      claimId,
    );

    log?.info('kit_provision.provisioned', {
      hr_person_id: hrPersonId,
      kit_id: kit.id,
      reservations: reservationIds.length,
      purchase_orders: purchaseOrderIds.length,
      source,
    });

    return {
      ...base,
      provision_id: doneId,
      status: 'provisioned',
      reservation_ids: reservationIds,
      purchase_order_ids: purchaseOrderIds,
      plan,
      message: `Reserved ${plan.total_reserve}, ordered ${plan.total_shortfall} across ${purchaseOrderIds.length} PO(s).`,
    };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    await writeLedger(
      supabase,
      {
        ...stamp,
        kit_id: kit.id,
        location_id: location.id,
        order_mode: kit.order_mode,
        status: 'error',
        error: message,
        plan,
      },
      claimId,
    );
    log?.warn('kit_provision.failed', { hr_person_id: hrPersonId, kit_id: kit.id, error: message });
    return { ...base, provision_id: claimId, status: 'error', message };
  }
}

/**
 * Sync-diff pass: active people the automation still owes a kit.
 *
 * This is the catch-up path — stage's realtime ingress is the hub webhook, and
 * a missed (or never-registered) delivery would otherwise mean a hire never
 * gets kitted. Everyone who existed when migration 20260814000005 ran already
 * carries a `skipped_backfill` row, so this only ever sees genuinely NEW people.
 *
 * TWO kinds of candidate, and the second one is not optional:
 *   1. active people with NO ledger row at all — the classic missed webhook.
 *   2. active people whose ONLY rows are `error` or a crashed `planned` claim
 *      and haven't been touched for RETRY_AFTER_MS. Without this the catch-up
 *      is poisoned by the realtime path: a webhook that failed (bad location,
 *      transient DB error) leaves a ledger row, and "no ledger row" would skip
 *      that person forever, so the nightly sync could never heal a failure it
 *      was supposed to be the safety net for. Retrying is safe — provisionHire
 *      updates the same row in place and never re-runs a `provisioned` one.
 *
 * `limit` caps the blast radius of a surprise — an HR reseed that mints new
 * person ids would look like a hundred new hires. The rest are picked up on the
 * next run, and the deferred count is logged.
 */
const RETRY_AFTER_MS = 10 * 60 * 1000;

export async function provisionNewHires(
  supabase: AnyClient,
  params: { tenantId: string; log?: KitLogger; limit?: number },
): Promise<{
  candidates: number;
  provisioned: number;
  skipped: number;
  errors: number;
  retried: number;
}> {
  const { tenantId } = params;
  const limit = params.limit ?? 25;

  const { data: people, error } = await supabase
    .from('hr_people')
    .select('hr_person_id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .limit(10000);
  if (error) throw AppError.internal(`hr_people read failed: ${error.message}`);

  const { data: ledger, error: lErr } = await supabase
    .schema('supply_chain')
    .from('position_kit_provisions')
    .select('hr_person_id, status, updated_at, created_at')
    .eq('tenant_id', tenantId)
    .limit(20000);
  if (lErr) throw AppError.internal(`provision ledger read failed: ${lErr.message}`);

  const rowsByPerson = new Map<string, any[]>();
  for (const r of ledger ?? []) {
    const list = rowsByPerson.get(r.hr_person_id);
    if (list) list.push(r);
    else rowsByPerson.set(r.hr_person_id, [r]);
  }

  const retryBefore = Date.now() - RETRY_AFTER_MS;
  const stale = (rows: any[]) =>
    rows.every((r: any) => r.status === 'error' || r.status === 'planned') &&
    rows.every((r: any) => new Date(r.updated_at ?? r.created_at ?? 0).getTime() <= retryBefore);

  let retried = 0;
  const candidates = (people ?? [])
    .map((p: any) => p.hr_person_id)
    .filter((id: string) => {
      const rows = rowsByPerson.get(id);
      if (!rows || rows.length === 0) return true;
      if (!stale(rows)) return false;
      retried++;
      return true;
    });

  let provisioned = 0;
  let skipped = 0;
  let errors = 0;
  for (const hrPersonId of candidates.slice(0, limit)) {
    try {
      const outcome = await provisionHire(supabase, { tenantId, hrPersonId, source: 'sync', log: params.log });
      if (outcome.status === 'provisioned') provisioned++;
      else if (outcome.status === 'error') errors++;
      else skipped++;
    } catch (err: any) {
      errors++;
      params.log?.warn('kit_provision.sync_pass_failed', { hr_person_id: hrPersonId, error: err?.message });
    }
  }

  if (candidates.length > 0) {
    params.log?.info('kit_provision.sync_pass', {
      candidates: candidates.length,
      retried,
      provisioned,
      skipped,
      errors,
      deferred: Math.max(0, candidates.length - limit),
    });
  }

  return { candidates: candidates.length, provisioned, skipped, errors, retried };
}
