import { z } from 'zod';
import { randomBytes } from 'crypto';
import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CreateSessionSchema = z.object({
  ttl_minutes: z.number().int().min(60).max(1440).default(240),
});

function getCycleCountId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  // /api/inventory/cycle-counts/[id]/mobile-session
  const idx = segments.indexOf('cycle-counts');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Missing cycle count ID');
  return id;
}

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const session = { tenantId: ctx.tenantId, userId: ctx.userId };
  const body = CreateSessionSchema.parse(await req.json());
  const cycleCountId = getCycleCountId(req);

  // Verify cycle count exists and is in_progress
  const inv = (supabase as any).schema('inventory');
  const { data: cc, error: ccError } = await inv
    .from('cycle_counts')
    .select('id, status, count_number')
    .eq('id', cycleCountId)
    .single();

  if (ccError || !cc) throw AppError.notFound('Cycle count not found');
  if (cc.status !== 'in_progress') {
    throw AppError.badRequest(`Cycle count is ${cc.status}, must be in_progress`);
  }

  // Generate secure token
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + body.ttl_minutes * 60 * 1000).toISOString();

  // Insert session
  const { data, error } = await inv
    .from('mobile_count_sessions')
    .upsert({
      tenant_id: session.tenantId,
      token,
      cycle_count_id: cycleCountId,
      created_by_user_id: session.userId,
      ttl_minutes: body.ttl_minutes,
      expires_at: expiresAt,
      last_event_id: idempotencyKey,
    }, { onConflict: 'token' })
    .select()
    .single();

  if (error) throw AppError.internal(error.message);

  log.info('mobile_count_session.created', { sessionId: data.id, cycleCountId });

  return {
    data: {
      session_id: data.id,
      token: data.token,
      // x-vercel-set-bypass-cookie=true tells Vercel's edge to set its OWN bypass
      // cookie on first load, so the browser carries it on subsequent /_next/static
      // chunk requests. Without it, the HTML loads but JS chunks are 401'd by
      // deployment protection and React never hydrates (page loads but is frozen).
      url: `/m/count/${data.token}${process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? `?x-vercel-protection-bypass=${process.env.VERCEL_AUTOMATION_BYPASS_SECRET}&x-vercel-set-bypass-cookie=true` : ''}`,
      expires_at: data.expires_at,
    },
    status: 201,
    events: [{
      event_name: 'mobile_count_session.created',
      payload: { session_id: data.id, cycle_count_id: cycleCountId },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/cycle-counts/:id/mobile-session' });

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const cycleCountId = getCycleCountId(req);

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv
    .from('mobile_count_sessions')
    .select('id, token, cycle_count_id, created_by_user_id, ttl_minutes, expires_at, revoked_at, last_used_at, created_at')
    .eq('cycle_count_id', cycleCountId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw AppError.internal(error.message);

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });
