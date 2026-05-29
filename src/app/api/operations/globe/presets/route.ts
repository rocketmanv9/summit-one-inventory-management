/**
 * Globe Filter Presets — List + Upsert
 *
 * GET  /api/operations/globe/presets — List presets for current user (limit 50)
 * POST /api/operations/globe/presets — Upsert a preset by name
 */

import { z } from 'zod';
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── GET — List presets ──────────────────────────────────────────────────────

export const GET = createSessionReadRoute(async ({ session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId,
  });
  const inv = (supabase as any).schema('inventory');

  const { data, error } = await inv
    .from('globe_filter_presets')
    .select('id, name, config, created_at, updated_at')
    .eq('user_id', session.userId)
    .order('name', { ascending: true })
    .limit(50);

  if (error) {
    log.error('globe_filter_presets.list failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data: data || [] });
}, { serviceName: SERVICE_NAME });

// ── POST — Upsert preset ───────────────────────────────────────────────────

const UpsertPresetSchema = z.object({
  name: z.string().min(1).max(100),
  config: z.object({
    filters: z.record(z.string(), z.any()),
    visibleLayers: z.record(z.string(), z.boolean()),
    transferStatuses: z.array(z.string()),
    poStatuses: z.array(z.string()),
  }),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = UpsertPresetSchema.parse(await req.json());

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv
    .from('globe_filter_presets')
    .upsert(
      {
        tenant_id: ctx.tenantId,
        user_id: ctx.userId,
        name: body.name,
        config: body.config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,user_id,name' },
    )
    .select()
    .single();

  if (error) {
    log.error('globe_filter_preset.upsert failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('globe_filter_preset.saved', { presetId: data.id, name: body.name });

  return {
    data,
    status: 201,
    events: [{
      event_name: 'globe_filter_preset.saved',
      payload: { preset_id: data.id, name: body.name },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/operations/globe/presets' });
