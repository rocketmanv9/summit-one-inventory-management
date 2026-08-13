import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Per-PERSON link overrides for external_link buyable items (item 02, snap-and-
// buy sprint) — the Canva-per-estimator case: one "Business cards" group item,
// a different Canva file URL for each estimator. Resolution order in the
// consumer flow (/buyable-groups/mine): caller's person link → the item's
// external_url fallback → "not configured for you — tell an admin".
//
// Admin-gated on purchase_orders.manage like all buying config. This is the
// contract item 03's reworked buying-access UI drives.
//
//   GET  /api/inventory/buyable-groups/person-links?group_item_id=<uuid>
//        (or ?group_id=<uuid> for every link across a group's items)
//        &include_people=1 → also returns the active HR roster as the person
//        picker source (hr_person_id + name + email + position title).
//     → 200 { data: [ { id, group_item_id, hr_person_id, url, active,
//                        person_name, person_email } ], people?: [...] }
//
//   POST /api/inventory/buyable-groups/person-links
//        { group_item_id, hr_person_id, url, active? }
//     → upserts on (group_item_id, hr_person_id) — one URL per person per item.

const ListQuerySchema = z.object({
  group_item_id: z.string().uuid().optional(),
  group_id: z.string().uuid().optional(),
  include_people: z.string().optional(),
}).refine((q) => q.group_item_id || q.group_id, { message: 'Pass group_item_id or group_id' });

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const tenantId = session.tenantId!;
  const url = new URL(req.url);
  const q = ListQuerySchema.parse({
    group_item_id: url.searchParams.get('group_item_id') ?? undefined,
    group_id: url.searchParams.get('group_id') ?? undefined,
    include_people: url.searchParams.get('include_people') ?? undefined,
  });

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  await assertCapability(supabase, { tenantId, userId: session.userId! }, 'purchase_orders.manage');
  const sc = (supabase as any).schema('supply_chain');

  // Resolve the group-item id set to list links for.
  let groupItemIds: string[];
  if (q.group_item_id) {
    groupItemIds = [q.group_item_id];
  } else {
    const { data: items, error: iErr } = await sc
      .from('buyable_item_group_items')
      .select('id')
      .eq('group_id', q.group_id!)
      .eq('tenant_id', tenantId)
      .limit(1000);
    if (iErr) { log.error('person_links.items_failed', { error: iErr.message }); throw AppError.internal(iErr.message); }
    groupItemIds = (items ?? []).map((r: any) => r.id);
  }

  let links: any[] = [];
  if (groupItemIds.length > 0) {
    const { data, error } = await sc
      .from('buyable_item_person_links')
      .select('id, group_item_id, hr_person_id, url, active, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .in('group_item_id', groupItemIds)
      .order('created_at', { ascending: true })
      .limit(2000);
    if (error) { log.error('person_links.list_failed', { error: error.message }); throw AppError.internal(error.message); }
    links = data ?? [];
  }

  // Join display names from the HR mirror (public.hr_people).
  const personIds = Array.from(new Set(links.map((l) => l.hr_person_id)));
  const people = new Map<string, any>();
  if (personIds.length > 0) {
    const { data: ppl } = await (supabase as any)
      .from('hr_people')
      .select('hr_person_id, first_name, last_name, preferred_name, work_email, personal_email')
      .eq('tenant_id', tenantId)
      .in('hr_person_id', personIds)
      .limit(2000);
    for (const p of ppl ?? []) people.set(p.hr_person_id, p);
  }

  const data = links.map((l) => {
    const p = people.get(l.hr_person_id);
    const name = p ? `${p.preferred_name || p.first_name || ''} ${p.last_name || ''}`.trim() : null;
    return {
      id: l.id,
      group_item_id: l.group_item_id,
      hr_person_id: l.hr_person_id,
      url: l.url,
      active: l.active,
      person_name: name || null,
      person_email: p?.work_email ?? p?.personal_email ?? null,
    };
  });

  // Optional picker source: the active HR roster with position titles — what
  // item 03's "add a person link" picker lists.
  let roster: Array<{ hr_person_id: string; name: string; email: string | null; position_title: string | null }> | undefined;
  if (q.include_people === '1' || q.include_people === 'true') {
    const [{ data: ppl }, { data: positions }] = await Promise.all([
      (supabase as any)
        .from('hr_people')
        .select('hr_person_id, hr_position_id, first_name, last_name, preferred_name, work_email, personal_email, is_active')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('last_name', { ascending: true })
        .limit(5000),
      (supabase as any)
        .from('positions')
        .select('hr_position_id, title')
        .eq('tenant_id', tenantId)
        .limit(1000),
    ]);
    const titleByPosition = new Map<string, string>((positions ?? []).map((p: any) => [p.hr_position_id, p.title]));
    roster = (ppl ?? []).map((p: any) => ({
      hr_person_id: p.hr_person_id,
      name: `${p.preferred_name || p.first_name || ''} ${p.last_name || ''}`.trim(),
      email: p.work_email ?? p.personal_email ?? null,
      position_title: p.hr_position_id ? titleByPosition.get(p.hr_position_id) ?? null : null,
    }));
  }

  return Response.json(roster ? { data, people: roster } : { data });
}, { serviceName: SERVICE_NAME });

const UpsertSchema = z.object({
  group_item_id: z.string().uuid(),
  hr_person_id: z.string().uuid(),
  url: z.string().url().max(2000),
  active: z.boolean().optional(),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const body = UpsertSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;
  const sc = (supabase as any).schema('supply_chain');

  // The group item must exist in this tenant (and person links only make sense
  // on external_link items — enforce loudly rather than storing dead config).
  const { data: item, error: iErr } = await sc
    .from('buyable_item_group_items')
    .select('id, fulfillment_kind')
    .eq('id', body.group_item_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (iErr) { log.error('person_links.item_read_failed', { error: iErr.message }); throw AppError.internal(iErr.message); }
  if (!item) throw AppError.notFound('Buyable group item not found');
  if (item.fulfillment_kind !== 'external_link') {
    throw AppError.badRequest('Person links only apply to external_link items — set the item\'s fulfillment to external_link first.');
  }

  const { data: link, error } = await sc
    .from('buyable_item_person_links')
    .upsert({
      tenant_id: tenantId,
      group_item_id: body.group_item_id,
      hr_person_id: body.hr_person_id,
      url: body.url,
      active: body.active ?? true,
      updated_at: new Date().toISOString(),
      last_event_id: idempotencyKey,
    }, { onConflict: 'group_item_id,hr_person_id' })
    .select('*')
    .single();
  if (error) { log.error('person_links.upsert_failed', { error: error.message }); throw AppError.internal(error.message); }

  return {
    data: link,
    status: 201,
    events: [{
      event_name: 'buyable_item_person_link.saved',
      payload: { id: link.id, group_item_id: link.group_item_id, hr_person_id: link.hr_person_id, active: link.active },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/buyable-groups/person-links' });
