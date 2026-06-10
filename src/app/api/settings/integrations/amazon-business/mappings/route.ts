/**
 * Amazon Business Product Mappings API
 * GET  — list ASIN-to-catalog-item mappings
 * POST — create/update a mapping
 * DELETE — remove a mapping
 */
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';
import { rethrowDeleteError } from '@/lib/api/typed-crud';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Helpers ──────────────────────────────────────────────────────────────

async function getProviderForTenant(tenantId: string) {
  const adminClient = getAdminClient();
  const prov = (adminClient as any).schema('provisioning');

  const { data } = await prov
    .from('providers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('provider_type', 'procurement_marketplace')
    .like('provider_key', 'amazon-business%')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (!data) {
    throw AppError.badRequest('Amazon Business is not connected. Configure it in Settings > Integrations.');
  }

  return { adminClient, providerId: data.id };
}

// ── GET: List mappings ───────────────────────────────────────────────────

export const GET = createSessionReadRoute(async ({ session }) => {
  const { adminClient, providerId } = await getProviderForTenant(session.tenantId!);
  const prov = (adminClient as any).schema('provisioning');

  const { data: mappings, error } = await prov
    .from('provider_item_mappings')
    .select('id, catalog_item_id, external_product_id, external_variant_id, unit_cost, lead_time_days, metadata')
    .eq('tenant_id', session.tenantId!)
    .eq('provider_id', providerId)
    .limit(200);

  if (error) throw AppError.internal(error.message);

  // Enrich with catalog item names
  const inv = (adminClient as any).schema('inventory');
  const catalogIds = (mappings || []).map((m: any) => m.catalog_item_id);

  let itemNames: Record<string, string> = {};
  if (catalogIds.length > 0) {
    const { data: items } = await inv
      .from('catalog_items')
      .select('id, name, sku')
      .in('id', catalogIds)
      .limit(200);

    if (items) {
      itemNames = Object.fromEntries(items.map((i: any) => [i.id, `${i.name} (${i.sku})`]));
    }
  }

  const enriched = (mappings || []).map((m: any) => ({
    ...m,
    catalog_item_label: itemNames[m.catalog_item_id] || m.catalog_item_id,
    pack_size: m.metadata?.pack_size ?? null,
    order_unit: m.metadata?.order_unit ?? null,
    inventory_unit: m.metadata?.inventory_unit ?? null,
  }));

  return Response.json({ data: enriched });
}, { serviceName: SERVICE_NAME });

// ── POST: Create/update mapping ──────────────────────────────────────────

const MappingSchema = z.object({
  catalog_item_id: z.string().uuid(),
  asin: z.string().min(1),
  unit_cost: z.number().optional(),
  lead_time_days: z.number().int().optional(),
  pack_size: z.number().int().min(1).optional(),
  order_unit: z.string().optional(),
  inventory_unit: z.string().optional(),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, idempotencyKey }) => {
  const body = MappingSchema.parse(await req.json());
  const { adminClient, providerId } = await getProviderForTenant(ctx.tenantId!);
  const prov = (adminClient as any).schema('provisioning');

  const metadata: Record<string, unknown> = {};
  if (body.pack_size) metadata.pack_size = body.pack_size;
  if (body.order_unit) metadata.order_unit = body.order_unit;
  if (body.inventory_unit) metadata.inventory_unit = body.inventory_unit;

  const { data, error } = await prov
    .from('provider_item_mappings')
    .upsert({
      tenant_id: ctx.tenantId!,
      provider_id: providerId,
      catalog_item_id: body.catalog_item_id,
      external_product_id: body.asin,
      external_variant_id: body.asin, // ASIN serves as both product and variant for Amazon
      unit_cost: body.unit_cost ?? null,
      lead_time_days: body.lead_time_days ?? null,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
      last_event_id: idempotencyKey,
    }, { onConflict: 'tenant_id,provider_id,catalog_item_id' })
    .select()
    .single();

  if (error) throw AppError.internal(error.message);

  return {
    data,
    status: 201,
    events: [{
      event_name: 'vendor_mapping.created',
      payload: { catalog_item_id: body.catalog_item_id, asin: body.asin, provider: 'amazon-business' },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/settings/integrations/amazon-business/mappings' });

// ── DELETE: Remove mapping ───────────────────────────────────────────────

const DeleteMappingSchema = z.object({
  mapping_id: z.string().uuid(),
});

export const DELETE = createSessionWriteRoute(async ({ req, ctx, idempotencyKey }) => {
  const body = DeleteMappingSchema.parse(await req.json());
  const { adminClient, providerId } = await getProviderForTenant(ctx.tenantId!);
  const prov = (adminClient as any).schema('provisioning');

  const { error } = await prov
    .from('provider_item_mappings')
    .delete()
    .eq('id', body.mapping_id)
    .eq('tenant_id', ctx.tenantId!)
    .eq('provider_id', providerId);

  if (error) rethrowDeleteError(error, 'mapping');

  return {
    data: { deleted: true },
    status: 200,
    events: [{
      event_name: 'vendor_mapping.deleted',
      payload: { mapping_id: body.mapping_id, provider: 'amazon-business' },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'DELETE /api/settings/integrations/amazon-business/mappings' });
