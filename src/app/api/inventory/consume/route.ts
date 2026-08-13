import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * POST /api/inventory/consume
 *
 * "I took something" — the <10s field consumption flow. A worker records that
 * they took N of an item from a location (optionally for a job); the RPC writes
 * an `issued` stock movement (reason `job_consumption`/`consumption`),
 * decrements on-hand via the movement trigger, draws down the job's active
 * fungible reservation(s) at that location, and feeds `mv_item_velocity` —
 * this is the event source the demand engine (days-of-stock, reorder urgency)
 * runs on.
 *
 * Mirrors `adjustments/route.ts`: session write route, the movement trigger
 * owns emission (`emissionOwner: 'trigger'`), and the RPC's guardrail envelope
 * (`{success:false, error:{...}}` — here INSUFFICIENT_STOCK) surfaces as a 400
 * with the human message. Idempotent end-to-end: the chassis Idempotency-Key is
 * passed through as the movement's `last_event_id`, so a replayed request is a
 * ledger no-op.
 *
 * `job_ref` carries the same jsonb shape reservations use
 * (`{source:'operations', job_id, job_name}`), so consumption and holds agree
 * on attribution.
 */
const JobRefSchema = z.object({
  source: z.string().max(50).default('operations'),
  job_id: z.string().uuid(),
  job_name: z.string().max(300).nullable().optional(),
});

const ConsumeSchema = z.object({
  catalog_item_id: z.string().uuid(),
  location_id: z.string().uuid(),
  qty: z.number().positive(),
  job_ref: JobRefSchema.nullable().optional(),
  notes: z.string().max(500).optional(),
});

type ConsumeRpcResult = {
  success: boolean;
  replay?: boolean;
  movement_id?: string;
  quantity?: number;
  previous_qty?: number;
  new_qty?: number;
  reason?: string;
  job_id?: string | null;
  reservation_drawdown?: {
    drawn_qty: number;
    reservations_touched: number;
    reservations_closed: number;
  };
  error?: { code?: string; message?: string; action?: string };
};

export const POST = createSessionWriteRoute(
  async ({ req, ctx, log, supabase, idempotencyKey }) => {
    const body = ConsumeSchema.parse(await req.json());
    const inv = (supabase as any).schema('inventory');

    const { data, error } = await inv.rpc('rpc_consume_stock', {
      p_catalog_item_id: body.catalog_item_id,
      p_location_id: body.location_id,
      p_qty: body.qty,
      p_job_ref: body.job_ref ?? null,
      p_notes: body.notes || null,
      p_idempotency_key: idempotencyKey,
      // Explicit tenant/user: service-role RPC calls must not depend on the
      // pooled-connection GUC (20260807000001 precedent).
      p_tenant_id: ctx.tenantId,
      p_user_id: ctx.userId ?? null,
    });
    if (error) {
      log.error('consume.failed', { error: error.message });
      throw AppError.internal(`Failed to record consumption: ${error.message}`);
    }

    const result = (data ?? {}) as ConsumeRpcResult;
    if (result.success === false) {
      // Guardrail envelope (INSUFFICIENT_STOCK) — surface the human message.
      throw AppError.badRequest(
        result.error?.message || 'Consumption blocked by guardrail policy',
      );
    }

    log.info('consume.completed', {
      itemId: body.catalog_item_id,
      locationId: body.location_id,
      qty: body.qty,
      jobId: body.job_ref?.job_id ?? null,
      replay: result.replay === true,
      drawnFromReservations: result.reservation_drawdown?.drawn_qty ?? 0,
    });

    return {
      data: {
        item_id: body.catalog_item_id,
        location_id: body.location_id,
        quantity: body.qty,
        previous_qty: result.previous_qty ?? null,
        new_qty: result.new_qty ?? null,
        movement_id: result.movement_id ?? null,
        replay: result.replay === true,
        reservation_drawdown: result.reservation_drawdown ?? {
          drawn_qty: 0,
          reservations_touched: 0,
          reservations_closed: 0,
        },
      },
      status: 200,
      events: [],
    };
  },
  {
    bodySchema: 'raw',
    emissionOwner: 'trigger',
    serviceName: SERVICE_NAME,
    scope: 'POST /api/inventory/consume',
  },
);
