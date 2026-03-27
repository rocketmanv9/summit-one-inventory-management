/**
 * AI Chat API Route
 * Server-side OpenAI integration for the inventory assistant.
 *
 * - Auth handled by chassis route factory
 * - Returns { fallbackToKeyword: true } if no API key configured
 * - Calls OpenAI with function tools and returns structured JSON
 * - Falls back gracefully on any error
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { INVENTORY_TOOLS } from '@/lib/ai/tools';
import { buildSystemPrompt } from '@/lib/ai/system-prompt';
import OpenAI from 'openai';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';
const MAX_MESSAGES = 20;

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

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: openaiMessages,
      tools: INVENTORY_TOOLS,
      tool_choice: 'auto',
      temperature: 0.3,
      max_tokens: 512,
    });

    const choice = completion.choices[0];
    if (!choice) {
      return fallbackResponse();
    }

    const message = choice.message;

    // Check for tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0];

      // Only handle function-type tool calls
      if (toolCall.type !== 'function') {
        return fallbackResponse();
      }

      const functionName = toolCall.function.name;

      const params: Record<string, string> = {};
      try {
        const parsed = JSON.parse(toolCall.function.arguments || '{}');
        // Flatten all values to strings for consistency with the chat system
        for (const [key, value] of Object.entries(parsed)) {
          if (value !== null && value !== undefined && value !== '') {
            params[key] = String(value);
          }
        }
      } catch {
        // If argument parsing fails, use empty params
      }

      return Response.json({
        type: 'tool_use',
        intent: functionName,
        params,
      });
    }

    // Text response (no tool call)
    if (message.content) {
      return Response.json({
        type: 'text',
        content: message.content,
      });
    }

    return fallbackResponse();
  } catch (err: any) {
    log.error('[AI Chat] Error:', err.message || err);
    return fallbackResponse();
  }
}, { serviceName: SERVICE_NAME });
