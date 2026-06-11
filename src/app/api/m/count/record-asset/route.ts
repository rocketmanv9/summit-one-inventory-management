import { z } from 'zod';
import { createWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { requireMobileSession } from '@/lib/mobile-auth';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const RecordAssetSchema = z.object({
  line_id: z.string().uuid(),
  asset_ids: z.array(z.string().uuid()),
});

export const POST = createWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const session = await requireMobileSession(req);
  const body = RecordAssetSchema.parse(await req.json());

  const inv = (supabase as any).schema('inventory');

  // Verify line belongs to this cycle count
  const { data: line, error: lineError } = await inv
    .from('cycle_count_lines')
    .select('id, cycle_count_id, line_number')
    .eq('id', body.line_id)
    .eq('cycle_count_id', session.cycleCountId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();

  if (lineError || !line) throw AppError.notFound('Count line not found');

  // Replace the set of present assets for this line. cycle_count_asset_lines has
  // UNIQUE (cycle_count_id, asset_id), so upsert on that key instead of
  // delete-then-insert — two concurrent taps no longer race into duplicate-key
  // errors (the loser's insert becomes an update of the same row).
  if (body.asset_ids.length > 0) {
    const now = new Date().toISOString();
    const rows = body.asset_ids.map((assetId) => ({
      tenant_id: session.tenantId,
      cycle_count_id: session.cycleCountId,
      cycle_count_line_id: body.line_id,
      line_number: line.line_number,
      asset_id: assetId,
      expected_present: true,
      counted_present: true,
      scanned_at: now,
      last_event_id: `${idempotencyKey}-${assetId}`,
    }));

    const { error: upsertError } = await inv
      .from('cycle_count_asset_lines')
      .upsert(rows, { onConflict: 'cycle_count_id,asset_id' });

    if (upsertError) throw AppError.internal(upsertError.message);
  }

  // Then prune assets that were previously counted on this line but are no longer
  // in the submitted set (upsert-first ordering means a concurrent request never
  // observes the line momentarily empty).
  let pruneQuery = inv
    .from('cycle_count_asset_lines')
    .delete()
    .eq('cycle_count_line_id', body.line_id)
    .eq('cycle_count_id', session.cycleCountId)
    .eq('tenant_id', session.tenantId);

  if (body.asset_ids.length > 0) {
    pruneQuery = pruneQuery.not('asset_id', 'in', `(${body.asset_ids.join(',')})`);
  }

  const { error: pruneError } = await pruneQuery;
  if (pruneError) throw AppError.internal(pruneError.message);

  // Update the line's qty_counted to match asset count
  const { error: lineUpdateError } = await inv
    .from('cycle_count_lines')
    .update({
      qty_counted: body.asset_ids.length,
      counted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', body.line_id)
    .eq('tenant_id', session.tenantId);

  if (lineUpdateError) throw AppError.internal(lineUpdateError.message);

  log.info('mobile_count.asset_recorded', {
    cycleCountId: session.cycleCountId,
    lineId: body.line_id,
    assetCount: body.asset_ids.length,
  });

  return {
    data: { success: true, assets_counted: body.asset_ids.length },
    status: 200,
    events: [{
      event_name: 'mobile_count.asset_recorded',
      payload: {
        cycle_count_id: session.cycleCountId,
        line_id: body.line_id,
        asset_ids: body.asset_ids,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/m/count/record-asset',
  authenticate: async (req: Request) => {
    const session = await requireMobileSession(req);
    const supabase = await createTenantServiceClient({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      tenantId: session.tenantId,
    });
    return { tenantId: session.tenantId, userId: session.userId, supabase };
  },
});
