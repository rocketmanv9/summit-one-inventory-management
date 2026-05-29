import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function getCycleCountId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const idx = segments.indexOf('cycle-counts');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Missing cycle count ID');
  return id;
}

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const cycleCountId = getCycleCountId(req);
  const inv = (supabase as any).schema('inventory');

  // The desktop action is "Approve & Post to Inventory": approving must also
  // post the counted variances to stock. rpc_inv_cycle_count_approve only flips
  // status to 'approved' — on its own nothing ever reaches stock_movements /
  // stock_balances. We approve (if still pending) then post.
  const { data: current, error: readError } = await inv
    .from('cycle_counts')
    .select('status')
    .eq('id', cycleCountId)
    .single();

  if (readError || !current) {
    throw AppError.notFound('Cycle count not found');
  }

  // Idempotency/retry-safe: only approve when still pending; posting below is
  // a no-op if the count was already posted.
  if (current.status === 'under_review' || current.status === 'pending_approval') {
    const { error: approveError } = await inv.rpc('rpc_inv_cycle_count_approve', {
      p_tenant_id: ctx.tenantId,
      p_cycle_count_id: cycleCountId,
      p_approved_by_user_id: ctx.userId,
      p_last_event_id: idempotencyKey,
    });

    if (approveError) {
      log.error('cycle_count.approve_failed', { error: approveError.message });
      throw AppError.internal(approveError.message);
    }
  }

  // Post adjustments → creates stock_movements (the balance trigger applies them)
  // and flips status to 'posted'. Idempotent: returns early if already posted.
  const { data: postResult, error: postError } = await inv.rpc('post_cycle_count_adjustments', {
    p_cycle_count_id: cycleCountId,
    p_tenant_id: ctx.tenantId,
    p_posted_by_user_id: ctx.userId,
  });

  if (postError) {
    log.error('cycle_count.post_failed', { error: postError.message });
    throw AppError.internal(postError.message);
  }

  log.info('cycle_count.approved_and_posted', {
    cycleCountId,
    adjustmentsCreated: postResult?.adjustments_created ?? 0,
  });

  return {
    data: postResult || { cycle_count_id: cycleCountId },
    status: 200,
    events: [],
  };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/cycle-counts/:id/approve' });
