import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const StockReceiveSchema = z.object({
  item_name: z.string().min(1),
  item_description: z.string().optional(),
  location_name: z.string().min(1),
  quantity: z.number().positive(),
  unit_of_measure: z.string().default('each'),
});

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const body = StockReceiveSchema.parse(await req.json());

  const inv = (supabase as any).schema('inventory');

  // ── 1. Find location by fuzzy name match ──────────────────────────
  const { data: locations, error: locError } = await inv
    .from('locations')
    .select('id, name')
    .ilike('name', `%${body.location_name}%`)
    .eq('active', true)
    .limit(1);

  if (locError) {
    throw AppError.internal(`Failed to search locations: ${locError.message}`);
  }

  if (!locations || locations.length === 0) {
    throw AppError.notFound(`Location "${body.location_name}" not found. Please check the location name and try again.`);
  }

  const location = locations[0];

  // ── 2. Search for existing catalog item ───────────────────────────
  const { data: existingItems, error: itemSearchError } = await inv
    .from('catalog_items')
    .select('id, name, sku, unit_of_measure')
    .or(`name.ilike.%${body.item_name}%,sku.ilike.%${body.item_name}%`)
    .eq('active', true)
    .limit(5);

  if (itemSearchError) {
    throw AppError.internal(`Failed to search items: ${itemSearchError.message}`);
  }

  let itemId: string;
  let itemName: string;
  let itemCreated = false;

  if (existingItems && existingItems.length > 0) {
    // Use the best match (first result)
    itemId = existingItems[0].id;
    itemName = existingItems[0].name;
    log.info('stock_receive.item_found', { itemId, itemName });
  } else {
    // ── 3. Create new catalog item ──────────────────────────────────
    const autoSku = `AI-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

    const { data: newItem, error: createError } = await inv
      .rpc('rpc_create_catalog_item', {
        p_name: body.item_name,
        p_sku: autoSku,
        p_unit_of_measure: body.unit_of_measure,
        p_description: body.item_description || null,
        p_tracking_mode: 'fungible',
        p_last_event_id: `${idempotencyKey}_create_item`,
      });

    if (createError) {
      throw AppError.internal(`Failed to create catalog item: ${createError.message}`);
    }

    itemId = newItem;
    itemName = body.item_name;
    itemCreated = true;
    log.info('stock_receive.item_created', { itemId, itemName, sku: autoSku });
  }

  // ── 4. Get current stock balance at this location ──────────────────
  const { data: balanceRows, error: balError } = await inv
    .from('stock_balances')
    .select('qty_on_hand')
    .eq('catalog_item_id', itemId)
    .eq('location_id', location.id)
    .limit(1);

  if (balError) {
    throw AppError.internal(`Failed to check stock balance: ${balError.message}`);
  }

  const previousQty = balanceRows && balanceRows.length > 0
    ? Number(balanceRows[0].qty_on_hand) || 0
    : 0;
  const newQty = previousQty + body.quantity;

  // ── 5. Adjust inventory (set absolute qty = previous + added) ─────
  const { error: adjustError } = await inv
    .rpc('rpc_adjust_inventory', {
      p_catalog_item_id: itemId,
      p_location_id: location.id,
      p_new_qty: newQty,
      p_reason: 'other',
      p_notes: `AI image recognition stock receive: +${body.quantity} ${body.unit_of_measure}`,
      p_last_event_id: `${idempotencyKey}_adjust`,
    });

  if (adjustError) {
    throw AppError.internal(`Failed to adjust inventory: ${adjustError.message}`);
  }

  log.info('stock_receive.completed', {
    itemId,
    itemName,
    locationId: location.id,
    locationName: location.name,
    quantityAdded: body.quantity,
    previousQty,
    newQty,
  });

  return {
    data: {
      item_id: itemId,
      item_name: itemName,
      item_created: itemCreated,
      location_name: location.name,
      quantity_added: body.quantity,
      unit_of_measure: body.unit_of_measure,
      previous_qty: previousQty,
      new_qty: newQty,
    },
    status: 201,
    events: [{
      event_name: 'stock.received_via_ai',
      payload: {
        item_id: itemId,
        item_name: itemName,
        item_created: itemCreated,
        location_id: location.id,
        location_name: location.name,
        quantity_added: body.quantity,
        previous_qty: previousQty,
        new_qty: newQty,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, {
  serviceName: SERVICE_NAME,
  scope: 'POST /api/ai/stock-receive',
});
