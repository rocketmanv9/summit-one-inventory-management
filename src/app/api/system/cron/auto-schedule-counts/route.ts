/**
 * GET /api/system/cron/auto-schedule-counts
 *
 * Nightly cycle-count auto-scheduler: for each tenant that opted in
 * (tenant_settings.auto_schedule_counts_enabled), turns the top cycle-count
 * suggestions into real, assigned partial counts — one per location, capped
 * per run, round-robin across qualified counters, scheduled for tomorrow, with
 * an assignment email. Idempotent per run+location, so a same-day rerun is a
 * no-op.
 *
 * Triggered by Vercel Cron (see vercel.json). Vercel sends
 * `Authorization: Bearer <CRON_SECRET>` automatically when CRON_SECRET is set;
 * we reject anything else so the endpoint isn't publicly runnable.
 */
import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { autoScheduleCountsForAllTenants } from '@/lib/counts/auto-schedule-counts';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Allow more headroom than a normal request — this fans out across tenants.
export const maxDuration = 60;

export const GET = createReadRoute(
  async ({ req, fetch, log }) => {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization') || '';
    if (!secret || auth !== `Bearer ${secret}`) {
      throw AppError.unauthorized('Invalid or missing cron secret.');
    }

    const result = await autoScheduleCountsForAllTenants({
      fetchImpl: fetch,
      maxTenants: 15,
      log,
    });

    log.info('auto_schedule_counts.cron_run', {
      runId: result.runId,
      tenantsProcessed: result.tenantsProcessed,
      tenantsSkippedDisabled: result.tenantsSkippedDisabled,
      countsCreated: result.countsCreated,
      countsReused: result.countsReused,
      errorCount: result.errors.length,
    });
    return Response.json({ data: result });
  },
  { serviceName: SERVICE_NAME, auth: 'public' },
);
