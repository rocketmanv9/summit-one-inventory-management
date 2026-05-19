/**
 * Procurement Orders
 * GET  — list orders with optional status filter
 * POST — create a new order directly from items
 */
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── GET: List orders ──────────────────────────────────────────────────

export const GET = createSessionReadRoute(async ({ req, session }) => {
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const providerId = url.searchParams.get('provider_id');
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 50);
  const offset = (page - 1) * limit;

  const adminClient = getAdminClient();
  const proc = (adminClient as any).schema('procurement');

  let query = proc
    .from('orders')
    .select('id, order_number, provider_id, external_order_id, status, submitted_by, submitted_at, subtotal, tax_amount, shipping_amount, total_amount, notes, created_at, updated_at', { count: 'exact' })
    .eq('tenant_id', session.tenantId!)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);
  if (providerId) query = query.eq('provider_id', providerId);

  const { data, error, count } = await query;

  if (error) throw AppError.internal(error.message);

  return Response.json({
    data: data || [],
    meta: { total: count || 0, page, pageSize: limit },
  });
}, { serviceName: SERVICE_NAME });

// ── POST: Create order directly from items ──────────────────────────

const OrderItemSchema = z.object({
  catalog_item_id: z.string().uuid(),
  item_name: z.string().min(1),
  quantity: z.number().int().positive(),
  unit_price: z.number().min(0),
  external_product_id: z.string().optional(),
  reorder_rule_id: z.string().uuid().optional(),
});

const CreateOrderSchema = z.object({
  provider_id: z.string().uuid(),
  shipping_address: z.object({
    name: z.string().min(1),
    company: z.string().optional(),
    address1: z.string().min(1),
    address2: z.string().optional(),
    city: z.string().min(1),
    state: z.string().min(1),
    postalCode: z.string().min(1),
    country: z.string().min(1).default('US'),
    phone: z.string().optional(),
    email: z.string().email().optional(),
  }),
  billing_address: z.object({
    name: z.string().min(1),
    company: z.string().optional(),
    address1: z.string().min(1),
    address2: z.string().optional(),
    city: z.string().min(1),
    state: z.string().min(1),
    postalCode: z.string().min(1),
    country: z.string().min(1).default('US'),
  }).optional(),
  items: z.array(OrderItemSchema).min(1),
  notes: z.string().optional(),
  job_id: z.string().uuid().optional(),
  cost_center: z.string().optional(),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, idempotencyKey }) => {
  const body = CreateOrderSchema.parse(await req.json());

  const adminClient = getAdminClient();
  const proc = (adminClient as any).schema('procurement');

  // Generate order number
  const year = new Date().getFullYear();
  const { data: latestOrder } = await proc
    .from('orders')
    .select('order_number')
    .eq('tenant_id', ctx.tenantId!)
    .like('order_number', `PROC-${year}-%`)
    .order('order_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  let nextNum = 1;
  if (latestOrder?.order_number) {
    const match = latestOrder.order_number.match(/PROC-\d{4}-(\d+)/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }
  const orderNumber = `PROC-${year}-${String(nextNum).padStart(4, '0')}`;

  // Calculate totals
  const subtotal = body.items.reduce(
    (sum, item) => sum + (item.quantity * item.unit_price), 0
  );

  // Create order
  const { data: order, error: orderError } = await proc
    .from('orders')
    .upsert({
      tenant_id: ctx.tenantId!,
      order_number: orderNumber,
      provider_id: body.provider_id,
      status: 'draft',
      submitted_by: ctx.userId!,
      shipping_address: body.shipping_address,
      billing_address: body.billing_address,
      subtotal,
      total_amount: subtotal,
      notes: body.notes,
      job_id: body.job_id,
      cost_center: body.cost_center,
      last_event_id: idempotencyKey,
    }, { onConflict: 'last_event_id' })
    .select()
    .single();

  if (orderError) throw AppError.internal(orderError.message);

  // Create order items directly from input
  const orderItems = body.items.map((item, idx) => ({
    tenant_id: ctx.tenantId!,
    order_id: order.id,
    external_product_id: item.external_product_id,
    product_title: item.item_name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    line_total: item.quantity * item.unit_price,
    catalog_item_id: item.catalog_item_id,
    last_event_id: `${idempotencyKey}-item-${idx}`,
  }));

  const { error: itemsError } = await proc
    .from('order_items')
    .upsert(orderItems, { onConflict: 'last_event_id' });

  if (itemsError) throw AppError.internal(itemsError.message);

  return {
    data: { ...order, item_count: body.items.length },
    status: 201,
    events: [{
      event_name: 'procurement.order.created',
      payload: { order_id: order.id, order_number: orderNumber, total: subtotal },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/procurement/orders' });
