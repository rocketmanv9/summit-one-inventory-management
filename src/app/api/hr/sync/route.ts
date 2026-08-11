import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { isHRConfigured } from '@/lib/hr';
import { runHRSync } from '@/lib/hr-sync';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * POST /api/hr/sync — pull positions + people from summit-one-hr.
 *
 * Thin wrapper over runHRSync (src/lib/hr-sync.ts) — the same sync the daily
 * cron runs. Mirrors positions (preserving per-position spending_limit) and
 * people, matches local_users by email, and HEALS stale mirror rows so
 * position-title buying gates can't be broken by HR reseeds/dupes.
 *
 * Admin-only. Idempotent: re-running converges (upsert on (tenant_id, hr_position_id)).
 */
export const POST = createSessionWriteRoute(async ({ ctx, supabase, log, idempotencyKey }): Promise<{
  data: any;
  status: number;
  events: Array<{ event_name: string; payload: any; last_event_id: string }>;
}> => {
  const tenantId = ctx.tenantId!;

  // Admin gate — limits/positions are an admin concern.
  const { data: me } = await supabase
    .from('local_users')
    .select('role')
    .eq('user_id', ctx.userId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (me?.role !== 'admin') throw AppError.forbidden('Admin role required to sync HR data');

  if (!isHRConfigured()) {
    return {
      data: { configured: false, message: 'HR integration not configured (set HR_SUPABASE_URL / HR_SUPABASE_SERVICE_ROLE_KEY)', positionsSynced: 0, usersMatched: 0 },
      status: 200,
      events: [],
    };
  }

  const summary = await runHRSync(supabase, tenantId, log);

  return {
    data: summary,
    status: 200,
    events: [{
      event_name: 'hr.synced',
      payload: { tenant_id: tenantId, ...summary },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/hr/sync' });
