/**
 * GET /api/inventory/price-wars/candidates
 *
 * Items we buy from two or more vendors, ranked by what the price spread is
 * costing us. Pure detection — reads vendor_items + PO history, writes nothing,
 * stores nothing. See @/lib/price-wars for the math.
 *
 * Query: ?limit=25  ?item=<catalog_item_id> (single-item drill-in)
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

import { findWarCandidates, SPEND_WINDOW_MONTHS } from '@/lib/price-wars';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const tenantId = session.tenantId!;
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get('limit') ?? 25);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 25;
  const itemId = url.searchParams.get('item');

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });

  let candidates;
  try {
    candidates = await findWarCandidates(supabase, tenantId, { limit, catalogItemId: itemId });
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    log.error('price_wars.candidates_failed', { error: err?.message });
    throw AppError.internal(err?.message ?? 'Price-war detection failed');
  }

  const totalSavings = candidates.reduce((sum, c) => sum + c.potential_savings_12m, 0);

  log.info('price_wars.candidates', { count: candidates.length });

  return Response.json({
    data: {
      candidates,
      summary: {
        candidate_count: candidates.length,
        total_potential_savings_12m: Math.round(totalSavings * 100) / 100,
        window_months: SPEND_WINDOW_MONTHS,
      },
    },
  });
}, { serviceName: SERVICE_NAME });
