/**
 * GET /api/system/cron/gmail-reply-sync
 *
 * Scheduled background job: pulls new vendor replies for every tenant that has
 * an active Gmail connection and runs the AI status tracker on them — so POs
 * update themselves with no one pressing "Sync".
 *
 * Triggered by Vercel Cron (see vercel.json) or Supabase pg_cron. Vercel sends
 * `Authorization: Bearer <CRON_SECRET>` automatically when CRON_SECRET is set;
 * we reject anything else so the endpoint isn't publicly runnable.
 */
import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { syncAllTenantsReplies } from '@/lib/po/po-email-service';

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

    const result = await syncAllTenantsReplies({
      fetchImpl: fetch,
      lookbackDays: 5,
      maxTenants: 15,
    });

    log.info('gmail.cron_sync', { ...result });
    return Response.json({ data: result });
  },
  { serviceName: SERVICE_NAME, auth: 'public' },
);
