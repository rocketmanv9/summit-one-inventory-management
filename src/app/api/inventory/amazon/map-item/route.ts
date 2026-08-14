/**
 * Confirm a pasted Amazon link → persist the mapping (sprint 2026-08-14 item 05).
 *
 * POST /api/inventory/amazon/map-item
 *   { catalog_item_id, asin, title?, price?, image_url?, source_url? }
 *
 * Writes BOTH mapping layers in one call:
 *   provisioning.provider_item_mappings — the Amazon integration layer (ASIN)
 *   supply_chain.vendor_items           — the ordinary vendor-price layer, so
 *                                         POs/price hints see Amazon as a source
 *
 * Both are upserts on their natural keys and MERGE with what's already there,
 * so re-pasting the same product updates in place — no duplicate rows, and a
 * price-less resolve never blanks a price someone already recorded.
 *
 * The client sends the fields the user just SAW on the confirm card rather than
 * re-fetching, so what gets saved is exactly what they approved. The ASIN is
 * re-validated server-side; everything else is optional garnish.
 */

import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { saveAmazonMapping } from '@/lib/amazon-link';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const RequestSchema = z.object({
  catalog_item_id: z.string().min(1),
  asin: z.string().regex(/^[A-Z0-9]{10}$/, 'asin must be 10 upper-case alphanumerics'),
  title: z.string().max(300).nullish(),
  price: z.number().positive().nullish(),
  image_url: z.string().max(2000).nullish(),
  source_url: z.string().max(2000).nullish(),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  const body = RequestSchema.parse(await req.json());

  if (!ctx.tenantId) throw AppError.unauthorized('No tenant on session');

  const result = await saveAmazonMapping({
    tenantId: ctx.tenantId,
    catalogItemId: body.catalog_item_id,
    asin: body.asin,
    title: body.title ?? null,
    price: body.price ?? null,
    imageUrl: body.image_url ?? null,
    sourceUrl: body.source_url ?? null,
    eventId: idempotencyKey,
  });

  log.info('amazon.item_mapped', {
    asin: body.asin,
    catalog_item_id: body.catalog_item_id,
    reused: result.reused,
    vendor_item_saved: !!result.vendor_item_id,
  });

  return {
    data: result,
    status: 201,
    events: [{
      // Same event the settings mapping page emits — one vocabulary for "this
      // catalog item now has a provider SKU", whichever surface created it.
      event_name: 'vendor_mapping.created',
      payload: {
        catalog_item_id: body.catalog_item_id,
        asin: body.asin,
        provider: 'amazon-business',
        via: 'paste_link',
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/amazon/map-item' });
