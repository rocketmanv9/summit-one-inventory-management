/**
 * POST /api/inventory/item-suggestions/[id]/resolve
 *
 * Accept or dismiss an AI item-onboarding suggestion. Accepting returns the
 * suggestion payload so the client can open the item wizard pre-filled;
 * dismissing suppresses the item from future scans (the dedupe row stays).
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const BodySchema = z.object({
  action: z.enum(['accept', 'dismiss']),
});

function getSuggestionId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const idx = segments.indexOf('item-suggestions');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Missing suggestion id');
  return id;
}

export const POST = createSessionWriteRoute(
  async ({ ctx, req, log, idempotencyKey }) => {
    const body = BodySchema.parse(await req.json());
    const id = getSuggestionId(req);

    const inv = getAdminClient().schema('inventory');

    const { data: existing } = await inv
      .from('item_onboarding_suggestions')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .limit(1)
      .maybeSingle();

    if (!existing) throw AppError.notFound('Suggestion not found');
    if (existing.status !== 'suggested') {
      // Idempotent-friendly: resolving twice is a no-op, not an error.
      return { data: existing, status: 200, events: [] };
    }

    const status = body.action === 'accept' ? 'accepted' : 'dismissed';
    const { data: updated, error } = await inv
      .from('item_onboarding_suggestions')
      .update({
        status,
        resolved_by_user_id: ctx.userId,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_event_id: idempotencyKey,
      })
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .eq('status', 'suggested')
      .select()
      .single();

    if (error) {
      log.error('item_suggestions.resolve_failed', { id, error: error.message });
      throw AppError.internal(error.message);
    }

    return {
      data: updated,
      status: 200,
      events: [{
        event_name: `item_suggestion.${status}`,
        payload: {
          suggestion_id: id,
          item_name: existing.item_name,
          vendor_id: existing.vendor_id,
          confidence: existing.confidence,
        },
        last_event_id: idempotencyKey,
      }],
    };
  },
  { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/item-suggestions/:id/resolve' },
);
