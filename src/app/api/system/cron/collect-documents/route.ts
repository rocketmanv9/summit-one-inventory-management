/**
 * GET /api/system/cron/collect-documents
 *
 * Scheduled background job: for every tenant with an active Gmail connection,
 * sweeps its open purchase orders for supporting documents (receipts, invoices,
 * order confirmations, shipping/delivery notices), extracts + matches them, and
 * auto-reconciles high-confidence invoices/receipts onto the PO. A PO stops
 * being swept once a financial document is on file and the goods have arrived.
 *
 * Triggered by Vercel Cron (see vercel.json). Vercel sends
 * `Authorization: Bearer <CRON_SECRET>`; anything else is rejected.
 */
import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { collectAllTenants } from '@/lib/documents/store';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Fans out across tenants + POs + Gmail + extraction — give it headroom.
export const maxDuration = 300;

export const GET = createReadRoute(
  async ({ req, fetch, log }) => {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization') || '';
    if (!secret || auth !== `Bearer ${secret}`) {
      throw AppError.unauthorized('Invalid or missing cron secret.');
    }

    const result = await collectAllTenants({
      fetchImpl: fetch,
      maxTenants: 15,
      maxPosPerTenant: 10,
      newerThanDays: 90,
    });

    log.info('documents.cron_collect', {
      tenants: result.tenants,
      collected: result.collected,
      matched: result.matched,
      reconciled: result.reconciled,
      completed: result.completed,
    });
    return Response.json({ data: result });
  },
  { serviceName: SERVICE_NAME, auth: 'public' },
);
