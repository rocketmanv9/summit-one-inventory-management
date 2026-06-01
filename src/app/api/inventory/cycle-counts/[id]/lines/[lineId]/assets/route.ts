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
