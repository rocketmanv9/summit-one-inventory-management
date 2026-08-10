import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Admin catalog of buyable item groups (item 11 — "Who can buy what"). CRUD is
// gated on purchase_orders.manage — the same purchasing-admin capability that
// governs POs and external purchase links (item 04). Consumers hit
// /buyable-groups/mine (position-filtered) and /buyable-groups/request instead.
//
// A group is a named set of catalog items gated to HR position titles. Items are
// stored in a child table (buyable_item_group_items); this route returns each
// group with its items nested, and accepts them nested on create.

const GroupItemSchema = z.object({
  catalog_item_id: z.string().uuid(),
  default_qty: z.number().int().positive().max(100000).optional(),
  preferred_vendor_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().optional(),
});

const CreateGroupSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  allowed_positions: z.array(z.string().min(1).max(200)).max(200).optional(),
  active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  items: z.array(GroupItemSchema).max(500).optional(),
});

// List every group in the tenant's catalog (admin view — includes inactive),
// each with its items nested. Item names/SKUs/UOMs are joined from the inventory
// catalog client-side (cross-schema) so the settings UI renders in one fetch.
export const GET = createSessionReadRoute(async ({ session, log }) => {
  const tenantId = session.tenantId!;
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  const sc = (supabase as any).schema('supply_chain');

  const { data: groups, error: gErr } = await sc
    .from('buyable_item_groups')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .limit(500);
  if (gErr) { log.error('buyable_groups.list_failed', { error: gErr.message }); throw AppError.internal(gErr.message); }

  const groupIds = (groups ?? []).map((g: any) => g.id);
  const itemsByGroup = new Map<string, any[]>();
  const catalogIds = new Set<string>();

  if (groupIds.length > 0) {
    const { data: items, error: iErr } = await sc
      .from('buyable_item_group_items')
      .select('id, group_id, catalog_item_id, default_qty, preferred_vendor_id, sort_order')
      .in('group_id', groupIds)
      .order('sort_order', { ascending: true })
      .limit(5000);
    if (iErr) { log.error('buyable_groups.items_failed', { error: iErr.message }); throw AppError.internal(iErr.message); }

    for (const it of items ?? []) {
      if (!itemsByGroup.has(it.group_id)) itemsByGroup.set(it.group_id, []);
      itemsByGroup.get(it.group_id)!.push(it);
      catalogIds.add(it.catalog_item_id);
    }
  }

  // Cross-schema join to inventory.catalog_items for display (name/sku/uom).
  const catalogMap = new Map<string, any>();
  if (catalogIds.size > 0) {
    const { data: cat } = await (supabase as any)
      .schema('inventory')
      .from('catalog_items')
      .select('id, name, sku, uom_term_id')
      .in('id', Array.from(catalogIds))
      .limit(5000);
    for (const c of cat ?? []) catalogMap.set(c.id, c);
  }

  const result = (groups ?? []).map((g: any) => ({
    ...g,
    items: (itemsByGroup.get(g.id) ?? []).map((it: any) => {
      const c = catalogMap.get(it.catalog_item_id);
      return {
        id: it.id,
        catalog_item_id: it.catalog_item_id,
        default_qty: it.default_qty,
        preferred_vendor_id: it.preferred_vendor_id,
        sort_order: it.sort_order,
        name: c?.name ?? null,
        sku: c?.sku ?? null,
        uom_term_id: c?.uom_term_id ?? null,
      };
    }),
  }));

  return Response.json({ data: result });
}, { serviceName: SERVICE_NAME });

// Create a group and its items.
export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const body = CreateGroupSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;

  const sc = (supabase as any).schema('supply_chain');
  const { data: group, error } = await sc
    .from('buyable_item_groups')
    .insert({
      tenant_id: tenantId,
      name: body.name,
      description: body.description ?? null,
      allowed_positions: body.allowed_positions ?? [],
      active: body.active ?? true,
      sort_order: body.sort_order ?? 0,
      created_by_user_id: ctx.userId,
      last_event_id: idempotencyKey,
    })
    .select('*')
    .single();
  if (error) { log.error('buyable_groups.create_failed', { error: error.message }); throw AppError.internal(error.message); }

  if (body.items && body.items.length > 0) {
    const rows = body.items.map((it, idx) => ({
      tenant_id: tenantId,
      group_id: group.id,
      catalog_item_id: it.catalog_item_id,
      default_qty: it.default_qty ?? 1,
      preferred_vendor_id: it.preferred_vendor_id ?? null,
      sort_order: it.sort_order ?? idx,
      last_event_id: crypto.randomUUID(),
    }));
    const { error: iErr } = await sc
      .from('buyable_item_group_items')
      .upsert(rows, { onConflict: 'group_id,catalog_item_id' });
    if (iErr) { log.error('buyable_groups.items_insert_failed', { error: iErr.message }); throw AppError.internal(iErr.message); }
  }

  return {
    data: { ...group, items: body.items ?? [] },
    status: 201,
    events: [{
      event_name: 'buyable_item_group.created',
      payload: { id: group.id, name: group.name, item_count: body.items?.length ?? 0 },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/buyable-groups' });
