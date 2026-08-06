/**
 * POST /api/inventory/cycle-counts/auto-schedule
 *
 * On-demand "Schedule these": an admin/manager runs the same core logic the
 * nightly cron uses, but immediately and scoped to the locations currently
 * visible in the cycle-count suggestions widget. Creates one assigned partial
 * count per location from the live suggestions. Shares the exact lib the cron
 * calls — no copy-paste of the scheduling logic.
 */
import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { autoScheduleCountsForTenant } from '@/lib/counts/auto-schedule-counts';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const AutoScheduleSchema = z.object({
  // Locations to schedule (the widget passes the ones it's showing). Omit to let
  // the scheduler pick the highest-priority locations from all suggestions.
  location_ids: z.array(z.string().uuid()).optional(),
  // Cap on how many locations get a count this run.
  max_locations: z.number().int().min(1).max(20).optional(),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, fetch }): Promise<{
  data: any;
  status: number;
  events: Array<{ event_name: string; payload: any; last_event_id: string }>;
}> => {
  // Explicit, privileged action — restrict to admins/managers. The local_users
  // role is authoritative (the JWT role can be a generic 'authenticated'), same
  // gate the count-qualified admin route uses.
  const { data: me } = await (supabase as any)
    .from('local_users')
    .select('role')
    .eq('user_id', ctx.userId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (me?.role !== 'admin' && me?.role !== 'manager') {
    throw AppError.forbidden('Only admins or managers can auto-schedule cycle counts.');
  }

  const body = AutoScheduleSchema.parse(await req.json().catch(() => ({})));
  const admin = getAdminClient();

  const result = await autoScheduleCountsForTenant({
    adminClient: admin,
    fetchImpl: fetch,
    log,
    tenantId: ctx.tenantId,
    actorUserId: ctx.userId,
    onlyLocationIds: body.location_ids,
    maxLocations: body.max_locations,
  });

  log.info('auto_schedule_counts.on_demand', {
    tenantId: ctx.tenantId,
    created: result.createdCount,
    reused: result.reusedCount,
  });

  return {
    data: result,
    status: result.createdCount > 0 ? 201 : 200,
    events: result.created
      .filter((c) => !c.reused)
      .map((c) => ({
        event_name: 'cycle_count.auto_scheduled',
        payload: {
          cycle_count_id: c.cycleCountId,
          location_id: c.locationId,
          item_count: c.itemCount,
          assigned_to_user_id: c.assigneeUserId,
          scheduled_for: c.scheduledFor,
        },
        last_event_id: `auto-count-${result.runId}-${c.locationId}`,
      })),
  };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/cycle-counts/auto-schedule' });
