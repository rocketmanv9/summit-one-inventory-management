/**
 * GET /api/inventory/purchasing/po-suggestions
 *
 * Tenant-wide queue of pending (status='suggested') vendor-reply suggestions
 * awaiting a human Apply/Dismiss. Used for a purchasing "needs attention" view.
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(
  async ({ session }) => {
    const sc = getAdminClient().schema('supply_chain');

    const { data: suggestions } = await sc
      .from('purchase_order_suggestions')
      .select('id, purchase_order_id, reply_id, event_type, confidence, summary, proposed_changes, created_at')
      .eq('tenant_id', session.tenantId)
      .eq('status', 'suggested')
      .order('created_at', { ascending: false })
      .limit(100);

    // Attach PO numbers for display.
    const poIds = [...new Set((suggestions ?? []).map((s: any) => s.purchase_order_id))];
    const poNumbers: Record<string, string> = {};
    if (poIds.length > 0) {
      const { data: pos } = await sc
        .from('purchase_orders')
        .select('id, po_number')
        .in('id', poIds)
        .limit(200);
      for (const po of pos ?? []) poNumbers[po.id] = po.po_number;
    }

    const enriched = (suggestions ?? []).map((s: any) => ({
      ...s,
      po_number: poNumbers[s.purchase_order_id] ?? null,
    }));

    return Response.json({ data: { suggestions: enriched, count: enriched.length } });
  },
  { serviceName: SERVICE_NAME },
);
