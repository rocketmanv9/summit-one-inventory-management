import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { getGVClient } from '@/lib/gv';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/gv/terms?domain=uom
 *
 * Returns all terms for a GV domain as { term_id, code, label } tuples.
 * Uses tenant-aware label resolution so overrides are respected.
 */
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const domain = url.searchParams.get('domain');

  if (!domain) {
    return Response.json({ error: 'Missing required query param: domain' }, { status: 400 });
  }

  const gv = getGVClient();
  const labelMap = await gv.buildLabelMap(session.tenantId!, domain);

  // labelMap is Record<termId, label> — convert to array
  const data = Object.entries(labelMap).map(([term_id, label]) => ({
    term_id,
    label,
  }));

  log.info('gv_terms.list', { domain, count: data.length });

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });
