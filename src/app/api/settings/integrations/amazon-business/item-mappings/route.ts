/**
 * Amazon Business Item Mappings API (vendor_items-backed)
 * GET    — list mappings for the Amazon Business vendor
 * POST   — create or update a mapping
 * DELETE — remove a mapping
 */
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';
const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

// ── Helpers ──────────────────────────────────────────────────────────────

async function getAmazonVendorId(adminClient: any, tenantId: string): Promise<string> {
  const sc = (adminClient as any).schema('supply_chain');

  const { data } = await sc
    .from('vendors')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('code', 'AMAZON-BIZ')
    .eq('active', true)
    .limit(1)
    .maybeSingle();

  if (!data) {
    throw AppError.badRequest(
      'Amazon Business vendor not found. Connect Amazon Business in Settings > Integrations first.'
    );
  }

  return data.id;
}

// ── GET: List item mappings ─────────────────────────────────────────────

export const GET = createSessionReadRoute(async ({ session }) => {
  const adminClient = getAdminClient();
  const sc = (adminClient as any).schema('supply_chain');
  const inv = (adminClient as any).schema('inventory');

  const vendorId = await getAmazonVendorId(adminClient, session.tenantId!);

  const { data: mappings, error } = await sc
    .from('vendor_items')
    .select('id, catalog_item_id, vendor_sku, pack_size, unit_cost, last_known_price, price_checked_at, is_preferred, active, auto_order_enabled, auto_order_max_price, notes, created_at, updated_at')
    .eq('tenant_id', session.tenantId!)
    .eq('vendor_id', vendorId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw AppError.internal(error.message);

  // Enrich with catalog item names
  const catalogIds = (mappings || []).map((m: any) => m.catalog_item_id);
  let itemLookup: Record<string, { name: string; sku: string }> = {};

  if (catalogIds.length > 0) {
    const { data: items } = await inv
      .from('catalog_items')
      .select('id, name, sku')
      .in('id', catalogIds)
      .limit(200);

    if (items) {
      itemLookup = Object.fromEntries(
        items.map((i: any) => [i.id, { name: i.name, sku: i.sku }])
      );
    }
  }

  const enriched = (mappings || []).map((m: any) => ({
    ...m,
    item_name: itemLookup[m.catalog_item_id]?.name ?? null,
    item_sku: itemLookup[m.catalog_item_id]?.sku ?? null,
    supplier_id: vendorId,
    supplier_sku: m.vendor_sku,
    pack_quantity: Number(m.pack_size) || 1,
  }));

  return Response.json({ data: enriched });
}, { serviceName: SERVICE_NAME });

// ── POST: Create or update mapping ──────────────────────────────────────

const CreateMappingSchema = z.object({
  catalog_item_id: z.string().uuid(),
  asin: z.string().min(1).transform((v) => v.trim().toUpperCase()),
  pack_quantity: z.number().int().min(1).default(1),
  unit_cost: z.number().min(0).optional(),
  last_known_price: z.number().min(0).optional(),
  is_preferred: z.boolean().optional().default(false),
  notes: z.string().optional(),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, idempotencyKey }) => {
  const body = CreateMappingSchema.parse(await req.json());

  if (!ASIN_PATTERN.test(body.asin)) {
    throw AppError.badRequest(
      `Invalid ASIN "${body.asin}". Must be exactly 10 alphanumeric characters.`
    );
  }

  const adminClient = getAdminClient();
  const sc = (adminClient as any).schema('supply_chain');
  const vendorId = await getAmazonVendorId(adminClient, ctx.tenantId!);

  const now = new Date().toISOString();

  const { data, error } = await sc
    .from('vendor_items')
    .upsert({
      tenant_id: ctx.tenantId!,
      vendor_id: vendorId,
      catalog_item_id: body.catalog_item_id,
      vendor_sku: body.asin,
      pack_size: body.pack_quantity,
      unit_cost: body.unit_cost ?? null,
      last_known_price: body.last_known_price ?? null,
      price_checked_at: body.last_known_price ? now : null,
      is_preferred: body.is_preferred,
      active: true,
      auto_order_enabled: false,
      auto_order_max_price: null,
      notes: body.notes ?? null,
      last_event_id: idempotencyKey,
    }, { onConflict: 'tenant_id,vendor_id,catalog_item_id' })
    .select()
    .single();

  if (error) throw AppError.internal(error.message);

  return {
    data,
    status: 201,
    events: [{
      event_name: 'vendor_item.upserted',
      payload: {
        vendor_item_id: data.id,
        catalog_item_id: body.catalog_item_id,
        supplier_sku: body.asin,
        vendor: 'amazon-business',
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/settings/integrations/amazon-business/item-mappings' });

// ── DELETE: Remove mapping ──────────────────────────────────────────────

const DeleteMappingSchema = z.object({
  mapping_id: z.string().uuid(),
});

export const DELETE = createSessionWriteRoute(async ({ req, ctx, idempotencyKey }) => {
  const body = DeleteMappingSchema.parse(await req.json());
  const adminClient = getAdminClient();
  const sc = (adminClient as any).schema('supply_chain');
  const vendorId = await getAmazonVendorId(adminClient, ctx.tenantId!);

  const { error } = await sc
    .from('vendor_items')
    .delete()
    .eq('id', body.mapping_id)
    .eq('tenant_id', ctx.tenantId!)
    .eq('vendor_id', vendorId);

  if (error) throw AppError.internal(error.message);

  return {
    data: { deleted: true },
    status: 200,
    events: [{
      event_name: 'vendor_item.deleted',
      payload: { mapping_id: body.mapping_id, vendor: 'amazon-business' },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'DELETE /api/settings/integrations/amazon-business/item-mappings' });
