/**
 * GET /api/system/cron/abandon-stale-order-sessions
 *
 * Sweep guided-purchase order sessions (item 06) that have been 'active' for more
 * than 24h and mark them 'abandoned' — a worker opened the guided browser but
 * never completed or cancelled. Runs across every tenant that has such sessions.
 * The session routes also sweep lazily on read; this is the belt-and-suspenders
 * scheduled pass.
 *
 * Triggered by Vercel Cron (see vercel.json), CRON_SECRET gated.
 */
import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { STALE_SESSION_HOURS } from '@/lib/external-orders';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const maxDuration = 60;

export const GET = createReadRoute(
  async ({ req, log }) => {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization') || '';
    if (!secret || auth !== `Bearer ${secret}`) {
      throw AppError.unauthorized('Invalid or missing cron secret.');
    }

    const cutoff = new Date(Date.now() - STALE_SESSION_HOURS * 3600 * 1000).toISOString();
    const admin = getAdminClient();
    const sc = (admin as any).schema('supply_chain');

    const { data, error } = await sc
      .from('external_order_sessions')
      .update({ status: 'abandoned', updated_at: new Date().toISOString() })
      .eq('status', 'active')
      .lt('started_at', cutoff)
      .select('id, tenant_id');
    if (error) throw AppError.internal(error.message);

    const abandoned = (data ?? []).length;
    log.info('external_order_sessions.sweep', { abandoned });
    return Response.json({ data: { abandoned } });
  },
  { serviceName: SERVICE_NAME, auth: 'public' },
);
