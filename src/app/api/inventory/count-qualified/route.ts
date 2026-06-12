import { z } from 'zod';
import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const UpsertQualificationSchema = z.object({
  user_id: z.string().uuid(),
  active: z.boolean(),
  notes: z.string().nullable().optional(),
});

// Returns the tenant's user roster with each user's qualification status,
// so the settings page renders one toggle list instead of two fetches.
export const GET = createSessionReadRoute(async ({ session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const [usersRes, qualsRes] = await Promise.all([
    (supabase as any)
      .from('local_users')
      .select('user_id, email, name, role')
      .eq('tenant_id', session.tenantId)
      .order('name')
      .limit(500),
    (supabase as any)
      .schema('inventory')
      .from('cycle_count_qualified_users')
      .select('id, user_id, active, notes')
      .eq('tenant_id', session.tenantId)
      .limit(500),
  ]);

  if (usersRes.error) {
    log.error('count_qualified.users_failed', { error: usersRes.error.message });
    throw AppError.internal(usersRes.error.message);
  }
  if (qualsRes.error) {
    log.error('count_qualified.list_failed', { error: qualsRes.error.message });
    throw AppError.internal(qualsRes.error.message);
  }

  const qualByUser = new Map<string, any>(
    (qualsRes.data || []).map((q: any) => [q.user_id, q])
  );

  const data = (usersRes.data || []).map((u: any) => ({
    user_id: u.user_id,
    name: u.name,
    email: u.email,
    role: u.role,
    qualified: qualByUser.get(u.user_id)?.active === true,
    notes: qualByUser.get(u.user_id)?.notes ?? null,
  }));

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const { data: me } = await (supabase as any)
    .from('local_users')
    .select('role')
    .eq('user_id', ctx.userId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (me?.role !== 'admin') {
    throw AppError.forbidden('Only admins can manage cycle count qualifications');
  }

  const body = UpsertQualificationSchema.parse(await req.json());

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv
    .from('cycle_count_qualified_users')
    .upsert({
      tenant_id: ctx.tenantId,
      user_id: body.user_id,
      active: body.active,
      notes: body.notes ?? null,
      last_event_id: idempotencyKey,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,user_id' })
    .select()
    .single();

  if (error) {
    log.error('count_qualified.upsert_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('count_qualified.updated', { userId: body.user_id, active: body.active });

  return {
    data,
    status: 200,
    events: [{
      event_name: 'cycle_count_qualification.updated',
      payload: { user_id: body.user_id, active: body.active },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/count-qualified' });
