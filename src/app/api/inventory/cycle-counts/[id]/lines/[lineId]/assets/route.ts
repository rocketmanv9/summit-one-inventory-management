import { z } from 'zod';
import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const AssetCountSchema = z.object({
  asset_ids: z.array(z.string().uuid()),
});

function getCycleCountId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const idx = segments.indexOf('cycle-counts');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Missing cycle count ID');
  return id;
}

function getLineId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const idx = segments.indexOf('lines');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Missing line ID');
  return id;
}

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const cycleCountId = getCycleCountId(req);
  const lineId = getLineId(req);

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const inv = (supabase as any).schema('inventory');

  const { data: assetLines, error } = await inv
    .from('cycle_count_asset_lines')
    .select('id, asset_id, expected_present, counted_present, status, asset:assets(id, asset_tag, serial_number, status)')
    .eq('cycle_count_id', cycleCountId)
    .eq('cycle_count_line_id', lineId);

  if (error) {
    log.error('cycle_count_assets.list_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  const expected_assets = (assetLines || [])
    .filter((al: any) => al.expected_present)
    .map((al: any) => al.asset);

  const counted_assets = (assetLines || [])
    .filter((al: any) => al.counted_present)
    .map((al: any) => ({ asset_id: al.asset_id }));

  return Response.json({ data: { expected_assets, counted_assets } });
}, { serviceName: SERVICE_NAME });

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const cycleCountId = getCycleCountId(req);
  const lineId = getLineId(req);
  const body = AssetCountSchema.parse(await req.json());
  const inv = (supabase as any).schema('inventory');

  // Reset all asset lines for this line to not counted
  await inv
    .from('cycle_count_asset_lines')
    .update({ counted_present: false })
    .eq('cycle_count_id', cycleCountId)
    .eq('cycle_count_line_id', lineId);

  // Mark selected assets as counted
  if (body.asset_ids.length > 0) {
    await inv
      .from('cycle_count_asset_lines')
      .update({
        counted_present: true,
        scanned_by_user_id: ctx.userId,
        scanned_at: new Date().toISOString(),
      })
      .eq('cycle_count_id', cycleCountId)
      .eq('cycle_count_line_id', lineId)
      .in('asset_id', body.asset_ids);
  }

  // Update qty_counted on parent line
  const { data, error } = await inv
    .from('cycle_count_lines')
    .update({
      qty_counted: body.asset_ids.length,
      counted_at: new Date().toISOString(),
      counted_by_user_id: ctx.userId,
      last_event_id: idempotencyKey,
    })
    .eq('id', lineId)
    .select()
    .single();

  if (error) throw AppError.internal(error.message);

  log.info('cycle_count_line.assets_updated', { lineId, countedCount: body.asset_ids.length });

  return {
    data,
    status: 200,
    events: [{
      event_name: 'cycle_count_line.assets_updated',
      payload: { line_id: lineId, counted_count: body.asset_ids.length },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/cycle-counts/:id/lines/:lineId/assets' });

const AddSerialSchema = z.object({
  serial: z.string().min(1).max(100),
});

// PUT — type/add a serial for a serialized line on desktop. Creates the asset
// if it doesn't exist yet (you found one not in the system) and marks it
// present, additively. Desktop equivalent of the mobile record-serial flow —
// so you don't need a scanner to record a serialized item.
export const PUT = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const cycleCountId = getCycleCountId(req);
  const lineId = getLineId(req);
  const { serial } = AddSerialSchema.parse(await req.json());
  const tag = serial.trim();
  const inv = (supabase as any).schema('inventory');

  const { data: line, error: lineError } = await inv
    .from('cycle_count_lines')
    .select('id, cycle_count_id, line_number, catalog_item_id, location_id')
    .eq('id', lineId)
    .eq('cycle_count_id', cycleCountId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (lineError || !line) throw AppError.notFound('Count line not found');

  const { data: existingAsset } = await inv
    .from('assets')
    .select('id, asset_tag, serial_number, status')
    .eq('tenant_id', ctx.tenantId)
    .eq('catalog_item_id', line.catalog_item_id)
    .or(`serial_number.eq.${tag},asset_tag.eq.${tag}`)
    .limit(1)
    .maybeSingle();

  let asset = existingAsset;
  if (!asset) {
    const { data: newAsset, error: createError } = await inv
      .from('assets')
      .upsert({
        tenant_id: ctx.tenantId,
        catalog_item_id: line.catalog_item_id,
        asset_tag: tag,
        serial_number: tag,
        status: 'available',
        location_id: line.location_id,
        last_event_id: `cc_serial_${idempotencyKey}`,
      }, { onConflict: 'tenant_id,asset_tag' })
      .select('id, asset_tag, serial_number, status')
      .single();
    if (createError) throw AppError.internal(createError.message);
    asset = newAsset;
  }

  const { error: upsertError } = await inv
    .from('cycle_count_asset_lines')
    .upsert({
      tenant_id: ctx.tenantId,
      cycle_count_id: cycleCountId,
      cycle_count_line_id: line.id,
      line_number: line.line_number,
      asset_id: asset.id,
      expected_present: false,
      counted_present: true,
      scanned_by_user_id: ctx.userId,
      scanned_at: new Date().toISOString(),
      last_event_id: `cc_asset_${idempotencyKey}`,
    }, { onConflict: 'cycle_count_id,asset_id' });
  if (upsertError) throw AppError.internal(upsertError.message);

  const { count } = await inv
    .from('cycle_count_asset_lines')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.tenantId)
    .eq('cycle_count_line_id', line.id)
    .eq('counted_present', true);

  await inv
    .from('cycle_count_lines')
    .update({ qty_counted: count ?? 1, counted_at: new Date().toISOString(), counted_by_user_id: ctx.userId, updated_at: new Date().toISOString() })
    .eq('id', line.id);

  log.info('cycle_count_line.serial_added', { lineId, assetId: asset.id });

  return {
    data: { asset, qty_counted: count ?? 1 },
    status: 200,
    events: [{
      event_name: 'cycle_count_line.serial_added',
      payload: { line_id: lineId, asset_id: asset.id },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'PUT /api/inventory/cycle-counts/:id/lines/:lineId/assets' });
