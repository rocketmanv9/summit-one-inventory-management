import { z } from 'zod';
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const QuerySchema = z.object({
  buyer_user_id: z.string().uuid(),
  delivery_location_id: z.string().uuid().optional(),
});

/**
 * GET /api/inventory/purchasing/approval-flow/simulate — "if THIS person buys
 * from THIS location, who approves?" (sprint item 10).
 *
 * Calls the REAL `supply_chain.resolve_po_approver()` for the answer — never a
 * client-side re-implementation, so this can't drift from what actually gates a
 * PO. Then it labels which of the three rules produced that answer by comparing
 * the resolved id against the two candidates the resolver would have considered
 * (the location's own override, the buyer's supervisor). A null result means
 * neither fired → the admin pool.
 */
export const GET = createSessionReadRoute(async ({ session, req, log }) => {
  const tenantId = session.tenantId!;
  const url = new URL(req.url);
  const params = QuerySchema.parse({
    buyer_user_id: url.searchParams.get('buyer_user_id') ?? undefined,
    delivery_location_id: url.searchParams.get('delivery_location_id') ?? undefined,
  });

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  const sc = (supabase as any).schema('supply_chain');

  // The source of truth. Everything below only explains this value.
  const { data: approverId, error: rpcErr } = await sc.rpc('resolve_po_approver', {
    p_tenant_id: tenantId,
    p_buyer_user_id: params.buyer_user_id,
    p_delivery_location_id: params.delivery_location_id ?? null,
  });
  if (rpcErr) {
    log.error('approval_flow.simulate_failed', { error: rpcErr.message });
    throw AppError.internal(rpcErr.message);
  }

  // Candidate inputs, read the same way the resolver reads them — used only to
  // NAME which rule fired, never to compute the answer.
  let locationOverrideId: string | null = null;
  if (params.delivery_location_id) {
    const { data: loc } = await (supabase as any)
      .schema('inventory')
      .from('locations')
      .select('po_approver_user_id')
      .eq('id', params.delivery_location_id)
      .maybeSingle();
    locationOverrideId = loc?.po_approver_user_id || null;
  }

  // Buyer's supervisor → their app user (mirror of the resolver's step 2).
  let supervisorUserId: string | null = null;
  const { data: buyer } = await supabase
    .from('local_users')
    .select('hr_person_id')
    .eq('tenant_id', tenantId)
    .eq('user_id', params.buyer_user_id)
    .maybeSingle();
  if (buyer?.hr_person_id) {
    const { data: hr } = await supabase
      .from('hr_people')
      .select('supervisor_hr_person_id')
      .eq('tenant_id', tenantId)
      .eq('hr_person_id', buyer.hr_person_id)
      .maybeSingle();
    if (hr?.supervisor_hr_person_id) {
      const { data: sup } = await supabase
        .from('local_users')
        .select('user_id')
        .eq('tenant_id', tenantId)
        .eq('hr_person_id', hr.supervisor_hr_person_id)
        .maybeSingle();
      supervisorUserId = sup?.user_id || null;
    }
  }

  // Which rule produced the resolved approver.
  let rule: 'location_override' | 'supervisor' | 'admin_fallback';
  if (approverId && approverId === locationOverrideId) rule = 'location_override';
  else if (approverId && approverId === supervisorUserId) rule = 'supervisor';
  else rule = 'admin_fallback';

  // Resolve names for the response.
  const wantedIds = [approverId, params.buyer_user_id].filter(Boolean) as string[];
  const { data: people } = wantedIds.length
    ? await supabase
        .from('local_users')
        .select('user_id, name, email')
        .eq('tenant_id', tenantId)
        .in('user_id', wantedIds)
    : { data: [] as any[] };
  const nameById = new Map((people ?? []).map((p: any) => [p.user_id, p.name || p.email || 'Unknown']));

  let locationName: string | null = null;
  if (params.delivery_location_id) {
    const { data: loc } = await (supabase as any)
      .schema('inventory')
      .from('locations')
      .select('name')
      .eq('id', params.delivery_location_id)
      .maybeSingle();
    locationName = loc?.name || null;
  }

  const buyerName = nameById.get(params.buyer_user_id) || 'this buyer';
  const explanation =
    rule === 'location_override'
      ? `Location override on ${locationName || 'this location'}`
      : rule === 'supervisor'
        ? `${buyerName}'s supervisor`
        : 'Falls back to admins (any admin can approve)';

  return Response.json({
    data: {
      approver_user_id: approverId || null,
      approver_name: approverId ? nameById.get(approverId) || 'Unknown' : null,
      rule,
      explanation,
      buyer_name: buyerName,
      location_name: locationName,
    },
  });
}, { serviceName: SERVICE_NAME });
