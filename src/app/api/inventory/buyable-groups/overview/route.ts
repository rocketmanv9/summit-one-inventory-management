import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

import { assertCapability } from '@/lib/access-server';
import { resolveBestVendorItems, resolveVendorItemRows, type FulfillmentKind } from '@/lib/buyable-groups';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Item 03 (buying-access rework) — the landing-page aggregate ──────────────
//   GET /api/inventory/buyable-groups/overview
//     → 200 { data: { groups: [...], position_counts: { [title]: n } } }
//
// One admin-gated read that answers, per group and per item, "how is this thing
// ACTUALLY fulfilled and for whom does it work?" — the question the old
// matrix-first page could not answer on screen. Each item carries a `resolution`
// computed with the SAME helpers the consumer /mine//request paths use
// (resolveBestVendorItems / resolveVendorItemRows), so what this page claims is
// what drafting does:
//   - catalog:      admin-pinned vendor, else best vendor_items row (preferred →
//                   cheapest), else NONE → the line drafts as free text onto the
//                   per-tenant "Guided Purchase" placeholder PO and a buyer must
//                   assign a real vendor before approval. Never silent.
//   - vendor_item:  the exact pinned vendor_items row (vendor + price);
//                   pin_ok=false when the row is gone/inactive (drafting then
//                   falls back to normal catalog resolution).
//   - external_link: per-person coverage — how many ACTIVE people in the group's
//                   allowed positions have an active person link, plus whether a
//                   shared fallback URL exists.
//
// position_counts = active HR headcount per position title (hr_people mirror) —
// powers "Estimator · 12 people" chips and the wizard's member counts.
export const GET = createSessionReadRoute(async ({ session, log }) => {
  const tenantId = session.tenantId!;
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  await assertCapability(supabase, { tenantId, userId: session.userId! }, 'purchase_orders.manage');
  const sc = (supabase as any).schema('supply_chain');

  // Groups (admin view — includes inactive) + items.
  const { data: groups, error: gErr } = await sc
    .from('buyable_item_groups')
    .select('id, name, description, allowed_positions, active, sort_order')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .limit(500);
  if (gErr) { log.error('buyable_overview.groups_failed', { error: gErr.message }); throw AppError.internal(gErr.message); }

  const groupIds = (groups ?? []).map((g: any) => g.id);
  let items: any[] = [];
  if (groupIds.length > 0) {
    const { data, error: iErr } = await sc
      .from('buyable_item_group_items')
      .select('id, group_id, catalog_item_id, default_qty, preferred_vendor_id, sort_order, fulfillment_kind, external_url, link_label, vendor_item_id')
      .in('group_id', groupIds)
      .order('sort_order', { ascending: true })
      .limit(5000);
    if (iErr) { log.error('buyable_overview.items_failed', { error: iErr.message }); throw AppError.internal(iErr.message); }
    items = data ?? [];
  }

  // Catalog display names (cross-schema).
  const catalogIds = Array.from(new Set(items.map((it) => it.catalog_item_id)));
  const catalogMap = new Map<string, any>();
  if (catalogIds.length > 0) {
    const { data: cat } = await (supabase as any)
      .schema('inventory')
      .from('catalog_items')
      .select('id, name, sku, uom_term_id')
      .in('id', catalogIds)
      .limit(5000);
    for (const c of cat ?? []) catalogMap.set(c.id, c);
  }

  // Vendor resolution — identical helpers to the consumer draft path.
  const bestVendors = await resolveBestVendorItems(
    supabase,
    tenantId,
    items.filter((it) => (it.fulfillment_kind ?? 'catalog') === 'catalog').map((it) => it.catalog_item_id),
  );
  const pinnedRows = await resolveVendorItemRows(
    supabase,
    items.filter((it) => it.fulfillment_kind === 'vendor_item' && it.vendor_item_id).map((it) => it.vendor_item_id),
  );

  // Admin-pinned vendor names (catalog items with preferred_vendor_id).
  const adminVendorIds = Array.from(new Set(items.map((it) => it.preferred_vendor_id).filter(Boolean)));
  const adminVendorNames = new Map<string, string>();
  if (adminVendorIds.length > 0) {
    const { data: vendors } = await sc
      .from('vendors')
      .select('id, name')
      .in('id', adminVendorIds)
      .limit(1000);
    for (const v of vendors ?? []) adminVendorNames.set(v.id, v.name);
  }

  // Person-link coverage for external_link items.
  const linkItemIds = items.filter((it) => it.fulfillment_kind === 'external_link').map((it) => it.id);
  const linksByItem = new Map<string, Set<string>>(); // group_item_id → hr_person_ids with active link
  if (linkItemIds.length > 0) {
    const { data: links } = await sc
      .from('buyable_item_person_links')
      .select('group_item_id, hr_person_id, active')
      .eq('tenant_id', tenantId)
      .in('group_item_id', linkItemIds)
      .limit(5000);
    for (const l of links ?? []) {
      if (l.active === false) continue;
      if (!linksByItem.has(l.group_item_id)) linksByItem.set(l.group_item_id, new Set());
      linksByItem.get(l.group_item_id)!.add(l.hr_person_id);
    }
  }

  // Active HR headcount per position title, and person→title for coverage math.
  const [{ data: ppl }, { data: positions }] = await Promise.all([
    (supabase as any)
      .from('hr_people')
      .select('hr_person_id, hr_position_id, is_active')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .limit(10000),
    (supabase as any)
      .from('positions')
      .select('hr_position_id, title')
      .eq('tenant_id', tenantId)
      .limit(1000),
  ]);
  const titleByPosition = new Map<string, string>((positions ?? []).map((p: any) => [p.hr_position_id, p.title]));
  const positionCounts: Record<string, number> = {};
  for (const t of titleByPosition.values()) positionCounts[t] = positionCounts[t] ?? 0;
  const peopleByTitle = new Map<string, string[]>();
  for (const p of ppl ?? []) {
    const title = p.hr_position_id ? titleByPosition.get(p.hr_position_id) : undefined;
    if (!title) continue;
    positionCounts[title] = (positionCounts[title] ?? 0) + 1;
    if (!peopleByTitle.has(title)) peopleByTitle.set(title, []);
    peopleByTitle.get(title)!.push(p.hr_person_id);
  }

  const itemsByGroup = new Map<string, any[]>();
  for (const it of items) {
    if (!itemsByGroup.has(it.group_id)) itemsByGroup.set(it.group_id, []);
    itemsByGroup.get(it.group_id)!.push(it);
  }

  const result = (groups ?? []).map((g: any) => {
    const allowed: string[] = Array.isArray(g.allowed_positions) ? g.allowed_positions : [];
    // The people this group serves (active, in an allowed position).
    const groupPeople = new Set<string>();
    for (const t of allowed) for (const id of peopleByTitle.get(t) ?? []) groupPeople.add(id);

    return {
      id: g.id,
      name: g.name,
      description: g.description ?? null,
      allowed_positions: allowed,
      active: g.active,
      sort_order: g.sort_order ?? 0,
      items: (itemsByGroup.get(g.id) ?? []).map((it: any) => {
        const c = catalogMap.get(it.catalog_item_id);
        const kind: FulfillmentKind = it.fulfillment_kind ?? 'catalog';

        let resolution: Record<string, unknown>;
        if (kind === 'external_link') {
          const covered = linksByItem.get(it.id) ?? new Set<string>();
          let coveredCount = 0;
          for (const id of covered) if (groupPeople.has(id)) coveredCount += 1;
          resolution = {
            kind,
            has_fallback: !!it.external_url,
            link_label: it.link_label ?? null,
            people_total: groupPeople.size,
            people_covered: coveredCount,
            links_total: covered.size, // incl. people outside allowed positions
          };
        } else if (kind === 'vendor_item') {
          const row = it.vendor_item_id ? pinnedRows.get(it.vendor_item_id) : undefined;
          resolution = {
            kind,
            pin_ok: !!row,
            vendor_id: row?.vendor_id ?? null,
            vendor_name: row?.vendor_name ?? null,
            unit_cost: row?.unit_cost ?? null,
          };
        } else {
          const best = bestVendors.get(it.catalog_item_id);
          resolution = {
            kind,
            admin_vendor_name: it.preferred_vendor_id ? adminVendorNames.get(it.preferred_vendor_id) ?? null : null,
            vendor_id: best?.vendor_id ?? null,
            vendor_name: best?.vendor_name ?? null,
            unit_cost: best?.unit_cost ?? null,
            vendor_is_preferred: best?.is_preferred ?? false,
          };
        }

        return {
          id: it.id,
          catalog_item_id: it.catalog_item_id,
          default_qty: it.default_qty ?? 1,
          preferred_vendor_id: it.preferred_vendor_id ?? null,
          sort_order: it.sort_order ?? 0,
          fulfillment_kind: kind,
          external_url: it.external_url ?? null,
          link_label: it.link_label ?? null,
          vendor_item_id: it.vendor_item_id ?? null,
          name: c?.name ?? null,
          sku: c?.sku ?? null,
          uom_term_id: c?.uom_term_id ?? null,
          resolution,
        };
      }),
    };
  });

  return Response.json({ data: { groups: result, position_counts: positionCounts } });
}, { serviceName: SERVICE_NAME });
