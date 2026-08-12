/**
 * GET /api/inventory/purchasing/po-email-draft?po_id=…&urgency=…
 *
 * AI-assisted: returns a professional, ready-to-edit PO email draft (subject +
 * body) for the given purchase order. Falls back to a deterministic template
 * when OpenAI is not configured.
 *
 * urgency = 'normal' | 'urgent' | 'follow_up'  (default 'normal')
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { loadPOContext } from '@/lib/po/po-context';
import { generatePurchaseOrderEmailDraft, type EmailUrgency } from '@/lib/po/po-email-service';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const URGENCIES: EmailUrgency[] = ['normal', 'urgent', 'follow_up'];

export const GET = createSessionReadRoute(
  async ({ req, session }) => {
    const url = new URL(req.url);
    const poId = url.searchParams.get('po_id');
    if (!poId) throw AppError.badRequest('po_id is required.');

    const urgencyParam = url.searchParams.get('urgency') as EmailUrgency | null;
    const urgency = urgencyParam && URGENCIES.includes(urgencyParam) ? urgencyParam : 'normal';

    const ctx = await loadPOContext(getAdminClient(), session.tenantId, poId);
    const draft = await generatePurchaseOrderEmailDraft({ ctx, urgency });

    return Response.json({
      data: {
        subject: draft.subject,
        body: draft.body,
        vendor_name: ctx.vendorName,
        recipient: ctx.vendorEmail,
        urgency,
      },
    });
  },
  { serviceName: SERVICE_NAME },
);
