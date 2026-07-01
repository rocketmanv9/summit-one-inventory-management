/**
 * POST /api/inventory/purchasing/documents/collect
 *
 * Searches the user's connected Gmail for documents relating to a purchase
 * order (receipts, invoices, order confirmations, shipping/delivery notices),
 * extracts their structured data, scores each against the PO, stores the
 * originals in the private receipt repository, and auto-reconciles high-
 * confidence invoices/receipts back onto the PO (audited).
 *
 * Body: { po_id: string, newer_than_days?: number, auto_reconcile?: boolean }
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { z } from 'zod';
import { getGoogleAccessTokenForUser } from '@/lib/integrations/google-connections';
import { collectForPurchaseOrder } from '@/lib/documents/store';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CollectSchema = z.object({
  po_id: z.string().uuid(),
  newer_than_days: z.number().int().min(1).max(365).optional(),
  auto_reconcile: z.boolean().optional(),
});

export const POST = createSessionWriteRoute(
  async ({ req, ctx, fetch, supabase, log, idempotencyKey }) => {
    const body = CollectSchema.parse(await req.json());
    const tenantId = ctx.tenantId!;
    const userId = ctx.userId!;

    const { accessToken } = await getGoogleAccessTokenForUser(tenantId, userId, { fetchImpl: fetch });

    const result = await collectForPurchaseOrder({
      db: supabase,
      fetchImpl: fetch,
      accessToken,
      tenantId,
      userId,
      poId: body.po_id,
      newerThanDays: body.newer_than_days,
      autoReconcile: body.auto_reconcile,
    });

    log.info('purchase_document.collected', { po_id: body.po_id, ...result, documents: result.documents.length });

    return {
      data: result,
      status: 200,
      events: [
        {
          event_name: 'purchase_document.collected',
          payload: {
            purchase_order_id: body.po_id,
            collected: result.collected,
            matched: result.matched,
            suggested: result.suggested,
            reconciled: result.reconciled,
          },
          last_event_id: idempotencyKey,
        },
      ],
    };
  },
  { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/purchasing/documents/collect' },
);
