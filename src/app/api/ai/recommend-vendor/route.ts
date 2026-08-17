import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { z } from 'zod';

import { recommendVendorForItem } from '@/lib/ai/recommend-vendor';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Vendor recommender (sprint item 01) ──────────────────────────────────────
//   GET /api/ai/recommend-vendor?item_ref=wheelstops[&qty=10&location_id=...]
//     → 200 { data: RecommendVendorResult }
//
// Advisory read-only. Answers "who should I buy <item> from?" with a tiered,
// honest list: your tenant vendors (preferred → cheapest, with a fastest marker
// and last-paid signal), then a shared GV vendor_catalog candidate when you have
// none on file, then a "web search available" flag. Shared logic lives in
// @/lib/ai/recommend-vendor so Isabelle's server tool calls the same function
// (no self-HTTP-fetch). Reuses the exact vendor_items ranking the shopping-list
// suggest route uses — it does not change that route's behavior.

const QuerySchema = z.object({
  item_ref: z.string().min(1).max(500),
  qty: z.coerce.number().positive().max(1_000_000).optional(),
  location_id: z.string().uuid().optional(),
});

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const input = QuerySchema.parse({
    item_ref: url.searchParams.get('item_ref') ?? '',
    qty: url.searchParams.get('qty') ?? undefined,
    location_id: url.searchParams.get('location_id') ?? undefined,
  });
  const tenantId = session.tenantId!;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });

  const result = await recommendVendorForItem(supabase, tenantId, input);

  log.info('recommend_vendor', {
    item_ref: input.item_ref,
    resolved: result.resolved,
    tier: result.tier,
    option_count: result.options.length,
    web: result.web_search_available,
  });

  return Response.json({ data: result });
}, { serviceName: SERVICE_NAME });
