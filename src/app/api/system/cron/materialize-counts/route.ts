/**
 * GET /api/system/cron/materialize-counts
 *
 * Nightly cycle-count materializer: turns every due (scheduled today or
 * overdue) `planned` schedule entry into a real cycle count via
 * rpc_inv_cycle_count_start, then emails each assignee a "ready to start"
 * digest. Idempotent — materialized entries flip to 'generated' and the
 * RPC's last_event_id is derived from the entry id, so reruns are safe.
 *
 * Triggered by Vercel Cron (see vercel.json). Vercel sends
 * `Authorization: Bearer <CRON_SECRET>` automatically when CRON_SECRET is set;
 * we reject anything else so the endpoint isn't publicly runnable.
 */
import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { materializeDueCounts } from '@/lib/counts/materialize-counts';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Allow more headroom than a normal request — this fans out across entries.
export const maxDuration = 60;

export const GET = createReadRoute(
  async ({ req, fetch, log }) => {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization') || '';
    if (!secret || auth !== `Bearer ${secret}`) {
      throw AppError.unauthorized('Invalid or missing cron secret.');
    }

    const result = await materializeDueCounts({
      fetchImpl: fetch,
      maxEntries: 100,
      log,
    });

    log.info('materialize_counts.cron_run', {
      runDate: result.runDate,
      entriesDue: result.entriesDue,
      countsCreated: result.countsCreated,
      emailsSent: result.emailsSent,
      emailsSkipped: result.emailsSkipped,
      errorCount: result.errors.length,
    });
    return Response.json({ data: result });
  },
  { serviceName: SERVICE_NAME, auth: 'public' },
);
