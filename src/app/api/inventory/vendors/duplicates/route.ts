/**
 * Possible-duplicate vendor pairs — powers the admin duplicates browser.
 *
 * GET /api/inventory/vendors/duplicates?min_confidence=45&limit=100
 *   → { pairs: VendorDuplicatePair[], strongThreshold, hintThreshold }
 *
 * The scan runs entirely in SQL (supply_chain.rpc_vendor_duplicate_pairs) so the
 * whole vendor book is compared pairwise in one set-based pass — same signals
 * and confidence formula as the add-flow matcher (rpc_vendor_match_candidates),
 * never O(n) round trips. Active vendors only; merged vendors are already
 * inactive and drop out on their own. Each side carries the item / PO /
 * address / contact counts the browser shows side-by-side.
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

import { STRONG_MATCH_THRESHOLD, HINT_MATCH_THRESHOLD } from '@/lib/vendor-match';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const minConfidence = clampInt(url.searchParams.get('min_confidence'), HINT_MATCH_THRESHOLD, 1, 100);
  const limit = clampInt(url.searchParams.get('limit'), 100, 1, 200);

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });
  const sc = (supabase as any).schema('supply_chain');

  const { data, error } = await sc.rpc('rpc_vendor_duplicate_pairs', {
    p_tenant_id: session.tenantId!,
    p_min_confidence: minConfidence,
    p_limit: limit,
  });
  if (error) {
    log.error('vendor.duplicates_scan_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({
    pairs: data || [],
    strongThreshold: STRONG_MATCH_THRESHOLD,
    hintThreshold: HINT_MATCH_THRESHOLD,
  });
}, { serviceName: SERVICE_NAME });

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = parseInt(raw || '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
