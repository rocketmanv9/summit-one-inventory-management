/**
 * Email an approved purchase order to its vendor.
 * GET  ?po_id=…  — preview the composed order (recipient, ship-to, line items).
 * POST { po_id, message?, recipient_email?, requester_email, requester_name }
 *      — send it via Resend (from the requester, CC'd back), stamp sent_at.
 */
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getGVClient } from '@/lib/gv';
import { getAdminClient } from '@/utils/supabase/admin';
import type { POEmailLine } from '@/lib/email/order-email';
import { sendPurchaseOrderEmail } from '@/lib/po/po-email-service';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

interface POEmailContext {
  poNumber: string;
  vendorName: string;
  recipient: string | null;
  shipTo: string | null;
  neededBy: string | null;
  notes: string | null;
  lines: POEmailLine[];
}

async function loadPOEmailContext(supabase: any, tenantId: string, poId: string): Promise<POEmailContext> {
  const sc = supabase.schema('supply_chain');
  const inv = supabase.schema('inventory');

  const { data: po, error: poErr } = await sc
    .from('purchase_orders')
    .select('id, po_number, vendor_id, vendor_name_snapshot, delivery_location_id, needed_by_date, notes')
    .eq('id', poId)
    .eq('tenant_id', tenantId)
    .limit(1)
    .single();
  if (poErr || !po) throw AppError.notFound('Purchase order not found.');

  let recipient: string | null = null;
  let vendorName: string = po.vendor_name_snapshot || 'Vendor';
  if (po.vendor_id) {
    const { data: vendor } = await sc
      .from('vendors')
      .select('name, po_email, contact_email')
      .eq('id', po.vendor_id)
      .limit(1)
      .maybeSingle();
    if (vendor) {
      recipient = vendor.po_email || vendor.contact_email || null;
      vendorName = po.vendor_name_snapshot || vendor.name || vendorName;
    }
  }

  let shipTo: string | null = null;
  if (po.delivery_location_id) {
    const { data: loc } = await inv
      .from('locations')
      .select('name')
      .eq('id', po.delivery_location_id)
      .limit(1)
      .maybeSingle();
    shipTo = loc?.name ?? null;
  }

  const { data: rawLines } = await sc
    .from('purchase_order_lines')
    .select('catalog_item_id, item_description, qty_ordered, unit_cost, uom_term_id, line_number')
    .eq('po_id', poId)
    .order('line_number');

  const lineRows = rawLines || [];

  // Resolve catalog item names.
  const itemIds = [...new Set(lineRows.map((l: any) => l.catalog_item_id).filter(Boolean))];
  const itemMap: Record<string, { name: string; sku: string }> = {};
  if (itemIds.length > 0) {
    const { data: items } = await inv.from('catalog_items').select('id, name, sku').in('id', itemIds).limit(200);
    for (const it of items || []) itemMap[it.id] = { name: it.name, sku: it.sku };
  }

  // Resolve UOM labels (best-effort).
  let uomMap: Record<string, string> = {};
  try {
    const raw = await getGVClient().buildLabelMap(tenantId, 'uom');
    uomMap = raw instanceof Map ? Object.fromEntries(raw) : (raw as Record<string, string>);
  } catch {
    uomMap = {};
  }

  const lines: POEmailLine[] = lineRows.map((l: any) => {
    const item = l.catalog_item_id ? itemMap[l.catalog_item_id] : null;
    const description = item ? `${item.name} (${item.sku})` : l.item_description || 'Item';
    return {
      description,
      quantity: Number(l.qty_ordered) || 0,
      uom: l.uom_term_id ? uomMap[l.uom_term_id] ?? null : null,
      unitPrice: l.unit_cost != null ? Number(l.unit_cost) : null,
    };
  });

  return {
    poNumber: po.po_number,
    vendorName,
    recipient,
    shipTo,
    neededBy: po.needed_by_date ?? null,
    notes: po.notes ?? null,
    lines,
  };
}

// ── GET: preview ─────────────────────────────────────────────────────

export const GET = createSessionReadRoute(async ({ req, session }) => {
  const poId = new URL(req.url).searchParams.get('po_id');
  if (!poId) throw AppError.badRequest('po_id is required.');

  const ctx = await loadPOEmailContext(getAdminClient(), session.tenantId!, poId);

  return Response.json({
    data: {
      po_number: ctx.poNumber,
      vendor_name: ctx.vendorName,
      recipient: ctx.recipient,
      has_recipient: !!ctx.recipient,
      ship_to: ctx.shipTo,
      needed_by: ctx.neededBy,
      notes: ctx.notes,
      lines: ctx.lines,
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
