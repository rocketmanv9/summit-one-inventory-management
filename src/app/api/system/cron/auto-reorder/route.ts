/**
 * GET /api/system/cron/auto-reorder
 *
 * Nightly auto-reorder loop: for each tenant, generates draft purchase orders
 * from inventory.v_reorder_suggestions (via supply_chain.rpc_generate_reorder_pos_v2,
 * idempotent per run_id = YYYYMMDD — a same-day rerun creates no duplicates) and
 * emails the tenant a digest of the new draft POs to review in /inventory/purchasing.
 *
 * Triggered by Vercel Cron (see vercel.json) or Supabase pg_cron. Vercel sends
 * `Authorization: Bearer <CRON_SECRET>` automatically when CRON_SECRET is set;
 * we reject anything else so the endpoint isn't publicly runnable.
 */
import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { runAutoReorderForAllTenants } from '@/lib/reorder/auto-reorder';

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

    const result = await runAutoReorderForAllTenants({
      fetchImpl: fetch,
      maxTenants: 15,
      log,
    });

    log.info('reorder.cron_run', {
      runId: result.runId,
      tenantsProcessed: result.tenantsProcessed,
      posCreated: result.posCreated,
      skippedExisting: result.skippedExisting,
      emailsSent: result.emailsSent,
      emailsSkipped: result.emailsSkipped,
      errorCount: result.errors.length,
    });
    return Response.json({ data: result });
  },
  { serviceName: SERVICE_NAME, auth: 'public' },
);
