import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const parts = new URL(req.url).pathname.split('/').filter(Boolean);
  const id = parts[parts.length - 1];
  if (!id) throw AppError.badRequest('PO ID required');
  return id;
}

const DecisionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  reason: z.string().max(500).optional(),
});

/**
 * POST /api/inventory/purchasing/approvals/:id — the inbox verdict.
 *
 * approve → status 'approved' (+stamps, +approved_reason); the buyer sends it
 *           like any approved PO.
 * reject  → back to 'draft' with rejected_* stamped (buyer can fix + resubmit).
 *
 * Reasons both ways (sprint item 14): approve now captures the approver's own
 * words in approved_reason, the mirror of a reject's rejected_reason. The web
 * UI requires it; the API keeps `reason` OPTIONAL on approve so the mobile
 * approval runner (item 09) stays compatible until it catches up. FOLLOW-UP:
 * once mobile sends a reason on approve, make it required here too.
 */
export const POST = createSessionWriteRoute(async ({ ctx, req, supabase, idempotencyKey, log }) => {
  const tenantId = ctx.tenantId!;
  const userId = ctx.userId!;
  const poId = extractId(req);
  const body = DecisionSchema.parse(await req.json());

  const [{ data: me }, poRes] = await Promise.all([
    supabase.from('local_users').select('role').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle(),
    (supabase as any).schema('supply_chain')
      .from('purchase_orders')
      .select('id, po_number, status, created_by_user_id, approver_user_id')
      .eq('tenant_id', tenantId).eq('id', poId).maybeSingle(),
  ]);
  const po = poRes.data;
  if (poRes.error) throw AppError.internal(poRes.error.message);
  if (!po) throw AppError.notFound('PO not found');
  if (po.status !== 'awaiting_approval') {
    throw AppError.conflict(`This PO is no longer awaiting approval (status: ${po.status}).`);
  }

  const isAdmin = me?.role === 'admin';
  if (!isAdmin && po.approver_user_id !== userId) {
    throw AppError.forbidden('This PO is not routed to you for approval.');
  }
  if (po.created_by_user_id === userId) {
    throw AppError.forbidden('You can’t approve your own purchase order — it needs someone else’s sign-off.');
  }
  if (body.action === 'reject' && !body.reason?.trim()) {
    throw AppError.badRequest('Give the buyer a reason so they know what to fix.');
  }

  const sc = (supabase as any).schema('supply_chain');
  const updates = body.action === 'approve'
    ? {
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by_user_id: userId,
        // The approver's own words (web UI requires it; API optional for mobile
        // compat). Null when omitted — never a fabricated reason.
        approved_reason: body.reason?.trim() || null,
        last_event_id: idempotencyKey,
      }
    : {
        status: 'draft',
        rejected_at: new Date().toISOString(),
        rejected_by_user_id: userId,
        rejected_reason: body.reason!.trim(),
        approver_user_id: null,
        approval_reason: null,
        last_event_id: idempotencyKey,
      };

  const { data, error } = await sc
    .from('purchase_orders')
    .update(updates)
    .eq('tenant_id', tenantId)
    .eq('id', poId)
    .eq('status', 'awaiting_approval') // races lose cleanly
    .select('id, po_number, status')
    .maybeSingle();
  if (error) throw AppError.internal(error.message);
  if (!data) throw AppError.conflict('Someone else just decided this PO — refresh the inbox.');

  log.info('po_approval.decided', { po_id: poId, action: body.action, by: userId });

  return { data, status: 200, events: [] };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/purchasing/approvals/[id]' });
