import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { resolveKitForHire, planKitFulfillment, resolveFallbackBuyer } from '@/lib/position-kits';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// "Preview a hire" — the read-only dry run of item 04's engine.
//
//   GET /api/inventory/position-kits/preview?hr_position_id=…&location_id=…
//     → 200 { data: { kit: {id,name,location_id,order_mode} | null, plan: KitPlan | null,
//                     approval: { buyer, approver } | null } }
//
// Deliberately answers the question the way the automation will: resolve which
// kit applies (location kit beats all-locations kit) and then plan it against
// that location's available stock. Same two functions item 04 calls, so what an
// admin sees here is what the robot will do.
//
// Item 07 (2026-08-26) added `approval`: who the shortfall PO would be authored
// by (same fallback-buyer rule the engine uses for webhook/sync-born hires) and
// which approver resolve_po_approver would route it to. Read-only — the RPC is
// a resolver, not a writer.
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const tenantId = session.tenantId!;
  const url = new URL(req.url);
  const hrPositionId = z.string().uuid().parse(url.searchParams.get('hr_position_id'));
  const locationId = z.string().uuid().parse(url.searchParams.get('location_id'));

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });

  try {
    const kit = await resolveKitForHire(supabase, { tenantId, hrPositionId, locationId });
    if (!kit) return Response.json({ data: { kit: null, plan: null, approval: null } });

    const plan = await planKitFulfillment(supabase, { tenantId, kit, locationId });

    // Who would the shortfall PO route to? Mirror the engine exactly: buyer is
    // the fallback buyer (webhook/sync hires have no acting user), approver
    // comes from item 02's resolver keyed on that buyer + delivery location.
    let approval: {
      buyer: { user_id: string; name: string | null } | null;
      approver: { user_id: string; name: string | null } | null;
    } | null = null;
    try {
      const buyerUserId = await resolveFallbackBuyer(supabase, tenantId);
      const { data: approverUserId } = await (supabase as any)
        .schema('supply_chain')
        .rpc('resolve_po_approver', {
          p_tenant_id: tenantId,
          p_buyer_user_id: buyerUserId,
          p_delivery_location_id: locationId,
        });

      const ids = [buyerUserId, approverUserId].filter(Boolean) as string[];
      const nameById = new Map<string, string | null>();
      if (ids.length > 0) {
        const { data: users } = await (supabase as any)
          .from('local_users')
          .select('user_id, name, email')
          .eq('tenant_id', tenantId)
          .in('user_id', ids)
          .limit(10);
        for (const u of users ?? []) nameById.set(u.user_id, u.name ?? u.email ?? null);
      }
      approval = {
        buyer: buyerUserId ? { user_id: buyerUserId, name: nameById.get(buyerUserId) ?? null } : null,
        approver: approverUserId
          ? { user_id: approverUserId, name: nameById.get(approverUserId) ?? null }
          : null,
      };
    } catch (e) {
      // The routing answer is a bonus, not the preview — degrade to null.
      log.warn('position_kits.preview_approver_failed', { error: (e as Error).message });
    }

    return Response.json({
      data: {
        kit: {
          id: kit.id,
          name: kit.name,
          location_id: kit.location_id,
          order_mode: kit.order_mode,
          // Tells the UI whether the general kit or a location override answered.
          scope: kit.location_id ? 'location' : 'all_locations',
        },
        plan,
        approval,
      },
    });
  } catch (e) {
    log.error('position_kits.preview_failed', { error: (e as Error).message });
    throw AppError.internal((e as Error).message);
  }
}, { serviceName: SERVICE_NAME });
