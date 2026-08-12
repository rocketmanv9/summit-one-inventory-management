import { z } from 'zod';
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const QuerySchema = z.object({
  // pending = the live inbox (default, unchanged). approved / denied are history.
  status: z.enum(['pending', 'approved', 'denied']).default('pending'),
  // Decision-date window for history (ISO dates or datetimes). Ignored for pending.
  from: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  to: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * GET /api/inventory/purchasing/approvals — the manager's inbox + decision history.
 *
 * ?status=pending (default): POs awaiting approval THIS user can act on —
 * routed to them as approver, or all of them for admins. Unchanged behavior.
 *
 * ?status=approved | denied: history of decisions, scoped the same way. A
 * non-admin sees the decisions they personally made (approved_by / rejected_by
 * = them); an admin sees every decision. Filterable by decision date
 * (?from=&to=, ISO) and paginated (?limit=&offset=). Newest first.
 *
 * History reads the durable decision stamps on the PO — approved_at /
 * approved_by_user_id and rejected_at / rejected_by_user_id / rejected_reason.
 * A reject sends the PO back to draft (so status alone can't tell you it was
 * denied); resubmitting clears the rejected_* stamps, so the denied list only
 * ever shows still-outstanding rejections.
 *
 * Each card carries buyer, vendor, computed total, created date, plus (for
 * history) who decided, when, and the rejection reason. Also returns
 * is_admin so the UI knows what it's showing.
 */
export const GET = createSessionReadRoute(async ({ session, req, log }) => {
  const tenantId = session.tenantId!;
  const userId = session.userId!;
  const url = new URL(req.url);
  const params = QuerySchema.parse({
    status: url.searchParams.get('status') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
  });

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });

  const { data: me } = await supabase
    .from('local_users')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();
  const isAdmin = me?.role === 'admin';

  const sc = (supabase as any).schema('supply_chain');

  // ?counts=1 — just the three tab totals (respecting the same scoping + the
  // active date window), so the UI can label every tab without paging its rows.
  if (url.searchParams.get('counts') === '1') {
    const countFor = (which: 'pending' | 'approved' | 'denied') => {
      let q = sc.from('purchase_orders').select('id', { count: 'exact', head: true });
      if (which === 'pending') {
        q = q.eq('status', 'awaiting_approval');
        if (!isAdmin) q = q.eq('approver_user_id', userId);
      } else if (which === 'approved') {
        q = q.not('approved_at', 'is', null);
        if (!isAdmin) q = q.eq('approved_by_user_id', userId);
        if (params.from) q = q.gte('approved_at', params.from);
        if (params.to) q = q.lte('approved_at', params.to);
      } else {
        q = q.not('rejected_at', 'is', null);
        if (!isAdmin) q = q.eq('rejected_by_user_id', userId);
        if (params.from) q = q.gte('rejected_at', params.from);
        if (params.to) q = q.lte('rejected_at', params.to);
      }
      return q;
    };
    const [pending, approved, denied] = await Promise.all([
      countFor('pending'), countFor('approved'), countFor('denied'),
    ]);
    if (pending.error || approved.error || denied.error) {
      const msg = pending.error?.message || approved.error?.message || denied.error?.message || 'count failed';
      log.error('po_approvals.counts_failed', { error: msg });
      throw AppError.internal(msg);
    }
    return Response.json({
      data: {
        counts: { pending: pending.count ?? 0, approved: approved.count ?? 0, denied: denied.count ?? 0 },
        is_admin: isAdmin,
      },
    });
  }

  // The stamp column that dates each row for filtering + sorting: created for
  // the pending inbox, the decision time for history.
  const dateCol =
    params.status === 'approved' ? 'approved_at'
    : params.status === 'denied' ? 'rejected_at'
    : 'created_at';

  let query = sc
    .from('purchase_orders')
    .select(
      'id, po_number, origin, vendor_name_snapshot, vendor_code_snapshot, created_by_user_id, approver_user_id, approval_reason, delivery_location_id, created_at, approved_at, approved_by_user_id, rejected_at, rejected_by_user_id, rejected_reason, purchase_order_lines(line_number, catalog_item_id, item_description, qty_ordered, unit_cost, estimated_unit_cost, status)',
      { count: 'exact' }
    );

  if (params.status === 'pending') {
    query = query.eq('status', 'awaiting_approval').order('created_at', { ascending: true });
    // Admins see the whole inbox; everyone else sees what's routed to them.
    if (!isAdmin) query = query.eq('approver_user_id', userId);
  } else if (params.status === 'approved') {
    query = query.not('approved_at', 'is', null).order('approved_at', { ascending: false });
    // Non-admins see only the decisions they themselves made.
    if (!isAdmin) query = query.eq('approved_by_user_id', userId);
  } else {
    query = query.not('rejected_at', 'is', null).order('rejected_at', { ascending: false });
    if (!isAdmin) query = query.eq('rejected_by_user_id', userId);
  }

  // Decision-date window (history only — pending is always the live queue).
  if (params.status !== 'pending') {
    if (params.from) query = query.gte(dateCol, params.from);
    if (params.to) query = query.lte(dateCol, params.to);
  }

  query = query.range(params.offset, params.offset + params.limit - 1);

  const { data: pos, count, error } = await query;
  if (error) {
    log.error('po_approvals.list_failed', { status: params.status, error: error.message });
    throw AppError.internal(error.message);
  }

  // Buyer + decider + delivery-location names in one hop each.
  const buyerIds = (pos ?? []).map((p: any) => p.created_by_user_id);
  const deciderIds = (pos ?? []).map((p: any) =>
    params.status === 'denied' ? p.rejected_by_user_id : p.approved_by_user_id
  );
  const userIds = [...new Set([...buyerIds, ...deciderIds].filter(Boolean))];
  const locIds = [...new Set((pos ?? []).map((p: any) => p.delivery_location_id).filter(Boolean))];
  const [{ data: people }, { data: locs }] = await Promise.all([
    userIds.length
      ? supabase.from('local_users').select('user_id, name, email').eq('tenant_id', tenantId).in('user_id', userIds)
      : Promise.resolve({ data: [] as any[] }),
    locIds.length
      ? (supabase as any).schema('inventory').from('locations').select('id, name').in('id', locIds).limit(100)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const nameById = new Map((people ?? []).map((b: any) => [b.user_id, b.name || b.email]));
  const locById = new Map((locs ?? []).map((l: any) => [l.id, l.name]));

  // Line detail for the pending inbox only (the mobile one-by-one approval
  // runner shows what's actually being bought). Catalog lines often carry no
  // item_description snapshot, so resolve their display names in one
  // cross-schema hop. History payloads stay slim — no lines there.
  const itemNameById = new Map<string, string>();
  if (params.status === 'pending') {
    const catalogIds = [
      ...new Set(
        (pos ?? [])
          .flatMap((p: any) => p.purchase_order_lines ?? [])
          .map((l: any) => l.catalog_item_id)
          .filter(Boolean)
      ),
    ] as string[];
    if (catalogIds.length) {
      const { data: cat } = await (supabase as any)
        .schema('inventory')
        .from('catalog_items')
        .select('id, name')
        .in('id', catalogIds)
        .limit(1000);
      for (const c of cat ?? []) itemNameById.set(c.id, c.name);
    }
  }

  const items = (pos ?? []).map((p: any) => {
    const deciderId = params.status === 'denied' ? p.rejected_by_user_id : p.approved_by_user_id;
    return {
      id: p.id,
      po_number: p.po_number,
      // 'auto_reorder' → AI-drafted restock; drives the inbox badge.
      origin: p.origin ?? 'user',
      vendor_name: p.vendor_name_snapshot,
      is_amazon: p.vendor_code_snapshot === 'AMAZON-BIZ',
      buyer_user_id: p.created_by_user_id,
      buyer_name: nameById.get(p.created_by_user_id) || 'Unknown',
      delivery_location: locById.get(p.delivery_location_id) || null,
      reason: p.approval_reason,
      total: (p.purchase_order_lines ?? [])
        .filter((l: any) => l.status !== 'cancelled')
        .reduce((sum: number, l: any) => sum + Number(l.qty_ordered) * Number(l.unit_cost ?? l.estimated_unit_cost ?? 0), 0),
      created_at: p.created_at,
      // Buyers never approve their own — even when it routed to them somehow.
      can_decide: p.created_by_user_id !== userId,
      // What's on the PO — pending only (feeds the mobile approval runner).
      // ADDITIVE: existing consumers (web inbox, mobile list) ignore this.
      lines:
        params.status === 'pending'
          ? (p.purchase_order_lines ?? [])
              .filter((l: any) => l.status !== 'cancelled')
              .sort((a: any, b: any) => (a.line_number ?? 0) - (b.line_number ?? 0))
              .map((l: any) => {
                const unitCost = l.unit_cost ?? l.estimated_unit_cost;
                return {
                  description:
                    l.item_description || itemNameById.get(l.catalog_item_id) || 'Item',
                  qty: Number(l.qty_ordered),
                  // NB: stage stores a GV uom_term_id, not a display label —
                  // resolving labels is a GV round-trip we skip here. Null is
                  // honest and the mobile runner renders qty × description.
                  uom: null,
                  unit_cost: unitCost != null ? Number(unitCost) : null,
                  line_total:
                    unitCost != null ? Number(l.qty_ordered) * Number(unitCost) : null,
                  // True when the price is a buyer estimate, not a committed cost.
                  estimated: l.unit_cost == null && l.estimated_unit_cost != null,
                };
              })
          : undefined,
      // History fields (null on the pending tab).
      decided_by: deciderId ? nameById.get(deciderId) || 'Unknown' : null,
      decided_at: params.status === 'denied' ? p.rejected_at : params.status === 'approved' ? p.approved_at : null,
      rejection_reason: params.status === 'denied' ? p.rejected_reason : null,
    };
  });

  return Response.json({
    data: {
      items,
      count: count ?? items.length,
      is_admin: isAdmin,
      limit: params.limit,
      offset: params.offset,
    },
  });
}, { serviceName: SERVICE_NAME });
