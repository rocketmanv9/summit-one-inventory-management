import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';

import { buildConsumerGroupsPayload, loadAllowedGroupsForCaller } from '@/lib/buyable-groups';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Item 12 contract (mobile quick action) ───────────────────────────────────
//   GET /api/inventory/buyable-groups/mine
//     → 200 { data: [ {
//          group: { id, name, description },
//          items: [ {
//            catalog_item_id, name, uom, default_qty,
//            est_unit_cost | null, preferred_vendor_name | null
//          } ]
//        } ] }
//   Returns exactly the groups the CALLER's HR position allows (admins see all),
//   with each group's items. Only ACTIVE groups that have at least one item are
//   returned. est_unit_cost / preferred_vendor_name come from the best
//   vendor_items row (preferred, then cheapest) and are null when none is known.
//   Auth: session. Position gating is server-side and cannot be bypassed.
//   The shaping lives in buildConsumerGroupsPayload so the admin preview-as
//   surface (/buyable-groups/preview) renders EXACTLY this response.
export const GET = createSessionReadRoute(async ({ session, log }) => {
  const tenantId = session.tenantId!;
  const userId = session.userId!;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });

  const { groups } = await loadAllowedGroupsForCaller(supabase, tenantId, userId);
  const data = await buildConsumerGroupsPayload(supabase, tenantId, groups, (msg, meta) => log.warn(msg, meta));

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });
