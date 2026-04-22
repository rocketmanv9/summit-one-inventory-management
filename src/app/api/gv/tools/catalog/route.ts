import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { getToolCatalogClient } from '@/lib/tools';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/gv/tools/catalog
 *
 * Browse the platform tool catalog.
 * Optional query params: industry (string), activeOnly (boolean, default true).
 */
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const industry = url.searchParams.get('industry') || undefined;
  const activeOnlyParam = url.searchParams.get('activeOnly');
  const activeOnly = activeOnlyParam === 'false' ? false : true;

  const catalog = getToolCatalogClient();
  const tools = await catalog.list({ industry, activeOnly });

  return Response.json({ data: tools });
}, { serviceName: SERVICE_NAME });
