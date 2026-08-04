import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/inventory/purchasing/approvals — the manager's inbox.
 *
 * POs awaiting approval that THIS user can act on: routed to them as
 * approver, or unrouted/any when they're an admin. Each card carries the
 * buyer, vendor, computed total, the reason it needs sign-off, and age.
 * Also returns can_approve + is_admin so the UI knows what to render.
 */
export const GET = createSessionReadRoute(async ({ session, log }) => {
  const tenantId = session.tenantId!;
  const userId = session.userId!;
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
  let query = sc
    .from('purchase_orders')
    .select('id, po_number, vendor_name_snapshot, vendor_code_snapshot, created_by_user_id, approver_user_id, approval_reason, delivery_location_id, created_at, purchase_order_lines(qty_ordered, unit_cost, estimated_unit_cost, status)')
    .eq('status', 'awaiting_approval')
    .order('created_at', { ascending: true })
    .limit(100);
  // Admins see the whole inbox; everyone else sees what's routed to them.
  if (!isAdmin) query = query.eq('approver_user_id', userId);

  const { data: pos, error } = await query;
  if (error) {
    log.error('po_approvals.list_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  // Buyer + delivery-location names in one hop each.
  const buyerIds = [...new Set((pos ?? []).map((p: any) => p.created_by_user_id).filter(Boolean))];
  const locIds = [...new Set((pos ?? []).map((p: any) => p.delivery_location_id).filter(Boolean))];
  const [{ data: buyers }, { data: locs }] = await Promise.all([
    buyerIds.length
      ? supabase.from('local_users').select('user_id, name, email').eq('tenant_id', tenantId).in('user_id', buyerIds)
      : Promise.resolve({ data: [] as any[] }),
    locIds.length
      ? (supabase as any).schema('inventory').from('locations').select('id, name').in('id', locIds).limit(100)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const buyerById = new Map((buyers ?? []).map((b: any) => [b.user_id, b.name || b.email]));
  const locById = new Map((locs ?? []).map((l: any) => [l.id, l.name]));

  const items = (pos ?? []).map((p: any) => ({
    id: p.id,
    po_number: p.po_number,
    vendor_name: p.vendor_name_snapshot,
    is_amazon: p.vendor_code_snapshot === 'AMAZON-BIZ',
    buyer_user_id: p.created_by_user_id,
    buyer_name: buyerById.get(p.created_by_user_id) || 'Unknown',
    delivery_location: locById.get(p.delivery_location_id) || null,
    reason: p.approval_reason,
    total: (p.purchase_order_lines ?? [])
      .filter((l: any) => l.status !== 'cancelled')
      .reduce((sum: number, l: any) => sum + Number(l.qty_ordered) * Number(l.unit_cost ?? l.estimated_unit_cost ?? 0), 0),
    created_at: p.created_at,
    // Buyers never approve their own — even when it routed to them somehow.
    can_decide: p.created_by_user_id !== userId,
  }));

  return Response.json({ data: { items, count: items.length, is_admin: isAdmin } });
}, { serviceName: SERVICE_NAME });
