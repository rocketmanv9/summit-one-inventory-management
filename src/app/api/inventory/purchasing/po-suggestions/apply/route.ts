/**
 * POST /api/inventory/purchasing/po-suggestions/apply
 *
 * Apply or dismiss a queued vendor-reply suggestion.
 * Body: { suggestion_id: uuid, action: 'apply' | 'dismiss' }
 *
 * 'apply' writes the suggestion's proposed changes to the PO (whitelisted +
 * transition-guarded); 'dismiss' just resolves the queue item.
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';
import { resolveSuggestion } from '@/lib/po/po-status-tracker';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const ApplySchema = z.object({
  suggestion_id: z.string().uuid(),
  action: z.enum(['apply', 'dismiss']),
});

export const POST = createSessionWriteRoute(
  async ({ req, ctx, log, idempotencyKey }) => {
    const body = ApplySchema.parse(await req.json());

    const result = await resolveSuggestion(
      getAdminClient(),
      ctx.tenantId!,
      body.suggestion_id,
      body.action,
      ctx.userId!,
    );

    log.info('po_suggestion.resolved', {
      suggestionId: body.suggestion_id,
      action: body.action,
      applied: result.applied,
    });

    return {
      data: { status: result.status, applied: result.applied, purchase_order_id: result.purchaseOrderId },
      status: 200,
      events: [
        {
          event_name: body.action === 'apply' ? 'purchase_order.suggestion_applied' : 'purchase_order.suggestion_dismissed',
          payload: {
            suggestion_id: body.suggestion_id,
            purchase_order_id: result.purchaseOrderId,
            applied: result.applied,
          },
          last_event_id: idempotencyKey,
        },
      ],
    };
  },
  { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/purchasing/po-suggestions/apply' },
);
