import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { idFromPath } from '@/lib/api/typed-crud';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// A periodic (cumulative) budget. Sent as a whole object; `budget: null` clears it.
const BudgetSchema = z.object({
  amount: z.number().positive(),
  period: z.enum(['weekly', 'monthly', 'quarterly', 'annual']),
  anchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'anchor must be a YYYY-MM-DD date'),
});

// Any field may be sent. null clears it (position -> none, limit -> inherit, budget -> none).
const Schema = z.object({
  position_id: z.string().uuid().nullable().optional(),
  spending_limit: z.number().nonnegative().nullable().optional(),
  budget: BudgetSchema.nullable().optional(),
}).refine((b) => b.position_id !== undefined || b.spending_limit !== undefined || b.budget !== undefined, {
  message: 'Provide position_id, spending_limit, and/or budget',
});

/** PATCH /api/hr/users/[id] — assign a user's position and/or per-user PO cap (admin). */
export const PATCH = createSessionWriteRoute(async ({ req, body, ctx, supabase, idempotencyKey }) => {
  const userId = idFromPath(req, 'users');
  const tenantId = ctx.tenantId!;

  const { data: me } = await supabase.from('local_users').select('role').eq('user_id', ctx.userId).eq('tenant_id', tenantId).maybeSingle();
  if (me?.role !== 'admin') throw AppError.forbidden('Admin role required');

  // Validate the position belongs to this tenant before assigning.
  if (body.position_id) {
    const { data: pos } = await supabase.from('positions').select('id').eq('id', body.position_id).eq('tenant_id', tenantId).maybeSingle();
    if (!pos) throw AppError.badRequest('Position not found for this tenant');
  }

  const patch: Record<string, any> = { synced_at: new Date().toISOString() };
  if (body.position_id !== undefined) patch.position_id = body.position_id;
  if (body.spending_limit !== undefined) patch.spending_limit = body.spending_limit;
  if (body.budget !== undefined) {
    // Whole-object set, or null to clear. The DB CHECK requires all three together.
    patch.budget_amount = body.budget?.amount ?? null;
    patch.budget_period = body.budget?.period ?? null;
    patch.budget_anchor = body.budget?.anchor ?? null;
  }

  const { data, error } = await supabase
    .from('local_users')
    .update(patch)
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .select('user_id, name, position_id, spending_limit, budget_amount, budget_period, budget_anchor')
    .maybeSingle();
  if (error) throw AppError.internal(error.message);
  if (!data) throw AppError.notFound('User not found');

  return {
    data,
    status: 200,
    events: [{
      event_name: 'user.limit_updated',
      payload: {
        tenant_id: tenantId, user_id: userId, position_id: data.position_id,
        spending_limit: data.spending_limit, budget_amount: data.budget_amount,
        budget_period: data.budget_period, budget_anchor: data.budget_anchor,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: Schema, serviceName: SERVICE_NAME, scope: 'PATCH /api/hr/users/[id]' });
