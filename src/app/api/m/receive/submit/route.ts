/**
 * Create a receipt against a PO from the mobile receiving flow.
 *
 * JWT-protected (mobile receiving JWT) + idempotent (route factory guard).
 * Catalog-backed lines go through supply_chain.rpc_create_receipt_v2 with
 * auto_post=true (posts stock + advances PO line/header statuses via
 * triggers); free-text lines have no stock to post, so their cumulative
 * qty_received is stamped directly — exactly mirroring the desktop
 * ReceivePOModal split.
 *
 * IMPORTANT: rpc_create_receipt_v2 derives tenant/user from auth.jwt(), which
 * is NULL under the admin/service-role client (the same class of bug that left
 * Amazon POs stuck in draft — see punchout/submit). So we mint a
 * Supabase-compatible session JWT for the session's tenant/user with
 * mintSessionTokens() and call the RPC through createAuthenticatedClient(),
 * identical to how the browser invokes it.
 */

import { z } from 'zod';
import { createWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { mintSessionTokens } from '@rocketmanv9/chassis/auth';
import { createAuthenticatedClient } from '@/supabase/client';
import { requireReceiveSession, RECEIVABLE_PO_STATUSES } from '../_lib/receive-session';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const SubmitSchema = z.object({
  po_id: z.string().uuid(),
  lines: z
    .array(
      z.object({
        po_line_id: z.string().uuid(),
        // Client sends numbers, but coerce defensively (never trust "3" + math).
        qty: z.coerce.number().positive(),
      })
    )
    .min(1),
});

export const POST = createWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const session = await requireReceiveSession(req);
  const body = SubmitSchema.parse(await req.json());

  const sc = (supabase as any).schema('supply_chain');

  // 1. Load + verify the PO (tenant-scoped, receivable status).
  const { data: po, error: poError } = await sc
    .from('purchase_orders')
    .select('id, po_number, status, delivery_location_id')
    .eq('id', body.po_id)
    .eq('tenant_id', session.tenantId)
    .limit(1)
    .single();

  if (poError || !po) throw AppError.notFound('Purchase order not found');
  if (!RECEIVABLE_PO_STATUSES.includes((po.status || '').toLowerCase())) {
    throw AppError.badRequest(
      `PO ${po.po_number} is "${po.status}" and can no longer be received. Pull the PO list again.`
    );
  }

  // 2. Load the targeted lines and validate quantities server-side.
  const lineIds = body.lines.map((l) => l.po_line_id);
  const { data: rawLines, error: lineError } = await sc
    .from('purchase_order_lines')
    .select('id, catalog_item_id, item_description, qty_ordered, qty_received, allow_over_delivery')
    .eq('tenant_id', session.tenantId)
    .eq('po_id', body.po_id)
    .in('id', lineIds)
    .limit(200);

  if (lineError) throw AppError.internal(lineError.message);
  const lineMap = new Map<string, any>((rawLines || []).map((l: any) => [l.id, l]));

  // Catalog item names for error messages + the success summary.
  const catalogIds = [...new Set((rawLines || []).map((l: any) => l.catalog_item_id).filter(Boolean))];
  let itemNameMap = new Map<string, string>();
  if (catalogIds.length > 0) {
    const inv = (supabase as any).schema('inventory');
    const { data: items } = await inv
      .from('catalog_items')
      .select('id, name')
      .eq('tenant_id', session.tenantId)
      .in('id', catalogIds)
      .limit(200);
    itemNameMap = new Map((items || []).map((i: any) => [i.id, i.name]));
  }

  const catalogToReceive: Array<{ catalog_item_id: string; qty_received: number; po_line_id: string }> = [];
  const freeToReceive: Array<{ id: string; qty_received: number; description: string }> = [];
  const receivedSummary: Array<{ po_line_id: string; name: string; qty: number }> = [];

  for (const submitted of body.lines) {
    const line = lineMap.get(submitted.po_line_id);
    if (!line) {
      throw AppError.badRequest('One of the submitted lines is not on this PO. Refresh and try again.');
    }
    const name =
      (line.catalog_item_id && itemNameMap.get(line.catalog_item_id)) ||
      line.item_description ||
      'item';
    // PostgREST numerics arrive as strings — coerce before any arithmetic.
    const qtyOrdered = Number(line.qty_ordered) || 0;
    const qtyReceived = Number(line.qty_received) || 0;
    const outstanding = Math.max(0, qtyOrdered - qtyReceived);

    if (submitted.qty > outstanding && line.allow_over_delivery !== true) {
      throw AppError.badRequest(
        `OVER_RECEIPT_BLOCKED: "${name}" — receiving ${submitted.qty} exceeds the outstanding ${outstanding}.`
      );
    }

    if (line.catalog_item_id) {
      catalogToReceive.push({
        catalog_item_id: line.catalog_item_id,
        qty_received: submitted.qty,
        po_line_id: line.id,
      });
    } else {
      freeToReceive.push({
        id: line.id,
        // Free-text lines store an absolute cumulative qty_received.
        qty_received: qtyReceived + submitted.qty,
        description: name,
      });
    }
    receivedSummary.push({ po_line_id: line.id, name, qty: submitted.qty });
  }

  if (catalogToReceive.length > 0 && !po.delivery_location_id) {
    throw AppError.badRequest(
      `PO ${po.po_number} has no delivery location set — edit the PO on desktop to add one before receiving.`
    );
  }

  // 3. Mint a Supabase-compatible JWT so rpc_create_receipt_v2 (and the
  //    RLS-scoped free-text updates) see the right tenant/user in auth.jwt().
  const { accessToken } = await mintSessionTokens({
    userId: session.userId,
    tenantId: session.tenantId,
    email: 'mobile-receive@internal',
    name: 'Mobile Receiving',
    role: 'authenticated',
    isDeveloper: false,
  });
  const authed = createAuthenticatedClient(accessToken).schema('supply_chain');

  let receiptId: string | null = null;
  let receiptNumber: string | null = null;
  let warning: string | null = null;

  // 4. Catalog lines → create receipt + auto-post to inventory.
  if (catalogToReceive.length > 0) {
    const { data: receiptResult, error: receiptError } = await authed.rpc('rpc_create_receipt_v2', {
      p_receipt_number: null,
      p_location_id: po.delivery_location_id,
      p_lines: catalogToReceive,
      p_po_id: po.id,
      p_vendor_id: null,
      p_notes: 'Received via mobile receiving',
      p_packing_slip_no: null,
      p_vendor_invoice_no: null,
      p_source_type: 'delivery',
      p_status: 'confirmed',
      p_auto_post: true,
    });

    if (receiptError) {
      log.error('mobile_receiving.receipt_failed', { poId: po.id, error: receiptError.message });
      const msg = receiptError.message || 'Failed to create receipt';
      throw /OVER_RECEIPT/i.test(msg)
        ? AppError.badRequest(msg)
        : AppError.internal(msg);
    }
    if (!receiptResult?.success) {
      throw AppError.internal('Receipt creation failed — try again.');
    }

    receiptId = receiptResult.receipt_id || null;
    receiptNumber = receiptResult.receipt_number || null;

    // The RPC swallows posting errors as a warning blob — surface them so the
    // operator knows stock did NOT move even though the receipt row exists.
    const postResult = receiptResult.auto_post_result;
    if (postResult && postResult.success === false && postResult.error) {
      warning = `Receipt ${receiptNumber} was saved but posting to stock failed: ${postResult.error}. Verify on desktop.`;
      log.error('mobile_receiving.auto_post_failed', { receiptId, error: postResult.error });
    }
  }

  // 5. Free-text lines → stamp cumulative qty_received directly (the PO line/
  //    header status triggers roll the PO forward). Raw supabase-js writes
  //    don't throw — select the row back and surface errors explicitly.
  for (const line of freeToReceive) {
    const { data: updated, error: updateError } = await authed
      .from('purchase_order_lines')
      .update({ qty_received: line.qty_received })
      .eq('id', line.id)
      .eq('po_id', po.id)
      .select('id')
      .single();

    if (updateError) {
      throw AppError.internal(`Couldn't update "${line.description}": ${updateError.message}`);
    }
    if (!updated) {
      throw AppError.internal(`Couldn't update "${line.description}" — it may have changed. Refresh and retry.`);
    }
  }

  log.info('mobile_receiving.receipt_created', {
    poId: po.id,
    receiptId,
    catalogLines: catalogToReceive.length,
    freeTextLines: freeToReceive.length,
    source: 'mobile',
  });

  return {
    data: {
      po_id: po.id,
      po_number: po.po_number,
      receipt_id: receiptId,
      receipt_number: receiptNumber,
      lines_received: receivedSummary,
      total_qty: receivedSummary.reduce((sum, l) => sum + l.qty, 0),
      warning,
    },
    status: 201,
    events: [
      ...(receiptId
        ? [{
            event_name: 'receipt.created',
            payload: {
              receipt_id: receiptId,
              receipt_number: receiptNumber,
              po_id: po.id,
              po_number: po.po_number,
              source: 'mobile',
            },
            last_event_id: idempotencyKey,
          }]
        : []),
      ...(freeToReceive.length > 0
        ? [{
            event_name: 'purchase_order.lines_received',
            payload: {
              po_id: po.id,
              po_number: po.po_number,
              line_ids: freeToReceive.map((l) => l.id),
              source: 'mobile',
            },
            last_event_id: `${idempotencyKey}-freetext`,
          }]
        : []),
    ],
  };
}, { bodySchema: 'raw',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/m/receive/submit',
  authenticate: async (req: Request) => {
    const session = await requireReceiveSession(req);
    const supabase = await createTenantServiceClient({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      tenantId: session.tenantId,
    });
    return { tenantId: session.tenantId, userId: session.userId, supabase };
  },
});
