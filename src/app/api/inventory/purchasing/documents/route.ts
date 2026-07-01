/**
 * GET /api/inventory/purchasing/documents?po_id=<uuid>
 *
 * Lists the collected documents (receipt repository) for a purchase order, each
 * with a short-lived signed URL to open/download the original from the private
 * bucket.
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { signedUrlsFor } from '@/lib/documents/store';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(
  async ({ req, session }) => {
    const poId = new URL(req.url).searchParams.get('po_id');
    if (!poId) throw AppError.badRequest('po_id is required');

    const supabase = await createTenantServiceClient({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      tenantId: session.tenantId!,
    });

    const { data, error } = await supabase
      .schema('supply_chain')
      .from('purchase_documents')
      .select(
        'id, purchase_order_id, doc_type, source, sender_email, subject, document_date, ' +
          'file_name, content_type, byte_size, storage_path, vendor_name, po_number_detected, ' +
          'order_number, invoice_number, receipt_number, tracking_numbers, subtotal, tax, ' +
          'shipping, total, currency, payment_method, line_items, extraction_status, ' +
          'match_status, match_confidence, match_signals, matched_at, reconciled_at, created_at',
      )
      .eq('tenant_id', session.tenantId!)
      .eq('purchase_order_id', poId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw AppError.internal(error.message);

    const paths = (data ?? []).map((d: any) => d.storage_path).filter(Boolean);
    const urls = await signedUrlsFor(supabase, paths);
    const documents = (data ?? []).map((d: any) => ({ ...d, signed_url: d.storage_path ? urls[d.storage_path] ?? null : null }));

    return Response.json({ data: documents });
  },
  { serviceName: SERVICE_NAME },
);
