import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Vendor choices per catalog item for the group editor's "preferred vendor"
// dropdown (item 02, tyler-ideas sprint):
//   GET /api/inventory/buyable-groups/vendor-options?catalog_item_ids=a,b,c
//     → 200 { data: { [catalog_item_id]: [ { vendor_id, vendor_name,
//                       unit_cost | null, is_preferred, vendor_item_id } ] } }
// Reads supply_chain.vendor_items (active rows) — the same table the draft-PO
// path resolves against — so pinning a vendor here always pins a real option.
// Options are sorted the way resolution ranks them: preferred, then cheapest.
// vendor_item_id (item 03) is the underlying vendor_items row id — what a
// fulfillment_kind='vendor_item' pin stores. Additive; older callers ignore it.
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const tenantId = session.tenantId!;
  const url = new URL(req.url);
  const raw = (url.searchParams.get('catalog_item_ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ids = z.array(z.string().uuid()).max(500).parse(raw);
  if (ids.length === 0) return Response.json({ data: {} });

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  const sc = (supabase as any).schema('supply_chain');

  const { data: rows, error } = await sc
    .from('vendor_items')
    .select('id, catalog_item_id, vendor_id, unit_cost, is_preferred, active')
    .in('catalog_item_id', ids)
    .limit(5000);
  if (error) { log.error('buyable_groups.vendor_options_failed', { error: error.message }); throw AppError.internal(error.message); }

  const active = (rows ?? []).filter((r: any) => r.active !== false && r.vendor_id);
  const vendorIds = Array.from(new Set<string>(active.map((r: any) => r.vendor_id)));
  const vendorNames = new Map<string, string>();
  if (vendorIds.length > 0) {
    const { data: vendors, error: vErr } = await sc
      .from('vendors')
      .select('id, name')
      .in('id', vendorIds)
      .limit(5000);
    if (vErr) { log.error('buyable_groups.vendor_names_failed', { error: vErr.message }); throw AppError.internal(vErr.message); }
    for (const v of vendors ?? []) vendorNames.set(v.id, v.name);
  }

  const data: Record<string, Array<{ vendor_id: string; vendor_name: string | null; unit_cost: number | null; is_preferred: boolean; vendor_item_id: string }>> = {};
  for (const r of active) {
    if (!data[r.catalog_item_id]) data[r.catalog_item_id] = [];
    data[r.catalog_item_id].push({
      vendor_id: r.vendor_id,
      vendor_name: vendorNames.get(r.vendor_id) ?? null,
      unit_cost: r.unit_cost != null ? Number(r.unit_cost) : null,
      is_preferred: !!r.is_preferred,
      vendor_item_id: r.id,
    });
  }
  // Dedupe (an item can have default + branch-override rows for one vendor) and
  // sort the way PO resolution ranks: preferred first, then cheapest.
  for (const key of Object.keys(data)) {
    const seen = new Map<string, { vendor_id: string; vendor_name: string | null; unit_cost: number | null; is_preferred: boolean; vendor_item_id: string }>();
    for (const opt of data[key]) {
      const cur = seen.get(opt.vendor_id);
      const better = !cur
        || (opt.is_preferred && !cur.is_preferred)
        || (opt.is_preferred === cur.is_preferred
            && (opt.unit_cost ?? Infinity) < (cur.unit_cost ?? Infinity));
      if (better) seen.set(opt.vendor_id, opt);
    }
    data[key] = Array.from(seen.values()).sort((a, b) => {
      if (a.is_preferred !== b.is_preferred) return a.is_preferred ? -1 : 1;
      // MAX_VALUE (not Infinity) so two null costs subtract to 0, not NaN.
      return (a.unit_cost ?? Number.MAX_VALUE) - (b.unit_cost ?? Number.MAX_VALUE);
    });
  }

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });
