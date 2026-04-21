import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { getVehicleCatalogClient } from '@/lib/vehicles';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/gv/vehicles/catalog?industry=...&activeOnly=true
 *
 * Browse the shared platform vehicle catalog.
 * Tenant-scoped via session auth; catalog data is read-only.
 */
export const GET = createSessionReadRoute(async ({ req }) => {
  const url = new URL(req.url);
  const industry = url.searchParams.get('industry') || undefined;
  const activeOnlyParam = url.searchParams.get('activeOnly');
  const activeOnly = activeOnlyParam === 'false' ? false : true;

  const catalog = getVehicleCatalogClient();
  const vehicles = await catalog.list({ industry, activeOnly });

  return Response.json({ data: vehicles });
}, { serviceName: SERVICE_NAME });
