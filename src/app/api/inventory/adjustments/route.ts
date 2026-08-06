import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// The reason codes rpc_adjust_inventory accepts (same allow-list the AI bridge's
// adjust_stock / adjust_stock_delta actions enforce). Anything else falls back
// to 'other'.
const VALID_ADJUST_REASONS = ['count_variance', 'damage', 'theft', 'expiration', 'other'] as const;

/**
 * POST /api/inventory/adjustments
 *
 * Session-authenticated stock adjustment for the true mobile app's "Adjust
 * stock" quick action. Mirrors the AI write bridge's adjust_stock (mode 'set',
 * exact on-hand) and adjust_stock_delta (mode 'delta', +/- on-hand) actions:
 * both resolve the current balance and call the same `rpc_adjust_inventory` RPC
 * with an absolute target quantity. The mobile app has no direct Supabase
 * access, so this thin route is how it reaches that RPC.
 *
 * rpc_adjust_inventory writes the stock_movements ledger and its outbox event
 * trigger owns emission (emissionOwner: 'trigger'), so — exactly like
 * scan/receive and transfers — this handler returns no app-level events. It
 * returns previous/new qty so the sheet can show old → new.
 */
const AdjustSchema = z
  .object({
    catalog_item_id: z.string().uuid(),
    location_id: z.string().uuid(),
    mode: z.enum(['set', 'delta']),
    // 'set' uses new_qty (>= 0); 'delta' uses delta (non-zero, may be negative).
    new_qty: z.number().nonnegative().optional(),
    delta: z.number().optional(),
    reason: z.string().optional(),
    notes: z.string().max(500).optional(),
    override_reason: z.string().max(500).optional(),
  })
  .refine((b) => (b.mode === 'set' ? b.new_qty != null : b.delta != null && b.delta !== 0), {
    message: 'set mode requires new_qty; delta mode requires a non-zero delta',
  });

export const POST = createSessionWriteRoute(
  async ({ req, log, supabase }) => {
    const body = AdjustSchema.parse(await req.json());
    const inv = (supabase as any).schema('inventory');

    // Current on-hand at this location (0 if no balance row yet).
    const { data: balanceRows, error: balError } = await inv
      .from('stock_balances')
      .select('qty_on_hand')
      .eq('catalog_item_id', body.catalog_item_id)
      .eq('location_id', body.location_id)
      .limit(1);
    if (balError) {
      throw AppError.internal(`Failed to check stock balance: ${balError.message}`);
    }
    const previousQty =
      balanceRows && balanceRows.length > 0 ? Number(balanceRows[0].qty_on_hand) || 0 : 0;

    // Both modes resolve to an absolute target for rpc_adjust_inventory; delta
    // clamps at zero so a large negative delta can't drive on-hand below zero
    // (matches the AI bridge's adjust_stock_delta).
    const newQty =
      body.mode === 'set'
        ? (body.new_qty as number)
        : Math.max(0, previousQty + (body.delta as number));

    const reason = VALID_ADJUST_REASONS.includes(body.reason as any) ? body.reason : 'other';
    const defaultNote =
      body.mode === 'set'
        ? `Set via mobile (was ${previousQty})`
        : `${(body.delta as number) > 0 ? '+' : ''}${body.delta} via mobile`;

    const { data, error } = await inv.rpc('rpc_adjust_inventory', {
      p_catalog_item_id: body.catalog_item_id,
      p_location_id: body.location_id,
      p_new_qty: newQty,
      p_reason: reason,
      p_notes: body.notes || defaultNote,
      p_override_reason: body.override_reason ?? null,
    });
    if (error) {
      log.error('adjustment.failed', { error: error.message });
      throw AppError.internal(`Failed to adjust inventory: ${error.message}`);
    }

    // rpc_adjust_inventory returns a guardrail envelope on soft/hard blocks.
    if (data && typeof data === 'object' && (data as { success?: boolean }).success === false) {
      const guardrail = (data as { error?: { message?: string } }).error;
      throw AppError.badRequest(guardrail?.message || 'Adjustment blocked by guardrail policy');
    }

    log.info('adjustment.completed', {
      itemId: body.catalog_item_id,
      locationId: body.location_id,
      mode: body.mode,
      previousQty,
      newQty,
    });

    return {
      data: {
        item_id: body.catalog_item_id,
        location_id: body.location_id,
        previous_qty: previousQty,
        new_qty: newQty,
      },
      status: 200,
      events: [],
    };
  },
  {
    bodySchema: 'raw',
    emissionOwner: 'trigger',
    serviceName: SERVICE_NAME,
    scope: 'POST /api/inventory/adjustments',
  },
);
