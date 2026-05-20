import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { getCatalogClient } from '@/lib/vendors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/gv/vendors/catalog
 *
 * Browse the platform vendor catalog.
 * Optional query params: industry (string), activeOnly (boolean, default true).
 */
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const industry = url.searchParams.get('industry') || undefined;
  const activeOnlyParam = url.searchParams.get('activeOnly');
  const activeOnly = activeOnlyParam === 'false' ? false : true;

  const catalog = getCatalogClient();
  const vendors = await catalog.list({ industry, activeOnly });

  return Response.json({ data: vendors });
}, { serviceName: SERVICE_NAME });
