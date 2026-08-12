/**
 * POST /api/inventory/purchasing/documents/reconcile
 *
 * Writes a matched document's real numbers back onto its purchase order — line
 * actual costs, vendor order #, and an accounting expense — so the PO on file
 * (and its generated PDF) reflects the invoiced actuals. Fully audited via
 * procurement_events and reversible from the recorded before/after snapshot.
 *
 * Body: { document_id: string }
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { z } from 'zod';
import { reconcileDocument } from '@/lib/documents/store';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const ReconcileSchema = z.object({ document_id: z.string().uuid() });

export const POST = createSessionWriteRoute(
  async ({ req, ctx, supabase, log, idempotencyKey }) => {
    const body = ReconcileSchema.parse(await req.json());

    const result = await reconcileDocument(supabase, ctx.tenantId!, body.document_id, ctx.userId!);

    log.info('purchase_document.reconciled', { document_id: body.document_id, lines_updated: result?.lines_updated });

    return {
      data: result,
      status: 200,
      events: [
        {
          event_name: 'purchase_document.reconciled',
          payload: {
            document_id: body.document_id,
            purchase_order_id: result?.purchase_order_id,
            lines_updated: result?.lines_updated ?? 0,
            total_before: result?.total_before,
            total_after: result?.total_after,
          },
          last_event_id: idempotencyKey,
        },
      ],
    };
  },
  { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/purchasing/documents/reconcile' },
);
