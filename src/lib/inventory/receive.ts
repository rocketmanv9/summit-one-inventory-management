import { AppError } from '@rocketmanv9/chassis/errors';

/**
 * Additive stock receive used by the session-authenticated
 * `POST /api/inventory/scan/receive` route (the true mobile app's
 * scan-to-receive flow).
 *
 * This is the same mechanism the AI stock-receive route uses: read the current
 * on-hand balance and call `rpc_adjust_inventory` with the absolute target
 * (`previous + quantity`). The RPC owns the guardrail policy (over-receipt,
 * negative inventory, override-reason), so business rules stay in one place.
 *
 * `inv` must be a tenant-scoped client on the `inventory` schema, so the
 * balance read and the adjustment RPC are tenant-isolated.
 */

export interface ReceiveStockParams {
  catalogItemId: string;
  locationId: string;
  /** Quantity to ADD to the current on-hand (must be positive). */
  quantity: number;
  /** rpc_adjust_inventory reason code; defaults to 'other'. */
  reason?: string;
  notes?: string;
  /** Re-submit with this set to clear a soft `OVERRIDE_REASON_REQUIRED` guardrail. */
  overrideReason?: string;
}

export interface ReceiveStockResult {
  item_id: string;
  location_id: string;
  quantity_added: number;
  previous_qty: number;
  new_qty: number;
}

export async function receiveStock(
  inv: { from: (table: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any },
  params: ReceiveStockParams,
): Promise<ReceiveStockResult> {
  if (!(params.quantity > 0)) {
    throw AppError.badRequest('quantity must be greater than 0');
  }

  // Current on-hand at this location (0 if no balance row yet).
  const { data: balanceRows, error: balError } = await inv
    .from('stock_balances')
    .select('qty_on_hand')
    .eq('catalog_item_id', params.catalogItemId)
    .eq('location_id', params.locationId)
    .limit(1);

  if (balError) {
    throw AppError.internal(`Failed to check stock balance: ${balError.message}`);
  }

  const previousQty =
    balanceRows && balanceRows.length > 0 ? Number(balanceRows[0].qty_on_hand) || 0 : 0;
  const newQty = previousQty + params.quantity;

  // Absolute set (previous + added) — guardrails enforced inside the RPC.
  const { data, error } = await inv.rpc('rpc_adjust_inventory', {
    p_catalog_item_id: params.catalogItemId,
    p_location_id: params.locationId,
    p_new_qty: newQty,
    p_reason: params.reason || 'other',
    p_notes: params.notes || `Mobile scan receive: +${params.quantity}`,
    p_override_reason: params.overrideReason ?? null,
  });

  if (error) {
    throw AppError.internal(`Failed to adjust inventory: ${error.message}`);
  }

  // rpc_adjust_inventory returns a guardrail envelope on soft/hard blocks.
  if (data && typeof data === 'object' && (data as { success?: boolean }).success === false) {
    const guardrail = (data as { error?: { message?: string } }).error;
    throw AppError.badRequest(guardrail?.message || 'Adjustment blocked by guardrail policy');
  }

  return {
    item_id: params.catalogItemId,
    location_id: params.locationId,
    quantity_added: params.quantity,
    previous_qty: previousQty,
    new_qty: newQty,
  };
}
