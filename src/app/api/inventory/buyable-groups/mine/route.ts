import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';

import { loadAllowedGroupsForCaller, resolveBestVendorItems } from '@/lib/buyable-groups';

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
export const GET = createSessionReadRoute(async ({ session, log }) => {
  const tenantId = session.tenantId!;
  const userId = session.userId!;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });

  const { groups } = await loadAllowedGroupsForCaller(supabase, tenantId, userId);

  // Resolve UOM labels + best vendor/price across every item once.
  const allCatalogIds = groups.flatMap((g) => g.items.map((it) => it.catalog_item_id));
  const uomTermIds = Array.from(
    new Set(groups.flatMap((g) => g.items.map((it) => it.uom_term_id).filter(Boolean))),
  ) as string[];

  const bestVendors = await resolveBestVendorItems(supabase, tenantId, allCatalogIds);

  // UOM labels from GV — best-effort; null on failure. displayLabels resolves the
  // exact term ids (via rpc_gv_display_labels), which also picks up tenant-specific
  // terms that a domain listing (buildLabelMap) can miss.
  const uomLabels: Record<string, string> = {};
  if (uomTermIds.length > 0) {
    try {
      const { getGVClient } = await import('@/lib/gv');
      const gv = getGVClient();
      const results = await gv.displayLabels(tenantId, uomTermIds as any);
      for (const r of results) uomLabels[r.term_id as unknown as string] = r.label;
    } catch (e: any) {
      log.warn('buyable_groups.uom_labels_failed', { error: e?.message });
    }
  }

  const data = groups.map((g) => ({
    group: { id: g.id, name: g.name, description: g.description },
    items: g.items.map((it) => {
      // An admin-pinned vendor overrides the resolved one for the display name,
      // but we only have a price from the resolved best row.
      const best = bestVendors.get(it.catalog_item_id);
      return {
        catalog_item_id: it.catalog_item_id,
        name: it.name,
        uom: it.uom_term_id ? uomLabels[it.uom_term_id] ?? null : null,
        default_qty: it.default_qty,
        est_unit_cost: best?.unit_cost ?? null,
        preferred_vendor_name: best?.vendor_name ?? null,
      };
    }),
  }));

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });
