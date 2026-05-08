/**
 * AI Conversations — List + Create
 *
 * GET  /api/ai/conversations — List conversations for current user (limit 50)
 * POST /api/ai/conversations — Create a new conversation
 */

import { z } from 'zod';
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── GET — List conversations ─────────────────────────────────────────────────

export const GET = createSessionReadRoute(async ({ req, session, log, supabase }) => {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
  const surface = url.searchParams.get('surface');

  const inv = (supabase as any).schema('inventory');
  let query = inv
    .from('ai_conversations')
    .select('id, title, surface, model, total_tokens, created_at, updated_at')
    .eq('user_id', session.userId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (surface) {
    query = query.eq('surface', surface);
  }

  const { data, error } = await query;

  if (error) {
    log.error('ai_conversations.list failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data: data || [] });
}, { serviceName: SERVICE_NAME });

// ── POST — Create conversation ───────────────────────────────────────────────

const CreateConversationSchema = z.object({
  title: z.string().optional(),
  surface: z.enum(['corner', 'panel', 'workspace']).default('corner'),
  model: z.string().default('gpt-4.1'),
});

export const POST = createSessionWriteRoute(async ({ req, session, log, supabase, idempotencyKey }) => {
  const body = CreateConversationSchema.parse(await req.json());

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv
    .from('ai_conversations')
    .upsert({
      tenant_id: session.tenantId,
      user_id: session.userId,
      title: body.title || null,
      surface: body.surface,
      model: body.model,
    })
    .select()
    .single();

  if (error) {
    log.error('ai_conversation.create failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('ai_conversation.created', { conversationId: data.id });

  return {
    data,
    status: 201,
    events: [{
      event_name: 'ai_conversation.created',
      payload: { conversation_id: data.id, surface: body.surface },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/ai/conversations' });
