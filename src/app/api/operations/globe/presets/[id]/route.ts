/**
 * Globe Filter Preset — Delete
 *
 * DELETE /api/operations/globe/presets/[id] — Delete a preset by ID
 */

import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { rethrowDeleteError } from '@/lib/api/typed-crud';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const id = segments[segments.length - 1];
  if (!id) throw AppError.badRequest('Preset ID required');
  return id;
}

export const DELETE = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const id = extractId(req);
  const inv = (supabase as any).schema('inventory');

  // Verify ownership before deleting
  const { data: existing, error: checkErr } = await inv
    .from('globe_filter_presets')
    .select('id')
    .eq('id', id)
    .eq('user_id', ctx.userId)
    .single();

  if (checkErr || !existing) {
    throw AppError.notFound('Preset not found');
  }

  const { error } = await inv
    .from('globe_filter_presets')
    .delete()
    .eq('id', id);

  if (error) {
    log.error('globe_filter_preset.delete failed', { error: error.message });
    rethrowDeleteError(error, 'preset');
  }

  log.info('globe_filter_preset.deleted', { presetId: id });

  return {
    data: { id, deleted: true },
    status: 200,
    events: [{
      event_name: 'globe_filter_preset.deleted',
      payload: { preset_id: id },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'DELETE /api/operations/globe/presets/[id]' });
