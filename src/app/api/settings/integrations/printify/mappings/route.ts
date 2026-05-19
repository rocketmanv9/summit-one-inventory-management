/**
 * Printify Product Mappings API
 * GET  — list mappings for tenant's Printify provider
 * POST — create/update a mapping (catalog_item_id → Printify product/variant)
 */
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Helpers ──────────────────────────────────────────────────────────────

async function getProviderForTenant(tenantId: string) {
  const adminClient = getAdminClient();
  const prov = (adminClient as any).schema('provisioning');

  const { data } = await prov
    .from('providers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('provider_type', 'print_on_demand')
    .like('provider_key', 'printify%')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (!data) {
    throw AppError.badRequest('Printify is not connected. Configure it in Settings > Integrations.');
  }

  return { adminClient, providerId: data.id };
}

// ── GET: List mappings ───────────────────────────────────────────────────

export const GET = createSessionReadRoute(async ({ session, log }) => {
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
  }));

  return Response.json({ data: enriched });
}, { serviceName: SERVICE_NAME });

// ── POST: Create/update mapping ─────────────────────────────────────────

const MappingSchema = z.object({
  catalog_item_id: z.string().uuid(),
  printify_product_id: z.string().min(1),
  printify_variant_id: z.string().min(1),
  unit_cost: z.number().optional(),
  lead_time_days: z.number().int().optional(),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  const body = MappingSchema.parse(await req.json());
  const { adminClient, providerId } = await getProviderForTenant(ctx.tenantId!);
  const prov = (adminClient as any).schema('provisioning');

  const { data, error } = await prov
    .from('provider_item_mappings')
    .upsert({
      tenant_id: ctx.tenantId!,
      provider_id: providerId,
      catalog_item_id: body.catalog_item_id,
      external_product_id: body.printify_product_id,
      external_variant_id: body.printify_variant_id,
      unit_cost: body.unit_cost ?? null,
      lead_time_days: body.lead_time_days ?? null,
      last_event_id: idempotencyKey,
    }, { onConflict: 'tenant_id,provider_id,catalog_item_id' })
    .select()
    .single();

  if (error) throw AppError.internal(error.message);

  return {
    data,
    status: 201,
    events: [{
      event_name: 'mapping.created',
      payload: { catalog_item_id: body.catalog_item_id, printify_product_id: body.printify_product_id },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/settings/integrations/printify/mappings' });
