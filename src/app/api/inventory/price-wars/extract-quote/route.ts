/**
 * POST /api/inventory/price-wars/extract-quote
 *   { text, item_name?, vendor_name? }
 *
 * A buyer pastes the vendor's reply ("we can do $41.50/ea on 100+, 5 day lead")
 * and gets back { unit_cost, currency, moq, lead_time_days, confidence }. The
 * buyer confirms before anything is written — this route persists NOTHING; the
 * PATCH on the round is what records a price, and a human always drives it.
 *
 * Degrades honestly: no key, unreadable text, or an AI error all return
 * confidence 0 with a message telling the buyer to type the number instead.
 *
 * Read route: it extracts and returns, mutating nothing (same shape as
 * /vendors/extract-card and /vendors/match). The extraction itself lives in
 * `@/lib/price-wars-extract` so the inbox monitor (ingest-replies) reads a price
 * the exact same way.
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { z } from 'zod';

import { extractQuoteFromText } from '@/lib/price-wars-extract';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const RequestSchema = z.object({
  text: z.string().min(1).max(20000),
  item_name: z.string().max(300).nullable().optional(),
  vendor_name: z.string().max(300).nullable().optional(),
});

export const POST = createSessionReadRoute(async ({ req, log }) => {
  const body = RequestSchema.parse(await req.json());
  const result = await extractQuoteFromText({
    text: body.text,
    item_name: body.item_name,
    vendor_name: body.vendor_name,
  });
  log.info('price_wars.quote_extracted', { has_price: result.unit_cost !== null, confidence: result.confidence });
  return Response.json(result);
}, { serviceName: SERVICE_NAME });
