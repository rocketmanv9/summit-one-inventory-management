/**
 * GET /api/inventory/purchasing/po-activity?po_id=…
 *
 * Returns the vendor-activity timeline for a PO: AI-interpreted suggestions
 * (auto-applied + pending), the underlying vendor replies, and any carrier
 * shipments received from an integration ASN (e.g. Amazon ship-notice).
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(
  async ({ req, session }) => {
    const poId = new URL(req.url).searchParams.get('po_id');
    if (!poId) throw AppError.badRequest('po_id is required.');

    const admin = getAdminClient();
    const sc = admin.schema('supply_chain');
    const inv = admin.schema('inventory');

    const [{ data: suggestions }, { data: replies }, { data: punchout }] = await Promise.all([
      sc
        .from('purchase_order_suggestions')
        .select('id, reply_id, event_type, confidence, summary, proposed_changes, status, applied_at, created_at')
        .eq('tenant_id', session.tenantId)
        .eq('purchase_order_id', poId)
        .order('created_at', { ascending: false })
        .limit(100),
      sc
        .from('purchase_order_email_replies')
        .select('id, from_email, subject, snippet, summary, event_type, confidence, received_at, created_at')
        .eq('tenant_id', session.tenantId)
        .eq('purchase_order_id', poId)
        .order('received_at', { ascending: false })
        .limit(50),
      // Carrier shipments arrive via the integration ASN webhook (e.g. Amazon
      // ship-notice) and are stored on the linked punchout order's metadata.
      inv
        .from('punchout_orders')
        .select('metadata')
        .eq('tenant_id', session.tenantId)
        .eq('purchase_order_id', poId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const shipments = Array.isArray((punchout as any)?.metadata?.shipments)
      ? (punchout as any).metadata.shipments
      : [];

    return Response.json({
      data: {
        suggestions: suggestions ?? [],
        replies: replies ?? [],
        shipments,
        pending_count: (suggestions ?? []).filter((s: any) => s.status === 'suggested').length,
      },
    });
  },
  { serviceName: SERVICE_NAME },
);
