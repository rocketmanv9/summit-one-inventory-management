/**
 * POST /api/integrations/google/sync-replies
 *
 * Reads recent Gmail messages across the user's connections (personal + tenant
 * shared mailboxes), matches them to sent POs by thread id or PO number, and
 * stores inbound vendor replies linked to the originating PO.
 *
 * Body: { lookback_days?: number }
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { z } from 'zod';
import { syncVendorReplies } from '@/lib/po/po-email-service';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const SyncSchema = z.object({ lookback_days: z.number().int().min(1).max(180).optional() });

export const POST = createSessionWriteRoute(
  async ({ req, ctx, fetch, log, idempotencyKey }) => {
    const body = SyncSchema.parse(await req.json().catch(() => ({})));

    const result = await syncVendorReplies({
      tenantId: ctx.tenantId!,
      userId: ctx.userId!,
      fetchImpl: fetch,
      lookbackDays: body.lookback_days,
    });

    log.info('gmail.replies_synced', { ...result });

    return {
      data: { scanned_connections: result.scannedConnections, new_replies: result.newReplies },
      status: 200,
      events: [
        {
          event_name: 'purchase_order.replies_synced',
          payload: {
            scanned_connections: result.scannedConnections,
            new_replies: result.newReplies,
          },
          last_event_id: idempotencyKey,
        },
      ],
    };
  },
  { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/integrations/google/sync-replies' },
);
