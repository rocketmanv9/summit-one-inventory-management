/**
 * Isabelle's purchasing agent — the "order everything that's low" loop.
 *
 * Two server tools with a hard review gate between them:
 *   draft_restock_order   — builds a reviewable draft (one PO per vendor) and
 *                           stores it in supply_chain.ai_order_drafts. Orders
 *                           NOTHING.
 *   confirm_restock_order — after the user explicitly confirms in chat: claims
 *                           the draft (status flip, race-safe), creates the POs
 *                           via rpc_create_purchase_order with the real user as
 *                           acting identity (spend limits / budgets / approval
 *                           routing apply to them), then emails each vendor as
 *                           the user via the PO email service. POs that land in
 *                           the approval inbox are NOT emailed until approved.
 */

import { AppError } from '@rocketmanv9/chassis/errors';
import type { ServerToolContext, ServerToolResult } from './server-tools';

// ─── Draft shapes (stored in ai_order_drafts.payload) ─────────────────

export interface RestockLine {
  catalog_item_id: string;
  name: string;
  sku: string | null;
  uom_term_id: string | null;
  qty: number;
  unit_cost: number | null;
  qty_available?: number;
  reorder_point?: number;
}

export interface RestockGroup {
  vendor_id: string | null;
  vendor_name: string;
  vendor_email: string | null;
  ordering_mode: string | null;
  lines: RestockLine[];
}

export interface RestockDraftPayload {
  scope: 'low_stock' | 'items';
  delivery_location_id: string | null;
  delivery_location_name: string | null;
  groups: RestockGroup[];
  note: string | null;
}

// ─── Pure logic (unit-tested in tests/ai-restock.test.ts) ─────────────

/** How many to order: bring the item back up to target (or reorder point),
 *  never less than its configured reorder quantity, always at least 1. */
export function suggestedOrderQty(item: {
  qty_available: number;
  reorder_point: number | null;
  reorder_qty?: number | null;
  target_level?: number | null;
}): number {
  const target = item.target_level ?? item.reorder_point ?? 0;
  const shortfall = target - item.qty_available;
  return Math.max(Math.ceil(shortfall), Math.ceil(item.reorder_qty ?? 0), 1);
}

export interface VendorItemRow {
  vendor_id: string;
  catalog_item_id: string;
  unit_cost: number | null;
  last_known_price: number | null;
  is_preferred: boolean | null;
  active: boolean | null;
}

/**
 * Which vendor supplies this line? Specific knowledge beats generic defaults:
 * the item's own preferred vendor → the vendor price list flagged preferred →
 * the cheapest vendor price list → the yard's preferred vendor → nobody.
 * Returns the vendor id (or null) and the known unit cost from that vendor.
 */
export function pickVendorForItem(
  item: { catalog_item_id: string; preferred_vendor_id: string | null },
  vendorItems: VendorItemRow[],
  yardPreferredVendorId: string | null,
): { vendor_id: string | null; unit_cost: number | null } {
  const forItem = vendorItems.filter(
    (vi) => vi.catalog_item_id === item.catalog_item_id && vi.active !== false,
  );
  const costOf = (vi: VendorItemRow | undefined): number | null =>
    vi ? (vi.unit_cost ?? vi.last_known_price ?? null) : null;
  const byVendor = (vendorId: string) => forItem.find((vi) => vi.vendor_id === vendorId);

  if (item.preferred_vendor_id) {
    return { vendor_id: item.preferred_vendor_id, unit_cost: costOf(byVendor(item.preferred_vendor_id)) };
  }
  const preferred = forItem.find((vi) => vi.is_preferred);
  if (preferred) return { vendor_id: preferred.vendor_id, unit_cost: costOf(preferred) };

  const priced = forItem
    .filter((vi) => costOf(vi) != null)
    .sort((a, b) => (costOf(a) as number) - (costOf(b) as number));
  if (priced.length > 0) return { vendor_id: priced[0].vendor_id, unit_cost: costOf(priced[0]) };
  if (forItem.length > 0) return { vendor_id: forItem[0].vendor_id, unit_cost: null };

  if (yardPreferredVendorId) {
    return { vendor_id: yardPreferredVendorId, unit_cost: costOf(byVendor(yardPreferredVendorId)) };
  }
  return { vendor_id: null, unit_cost: null };
}

export function groupTotal(group: RestockGroup): number {
  return group.lines.reduce((sum, l) => sum + l.qty * (l.unit_cost ?? 0), 0);
}

// ─── Helpers ──────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

function inv(ctx: ServerToolContext) {
  return (ctx.supabase as any).schema('inventory');
}
function sc(ctx: ServerToolContext) {
  return (ctx.supabase as any).schema('supply_chain');
}

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

async function resolveDeliveryLocation(
  ctx: ServerToolContext,
  locationName?: string,
): Promise<{ id: string; name: string; preferred_vendor_id: string | null } | null> {
  const base = inv(ctx)
    .from('locations')
    .select('id, name, preferred_vendor_id, is_default_ship_to')
    .eq('active', true);
  if (locationName) {
    const { data } = await base.ilike('name', `%${locationName}%`).limit(1);
    if (data?.length) return data[0];
    return null;
  }
  const { data } = await base.order('is_default_ship_to', { ascending: false }).limit(1);
  return data?.length ? data[0] : null;
}

interface CatalogRow {
  id: string;
  name: string;
  sku: string | null;
  reorder_point: number | null;
  reorder_qty: number | null;
  target_level: number | null;
  preferred_vendor_id: string | null;
  uom_term_id: string | null;
}

const CATALOG_COLS = 'id, name, sku, reorder_point, reorder_qty, target_level, preferred_vendor_id, uom_term_id';

// ─── draft_restock_order ──────────────────────────────────────────────

export async function draftRestockOrder(
  params: Record<string, any>,
  ctx: ServerToolContext,
): Promise<ServerToolResult> {
  const scope: 'low_stock' | 'items' = params.scope === 'items' ? 'items' : 'low_stock';

  const location = await resolveDeliveryLocation(ctx, params.location);
  if (params.location && !location) {
    return {
      text: `I couldn't find a location matching "${params.location}". Ask the user which yard this order should ship to.`,
      dataDisplay: { displayType: 'metric', label: 'Location not found', value: params.location },
    };
  }
  if (!location) {
    return {
      text: 'No delivery location is configured (no default ship-to yard). Ask the user which yard the order should ship to, then call draft_restock_order again with location set.',
      dataDisplay: { displayType: 'metric', label: 'Missing', value: 'Delivery yard' },
    };
  }

  // Collect candidate lines: {catalog row, qty, availability context}.
  const candidates: Array<{ item: CatalogRow; qty: number; qty_available?: number }> = [];
  const notFound: string[] = [];

  if (scope === 'low_stock') {
    const { data: items, error } = await inv(ctx)
      .from('catalog_items')
      .select(CATALOG_COLS)
      .eq('active', true)
      .is('deleted_at', null)
      .not('reorder_point', 'is', null)
      .gt('reorder_point', 0)
      .limit(500);
    if (error) throw AppError.internal(`Catalog query failed: ${error.message}`);
    const itemRows: CatalogRow[] = items ?? [];
    if (itemRows.length === 0) {
      return {
        text: 'No items have reorder points configured, so there is nothing to sweep for low stock.',
        dataDisplay: { displayType: 'metric', label: 'Low stock', value: 'No reorder points set' },
      };
    }

    let balQuery = inv(ctx)
      .from('stock_balances')
      .select('catalog_item_id, qty_available')
      .in('catalog_item_id', itemRows.map((i) => i.id))
      .limit(2000);
    if (params.location) balQuery = balQuery.eq('location_id', location.id);
    const { data: balances, error: balErr } = await balQuery;
    if (balErr) throw AppError.internal(`Stock query failed: ${balErr.message}`);

    const availByItem = new Map<string, number>();
    for (const b of balances ?? []) {
      availByItem.set(b.catalog_item_id, (availByItem.get(b.catalog_item_id) ?? 0) + Number(b.qty_available ?? 0));
    }
    for (const item of itemRows) {
      const available = availByItem.get(item.id) ?? 0;
      if (available < (item.reorder_point as number)) {
        candidates.push({
          item,
          qty: suggestedOrderQty({
            qty_available: available,
            reorder_point: item.reorder_point,
            reorder_qty: item.reorder_qty,
            target_level: item.target_level,
          }),
          qty_available: available,
        });
      }
    }
    if (candidates.length === 0) {
      return {
        text: `Nothing is below its reorder point${params.location ? ` at ${location.name}` : ''}. Stock levels look good — no order needed.`,
        dataDisplay: { displayType: 'metric', label: 'Low stock', value: 'All stocked' },
      };
    }
  } else {
    const requested: Array<{ item: string; quantity: number }> = Array.isArray(params.items) ? params.items : [];
    if (requested.length === 0) {
      return {
        text: 'No items were given. Ask the user which items and quantities to order, then call draft_restock_order(scope: "items", items: [...]).',
        dataDisplay: { displayType: 'metric', label: 'Missing', value: 'Items' },
      };
    }
    for (const req of requested) {
      const term = String(req.item ?? '').trim();
      if (!term) continue;
      const { data: matches } = await inv(ctx)
        .from('catalog_items')
        .select(CATALOG_COLS)
        .eq('active', true)
        .is('deleted_at', null)
        .or(`name.ilike.%${term.replace(/[,()]/g, ' ')}%,sku.ilike.%${term.replace(/[,()]/g, ' ')}%`)
        .limit(5);
      const rows: CatalogRow[] = matches ?? [];
      const exact = rows.find((r) => r.name.toLowerCase() === term.toLowerCase() || r.sku?.toLowerCase() === term.toLowerCase());
      const pick = exact ?? rows[0];
      if (!pick) {
        notFound.push(term);
        continue;
      }
      const qty = Number(req.quantity);
      candidates.push({ item: pick, qty: Number.isFinite(qty) && qty > 0 ? qty : 1 });
    }
    if (candidates.length === 0) {
      return {
        text: `None of the requested items matched the catalog: ${notFound.join(', ')}. Ask the user to clarify (or offer to quick-add them as new items first).`,
        dataDisplay: { displayType: 'metric', label: 'Not found', value: notFound.join(', ') },
      };
    }
  }

  // Vendor assignment. Optional params.vendor forces the whole draft to one vendor.
  let forcedVendorId: string | null = null;
  if (params.vendor) {
    const { data: v } = await sc(ctx)
      .from('vendors')
      .select('id, name')
      .eq('active', true)
      .ilike('name', `%${params.vendor}%`)
      .limit(1);
    if (!v?.length) {
      return {
        text: `I couldn't find an active vendor matching "${params.vendor}". Ask the user to pick a vendor (list_vendors can show options).`,
        dataDisplay: { displayType: 'metric', label: 'Vendor not found', value: params.vendor },
      };
    }
    forcedVendorId = v[0].id;
  }

  const itemIds = candidates.map((c) => c.item.id);
  const { data: vendorItems } = await sc(ctx)
    .from('vendor_items')
    .select('vendor_id, catalog_item_id, unit_cost, last_known_price, is_preferred, active')
    .in('catalog_item_id', itemIds)
    .limit(2000);
  const viRows: VendorItemRow[] = (vendorItems ?? []) as VendorItemRow[];

  const assignments = candidates.map((c) => {
    const picked = forcedVendorId
      ? {
          vendor_id: forcedVendorId,
          unit_cost:
            viRows.find((vi) => vi.catalog_item_id === c.item.id && vi.vendor_id === forcedVendorId)?.unit_cost ??
            viRows.find((vi) => vi.catalog_item_id === c.item.id && vi.vendor_id === forcedVendorId)?.last_known_price ??
            null,
        }
      : pickVendorForItem(
          { catalog_item_id: c.item.id, preferred_vendor_id: c.item.preferred_vendor_id },
          viRows,
          location.preferred_vendor_id,
        );
    return { ...c, ...picked };
  });

  // Vendor details for every assigned vendor.
  const vendorIds = [...new Set(assignments.map((a) => a.vendor_id).filter(Boolean))] as string[];
  const vendorsById = new Map<string, any>();
  if (vendorIds.length > 0) {
    const { data: vendors } = await sc(ctx)
      .from('vendors')
      .select('id, name, po_email, contact_email, ordering_mode, active')
      .in('id', vendorIds)
      .limit(200);
    for (const v of vendors ?? []) vendorsById.set(v.id, v);
  }

  const groups: RestockGroup[] = [];
  const groupFor = (vendorId: string | null): RestockGroup => {
    const key = vendorId ?? '__none__';
    let g = groups.find((x) => (x.vendor_id ?? '__none__') === key);
    if (!g) {
      const v = vendorId ? vendorsById.get(vendorId) : null;
      g = {
        vendor_id: vendorId,
        vendor_name: v?.name ?? (vendorId ? 'Unknown vendor' : 'No vendor assigned'),
        vendor_email: v ? (v.po_email || v.contact_email || null) : null,
        ordering_mode: v?.ordering_mode ?? null,
        lines: [],
      };
      groups.push(g);
    }
    return g;
  };
  for (const a of assignments) {
    groupFor(a.vendor_id).lines.push({
      catalog_item_id: a.item.id,
      name: a.item.name,
      sku: a.item.sku,
      uom_term_id: a.item.uom_term_id,
      qty: a.qty,
      unit_cost: a.unit_cost,
      qty_available: a.qty_available,
      reorder_point: a.item.reorder_point ?? undefined,
    });
  }

  const payload: RestockDraftPayload = {
    scope,
    delivery_location_id: location.id,
    delivery_location_name: location.name,
    groups,
    note: params.note ?? null,
  };

  const { data: draft, error: draftErr } = await sc(ctx)
    .from('ai_order_drafts')
    .insert({ tenant_id: ctx.tenantId, created_by_user_id: ctx.userId, status: 'draft', payload })
    .select('id')
    .single();
  if (draftErr) throw AppError.internal(`Failed to save draft: ${draftErr.message}`);

  // Review table: one row per line, grouped by vendor.
  const rows = groups.flatMap((g) =>
    g.lines.map((l) => ({
      vendor: g.vendor_name,
      item: l.sku ? `${l.name} (${l.sku})` : l.name,
      qty: l.qty,
      unit_cost: l.unit_cost != null ? usd(l.unit_cost) : 'request pricing',
      line_total: l.unit_cost != null ? usd(l.qty * l.unit_cost) : '—',
    })),
  );
  const knownTotal = groups.reduce((sum, g) => sum + groupTotal(g), 0);
  const unpriced = groups.flatMap((g) => g.lines).filter((l) => l.unit_cost == null).length;
  const unassigned = groups.find((g) => g.vendor_id === null);
  const punchout = groups.filter((g) => g.ordering_mode === 'punchout');
  const noEmail = groups.filter((g) => g.vendor_id && g.ordering_mode !== 'punchout' && !g.vendor_email);

  const warnings = [
    unassigned ? `${unassigned.lines.length} line(s) have NO vendor — ask the user which vendor to use (re-draft with vendor set, or fix per item).` : null,
    unpriced > 0 ? `${unpriced} line(s) have no known price — those POs go out as pricing requests.` : null,
    punchout.length > 0 ? `${punchout.map((g) => g.vendor_name).join(', ')} order(s) are punchout (Amazon-style) — they will NOT be emailed; the user places them via the one-click flow on the PO page.` : null,
    noEmail.length > 0 ? `No email on file for: ${noEmail.map((g) => g.vendor_name).join(', ')} — their POs will be created but can't be emailed.` : null,
  ].filter(Boolean);

  return {
    text: [
      `DRAFT ONLY — nothing has been ordered. Draft id: ${draft.id}`,
      `${groups.length} purchase order(s) shipping to ${location.name}: ${groups
        .map((g) => `${g.vendor_name} (${g.lines.length} item${g.lines.length === 1 ? '' : 's'}, ${groupTotal(g) > 0 ? usd(groupTotal(g)) : 'pricing TBD'})`)
        .join('; ')}. Known total: ${usd(knownTotal)}.`,
      ...warnings,
      notFound.length > 0 ? `Not found in catalog (skipped): ${notFound.join(', ')}.` : null,
      `Present this draft to the user for review. If they want changes, call draft_restock_order again (it replaces this draft). ONLY after they explicitly confirm, call confirm_restock_order(draft_id: "${draft.id}").`,
    ]
      .filter(Boolean)
      .join('\n'),
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'vendor', label: 'Vendor' },
        { key: 'item', label: 'Item' },
        { key: 'qty', label: 'Qty' },
        { key: 'unit_cost', label: 'Unit Cost' },
        { key: 'line_total', label: 'Line Total' },
      ],
      rows: rows.slice(0, 50),
      totalRows: rows.length,
    },
  };
}

// ─── confirm_restock_order ────────────────────────────────────────────

export async function confirmRestockOrder(
  params: Record<string, any>,
  ctx: ServerToolContext,
): Promise<ServerToolResult> {
  const draftId = String(params.draft_id ?? '').trim();
  if (!draftId) {
    return {
      text: 'draft_id is required — call draft_restock_order first and review it with the user.',
      dataDisplay: { displayType: 'metric', label: 'Missing', value: 'draft_id' },
    };
  }
  const sendEmails = params.send_emails !== false && params.send_emails !== 'false';

  // Claim the draft. The status-guarded update makes a doubled confirm lose
  // cleanly instead of double-ordering.
  const { data: claimed, error: claimErr } = await sc(ctx)
    .from('ai_order_drafts')
    .update({ status: 'ordered', updated_at: new Date().toISOString() })
    .eq('id', draftId)
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'draft')
    .select('payload')
    .maybeSingle();
  if (claimErr) throw AppError.internal(`Failed to load draft: ${claimErr.message}`);
  if (!claimed) {
    const { data: existing } = await sc(ctx)
      .from('ai_order_drafts')
      .select('status')
      .eq('id', draftId)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    const why = existing
      ? `it was already ${existing.status === 'ordered' ? 'ordered' : existing.status}`
      : 'it does not exist';
    return {
      text: `That draft can't be confirmed — ${why}. Build a fresh draft with draft_restock_order if the user still wants to order.`,
      dataDisplay: { displayType: 'metric', label: 'Draft unavailable', value: why },
    };
  }

  const payload = claimed.payload as RestockDraftPayload;

  // The requesting user (email sender + CC).
  const { data: requester } = await (ctx.supabase as any)
    .from('local_users')
    .select('name, email')
    .eq('tenant_id', ctx.tenantId)
    .eq('user_id', ctx.userId)
    .limit(1)
    .maybeSingle();

  const results: Array<{
    vendor: string;
    po_number: string;
    total: string;
    status: string;
    email: string;
  }> = [];
  const skippedNoVendor = payload.groups.find((g) => g.vendor_id === null);

  for (const group of payload.groups) {
    if (!group.vendor_id) continue;

    const lines = group.lines.map((l) => ({
      catalog_item_id: l.catalog_item_id,
      qty_ordered: l.qty,
      unit_cost: l.unit_cost ?? undefined,
      price_basis: l.unit_cost != null ? 'fixed' : 'unknown',
    }));

    const { data: po, error: poErr } = await sc(ctx).rpc('rpc_create_purchase_order', {
      p_vendor_id: group.vendor_id,
      p_po_number: null,
      p_delivery_method: 'ship',
      p_needed_by_date: null,
      p_cost_context: 'yard',
      p_job_id: null,
      p_delivery_location_id: payload.delivery_location_id,
      p_pickup_location_id: null,
      p_max_authorized_spend: null,
      p_vendor_quote_ref: null,
      p_notes: payload.note ? `Ordered via Isabelle — ${payload.note}` : 'Ordered via Isabelle',
      p_attachments: [],
      p_lines: lines,
      p_initiated_by: 'user',
      p_tenant_id: ctx.tenantId,
      p_acting_user_id: ctx.userId,
    });
    if (poErr) {
      results.push({ vendor: group.vendor_name, po_number: '—', total: '—', status: `FAILED: ${poErr.message}`, email: '—' });
      continue;
    }

    const poId = (po as any)?.po_id;
    const poNumber = (po as any)?.po_number ?? '?';
    const poStatus = (po as any)?.status ?? '?';
    const total = groupTotal(group);

    let emailNote: string;
    if (group.ordering_mode === 'punchout') {
      emailNote = 'not emailed — place via one-click punchout';
    } else if (poStatus === 'awaiting_approval') {
      emailNote = 'held — awaiting manager approval';
    } else if (!sendEmails) {
      emailNote = 'not sent (emails off)';
    } else {
      try {
        const { sendPurchaseOrderEmail } = await import('@/lib/po/po-email-service');
        const sent = await sendPurchaseOrderEmail({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          purchaseOrderId: poId,
          message:
            params.message ??
            (poStatus === 'draft'
              ? 'Some items on this order need current pricing — please confirm availability and unit prices.'
              : undefined),
          requesterEmail: requester?.email ?? undefined,
          requesterName: requester?.name ?? undefined,
          fetchImpl: fetch,
          lastEventId: crypto.randomUUID(),
        });
        emailNote = `sent to ${sent.recipient} via ${sent.provider}`;
      } catch (err: any) {
        emailNote = `NOT sent — ${err?.message ?? 'email failed'}`;
      }
    }

    const statusLabel =
      poStatus === 'approved'
        ? 'approved'
        : poStatus === 'awaiting_approval'
          ? `awaiting approval${(po as any)?.approval_reason ? ` (${(po as any).approval_reason})` : ''}`
          : poStatus === 'draft'
            ? 'quote request (unpriced)'
            : poStatus;
    results.push({
      vendor: group.vendor_name,
      po_number: poNumber,
      total: total > 0 ? usd(total) : 'TBD',
      status: statusLabel,
      email: emailNote,
    });
  }

  // Store the outcome on the draft for the audit trail (best-effort).
  await sc(ctx)
    .from('ai_order_drafts')
    .update({ result: { results }, updated_at: new Date().toISOString() })
    .eq('id', draftId)
    .eq('tenant_id', ctx.tenantId);

  const created = results.filter((r) => !r.status.startsWith('FAILED'));
  const failed = results.filter((r) => r.status.startsWith('FAILED'));
  const held = created.filter((r) => r.status.startsWith('awaiting approval'));

  return {
    text: [
      `Created ${created.length} purchase order(s): ${created.map((r) => `${r.po_number} → ${r.vendor} (${r.total}, ${r.status}; email ${r.email})`).join('; ') || 'none'}.`,
      held.length > 0
        ? `${held.length} PO(s) are in the manager approval inbox (/inventory/purchasing/approvals) and will need to be emailed after approval.`
        : null,
      failed.length > 0 ? `FAILED: ${failed.map((r) => `${r.vendor}: ${r.status}`).join('; ')}.` : null,
      skippedNoVendor ? `${skippedNoVendor.lines.length} line(s) had no vendor and were NOT ordered.` : null,
      'Report this outcome to the user exactly — including anything held, failed, or not emailed.',
    ]
      .filter(Boolean)
      .join('\n'),
    dataDisplay: {
      displayType: 'table',
      columns: [
        { key: 'po_number', label: 'PO #' },
        { key: 'vendor', label: 'Vendor' },
        { key: 'total', label: 'Total' },
        { key: 'status', label: 'Status' },
        { key: 'email', label: 'Email' },
      ],
      rows: results,
      totalRows: results.length,
    },
  };
}
