/**
 * AI Chat API Route
 * Server-side OpenAI integration for the inventory assistant.
 *
 * - Auth handled by chassis route factory
 * - Returns { fallbackToKeyword: true } if no API key configured
 * - Calls OpenAI with function tools and returns structured JSON
 * - Server-side tools (query_*, create_dashboard, workflow_*) are executed
 *   here and their results fed back to OpenAI for natural language summary
 * - Falls back gracefully on any error
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { INVENTORY_TOOLS } from '@/lib/ai/tools';
import { buildSystemPrompt } from '@/lib/ai/system-prompt';
import { isServerTool, executeServerTool, type ServerToolContext } from '@/lib/ai/server-tools';
import OpenAI from 'openai';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';
const MAX_MESSAGES = 20;
const MAX_SERVER_TOOL_ROUNDS = 3;

function fallbackResponse() {
  return Response.json({ fallbackToKeyword: true });
}

export const POST = createSessionReadRoute(async ({ req, session, log }) => {
  // Check for API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return fallbackResponse();
  }

  try {
    const body = await req.json();
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = body.messages || [];

    if (messages.length === 0) {
      return fallbackResponse();
    }

    // Trim to last N messages
    const trimmed = messages.slice(-MAX_MESSAGES);

    // Build OpenAI messages
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: buildSystemPrompt() },
      ...trimmed.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    const openai = new OpenAI({ apiKey });

    // Build server tool context (lazy — only created if a server tool is called)
    let serverToolCtx: ServerToolContext | null = null;
    const getServerToolCtx = async (): Promise<ServerToolContext> => {
      if (!serverToolCtx) {
        const supabase = await createTenantServiceClient({
          url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
          serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          tenantId: session.tenantId,
        });

        // Derive base URL from request
        const url = new URL(req.url);
        const baseUrl = `${url.protocol}//${url.host}`;

        serverToolCtx = {
          supabase,
          tenantId: session.tenantId,
          userId: session.userId,
          cookieHeader: req.headers.get('cookie') || '',
          baseUrl,
        };
      }
      return serverToolCtx;
    };

    // ── Tool execution loop ──────────────────────────────────────────
    // OpenAI may pick a server tool. If so, execute it, feed the result
    // back as a tool response, and let OpenAI generate a NL summary.

    let lastDataDisplay: import('@/lib/ai/types').AiDataDisplay | null = null;

    for (let round = 0; round < MAX_SERVER_TOOL_ROUNDS; round++) {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: openaiMessages,
        tools: INVENTORY_TOOLS,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 1024,
      });

      const choice = completion.choices[0];
      if (!choice) {
        return fallbackResponse();
      }

      const message = choice.message;

      // ── No tool call → return text (possibly after a server tool round)
      if (!message.tool_calls || message.tool_calls.length === 0) {
        if (message.content) {
          // If we executed a server tool in a previous round, return data_result
          if (lastDataDisplay) {
            return Response.json({
              type: 'data_result',
              content: message.content,
              dataDisplay: lastDataDisplay,
            });
          }
          return Response.json({
            type: 'text',
            content: message.content,
          });
        }
        return fallbackResponse();
      }

      const toolCall = message.tool_calls[0];
      if (toolCall.type !== 'function') {
        return fallbackResponse();
      }

      const functionName = toolCall.function.name;

      // Parse tool arguments
      let params: Record<string, any> = {};
      try {
        params = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        // If argument parsing fails, use empty params
      }

      // ── Client-side tool → return for client execution
      if (!isServerTool(functionName)) {
        // Flatten all values to strings for consistency with the chat system
        const stringParams: Record<string, string> = {};
        for (const [key, value] of Object.entries(params)) {
          if (value !== null && value !== undefined && value !== '') {
            stringParams[key] = String(value);
          }
        }

        return Response.json({
          type: 'tool_use',
          intent: functionName,
          params: stringParams,
        });
      }

      // ── Server-side tool → execute and feed result back to OpenAI
      log.info(`[AI Chat] Executing server tool: ${functionName}`, { params });

      const ctx = await getServerToolCtx();
      const toolResult = await executeServerTool(functionName, params, ctx);

      // Store the data display for the final response
      lastDataDisplay = toolResult.dataDisplay;

      // Add the assistant's tool call message and the tool result to conversation
      openaiMessages.push({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: toolCall.id,
            type: 'function',
            function: {
              name: functionName,
              arguments: toolCall.function.arguments || '{}',
            },
          },
        ],
      });

      openaiMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult.text,
      });

      // Loop continues — OpenAI will now generate a NL summary
    }

    // If we exhausted rounds, return the last data display with the raw text
    if (lastDataDisplay) {
      return Response.json({
        type: 'data_result',
        content: 'Here are the results from your query.',
        dataDisplay: lastDataDisplay,
      });
    }

    return fallbackResponse();
  } catch (err: any) {
    log.error('[AI Chat] Error:', err.message || err);
    return fallbackResponse();
  }
}, { serviceName: SERVICE_NAME });
