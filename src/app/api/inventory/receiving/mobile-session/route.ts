/**
 * Mobile receiving sessions — tokenized, revocable phone access for receiving
 * deliveries against open POs. Mirrors the cycle-count mobile-session route,
 * except a receiving session is TENANT-WIDE (not tied to one PO) so the yard
 * phone can receive whichever truck shows up.
 *
 * POST   — mint a new session token (returns the /m/receive/<token> URL)
 * GET    — list active (non-revoked, non-expired) sessions
 * DELETE — revoke a session (?session_id=<uuid>)
 */

import { z } from 'zod';
import { randomBytes } from 'crypto';
import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CreateSessionSchema = z.object({
  // Default 12h — a receiving session typically covers a working day of deliveries.
  ttl_minutes: z.number().int().min(60).max(1440).default(720),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const session = { tenantId: ctx.tenantId, userId: ctx.userId };
  const body = CreateSessionSchema.parse(await req.json());

  // Generate secure token
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + body.ttl_minutes * 60 * 1000).toISOString();

  const sc = (supabase as any).schema('supply_chain');
  const { data, error } = await sc
    .from('mobile_receiving_sessions')
    .upsert({
      tenant_id: session.tenantId,
      token,
      created_by_user_id: session.userId,
      ttl_minutes: body.ttl_minutes,
      expires_at: expiresAt,
      last_event_id: idempotencyKey,
    }, { onConflict: 'token' })
    .select()
    .single();

  if (error) throw AppError.internal(error.message);

  log.info('mobile_receiving_session.created', { sessionId: data.id });

  return {
    data: {
      session_id: data.id,
      token: data.token,
      // x-vercel-set-bypass-cookie=true tells Vercel's edge to set its OWN bypass
      // cookie on first load, so the browser carries it on subsequent /_next/static
      // chunk requests. Without it, the HTML loads but JS chunks are 401'd by
      // deployment protection and React never hydrates (page loads but is frozen).
      url: `/m/receive/${data.token}${process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? `?x-vercel-protection-bypass=${process.env.VERCEL_AUTOMATION_BYPASS_SECRET}&x-vercel-set-bypass-cookie=true` : ''}`,
      expires_at: data.expires_at,
    },
    status: 201,
    events: [{
      event_name: 'mobile_receiving_session.created',
      payload: { session_id: data.id, ttl_minutes: body.ttl_minutes },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/receiving/mobile-session' });

export const GET = createSessionReadRoute(async ({ session }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const sc = (supabase as any).schema('supply_chain');
  const { data, error } = await sc
    .from('mobile_receiving_sessions')
    .select('id, token, created_by_user_id, ttl_minutes, expires_at, revoked_at, last_used_at, created_at')
    .eq('tenant_id', session.tenantId!)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw AppError.internal(error.message);

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

export const DELETE = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId) throw AppError.badRequest('Missing session_id');

  const sc = (supabase as any).schema('supply_chain');
  const { data, error } = await sc
    .from('mobile_receiving_sessions')
    .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .select()
    .single();

  if (error) throw AppError.internal(error.message);
  if (!data) throw AppError.notFound('Mobile receiving session not found');

  log.info('mobile_receiving_session.revoked', { sessionId });

  return {
    data: { revoked: true, session_id: sessionId },
    status: 200,
    events: [{
      event_name: 'mobile_receiving_session.revoked',
      payload: { session_id: sessionId },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'DELETE /api/inventory/receiving/mobile-session' });
