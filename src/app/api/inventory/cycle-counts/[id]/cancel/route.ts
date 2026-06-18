import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

function getCycleCountId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const idx = segments.indexOf('cycle-counts');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Missing cycle count ID');
  return id;
}

// Void a cycle count without touching stock. Only valid from a non-terminal
// status (draft / scheduled / in_progress / under_review) — the RPC enforces
// that and is idempotent if the count is already cancelled.
export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const cycleCountId = getCycleCountId(req);
  const body = CancelSchema.parse(await req.json().catch(() => ({})));

  const inv = (supabase as any).schema('inventory');

  const { error } = await inv.rpc('rpc_inv_cycle_count_cancel', {
    p_tenant_id: ctx.tenantId,
    p_cycle_count_id: cycleCountId,
    p_reason: body.reason ?? null,
    p_cancelled_by_user_id: ctx.userId,
    p_last_event_id: idempotencyKey,
  });

  if (error) {
    log.error('cycle_count.cancel_failed', { cycleCountId, error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('cycle_count.cancelled', { cycleCountId });

  return {
    data: { id: cycleCountId, status: 'cancelled' },
    status: 200,
    events: [],
  };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/cycle-counts/:id/cancel' });
