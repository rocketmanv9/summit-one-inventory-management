import { z } from 'zod';
import { randomBytes } from 'crypto';
import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CreateSessionSchema = z.object({
  location_id: z.string().uuid(),
  ttl_minutes: z.number().int().min(60).max(1440).default(240),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = CreateSessionSchema.parse(await req.json());
  const inv = (supabase as any).schema('inventory');

  // Verify location exists and is active
  const { data: location, error: locError } = await inv
    .from('locations')
    .select('id, name, is_active')
    .eq('id', body.location_id)
    .single();

  if (locError || !location) throw AppError.notFound('Location not found');
  if (!location.is_active) throw AppError.badRequest('Location is not active');

  // Generate secure token
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + body.ttl_minutes * 60 * 1000).toISOString();

  // Upsert session
  const { data, error } = await inv
    .from('mobile_onboarding_sessions')
    .upsert({
      tenant_id: ctx.tenantId,
      token,
      location_id: body.location_id,
      created_by_user_id: ctx.userId,
      status: 'in_progress',
      ttl_minutes: body.ttl_minutes,
      expires_at: expiresAt,
      last_event_id: idempotencyKey,
    }, { onConflict: 'token' })
    .select()
    .single();

  if (error) throw AppError.internal(error.message);

  log.info('onboarding_session.created', { sessionId: data.id, locationId: body.location_id });

  return {
    data: {
      session_id: data.id,
      token: data.token,
      url: `/m/onboard/${data.token}${process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? `?x-vercel-protection-bypass=${process.env.VERCEL_AUTOMATION_BYPASS_SECRET}` : ''}`,
      expires_at: data.expires_at,
    },
    status: 201,
    events: [{
      event_name: 'onboarding_session.created',
      payload: { session_id: data.id, location_id: body.location_id },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/inventory/onboarding' });

export const GET = createSessionReadRoute(async ({ session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv
    .from('mobile_onboarding_sessions')
    .select('id, token, location_id, created_by_user_id, status, ttl_minutes, expires_at, revoked_at, created_at')
    .is('revoked_at', null)
    .eq('status', 'in_progress')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw AppError.internal(error.message);

  // Fetch location names
  const locationIds = [...new Set((data || []).map((s: any) => s.location_id))];
  let locationMap = new Map<string, string>();
  if (locationIds.length > 0) {
    const { data: locations } = await inv
      .from('locations')
      .select('id, name')
      .in('id', locationIds);
    locationMap = new Map((locations || []).map((l: any) => [l.id, l.name]));
  }

  const enriched = (data || []).map((s: any) => ({
    ...s,
    location_name: locationMap.get(s.location_id) || 'Unknown',
  }));

  return Response.json({ data: enriched });
}, { serviceName: SERVICE_NAME });
