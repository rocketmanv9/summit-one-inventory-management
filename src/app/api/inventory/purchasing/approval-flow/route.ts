import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/inventory/purchasing/approval-flow — the whole PO approval routing,
 * made visible (sprint item 10). Read-only snapshot of the three inputs the
 * resolver (`supply_chain.resolve_po_approver`) actually uses, in precedence
 * order:
 *
 *   1. Location overrides — inventory.locations.po_approver_user_id, resolved to
 *      the approver's name/title. Every active location is returned (with a null
 *      approver where none is set) so the settings page can offer an inline
 *      editor for the whole list.
 *   2. Supervisor routing — each roster member → their HR supervisor's app user
 *      (via hr_people.supervisor_hr_person_id, the HR-mirrored edge the resolver
 *      reads). People whose supervisor doesn't resolve to a real app user fall
 *      through to admins; they're flagged.
 *   3. Fallback admins — anyone with role='admin' can approve when 1 and 2
 *      resolve nothing.
 *
 * Also returns the live pending count (?counts respected via the approvals API;
 * here we just include it so the page's context strip has one number to show).
 * This endpoint reports the routing; it never decides it — the simulator route
 * calls the real resolver for that.
 */
export const GET = createSessionReadRoute(async ({ session, log }) => {
  const tenantId = session.tenantId!;
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });

  // Everyone on the roster, with the columns the resolver keys off.
  const { data: users, error: usersErr } = await supabase
    .from('local_users')
    .select('user_id, name, email, role, position_id, hr_person_id')
    .eq('tenant_id', tenantId)
    .neq('user_id', '00000000-0000-0000-0000-000000000000')
    .order('name', { ascending: true })
    .limit(500);
  if (usersErr) {
    log.error('approval_flow.users_failed', { error: usersErr.message });
    throw AppError.internal(usersErr.message);
  }
  const roster = users ?? [];
  const nameFor = (u: any) => u?.name || u?.email || 'Unknown';

  // Titles live on positions.title, linked via local_users.position_id.
  const positionIds = [...new Set(roster.map((u: any) => u.position_id).filter(Boolean))];
  let titleByPosition = new Map<string, string>();
  if (positionIds.length) {
    const { data: positions } = await supabase
      .from('positions')
      .select('id, title, name')
      .eq('tenant_id', tenantId)
      .in('id', positionIds)
      .limit(500);
    titleByPosition = new Map(
      (positions ?? []).map((p: any) => [p.id, p.title || p.name || null]),
    );
  }
  const titleFor = (u: any) => (u?.position_id ? titleByPosition.get(u.position_id) || null : null);

  const userByUserId = new Map(roster.map((u: any) => [u.user_id, u]));
  const userByHrPerson = new Map(
    roster.filter((u: any) => u.hr_person_id).map((u: any) => [u.hr_person_id, u]),
  );

  // Active locations + their configured override (may be null).
  const inv = (supabase as any).schema('inventory');
  const { data: locations, error: locErr } = await inv
    .from('locations')
    .select('id, name, po_approver_user_id, last_event_id')
    .eq('active', true)
    .order('name', { ascending: true })
    .limit(500);
  if (locErr) {
    log.error('approval_flow.locations_failed', { error: locErr.message });
    throw AppError.internal(locErr.message);
  }

  // The HR supervisor edge (mirrored from HR). We read it straight off
  // hr_people so the map reflects exactly what the resolver sees.
  const hrPersonIds = roster.map((u: any) => u.hr_person_id).filter(Boolean);
  let supervisorByHrPerson = new Map<string, string>();
  if (hrPersonIds.length) {
    const { data: hrRows, error: hrErr } = await supabase
      .from('hr_people')
      .select('hr_person_id, supervisor_hr_person_id')
      .eq('tenant_id', tenantId)
      .in('hr_person_id', hrPersonIds)
      .limit(500);
    if (hrErr) {
      log.error('approval_flow.hr_failed', { error: hrErr.message });
      throw AppError.internal(hrErr.message);
    }
    supervisorByHrPerson = new Map(
      (hrRows ?? [])
        .filter((r: any) => r.supervisor_hr_person_id)
        .map((r: any) => [r.hr_person_id, r.supervisor_hr_person_id]),
    );
  }

  const admins = roster
    .filter((u: any) => u.role === 'admin')
    .map((u: any) => ({ user_id: u.user_id, name: nameFor(u), title: titleFor(u) }));

  // Section 1: location → approver (name/title), every location listed.
  const overrides = (locations ?? []).map((l: any) => {
    const approver = l.po_approver_user_id ? userByUserId.get(l.po_approver_user_id) : null;
    return {
      location_id: l.id,
      location_name: l.name,
      last_event_id: l.last_event_id,
      approver_user_id: l.po_approver_user_id || null,
      approver_name: approver ? nameFor(approver) : null,
      approver_title: approver ? titleFor(approver) : null,
      // Set-but-unresolvable (stale id) — surfaced so it's not silently ignored.
      approver_missing: !!l.po_approver_user_id && !approver,
    };
  });

  // Section 2: buyer → supervisor mapping for the roster.
  const supervisorRouting = roster.map((u: any) => {
    const supHrPerson = u.hr_person_id ? supervisorByHrPerson.get(u.hr_person_id) : undefined;
    const supUser = supHrPerson ? userByHrPerson.get(supHrPerson) : undefined;
    return {
      buyer_user_id: u.user_id,
      buyer_name: nameFor(u),
      buyer_title: titleFor(u),
      is_admin: u.role === 'admin',
      supervisor_user_id: supUser?.user_id || null,
      supervisor_name: supUser ? nameFor(supUser) : null,
      supervisor_title: supUser ? titleFor(supUser) : null,
      // No supervisor edge, OR the edge points at someone with no app user →
      // this buyer's over-limit POs fall through to the admin pool.
      falls_through_to_admins: !supUser,
    };
  });

  // Live pending count (same source the approvals inbox uses).
  const { count: pendingCount } = await (supabase as any)
    .schema('supply_chain')
    .from('purchase_orders')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'awaiting_approval');

  return Response.json({
    data: {
      overrides,
      supervisor_routing: supervisorRouting,
      admins,
      pending_count: pendingCount ?? 0,
      // Simple pickers for the simulator (buyers + locations).
      buyers: roster.map((u: any) => ({ user_id: u.user_id, name: nameFor(u), title: titleFor(u) })),
      locations: (locations ?? []).map((l: any) => ({ id: l.id, name: l.name })),
    },
  });
}, { serviceName: SERVICE_NAME });
