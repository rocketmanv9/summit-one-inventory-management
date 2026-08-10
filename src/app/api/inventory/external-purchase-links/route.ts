import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Admin catalog of external purchase links (item 04). CRUD is gated on
// purchase_orders.manage — the same purchasing-admin capability that governs POs.
// Consumers hit /external-purchase-links/mine (position-filtered) instead.

const CreateLinkSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  url: z.string().url().max(2000),
  category: z.string().max(120).nullable().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  allowed_positions: z.array(z.string().min(1).max(200)).max(200).optional(),
  requires_po: z.boolean().optional(),
  monthly_limit: z.number().nonnegative().nullable().optional(),
  icon: z.string().max(120).nullable().optional(),
  active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

// List every link in the tenant's catalog (admin view — includes inactive).
export const GET = createSessionReadRoute(async ({ session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });
  const sc = (supabase as any).schema('supply_chain');

  const { data, error } = await sc
    .from('external_purchase_links')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .limit(500);
  if (error) { log.error('purchase_links.list_failed', { error: error.message }); throw AppError.internal(error.message); }

  return Response.json({ data: data ?? [] });
}, { serviceName: SERVICE_NAME });

// Create a link.
export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const body = CreateLinkSchema.parse(await req.json());

  const sc = (supabase as any).schema('supply_chain');
  const { data, error } = await sc
    .from('external_purchase_links')
    .insert({
      tenant_id: ctx.tenantId,
      name: body.name,
      description: body.description ?? null,
      url: body.url,
      category: body.category ?? null,
      vendor_id: body.vendor_id ?? null,
      allowed_positions: body.allowed_positions ?? [],
      requires_po: body.requires_po ?? true,
      monthly_limit: body.monthly_limit ?? null,
      icon: body.icon ?? null,
      active: body.active ?? true,
      sort_order: body.sort_order ?? 0,
      created_by_user_id: ctx.userId,
      last_event_id: idempotencyKey,
    })
    .select('*')
    .single();

  if (error) { log.error('purchase_links.create_failed', { error: error.message }); throw AppError.internal(error.message); }

  return {
    data,
    status: 201,
    events: [{
      event_name: 'external_purchase_link.created',
      payload: { id: data.id, name: data.name },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/external-purchase-links' });
