import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { idFromPath } from '@/lib/api/typed-crud';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// null clears the per-position cap (falls back to tenant global).
const Schema = z.object({ spending_limit: z.number().nonnegative().nullable() });

/** PATCH /api/hr/positions/[id] — set this position's default PO spending cap (admin). */
export const PATCH = createSessionWriteRoute(async ({ req, body, ctx, supabase, idempotencyKey }) => {
  const id = idFromPath(req, 'positions');
  const tenantId = ctx.tenantId!;

  const { data: me } = await supabase.from('local_users').select('role').eq('user_id', ctx.userId).eq('tenant_id', tenantId).maybeSingle();
  if (me?.role !== 'admin') throw AppError.forbidden('Admin role required');

  const { data, error } = await supabase
    .from('positions')
    .update({ spending_limit: body.spending_limit, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('id, title, spending_limit')
    .maybeSingle();
  if (error) throw AppError.internal(error.message);
  if (!data) throw AppError.notFound('Position not found');

  return {
    data,
    status: 200,
    events: [{
      event_name: 'position.limit_updated',
      payload: { tenant_id: tenantId, position_id: id, spending_limit: body.spending_limit },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: Schema, serviceName: SERVICE_NAME, scope: 'PATCH /api/hr/positions/[id]' });
