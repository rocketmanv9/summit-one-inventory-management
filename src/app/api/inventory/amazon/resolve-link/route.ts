/**
 * Paste-an-Amazon-link resolver (sprint 2026-08-14 item 05).
 *
 * POST /api/inventory/amazon/resolve-link
 *   { url }  — whatever the buyer pasted: a full product URL, a share link with
 *              a mile of ref= tracking, or an a.co / amzn.to short link.
 *
 *   → 200 {
 *       ok, asin, title, price, image_url, source_url, input_url,
 *       source: 'parsed' | 'fetched' | 'degraded',
 *       message,                    // always human-readable, shown verbatim
 *       existing_mapping?: { catalog_item_id, catalog_item_label, ... } | null,
 *       amazon_connected: boolean,  // false → mapping can't be saved yet
 *     }
 *
 * READ-ONLY on purpose: this route only looks things up. Saving the mapping is
 * a separate, explicitly-confirmed write (POST ../map-item) so nothing is
 * persisted from a stray paste.
 *
 * Degrades honestly and NEVER 500s on a bad link — a garbage URL comes back
 * 200 { ok: false, message } so the composer can show an inline hint instead of
 * an error banner. Amazon blocking the page read is likewise not a failure:
 * the ASIN alone is a successful resolution.
 *
 * No SP-API (dev account intentionally lapsed — cXML punchout only).
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { z } from 'zod';

import {
  resolveAmazonLink,
  findAmazonProviderId,
  type AmazonLinkResolution,
} from '@/lib/amazon-link';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const RequestSchema = z.object({
  url: z.string().min(1, 'url is required').max(2000),
});

interface ExistingMapping {
  catalog_item_id: string;
  catalog_item_label: string;
  unit_cost: number | null;
}

/**
 * Has this ASIN already been mapped for the tenant? Lets the composer say
 * "you already map this to Nitrile Gloves (SKU-1234)" instead of silently
 * creating a second mapping to a different item.
 */
async function findExistingMapping(
  tenantId: string,
  providerId: string,
  asin: string,
): Promise<ExistingMapping | null> {
  const admin = getAdminClient() as any;
  const { data } = await admin
    .schema('provisioning')
    .from('provider_item_mappings')
    .select('catalog_item_id, unit_cost')
    .eq('tenant_id', tenantId)
    .eq('provider_id', providerId)
    .eq('external_product_id', asin)
    .limit(1)
    .maybeSingle();

  if (!data?.catalog_item_id) return null;

  const { data: item } = await admin
    .schema('inventory')
    .from('catalog_items')
    .select('name, sku')
    .eq('id', data.catalog_item_id)
    .limit(1)
    .maybeSingle();

  return {
    catalog_item_id: data.catalog_item_id,
    catalog_item_label: item ? `${item.name} (${item.sku})` : data.catalog_item_id,
    unit_cost: data.unit_cost != null ? Number(data.unit_cost) : null,
  };
}

export const POST = createSessionReadRoute(async ({ req, session, log }) => {
  const body = RequestSchema.parse(await req.json());

  const resolved: AmazonLinkResolution = await resolveAmazonLink(body.url);

  const providerId = await findAmazonProviderId(session.tenantId!);
  let existing: ExistingMapping | null = null;
  if (resolved.ok && resolved.asin && providerId) {
    existing = await findExistingMapping(session.tenantId!, providerId, resolved.asin);
  }

  log.info('amazon.link_resolved', {
    ok: resolved.ok,
    source: resolved.source,
    has_title: !!resolved.title,
    has_price: resolved.price != null,
    already_mapped: !!existing,
  });

  return Response.json({
    ...resolved,
    existing_mapping: existing,
    amazon_connected: !!providerId,
  });
}, { serviceName: SERVICE_NAME });
