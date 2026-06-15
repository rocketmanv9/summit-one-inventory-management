/**
 * GET /api/system/cron/agent-suggestions
 *
 * Daily proactive scan: for each tenant, flag reorder needs and unusual
 * material usage into the in-app notification feed, and (per the tenant's
 * reorder_mode) optionally create draft POs. See src/lib/suggestions/agent-suggestions.ts.
 *
 * Triggered by Vercel Cron (see vercel.json). Vercel sends
 * `Authorization: Bearer <CRON_SECRET>` automatically when CRON_SECRET is set;
 * we reject anything else so the endpoint isn't publicly runnable.
 */
import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { runAgentSuggestionsForAllTenants } from '@/lib/suggestions/agent-suggestions';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Fans out across tenants — give it more headroom than a normal request.
export const maxDuration = 60;

export const GET = createReadRoute(
  async ({ req, fetch, log }) => {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization') || '';
    if (!secret || auth !== `Bearer ${secret}`) {
      throw AppError.unauthorized('Invalid or missing cron secret.');
    }

    const result = await runAgentSuggestionsForAllTenants({ fetchImpl: fetch, log });

    log.info('agent_suggestions.cron_run', {
      runId: result.runId,
      tenantsProcessed: result.tenantsProcessed,
      reorderItems: result.reorderItems,
      usageAlerts: result.usageAlerts,
      errorCount: result.errors.length,
    });
    return Response.json({ data: result });
  },
  { serviceName: SERVICE_NAME, auth: 'public' },
);
