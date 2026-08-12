/**
 * Stream a purchase order as an inline PDF for the "View PDF" action.
 * GET ?po_id=…  — renders the same data the email service attaches.
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { loadPOContext } from '@/lib/po/po-context';
import { generatePurchaseOrderPdf } from '@/lib/po/po-pdf';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session }) => {
  const poId = new URL(req.url).searchParams.get('po_id');
  if (!poId) throw AppError.badRequest('po_id is required.');

  const ctx = await loadPOContext(getAdminClient(), session.tenantId!, poId);
  const pdf = await generatePurchaseOrderPdf(ctx);

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="PO-${ctx.poNumber}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}, { serviceName: SERVICE_NAME });
