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
//
// ── Item 02 addition (fulfillment types) — ADDITIVE, item 08 renders on mobile ──
//   Each item now also carries:
//     fulfillment: {
//       kind: 'catalog' | 'vendor_item' | 'external_link',
//       url: string | null,          // external_link: resolved for THIS caller
//                                    //   (their person link, else item fallback)
//       link_label: string | null,   // external_link display label
//       vendor_id: string | null, vendor: string | null, price: number | null,
//       configured_for_caller: boolean, // false ⇒ render "not configured for
//                                    // you — tell an admin", never a dead-end
//     }
//   'catalog' behaves exactly as before. 'external_link' items must be OPENED
//   (window/Linking) — POSTing them to /request returns them in rejected_links,
//   they never draft POs.
export const GET = createSessionReadRoute(async ({ session, log }) => {
  const tenantId = session.tenantId!;
  const userId = session.userId!;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });

  const { groups, hrPersonId } = await loadAllowedGroupsForCaller(supabase, tenantId, userId);
  const data = await buildConsumerGroupsPayload(supabase, tenantId, groups, (msg, meta) => log.warn(msg, meta), hrPersonId);

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });
