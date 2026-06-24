import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { receiveStock } from '@/lib/inventory/receive';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * POST /api/inventory/scan/receive
 *
 * Session-authenticated scan-to-receive for the true mobile app. Adds quantity
 * to an existing catalog item at a location. Quantity changes flow through
 * rpc_adjust_inventory, so guardrail policy and the stock_movements ledger
 * (and its outbox event trigger) apply exactly as on every other adjustment —
 * hence emissionOwner: 'trigger' and no app-level event here.
 */
const ReceiveSchema = z.object({
  catalog_item_id: z.string().uuid(),
  location_id: z.string().uuid(),
  quantity: z.number().positive(),
  notes: z.string().max(500).optional(),
  override_reason: z.string().max(500).optional(),
});

export const POST = createSessionWriteRoute(
  async ({ req, log, supabase }) => {
    const body = ReceiveSchema.parse(await req.json());
    const inv = (supabase as any).schema('inventory');

    const result = await receiveStock(inv, {
      catalogItemId: body.catalog_item_id,
      locationId: body.location_id,
      quantity: body.quantity,
      reason: 'other',
      notes: body.notes,
      overrideReason: body.override_reason,
    });

    log.info('scan.receive.completed', {
      itemId: result.item_id,
      locationId: result.location_id,
      quantityAdded: result.quantity_added,
      previousQty: result.previous_qty,
      newQty: result.new_qty,
    });

    return { data: result, status: 201, events: [] };
  },
  {
    bodySchema: 'raw',
    emissionOwner: 'trigger',
    serviceName: SERVICE_NAME,
    scope: 'POST /api/inventory/scan/receive',
  },
);
