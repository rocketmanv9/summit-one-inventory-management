/**
 * Email an approved purchase order to its vendor.
 * GET  ?po_id=…  — preview the composed order (recipient, ship-to, line items).
 * POST { po_id, message?, recipient_email?, requester_email, requester_name }
 *      — send it via Resend (from the requester, CC'd back), stamp sent_at.
 */
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';
import { loadPOContext } from '@/lib/po/po-context';
import { sendPurchaseOrderEmail } from '@/lib/po/po-email-service';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── GET: preview ─────────────────────────────────────────────────────
// Returns the structured data the modal needs to render an exact preview of
// both the email and the PDF. We load via loadPOContext — the same loader the
// PDF generator and the send path use — so the preview can't drift from what
// actually gets sent. Line descriptions are formatted identically to
// ctxLinesToEmailLines() in the email service.

export const GET = createSessionReadRoute(async ({ req, session }) => {
  const poId = new URL(req.url).searchParams.get('po_id');
  if (!poId) throw AppError.badRequest('po_id is required.');

  const ctx = await loadPOContext(getAdminClient(), session.tenantId!, poId);

  return Response.json({
    data: {
      po_number: ctx.poNumber,
      vendor_name: ctx.vendorName,
      recipient: ctx.vendorEmail,
      has_recipient: !!ctx.vendorEmail,
      ship_to: ctx.shipToName,
      ship_to_address: ctx.shipToAddress,
      delivery_label: ctx.deliveryLabel,
      needed_by: ctx.neededBy,
      notes: ctx.notes,
      company_name: ctx.company.name,
      lines: ctx.lines.map((l) => ({
        description: l.sku ? `${l.description} (${l.sku})` : l.description,
        quantity: l.quantity,
        uom: l.uom,
        unitPrice: l.unitPrice,
      })),
      subject: `Purchase Order ${ctx.poNumber}`,
    },
  });
}, { serviceName: SERVICE_NAME });

// ── POST: send ───────────────────────────────────────────────────────

const SendSchema = z.object({
  po_id: z.string().uuid(),
  message: z.string().optional(),
  recipient_email: z.string().email().optional(),
  requester_email: z.string().email(),
  requester_name: z.string().optional(),
  // Optionally force a specific Gmail connection (e.g. a chosen shared mailbox).
  connection_id: z.string().uuid().optional(),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, fetch, log, idempotencyKey }) => {
  const body = SendSchema.parse(await req.json());

  // Delegate to the PO email service: prefers the tenant's Gmail connection
  // (personal account or shared mailbox), attaches a generated PDF, and falls
  // back to the Resend transactional sender when no Google account is connected.
  const result = await sendPurchaseOrderEmail({
    tenantId: ctx.tenantId!,
    userId: ctx.userId!,
    purchaseOrderId: body.po_id,
    vendorEmail: body.recipient_email,
    message: body.message,
    requesterEmail: body.requester_email,
    requesterName: body.requester_name,
    preferConnectionId: body.connection_id,
    fetchImpl: fetch,
    lastEventId: idempotencyKey,
  });

  log.info('purchase_order.emailed', {
    poId: body.po_id,
    to: result.recipient,
    provider: result.provider,
    messageId: result.messageId,
  });

  return {
    data: {
      sent: true,
      provider: result.provider,
      message_id: result.messageId,
      thread_id: result.threadId,
      from: result.from,
      to: result.recipient,
      cc: body.requester_email,
      po_number: result.poNumber,
    },
    status: 200,
    events: [
      {
        event_name: 'purchase_order.sent',
        payload: {
          po_id: body.po_id,
          po_number: result.poNumber,
          provider: result.provider,
          from: result.from,
          to: result.recipient,
          cc: body.requester_email,
        },
        last_event_id: idempotencyKey,
      },
    ],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/purchasing/po-email' });
