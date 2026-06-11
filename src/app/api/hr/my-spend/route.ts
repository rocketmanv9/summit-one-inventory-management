/**
 * GET /api/hr/my-spend — the signed-in user's OWN spend picture.
 *
 * Returns their effective per-PO approval cap (user override > position default >
 * company global) and, if a recurring budget is configured, the live usage for
 * the current period (amount / spent / remaining / window). User-scoped — never
 * exposes other people's limits, unlike /api/hr/overview (admin).
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const num = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);

export const GET = createSessionReadRoute(async ({ session }) => {
  const tenantId = session.tenantId;
  const userId = session.userId;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });

  const { data: me, error: meErr } = await supabase
    .from('local_users')
    .select('user_id, name, spending_limit, budget_amount, budget_period, position_id')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();
  if (meErr) throw AppError.internal(meErr.message);

  const [{ data: pos }, { data: settings }] = await Promise.all([
    me?.position_id
      ? supabase
          .from('positions')
          .select('spending_limit, title')
          .eq('tenant_id', tenantId)
          .eq('id', me.position_id)
          .maybeSingle()
      : Promise.resolve({ data: null as { spending_limit?: unknown; title?: string } | null }),
    supabase
      .schema('supply_chain')
      .from('tenant_settings')
      .select('auto_approve_limit')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ]);

  // Per-PO approval cap cascade: user > position > company.
  const userLimit = num(me?.spending_limit);
  const positionLimit = num((pos as { spending_limit?: unknown } | null)?.spending_limit);
  const tenantLimit = num((settings as { auto_approve_limit?: unknown } | null)?.auto_approve_limit);
  const perPoLimit = userLimit ?? positionLimit ?? tenantLimit;
  const perPoSource = userLimit != null ? 'you' : positionLimit != null ? 'position' : tenantLimit != null ? 'company' : null;

  // Live recurring-budget usage for the current period (only if a budget is set).
  const { data: budgetRows, error: budErr } = await supabase
    .schema('supply_chain')
    .rpc('tenant_user_budgets', { p_tenant: tenantId });
  if (budErr) throw AppError.internal(budErr.message);

  const b = (budgetRows ?? []).find((r: { user_id: string }) => r.user_id === userId) as
    | Record<string, unknown>
    | undefined;
  const budget = b
    ? {
        amount: num(b.budget_amount),
        period: b.budget_period as string,
        spent: num(b.spent) ?? 0,
        remaining: num(b.remaining),
        period_start: b.period_start as string,
        period_end: b.period_end as string,
      }
    : null;

  return Response.json({
    data: {
      name: me?.name ?? null,
      position_title: (pos as { title?: string } | null)?.title ?? null,
      per_po_limit: perPoLimit,
      per_po_limit_source: perPoSource,
      budget,
    },
  });
}, { serviceName: SERVICE_NAME });
