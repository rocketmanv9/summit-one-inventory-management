import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { isHRConfigured } from '@/lib/hr';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/hr/overview — everything the People & Limits page needs:
 *   positions (with per-position caps), users (with position + resolved effective cap),
 *   and the tenant/agent limit settings.
 *
 * Effective per-user cap shown = user override > position default > tenant global
 * (vendor overrides are PO-time and not shown here).
 */
export const GET = createSessionReadRoute(async ({ session }) => {
  const tenantId = session.tenantId;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });

  const [{ data: positions, error: posErr }, { data: users, error: usersErr }, { data: settings, error: setErr }, { data: people, error: pplErr }] =
    await Promise.all([
      supabase
        .from('positions')
        .select('id, hr_position_id, title, name, role_level, role_level_rank, spending_limit, is_active, source, synced_at')
        .eq('tenant_id', tenantId)
        .order('role_level_rank', { ascending: true })
        .order('title', { ascending: true })
        .limit(1000),
      supabase
        .from('local_users')
        .select('user_id, name, email, role, position_id, spending_limit, budget_amount, budget_period, budget_anchor, hr_person_id, synced_at')
        .eq('tenant_id', tenantId)
        .order('name', { ascending: true })
        .limit(1000),
      supabase
        .schema('supply_chain')
        .from('tenant_settings')
        .select('auto_approve_enabled, auto_approve_limit, agent_auto_order_enabled, agent_auto_order_limit, hr_tenant_id')
        .eq('tenant_id', tenantId)
        .maybeSingle(),
      supabase
        .from('hr_people')
        .select('hr_person_id, hr_position_id, first_name, last_name, preferred_name, work_email, personal_email, employment_status, is_active')
        .eq('tenant_id', tenantId)
        .order('last_name', { ascending: true })
        .limit(5000),
    ]);

  if (posErr) throw AppError.internal(posErr.message);
  if (usersErr) throw AppError.internal(usersErr.message);
  if (setErr) throw AppError.internal(setErr.message);
  if (pplErr) throw AppError.internal(pplErr.message);

  // Live period-budget usage (spent/remaining within each user's current window).
  const { data: budgetRows, error: budgetErr } = await supabase
    .schema('supply_chain')
    .rpc('tenant_user_budgets', { p_tenant: tenantId });
  if (budgetErr) throw AppError.internal(budgetErr.message);
  const budgetByUser = new Map<string, any>((budgetRows ?? []).map((b: any) => [b.user_id, b]));

  const tenantLimit = settings?.auto_approve_limit ?? null;
  const positionById = new Map((positions ?? []).map((p: any) => [p.id, p]));
  const positionByHrId = new Map((positions ?? []).filter((p: any) => p.hr_position_id).map((p: any) => [p.hr_position_id, p]));
  const appUserEmails = new Set((users ?? []).map((u: any) => u.email?.trim().toLowerCase()).filter(Boolean));

  const roster = (people ?? []).map((p: any) => {
    const pos = p.hr_position_id ? positionByHrId.get(p.hr_position_id) : null;
    const email = (p.work_email || p.personal_email || '').trim().toLowerCase();
    const positionLimit = pos?.spending_limit ?? null;
    return {
      hr_person_id: p.hr_person_id,
      name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.preferred_name || email || p.hr_person_id.slice(0, 8),
      email: p.work_email || p.personal_email,
      employment_status: p.employment_status,
      is_active: p.is_active,
      position_title: pos?.title ?? null,
      position_limit: positionLimit,
      effective_limit: positionLimit ?? tenantLimit, // roster shows position/tenant cap (no per-app-user override here)
      is_app_user: email ? appUserEmails.has(email) : false,
    };
  });

  const usersWithEffective = (users ?? []).map((u: any) => {
    const pos = u.position_id ? positionById.get(u.position_id) : null;
    const userLimit = u.spending_limit ?? null;
    const positionLimit = pos?.spending_limit ?? null;
    const effective = userLimit ?? positionLimit ?? tenantLimit;
    const b = budgetByUser.get(u.user_id);
    return {
      ...u,
      position_title: pos?.title ?? null,
      position_limit: positionLimit,
      effective_limit: effective, // null => unlimited
      effective_source: userLimit != null ? 'user' : positionLimit != null ? 'position' : tenantLimit != null ? 'tenant' : 'none',
      // Periodic budget (cumulative). budget_* are the stored config; spent/remaining/period_* are live.
      budget_amount: u.budget_amount ?? null,
      budget_period: u.budget_period ?? null,
      budget_anchor: u.budget_anchor ?? null,
      budget_spent: b?.spent ?? null,
      budget_remaining: b?.remaining ?? null,
      budget_period_start: b?.period_start ?? null,
      budget_period_end: b?.period_end ?? null,
    };
  });

  return Response.json({
    data: {
      hrConfigured: isHRConfigured(),
      positions: positions ?? [],
      users: usersWithEffective,
      roster,
      settings: {
        auto_approve_enabled: settings?.auto_approve_enabled ?? true,
        auto_approve_limit: tenantLimit,
        agent_auto_order_enabled: settings?.agent_auto_order_enabled ?? false,
        agent_auto_order_limit: settings?.agent_auto_order_limit ?? null,
        hr_tenant_id: settings?.hr_tenant_id ?? null,
      },
    },
  });
}, { serviceName: SERVICE_NAME });
