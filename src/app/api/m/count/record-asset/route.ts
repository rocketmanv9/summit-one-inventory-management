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
    .select('id, cycle_count_id')
    .eq('id', body.line_id)
    .eq('cycle_count_id', session.cycleCountId)
    .single();

  if (lineError || !line) throw AppError.notFound('Count line not found');

  // Clear existing counted assets for this line
  await inv
    .from('cycle_count_asset_lines')
    .delete()
    .eq('cycle_count_line_id', body.line_id)
    .eq('cycle_count_id', session.cycleCountId)
    .eq('tenant_id', session.tenantId);

  // Insert new counted assets
  if (body.asset_ids.length > 0) {
    const rows = body.asset_ids.map((assetId) => ({
      tenant_id: session.tenantId,
      cycle_count_id: session.cycleCountId,
      cycle_count_line_id: body.line_id,
      asset_id: assetId,
      found: true,
    }));

    const { error: insertError } = await inv
      .from('cycle_count_asset_lines')
      .insert(rows);

    if (insertError) throw AppError.internal(insertError.message);
  }

  // Update the line's qty_counted to match asset count
  await inv
    .from('cycle_count_lines')
    .update({
      qty_counted: body.asset_ids.length,
      counted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', body.line_id);

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
}, {
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
