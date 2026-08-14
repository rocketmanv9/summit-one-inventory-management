import { z } from 'zod';
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const QuerySchema = z.object({
  buyer_user_id: z.string().uuid(),
  delivery_location_id: z.string().uuid().optional(),
});

type Rule = 'person_override' | 'location_override' | 'supervisor' | 'named_fallback' | 'admin_pool';

const RULE_EXPLANATION: Record<Rule, (buyer: string, loc: string | null) => string> = {
  person_override: (buyer) => `Personal override on ${buyer}`,
  location_override: (_b, loc) => `Location override on ${loc || 'this location'}`,
  supervisor: (buyer) => `${buyer}'s supervisor`,
  named_fallback: () => 'Named fallback approver (tenant setting)',
  admin_pool: () => 'Falls back to admins (any admin can approve)',
};

/**
 * GET /api/inventory/purchasing/approval-flow/simulate — "if THIS person buys
 * from THIS location, who approves?" (sprint item 10; upgraded 2026-08-14 item
 * 02 for the person-override + named-fallback tiers).
 *
 * Calls the REAL `supply_chain.resolve_po_approval_route()` — the exact
 * function every PO-creating path stores provenance from — and relays its
 * resolved rule + step trace verbatim. No client-side re-implementation, no
 * rule-guessing by comparison: the tier NAME comes from the resolver itself,
 * so new tiers show up here automatically.
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

  // The source of truth: resolved approver + rule + full step trace.
  const { data: route, error: rpcErr } = await sc.rpc('resolve_po_approval_route', {
    p_tenant_id: tenantId,
    p_buyer_user_id: params.buyer_user_id,
    p_delivery_location_id: params.delivery_location_id ?? null,
  });
  if (rpcErr) {
    log.error('approval_flow.simulate_failed', { error: rpcErr.message });
    throw AppError.internal(rpcErr.message);
  }

  const approverId: string | null = route?.resolved_user_id ?? null;
  const rule: Rule = (route?.resolved_rule as Rule) || 'admin_pool';
  const steps: unknown[] = Array.isArray(route?.steps) ? route.steps : [];

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
  const explain = RULE_EXPLANATION[rule] ?? RULE_EXPLANATION.admin_pool;

  return Response.json({
    data: {
      approver_user_id: approverId,
      approver_name: approverId ? nameById.get(approverId) || 'Unknown' : null,
      rule,
      explanation: explain(buyerName, locationName),
      buyer_name: buyerName,
      location_name: locationName,
      // The resolver's own step trace — the settings page renders it so the
      // simulator explains not just WHO but WHY.
      steps,
    },
  });
}, { serviceName: SERVICE_NAME });
