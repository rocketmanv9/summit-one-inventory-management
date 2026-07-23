/**
 * GET /api/inventory/item-suggestions
 *
 * Pending (status='suggested') AI item-onboarding suggestions for the tenant,
 * newest sighting first, for the /inventory/item-suggestions review queue.
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(
  async ({ session, log }) => {
    const inv = getAdminClient().schema('inventory');

    const { data, error } = await inv
      .from('item_onboarding_suggestions')
      .select('id, item_name, item_description, quantity, unit_cost, currency, confidence, rationale, occurrences, vendor_id, vendor_name, email_subject, email_from, email_date, last_seen_at, created_at')
      .eq('tenant_id', session.tenantId)
      .eq('status', 'suggested')
      .order('last_seen_at', { ascending: false })
      .limit(100);

    if (error) {
      log.error('item_suggestions.list_failed', { error: error.message });
      throw AppError.internal(error.message);
    }

    return Response.json({ data: { suggestions: data ?? [], count: (data ?? []).length } });
  },
  { serviceName: SERVICE_NAME },
);
