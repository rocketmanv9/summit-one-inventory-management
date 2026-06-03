/**
 * Email a vendor an order request.
 * POST — composes and sends an order email to the vendor (from the requesting
 * user, CC'd back to them for transparency) via Resend.
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { sendEmail } from '@/lib/email/send';
import { buildOrderEmail } from '@/lib/email/order-email';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const OrderEmailSchema = z
  .object({
    vendor_id: z.string().uuid(),
    catalog_item_id: z.string().uuid().optional(),
    item_description: z.string().min(1).optional(),
    quantity: z.number().positive(),
    uom: z.string().optional(),
    unit_price: z.number().min(0).optional(),
    needed_by: z.string().optional(),
    message: z.string().optional(),
    // The signed-in user's address (from /api/auth/session) — used as the
    // sender and CC'd for transparency.
    requester_email: z.string().email(),
    requester_name: z.string().optional(),
  })
  .refine((b) => b.catalog_item_id || b.item_description, {
    message: 'Provide either a catalog item or an item description.',
  });

export const POST = createSessionWriteRoute(async ({ req, ctx, fetch, supabase, log, idempotencyKey }) => {
  const body = OrderEmailSchema.parse(await req.json());

  const sc = (supabase as any).schema('supply_chain');
  const inv = (supabase as any).schema('inventory');

  // Resolve the vendor's order email.
  const { data: vendor, error: vendorError } = await sc
    .from('vendors')
    .select('id, name, po_email, contact_email')
    .eq('id', body.vendor_id)
    .eq('tenant_id', ctx.tenantId!)
    .limit(1)
    .single();

  if (vendorError || !vendor) throw AppError.notFound('Vendor not found.');

  const vendorEmail: string | null = vendor.po_email || vendor.contact_email || null;
  if (!vendorEmail) {
    throw AppError.badRequest(
      `${vendor.name} has no email on file. Add a PO email or contact email to the vendor first.`,
    );
  }

  // Resolve the item label.
  let itemLabel = body.item_description?.trim() || '';
  let uom = body.uom ?? null;
  if (body.catalog_item_id) {
    const { data: item } = await inv
      .from('catalog_items')
      .select('name, sku')
      .eq('id', body.catalog_item_id)
      .eq('tenant_id', ctx.tenantId!)
      .limit(1)
      .maybeSingle();
    if (item) itemLabel = `${item.name} (${item.sku})`;
  }
  if (!itemLabel) throw AppError.badRequest('Could not determine the item to order.');

  const { subject, html, text } = buildOrderEmail({
    vendorName: vendor.name,
    itemLabel,
    quantity: body.quantity,
    uom,
    unitPrice: body.unit_price ?? null,
    neededBy: body.needed_by ?? null,
    message: body.message ?? null,
    requesterName: body.requester_name ?? null,
    requesterEmail: body.requester_email,
  });

  // Resend can only send from a VERIFIED domain. Send from the org's verified
  // sender (ORDER_EMAIL_FROM, e.g. orders@summit-one.app) but show the
  // requester's name and route replies back to their real address.
  const rawSender = process.env.ORDER_EMAIL_FROM || body.requester_email;
  const senderAddress = rawSender.includes('<') ? rawSender.replace(/.*<([^>]+)>.*/, '$1').trim() : rawSender.trim();
  const fromName = body.requester_name?.trim();
  const from = fromName ? `${fromName} <${senderAddress}>` : senderAddress;

  // Send inline (not afterCommit) so a failure surfaces to the user and the
  // idempotency key is released for retry; a successful send is cached by the
  // idempotency guard so retries don't re-send.
  const sent = await sendEmail(fetch, {
    from,
    to: vendorEmail,
    cc: [body.requester_email],
    replyTo: body.requester_email,
    subject,
    html,
    text,
  });

  log.info('vendor.order_email.sent', { vendorId: vendor.id, to: vendorEmail, messageId: sent.id });

  return {
    data: { sent: true, message_id: sent.id, to: vendorEmail, cc: body.requester_email },
    status: 200,
    events: [
      {
        event_name: 'order.emailed',
        payload: {
          vendor_id: vendor.id,
          to: vendorEmail,
          cc: body.requester_email,
          item: itemLabel,
          quantity: body.quantity,
        },
        last_event_id: idempotencyKey,
      },
    ],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/vendors/order-email' });
