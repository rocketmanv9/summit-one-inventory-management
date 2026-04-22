import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { getEquipmentCatalogClient } from '@/lib/equipment';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/gv/equipment/catalog?industry=...&activeOnly=true
 *
 * Browse the shared platform equipment catalog.
 * Optional query params: industry (string), activeOnly (boolean, default true).
 */
export const GET = createSessionReadRoute(async ({ req }) => {
  const url = new URL(req.url);
  const industry = url.searchParams.get('industry') || undefined;
  const activeOnlyParam = url.searchParams.get('activeOnly');
  const activeOnly = activeOnlyParam === 'false' ? false : true;

  const catalog = getEquipmentCatalogClient();
  const equipment = await catalog.list({ industry, activeOnly });

  return Response.json({ data: equipment });
}, { serviceName: SERVICE_NAME });
