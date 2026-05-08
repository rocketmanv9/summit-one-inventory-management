/**
 * AI Conversation — Get (with messages) + Delete
 *
 * GET    /api/ai/conversations/[id] — Fetch conversation with messages
 * DELETE /api/ai/conversations/[id] — Delete conversation and its messages
 */

import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  // /api/ai/conversations/[id] → last segment is the ID
  const id = segments[segments.length - 1];
  if (!id) throw AppError.badRequest('Conversation ID required');
  return id;
}

// ── GET — Fetch conversation with messages ───────────────────────────────────

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const id = extractId(req);
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId,
  });
  const inv = (supabase as any).schema('inventory');

  // Fetch conversation
  const { data: conversation, error: convError } = await inv
    .from('ai_conversations')
    .select('*')
    .eq('id', id)
    .eq('user_id', session.userId)
    .single();

  if (convError || !conversation) {
    throw AppError.notFound('Conversation not found');
  }

  // Fetch messages
  const { data: messages, error: msgError } = await inv
    .from('ai_messages')
    .select('*')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .limit(500);

  if (msgError) {
    log.error('ai_messages.list failed', { error: msgError.message });
    throw AppError.internal(msgError.message);
  }

  return Response.json({
    data: {
      ...conversation,
      messages: messages || [],
    },
  });
}, { serviceName: SERVICE_NAME });

// ── DELETE — Delete conversation (cascade deletes messages) ──────────────────

export const DELETE = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const id = extractId(req);
  const inv = (supabase as any).schema('inventory');

  // Verify ownership before deleting
  const { data: existing, error: checkErr } = await inv
    .from('ai_conversations')
    .select('id')
    .eq('id', id)
    .eq('user_id', ctx.userId)
    .single();

  if (checkErr || !existing) {
    throw AppError.notFound('Conversation not found');
  }

  const { error } = await inv
    .from('ai_conversations')
    .delete()
    .eq('id', id);

  if (error) {
    log.error('ai_conversation.delete failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('ai_conversation.deleted', { conversationId: id });

  return {
    data: { id, deleted: true },
    status: 200,
    events: [{
      event_name: 'ai_conversation.deleted',
      payload: { conversation_id: id },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'DELETE /api/ai/conversations/[id]' });
