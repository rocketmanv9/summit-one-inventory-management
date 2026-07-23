/**
 * POST /api/inventory/item-suggestions/scan
 *
 * On-demand "scan my email now" for the current tenant — same engine as the
 * daily cron, so users don't have to wait a day after connecting Gmail.
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { z } from 'zod';
import { scanTenantForItemSuggestions } from '@/lib/suggestions/item-onboarding';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Gmail + per-message AI extraction can take a while.
export const maxDuration = 120;

const BodySchema = z.object({
  days: z.number().int().min(1).max(60).optional(),
});

export const POST = createSessionWriteRoute(
  async ({ ctx, req, log, fetch, idempotencyKey }) => {
    const body = BodySchema.parse(await req.json().catch(() => ({})));

    const result = await scanTenantForItemSuggestions({
      tenantId: ctx.tenantId,
      fetchImpl: fetch,
      log,
      newerThanDays: body.days ?? 14,
    });

    log.info('item_suggestions.manual_scan', {
      tenantId: ctx.tenantId,
      messagesScanned: result.messagesScanned,
      suggestionsCreated: result.suggestionsCreated,
      suggestionsBumped: result.suggestionsBumped,
    });

    return {
      data: result,
      status: 200,
      events: [{
        event_name: 'item_suggestions.scanned',
        payload: {
          messages_scanned: result.messagesScanned,
          suggestions_created: result.suggestionsCreated,
          suggestions_bumped: result.suggestionsBumped,
          skipped_no_connection: result.skippedNoConnection,
        },
        last_event_id: idempotencyKey,
      }],
    };
  },
  { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/item-suggestions/scan' },
);
