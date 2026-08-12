import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
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

  if (!session.tenantId) {
    throw AppError.forbidden('Session is missing tenantId');
  }

  const gv = getGVClient();

  let labelMap: Map<string, string>;
  try {
    labelMap = await gv.buildLabelMap(session.tenantId, domain);
  } catch (err) {
    log.error('gv_terms.buildLabelMap_failed', { domain, error: String(err) });
    throw AppError.internal(`Failed to load GV terms for domain "${domain}"`);
  }

  // labelMap is Map<termId, label> — convert to array
  const data = Array.from(labelMap, ([term_id, label]) => ({
    term_id,
    label,
  }));

  log.info('gv_terms.list', { domain, count: data.length });

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });
