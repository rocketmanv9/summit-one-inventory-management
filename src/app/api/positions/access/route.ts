import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { ACCESS_CAPABILITIES, ALL_CAPABILITY_KEYS } from '@/lib/access';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/positions/access
 * Returns the capability catalog, the tenant's positions, and each position's
 * granted capability keys (a position absent from `grants` is unconfigured =
 * full access). Drives the top-nav "view as position" preview + access editor.
 */
export const GET = createSessionReadRoute(async ({ session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const { data: positions, error: posErr } = await supabase
    .from('positions')
    .select('id, title, role_level, role_level_rank, is_active')
    .eq('is_active', true)
    .order('role_level_rank', { ascending: true, nullsFirst: false })
    .order('title', { ascending: true })
    .limit(2000);
  if (posErr) {
    log.error('positions.access.list_failed', { error: posErr.message });
    throw AppError.internal(posErr.message);
  }

  const { data: caps, error: capErr } = await supabase
    .from('position_capabilities')
    .select('position_id, capability_keys')
    .limit(2000);
  if (capErr) {
    log.error('positions.access.caps_failed', { error: capErr.message });
    throw AppError.internal(capErr.message);
  }

  const grants: Record<string, string[]> = {};
  for (const row of caps ?? []) grants[row.position_id] = row.capability_keys ?? [];

  return Response.json({
    data: {
      capabilities: ACCESS_CAPABILITIES,
      positions: positions ?? [],
      grants,
    },
  });
}, { serviceName: SERVICE_NAME });

const UpdateSchema = z.object({
  position_id: z.string().uuid(),
  // Only keys in the catalog are accepted; unknown keys are dropped server-side.
  capability_keys: z.array(z.string()).max(64),
});

/**
 * PUT /api/positions/access — set a position's granted capability keys (admin).
 * Upsert-by-position; the row's presence means "configured". An empty array =
 * explicitly no access.
 */
export const PUT = createSessionWriteRoute(async ({ body, ctx, supabase, idempotencyKey, log }) => {
  const tenantId = ctx.tenantId!;

  const { data: me } = await supabase
    .from('local_users').select('role').eq('user_id', ctx.userId).eq('tenant_id', tenantId).maybeSingle();
  if (me?.role !== 'admin') throw AppError.forbidden('Admin role required');

  // Keep only known capability keys, de-duplicated.
  const allowed = new Set(ALL_CAPABILITY_KEYS);
  const keys = Array.from(new Set((body.capability_keys as string[]).filter((k) => allowed.has(k))));

  // Guard against a dangling position_id (FK would 500 with a raw message).
  const { data: pos } = await supabase
    .from('positions').select('id').eq('id', body.position_id).eq('tenant_id', tenantId).maybeSingle();
  if (!pos) throw AppError.notFound('Position not found');

  const { data, error } = await supabase
    .from('position_capabilities')
    .upsert({
      tenant_id: tenantId,
      position_id: body.position_id,
      capability_keys: keys,
      last_event_id: idempotencyKey,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,position_id' })
    .select('position_id, capability_keys')
    .single();
  if (error) throw AppError.internal(error.message);

  log.info('position_access.updated', { positionId: body.position_id, count: keys.length });

  return {
    data,
    status: 200,
    events: [{
      event_name: 'position_access.updated',
      payload: { tenant_id: tenantId, position_id: body.position_id, capability_keys: keys },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: UpdateSchema, serviceName: SERVICE_NAME, scope: 'PUT /api/positions/access' });
