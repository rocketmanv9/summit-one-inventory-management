/**
 * Reorder Rules
 * GET  — list reorder rules for the tenant
 * POST — create a new reorder rule
 */
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── GET: List reorder rules ─────────────────────────────────────────

export const GET = createSessionReadRoute(async ({ req, session }) => {
  const url = new URL(req.url);
  const activeOnly = url.searchParams.get('active') !== 'false';
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
  const offset = (page - 1) * limit;

  const adminClient = getAdminClient();
  const proc = (adminClient as any).schema('procurement');

  let query = proc
    .from('reorder_rules')
    .select('*', { count: 'exact' })
    .eq('tenant_id', session.tenantId!)
    .order('item_name', { ascending: true })
    .range(offset, offset + limit - 1);

  if (activeOnly) query = query.eq('is_active', true);

  const { data, error, count } = await query;

  if (error) throw AppError.internal(error.message);

  return Response.json({
    data: data || [],
    meta: { total: count || 0, page, pageSize: limit },
  });
}, { serviceName: SERVICE_NAME });

// ── POST: Create reorder rule ───────────────────────────────────────

const CreateRuleSchema = z.object({
  catalog_item_id: z.string().uuid(),
  item_name: z.string().min(1),
  reorder_point: z.number().int().min(0),
  reorder_qty: z.number().int().positive(),
  max_stock: z.number().int().positive().optional(),
  preferred_provider_id: z.string().uuid().optional(),
  external_product_id: z.string().optional(),
  external_variant_id: z.string().optional(),
  unit_cost: z.number().min(0).optional(),
  auto_reorder: z.boolean().default(false),
  max_auto_amount: z.number().min(0).optional(),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, idempotencyKey }) => {
  const body = CreateRuleSchema.parse(await req.json());

  const adminClient = getAdminClient();
  const proc = (adminClient as any).schema('procurement');

  const { data: rule, error } = await proc
    .from('reorder_rules')
    .upsert({
      tenant_id: ctx.tenantId!,
      catalog_item_id: body.catalog_item_id,
      item_name: body.item_name,
      reorder_point: body.reorder_point,
      reorder_qty: body.reorder_qty,
      max_stock: body.max_stock,
      preferred_provider_id: body.preferred_provider_id,
      external_product_id: body.external_product_id,
      external_variant_id: body.external_variant_id,
      unit_cost: body.unit_cost,
      auto_reorder: body.auto_reorder,
      max_auto_amount: body.max_auto_amount,
      last_event_id: idempotencyKey,
    }, { onConflict: 'tenant_id,catalog_item_id' })
    .select()
    .single();

  if (error) throw AppError.internal(error.message);

  return {
    data: rule,
    status: 201,
    events: [{
      event_name: 'procurement.rule.created',
      payload: { rule_id: rule.id, catalog_item_id: body.catalog_item_id, item_name: body.item_name },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/procurement/reorder-rules' });
