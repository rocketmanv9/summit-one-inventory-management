/**
 * GET /api/system/cron/receipt-nudges
 *
 * Daily nudge loop: POs still in_transit / partially_received whose promised
 * delivery (shipment ETA or PO expected date) is at least a day past get an
 * email digest to their creator plus an in-app notification — "confirm
 * receipt to update stock". receipt_nudge_sent_at throttles to every 3 days.
 *
 * Triggered by Vercel Cron (see vercel.json), CRON_SECRET gated.
 */
import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { sendReceiptNudges } from '@/lib/po/receipt-nudges';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const maxDuration = 60;

export const GET = createReadRoute(
  async ({ req, fetch, log }) => {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization') || '';
    if (!secret || auth !== `Bearer ${secret}`) {
      throw AppError.unauthorized('Invalid or missing cron secret.');
    }

    const result = await sendReceiptNudges({ fetchImpl: fetch, log, maxPOs: 50 });

    log.info('receipt_nudges.cron_run', {
      posNudged: result.posNudged,
      emailsSent: result.emailsSent,
      emailsSkipped: result.emailsSkipped,
      notificationsCreated: result.notificationsCreated,
      errorCount: result.errors.length,
    });
    return Response.json({ data: result });
  },
  { serviceName: SERVICE_NAME, auth: 'public' },
);
