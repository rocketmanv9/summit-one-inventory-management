/**
 * GET /api/inventory/purchasing/documents/search?q=<term>&limit=<n>
 *
 * Full search over the receipt repository — by invoice #, receipt #, vendor
 * order #, PO #, tracking #, vendor name, sender email, file name, or amount.
 * Returns matching documents with their PO number and a signed link.
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { signedUrlsFor } from '@/lib/documents/store';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/** Strip characters that would break a PostgREST `.or()` filter expression. */
function sanitize(q: string): string {
  return q.replace(/[(),*]/g, ' ').trim();
}

export const GET = createSessionReadRoute(
  async ({ req, session }) => {
    const url = new URL(req.url);
    const rawQ = (url.searchParams.get('q') || '').trim();
    if (rawQ.length < 2) throw AppError.badRequest('Search term must be at least 2 characters.');
    const q = sanitize(rawQ);
    if (!q) throw AppError.badRequest('Invalid search term.');
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);
    const tenantId = session.tenantId!;

    const supabase = await createTenantServiceClient({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      tenantId,
    });
    const sc = supabase.schema('supply_chain');

    // PO-number matches contribute their PO ids to the document filter.
    const { data: matchingPos } = await sc
      .from('purchase_orders')
      .select('id, po_number')
      .eq('tenant_id', tenantId)
      .ilike('po_number', `%${q}%`)
      .limit(50);
    const poIds = (matchingPos ?? []).map((p: any) => p.id);

    const like = `%${q}%`;
    const ors = [
      `invoice_number.ilike.${like}`,
      `receipt_number.ilike.${like}`,
      `order_number.ilike.${like}`,
      `po_number_detected.ilike.${like}`,
      `vendor_name.ilike.${like}`,
      `sender_email.ilike.${like}`,
      `file_name.ilike.${like}`,
      `tracking_numbers.cs.{${q}}`,
    ];
    if (poIds.length) ors.push(`purchase_order_id.in.(${poIds.join(',')})`);
    const asNumber = Number(q.replace(/[$,]/g, ''));
    if (!Number.isNaN(asNumber) && asNumber > 0) ors.push(`total.eq.${asNumber}`);

    const { data, error } = await sc
      .from('purchase_documents')
      .select(
        'id, purchase_order_id, doc_type, source, sender_email, document_date, file_name, ' +
          'vendor_name, invoice_number, receipt_number, order_number, po_number_detected, ' +
          'tracking_numbers, total, currency, match_status, reconciled_at, storage_path, created_at',
      )
      .eq('tenant_id', tenantId)
      .or(ors.join(','))
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw AppError.internal(error.message);

    // Resolve PO numbers + signed URLs.
    const rows = data ?? [];
    const wantPoIds = Array.from(new Set(rows.map((d: any) => d.purchase_order_id).filter(Boolean)));
    const poNumberById = new Map<string, string>();
    if (wantPoIds.length) {
      const { data: pos } = await sc.from('purchase_orders').select('id, po_number').in('id', wantPoIds).eq('tenant_id', tenantId);
      for (const p of pos ?? []) poNumberById.set(p.id, p.po_number);
    }
    const urls = await signedUrlsFor(supabase, rows.map((d: any) => d.storage_path).filter(Boolean));

    const results = rows.map((d: any) => ({
      ...d,
      po_number: d.purchase_order_id ? poNumberById.get(d.purchase_order_id) ?? null : null,
      signed_url: d.storage_path ? urls[d.storage_path] ?? null : null,
    }));

    return Response.json({ data: results });
  },
  { serviceName: SERVICE_NAME },
);
