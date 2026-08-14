import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Everything the kit editor's pickers need, in one fetch:
//   positions — hr_position_id + title + how many active people hold it (the
//               headcount is what makes "Estimator" mean something to an admin)
//   locations — active inventory locations for the scope + preview pickers
//   catalog   — active catalog items (id/sku/name) for the add-line search
//
// GET /api/inventory/position-kits/options
//   → 200 { data: { positions: [...], locations: [...], catalog: [...] } }
export const GET = createSessionReadRoute(async ({ session, log }) => {
  const tenantId = session.tenantId!;
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });

  const { data: positions, error: pErr } = await (supabase as any)
    .from('positions')
    .select('hr_position_id, title')
    .eq('tenant_id', tenantId)
    .order('title', { ascending: true })
    .limit(500);
  if (pErr) { log.error('position_kits.options_positions_failed', { error: pErr.message }); throw AppError.internal(pErr.message); }

  const { data: people, error: hErr } = await (supabase as any)
    .from('hr_people')
    .select('hr_person_id, hr_position_id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .limit(10000);
  if (hErr) { log.error('position_kits.options_people_failed', { error: hErr.message }); throw AppError.internal(hErr.message); }
  const counts = new Map<string, number>();
  for (const p of people ?? []) {
    if (!p.hr_position_id) continue;
    counts.set(p.hr_position_id, (counts.get(p.hr_position_id) ?? 0) + 1);
  }

  const inv = (supabase as any).schema('inventory');

  const { data: locations, error: lErr } = await inv
    .from('locations')
    .select('id, name, active')
    .eq('active', true)
    .order('name', { ascending: true })
    .limit(500);
  if (lErr) { log.error('position_kits.options_locations_failed', { error: lErr.message }); throw AppError.internal(lErr.message); }

  const { data: catalog, error: cErr } = await inv
    .from('catalog_items')
    .select('id, sku, name')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('name', { ascending: true })
    .limit(2000);
  if (cErr) { log.error('position_kits.options_catalog_failed', { error: cErr.message }); throw AppError.internal(cErr.message); }

  return Response.json({
    data: {
      positions: (positions ?? []).map((p: any) => ({
        hr_position_id: p.hr_position_id,
        title: p.title,
        people: counts.get(p.hr_position_id) ?? 0,
      })),
      locations: locations ?? [],
      catalog: catalog ?? [],
    },
  });
}, { serviceName: SERVICE_NAME });
