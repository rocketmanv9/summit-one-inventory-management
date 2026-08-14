import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Position kits — "an estimator gets a laptop, 3 polos, pens" (item 03).
// Admin CRUD, gated on purchase_orders.manage like the sibling buying-access
// catalog: defining a kit commits the company to buying things, so it's the
// same purchasing-admin bar. Item 04's automation reads these tables through
// src/lib/position-kits.ts, not through this route.
//
// A kit is keyed on hr_position_id (stable) + an OPTIONAL location_id. A
// location kit overrides the all-locations kit for that location; that rule
// lives in resolveKitForHire(), not here.

const KitItemSchema = z.object({
  catalog_item_id: z.string().uuid(),
  qty: z.number().int().positive().max(10000),
  preferred_vendor_id: z.string().uuid().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  sort_order: z.number().int().optional(),
});

const CreateKitSchema = z.object({
  hr_position_id: z.string().uuid(),
  location_id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
  order_mode: z.enum(['draft', 'auto_submit']).optional(),
  items: z.array(KitItemSchema).max(200).optional(),
});

// List every kit with its lines, plus the display context the settings page
// needs in one fetch: position title, active-people count, location name.
export const GET = createSessionReadRoute(async ({ session, log }) => {
  const tenantId = session.tenantId!;
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  const sc = (supabase as any).schema('supply_chain');

  const { data: kits, error } = await sc
    .from('position_kits')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) { log.error('position_kits.list_failed', { error: error.message }); throw AppError.internal(error.message); }

  const kitIds = (kits ?? []).map((k: any) => k.id);
  const itemsByKit = new Map<string, any[]>();
  const catalogIds = new Set<string>();

  if (kitIds.length > 0) {
    const { data: items, error: iErr } = await sc
      .from('position_kit_items')
      .select('id, kit_id, catalog_item_id, qty, preferred_vendor_id, note, sort_order')
      .in('kit_id', kitIds)
      .order('sort_order', { ascending: true })
      .limit(5000);
    if (iErr) { log.error('position_kits.items_failed', { error: iErr.message }); throw AppError.internal(iErr.message); }
    for (const it of items ?? []) {
      if (!itemsByKit.has(it.kit_id)) itemsByKit.set(it.kit_id, []);
      itemsByKit.get(it.kit_id)!.push(it);
      catalogIds.add(it.catalog_item_id);
    }
  }

  // Cross-schema display joins (catalog names, vendor names, location names).
  const catalogMap = new Map<string, any>();
  if (catalogIds.size > 0) {
    const { data: cat } = await (supabase as any)
      .schema('inventory')
      .from('catalog_items')
      .select('id, name, sku')
      .in('id', Array.from(catalogIds))
      .limit(5000);
    for (const c of cat ?? []) catalogMap.set(c.id, c);
  }

  const vendorMap = new Map<string, string>();
  const vendorIds = Array.from(new Set(
    Array.from(itemsByKit.values()).flat().map((i: any) => i.preferred_vendor_id).filter(Boolean),
  )) as string[];
  if (vendorIds.length > 0) {
    const { data: vendors } = await sc.from('vendors').select('id, name').in('id', vendorIds).limit(1000);
    for (const v of vendors ?? []) vendorMap.set(v.id, v.name);
  }

  const locationMap = new Map<string, string>();
  const { data: locations } = await (supabase as any)
    .schema('inventory')
    .from('locations')
    .select('id, name')
    .limit(500);
  for (const l of locations ?? []) locationMap.set(l.id, l.name);

  // Position titles + headcount, so a kit card can say "Estimator — 13 people".
  const positionIds = Array.from(new Set((kits ?? []).map((k: any) => k.hr_position_id)));
  const titleMap = new Map<string, string>();
  const peopleCount = new Map<string, number>();
  if (positionIds.length > 0) {
    const { data: positions } = await (supabase as any)
      .from('positions')
      .select('hr_position_id, title')
      .eq('tenant_id', tenantId)
      .in('hr_position_id', positionIds)
      .limit(500);
    for (const p of positions ?? []) titleMap.set(p.hr_position_id, p.title);

    const { data: people } = await (supabase as any)
      .from('hr_people')
      .select('hr_person_id, hr_position_id')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('hr_position_id', positionIds)
      .limit(5000);
    for (const p of people ?? []) peopleCount.set(p.hr_position_id, (peopleCount.get(p.hr_position_id) ?? 0) + 1);
  }

  const data = (kits ?? []).map((k: any) => ({
    ...k,
    position_title: titleMap.get(k.hr_position_id) ?? null,
    position_people: peopleCount.get(k.hr_position_id) ?? 0,
    location_name: k.location_id ? locationMap.get(k.location_id) ?? null : null,
    items: (itemsByKit.get(k.id) ?? []).map((it: any) => ({
      ...it,
      name: catalogMap.get(it.catalog_item_id)?.name ?? null,
      sku: catalogMap.get(it.catalog_item_id)?.sku ?? null,
      vendor_name: it.preferred_vendor_id ? vendorMap.get(it.preferred_vendor_id) ?? null : null,
    })),
  }));

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

// Create a kit and its lines.
export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const body = CreateKitSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;
  const sc = (supabase as any).schema('supply_chain');

  const { data: kit, error } = await sc
    .from('position_kits')
    .insert({
      tenant_id: tenantId,
      hr_position_id: body.hr_position_id,
      location_id: body.location_id ?? null,
      name: body.name,
      description: body.description ?? null,
      active: body.active ?? true,
      order_mode: body.order_mode ?? 'draft',
      created_by_user_id: ctx.userId,
      last_event_id: idempotencyKey,
    })
    .select('*')
    .single();
  if (error) {
    // The partial unique indexes are the real guard against two kits fighting
    // over one position+location scope; turn that into a readable 409.
    if ((error as any).code === '23505') {
      throw AppError.conflict('A kit already exists for that position and location scope');
    }
    log.error('position_kits.create_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  if (body.items && body.items.length > 0) {
    const rows = body.items.map((it, idx) => ({
      tenant_id: tenantId,
      kit_id: kit.id,
      catalog_item_id: it.catalog_item_id,
      qty: it.qty,
      preferred_vendor_id: it.preferred_vendor_id ?? null,
      note: it.note ?? null,
      sort_order: it.sort_order ?? idx,
      last_event_id: crypto.randomUUID(),
    }));
    const { error: iErr } = await sc
      .from('position_kit_items')
      .upsert(rows, { onConflict: 'kit_id,catalog_item_id' });
    if (iErr) { log.error('position_kits.items_insert_failed', { error: iErr.message }); throw AppError.internal(iErr.message); }
  }

  return {
    data: { ...kit, items: body.items ?? [] },
    status: 201,
    events: [{
      event_name: 'position_kit.created',
      payload: { id: kit.id, name: kit.name, hr_position_id: kit.hr_position_id, item_count: body.items?.length ?? 0 },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/position-kits' });
