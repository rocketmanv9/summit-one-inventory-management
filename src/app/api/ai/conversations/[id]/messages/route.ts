/**
 * AI Conversation Messages — Paginated list
 *
 * GET /api/ai/conversations/[id]/messages — Paginated message list
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractConversationId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  // /api/ai/conversations/[id]/messages → id is at index -2
  const messagesIdx = segments.indexOf('messages');
  const id = messagesIdx > 0 ? segments[messagesIdx - 1] : undefined;
  if (!id) throw AppError.badRequest('Conversation ID required');
  return id;
}

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const conversationId = extractConversationId(req);
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId,
  });
  const inv = (supabase as any).schema('inventory');

  // Verify user owns the conversation
  const { data: conv, error: convErr } = await inv
    .from('ai_conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('user_id', session.userId)
    .single();

  if (convErr || !conv) {
    throw AppError.notFound('Conversation not found');
  }

  const { data, error, count } = await inv
    .from('ai_messages')
    .select('*', { count: 'exact' })
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    log.error('ai_messages.paginated failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({
    data: data || [],
    pagination: {
      total: count || 0,
      limit,
      offset,
      hasMore: (count || 0) > offset + limit,
    },
  });
}, { serviceName: SERVICE_NAME });
