import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('transfers') + 1];
  if (!id) throw AppError.badRequest('Missing transfer id');
  return id;
}

const BodySchema = z.object({ override_reason: z.string().nullable().optional() });

// Fully receive a transfer (moves the stock via rpc_inv_transfer_execute). This
// is the same RPC the web app's "Full Receive" calls through the browser client;
// this thin session route exists so the mobile task screen can drive it. The RPC
// records received_by_user_id = ctx.userId and flips status → completed, which
// fires the transfers_autocomplete_tasks trigger to close every assignee's task
// (first completer wins). The guardrails RPC returns a jsonb result object; a
// blocked receive (negative inventory) comes back as { success:false, error }.
export const POST = createSessionWriteRoute(async ({ ctx, req, body, log, supabase, idempotencyKey }) => {
  const transferId = extractId(req);
  const { override_reason } = body as z.infer<typeof BodySchema>;
  const inv = (supabase as any).schema('inventory');

  const { data, error } = await inv.rpc('rpc_inv_transfer_execute', {
    p_tenant_id: ctx.tenantId,
    p_transfer_id: transferId,
    p_received_by_user_id: ctx.userId,
    p_last_event_id: idempotencyKey,
    p_override_reason: override_reason ?? null,
  });
  if (error) { log.error('transfer.receive_failed', { error: error.message }); throw AppError.internal(error.message); }

  // Guardrails RPC returns a structured object; surface a blocked receive as 400.
  if (data && typeof data === 'object' && data.success === false) {
    const msg = data.error?.message || 'Transfer would drive inventory negative.';
    throw AppError.badRequest(msg);
  }

  log.info('transfer.received', { transferId });

  // The RPC publishes transfer.completed; the auto-complete trigger emits the
  // task.completed events. This route owns no additional emission.
  return { data: { id: transferId, result: data }, status: 200, events: [] };
}, { bodySchema: BodySchema, emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/transfers/[id]/receive' });
