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

// Returns the tenant's FULL people roster (HR-synced employees + app users)
// with each person's qualification status, so the settings page renders one
// toggle list. HR people without an app account are keyed by hr_person_id —
// qualification rows accept either id, and assignment falls back to the HR
// email for notifications.
export const GET = createSessionReadRoute(async ({ session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const [usersRes, peopleRes, qualsRes] = await Promise.all([
    (supabase as any)
      .from('local_users')
      .select('user_id, email, name, role')
      .eq('tenant_id', session.tenantId)
      .order('name')
      .limit(500),
    (supabase as any)
      .from('hr_people')
      .select('hr_person_id, profile_id, first_name, last_name, preferred_name, work_email, personal_email, is_active')
      .eq('tenant_id', session.tenantId)
      .eq('is_active', true)
      .limit(1000),
    (supabase as any)
      .schema('inventory')
      .from('cycle_count_qualified_users')
      .select('id, user_id, active, notes')
      .eq('tenant_id', session.tenantId)
      .limit(1000),
  ]);

  if (usersRes.error) {
    log.error('count_qualified.users_failed', { error: usersRes.error.message });
    throw AppError.internal(usersRes.error.message);
  }
  if (peopleRes.error) {
    log.error('count_qualified.people_failed', { error: peopleRes.error.message });
    throw AppError.internal(peopleRes.error.message);
  }
  if (qualsRes.error) {
    log.error('count_qualified.list_failed', { error: qualsRes.error.message });
    throw AppError.internal(qualsRes.error.message);
  }

  const qualByUser = new Map<string, any>(
    (qualsRes.data || []).map((q: any) => [q.user_id, q])
  );
  const localById = new Map<string, any>(
    (usersRes.data || []).map((u: any) => [u.user_id, u])
  );
  const localByEmail = new Map<string, any>(
    (usersRes.data || [])
      .filter((u: any) => u.email)
      .map((u: any) => [String(u.email).toLowerCase(), u])
  );

  const coveredLocalIds = new Set<string>();
  const data = (peopleRes.data || []).map((p: any) => {
    const email = p.work_email || p.personal_email || null;
    // Prefer the app account identity when the person has one, so existing
    // qualification rows and assignment/notification flows keep working.
    const local =
      (p.profile_id && localById.get(p.profile_id)) ||
      (email && localByEmail.get(String(email).toLowerCase())) ||
      null;
    if (local) coveredLocalIds.add(local.user_id);
    const userId = local?.user_id || p.hr_person_id;
    const name =
      p.preferred_name ||
      [p.first_name, p.last_name].filter(Boolean).join(' ') ||
      local?.name ||
      email;
    return {
      user_id: userId,
      name,
      email: local?.email || email,
      role: local?.role ?? null,
      has_app_account: !!local,
      qualified: qualByUser.get(userId)?.active === true,
      notes: qualByUser.get(userId)?.notes ?? null,
    };
  });

  // Keep app users that aren't in the HR roster (developers, admins, etc.).
  for (const u of usersRes.data || []) {
    if (coveredLocalIds.has(u.user_id)) continue;
    data.push({
      user_id: u.user_id,
      name: u.name,
      email: u.email,
      role: u.role,
      has_app_account: true,
      qualified: qualByUser.get(u.user_id)?.active === true,
      notes: qualByUser.get(u.user_id)?.notes ?? null,
    });
  }

  data.sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || '')));

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
