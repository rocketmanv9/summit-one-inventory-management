/**
 * AI Chat API Route — Streaming
 *
 * Server-side OpenAI integration for the inventory assistant.
 * Returns SSE stream with events: delta, tool_call, data_result, done.
 *
 * - Auth handled by chassis route factory
 * - Returns { fallbackToKeyword: true } if no API key configured
 * - Persists messages to ai_conversations / ai_messages
 * - Rate limited (20 req/min via aiRateLimit)
 * - Server-side tools executed inline, results fed back to OpenAI
 * - Tool governance: admin-only tools filtered by user role
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { INVENTORY_TOOLS } from '@/lib/ai/tools';
import { buildSystemPrompt } from '@/lib/ai/system-prompt';
import { isServerTool, executeServerTool, type ServerToolContext } from '@/lib/ai/server-tools';
import { resolveUserRole, filterToolsForRole, canExecuteTool } from '@/lib/ai/tool-governance';
import { checkRateLimit, aiRateLimit } from '@/lib/rate-limit';
import { estimateCost } from '@/lib/ai/cost';
import { selectModel } from '@/lib/ai/model-router';
import { estimateConfidence } from '@/lib/ai/confidence';
import { getRelevantMemories, formatMemoriesForPrompt, extractMemories, storeMemories } from '@/lib/ai/memory';
import OpenAI from 'openai';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';
const MAX_MESSAGES = 40;
const MAX_SERVER_TOOL_ROUNDS = 5;

function fallbackResponse() {
  return Response.json({ fallbackToKeyword: true });
}

export const POST = createSessionReadRoute(async ({ req, session, log }) => {
  // ── Rate limit check ─────────────────────────────────────────────────
  const rateLimitResult = await checkRateLimit(req, aiRateLimit);
  if (!rateLimitResult.success) {
    return rateLimitResult.response!;
  }

  // Check for API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.warn('[AI Chat] No OPENAI_API_KEY configured — falling back to keyword mode');
    return fallbackResponse();
  }

  try {
    const body = await req.json();
    const messages: Array<{ role: 'user' | 'assistant'; content: string; imageUrl?: string }> = body.messages || [];
    const conversationId: string | undefined = body.conversation_id;
    const surface: string = body.surface || 'corner';

    if (messages.length === 0) {
      return fallbackResponse();
    }

    // Trim to last N messages
    const trimmed = messages.slice(-MAX_MESSAGES);
    const lastUserMessage = trimmed[trimmed.length - 1];

    // ── Build tenant-scoped Supabase client for persistence ─────────────
    const supabase = await createTenantServiceClient({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      tenantId: session.tenantId,
    });
    const inv = (supabase as any).schema('inventory');

    // ── Resolve user role for tool governance ────────────────────────────
    // local_users is in the public schema, so use `supabase` directly (not `inv`)
    const userRole = await resolveUserRole(supabase, session.userId, session.tenantId);
    const filteredTools = filterToolsForRole(INVENTORY_TOOLS, userRole);
    log.info(`[AI Chat] User role: ${userRole}, tools available: ${filteredTools.length}/${INVENTORY_TOOLS.length}`);

    // ── Select model based on conversation complexity ──────────────────
    const hasImage = trimmed.some((m) => !!m.imageUrl);
    const hasToolHistory = trimmed.some((m) => m.content?.includes('[Action:'));
    const selectedModel = selectModel({
      messageCount: trimmed.length,
      hasImage,
      hasToolHistory,
      lastUserMessage: lastUserMessage?.content || '',
    });

    // ── Ensure conversation exists ──────────────────────────────────────
    let activeConversationId = conversationId;
    if (!activeConversationId) {
      // Auto-create conversation
      const title = (lastUserMessage?.content || 'New conversation').slice(0, 100);
      const { data: conv } = await inv
        .from('ai_conversations')
        .insert({
          tenant_id: session.tenantId,
          user_id: session.userId,
          title,
          surface,
          model: selectedModel,
        })
        .select('id')
        .single();
      activeConversationId = conv?.id;
    }

    // ── Persist user message ────────────────────────────────────────────
    if (activeConversationId && lastUserMessage) {
      await inv
        .from('ai_messages')
        .insert({
          tenant_id: session.tenantId,
          conversation_id: activeConversationId,
          role: 'user',
          content: lastUserMessage.content,
          image_url: lastUserMessage.imageUrl || null,
        });
    }

    // ── Retrieve relevant memories for context ──────────────────────────
    let memorySuffix = '';
    try {
      const memories = await getRelevantMemories(
        supabase,
        session.tenantId,
        session.userId,
        lastUserMessage?.content || '',
      );
      memorySuffix = formatMemoriesForPrompt(memories);
    } catch {
      // Memory retrieval is non-critical
    }

    // Build OpenAI messages — convert user messages with images to multimodal content
    const systemPromptContent = buildSystemPrompt() + memorySuffix;
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPromptContent },
      ...trimmed.map((m) => {
        if (m.role === 'user' && m.imageUrl) {
          return {
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: m.content || 'What is this item?' },
              { type: 'image_url' as const, image_url: { url: m.imageUrl, detail: 'low' as const } },
            ],
          };
        }
        return {
          role: m.role as 'user' | 'assistant',
          content: m.content,
        };
      }),
    ];

    const openai = new OpenAI({ apiKey });

    // Build server tool context (lazy)
    let serverToolCtx: ServerToolContext | null = null;
    const getServerToolCtx = async (): Promise<ServerToolContext> => {
      if (!serverToolCtx) {
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

    // ── Streaming SSE response ──────────────────────────────────────────
    const startTime = Date.now();
    let totalTokens = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    const toolsCalled: string[] = [];
    const toolsCalledInSession: Array<{ success: boolean; name: string }> = [];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function sendEvent(event: string, data: any) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }

        // Helper: log usage to ai_usage_log (fire-and-forget, never blocks stream)
        async function logUsage() {
          try {
            const usage = {
              prompt_tokens: totalPromptTokens,
              completion_tokens: totalCompletionTokens,
              total_tokens: totalTokens,
            };
            await inv.from('ai_usage_log').insert({
              tenant_id: session.tenantId,
              user_id: session.userId,
              conversation_id: activeConversationId || null,
              model: selectedModel,
              prompt_tokens: totalPromptTokens,
              completion_tokens: totalCompletionTokens,
              total_tokens: totalTokens,
              estimated_cost_usd: estimateCost(selectedModel, usage),
              latency_ms: Date.now() - startTime,
              tools_called: toolsCalled,
              intent_type: toolsCalled.length > 0 ? toolsCalled[toolsCalled.length - 1] : null,
              surface,
            });
          } catch (usageErr: any) {
            log.warn('[AI Chat] Failed to log usage', { error: usageErr.message });
          }
        }

        try {
          let lastDataDisplay: import('@/lib/ai/types').AiDataDisplay | null = null;
          let fullAssistantContent = '';

          for (let round = 0; round < MAX_SERVER_TOOL_ROUNDS; round++) {
            const streamResponse = await openai.chat.completions.create({
              model: selectedModel,
              messages: openaiMessages,
              tools: filteredTools,
              tool_choice: 'auto',
              temperature: 0.4,
              max_tokens: 4096,
              stream: true,
              stream_options: { include_usage: true },
            });

            let accumulatedContent = '';
            let toolCallId = '';
            let toolCallFunctionName = '';
            let toolCallArguments = '';
            let hasToolCall = false;
            let roundTokens = 0;

            for await (const chunk of streamResponse) {
              // Capture usage from the final chunk
              if (chunk.usage) {
                roundTokens = chunk.usage.total_tokens || 0;
                totalTokens += roundTokens;
                totalPromptTokens += chunk.usage.prompt_tokens || 0;
                totalCompletionTokens += chunk.usage.completion_tokens || 0;
              }

              const delta = chunk.choices[0]?.delta;
              if (!delta) continue;

              // Text content delta — stream to client
              if (delta.content) {
                accumulatedContent += delta.content;
                sendEvent('delta', { content: delta.content });
              }

              // Tool call accumulation
              if (delta.tool_calls && delta.tool_calls.length > 0) {
                hasToolCall = true;
                const tc = delta.tool_calls[0];
                if (tc.id) toolCallId = tc.id;
                if (tc.function?.name) toolCallFunctionName = tc.function.name;
                if (tc.function?.arguments) toolCallArguments += tc.function.arguments;
              }
            }

            // ── No tool call → done ──────────────────────────────────
            if (!hasToolCall) {
              fullAssistantContent = accumulatedContent;

              // Persist assistant message
              let assistantMessageId: string | undefined;
              if (activeConversationId) {
                const { data: savedMsg } = await inv
                  .from('ai_messages')
                  .insert({
                    tenant_id: session.tenantId,
                    conversation_id: activeConversationId,
                    role: 'assistant',
                    content: accumulatedContent || null,
                    data_display: lastDataDisplay || null,
                    metadata: { tokens: totalTokens, latency_ms: Date.now() - startTime, model: selectedModel },
                  })
                  .select('id')
                  .single();
                assistantMessageId = savedMsg?.id;

                // Update conversation token count + title
                const updates: Record<string, any> = {
                  total_tokens: totalTokens,
                  updated_at: new Date().toISOString(),
                };
                await inv
                  .from('ai_conversations')
                  .update(updates)
                  .eq('id', activeConversationId);
              }

              // Send final done event
              if (lastDataDisplay) {
                sendEvent('data_result', { dataDisplay: lastDataDisplay });
              }

              const confidence = estimateConfidence({
                content: fullAssistantContent,
                toolResults: toolsCalledInSession,
                dataDisplayPresent: !!lastDataDisplay,
              });

              sendEvent('done', {
                conversation_id: activeConversationId,
                message_id: assistantMessageId,
                tokens: totalTokens,
                latency_ms: Date.now() - startTime,
                model: selectedModel,
                confidence,
              });

              await logUsage();

              // ── Extract & store memories (fire-and-forget) ─────────
              try {
                const turns = trimmed.map((m) => ({
                  role: m.role as 'user' | 'assistant',
                  content: m.content,
                }));
                if (fullAssistantContent) {
                  turns.push({ role: 'assistant', content: fullAssistantContent });
                }
                const extracted = await extractMemories(turns);
                if (extracted.length > 0) {
                  await storeMemories(
                    supabase,
                    session.tenantId,
                    session.userId,
                    activeConversationId || null,
                    extracted,
                  );
                }
              } catch {
                // Memory extraction is non-critical
              }

              controller.close();
              return;
            }

            // ── Tool call handling ───────────────────────────────────

            // Parse tool arguments
            let params: Record<string, any> = {};
            try {
              params = JSON.parse(toolCallArguments || '{}');
            } catch {
              // empty params on parse failure
            }

            // ── Server-side role guard ───────────────────────────────
            // Even though we filter tools sent to OpenAI, this is a
            // defense-in-depth check in case the model hallucinates
            // a tool name that was not in the filtered list.
            if (!canExecuteTool(toolCallFunctionName, userRole)) {
              log.warn(`[AI Chat] Blocked tool ${toolCallFunctionName} for role ${userRole}`);
              sendEvent('delta', { content: "\n\nI'm sorry, but you don't have permission to use that tool. Please contact an admin.\n\n" });
              sendEvent('done', {
                conversation_id: activeConversationId,
                tokens: totalTokens,
                latency_ms: Date.now() - startTime,
                model: selectedModel,
              });
              await logUsage();
              controller.close();
              return;
            }

            // Client-side tool — return for client execution
            if (!isServerTool(toolCallFunctionName)) {
              toolsCalled.push(toolCallFunctionName);
              const stringParams: Record<string, string> = {};
              for (const [key, value] of Object.entries(params)) {
                if (value !== null && value !== undefined && value !== '') {
                  stringParams[key] = String(value);
                }
              }

              sendEvent('tool_call', {
                type: 'tool_use',
                intent: toolCallFunctionName,
                params: stringParams,
              });

              // Persist tool_use message
              if (activeConversationId) {
                await inv.from('ai_messages').insert({
                  tenant_id: session.tenantId,
                  conversation_id: activeConversationId,
                  role: 'assistant',
                  content: null,
                  tool_calls: [{ id: toolCallId, function: { name: toolCallFunctionName, arguments: toolCallArguments } }],
                  metadata: { tokens: totalTokens, model: selectedModel },
                });
              }

              sendEvent('done', {
                conversation_id: activeConversationId,
                tokens: totalTokens,
                latency_ms: Date.now() - startTime,
                model: selectedModel,
              });

              await logUsage();
              controller.close();
              return;
            }

            // Server-side tool — execute and loop
            toolsCalled.push(toolCallFunctionName);
            log.info(`[AI Chat] Executing server tool: ${toolCallFunctionName}`, { params });
            sendEvent('delta', { content: `\n\n_Running ${toolCallFunctionName}..._\n\n` });

            const ctx = await getServerToolCtx();
            let toolResult;
            try {
              toolResult = await executeServerTool(toolCallFunctionName, params, ctx);
              toolsCalledInSession.push({ success: true, name: toolCallFunctionName });
            } catch (toolErr: any) {
              toolResult = { text: `Error: ${toolErr.message}`, dataDisplay: null as any };
              toolsCalledInSession.push({ success: false, name: toolCallFunctionName });
            }
            lastDataDisplay = toolResult.dataDisplay;

            sendEvent('data_result', { dataDisplay: toolResult.dataDisplay });

            // Feed tool result back into conversation for next round
            openaiMessages.push({
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: toolCallId,
                type: 'function',
                function: { name: toolCallFunctionName, arguments: toolCallArguments },
              }],
            });

            openaiMessages.push({
              role: 'tool',
              tool_call_id: toolCallId,
              content: toolResult.text,
            });

            // Loop continues — OpenAI will generate a NL summary
          }

          // Exhausted tool rounds
          if (lastDataDisplay) {
            sendEvent('data_result', { dataDisplay: lastDataDisplay });
          }

          const exhaustedConfidence = estimateConfidence({
            content: fullAssistantContent,
            toolResults: toolsCalledInSession,
            dataDisplayPresent: !!lastDataDisplay,
          });

          sendEvent('done', {
            conversation_id: activeConversationId,
            tokens: totalTokens,
            latency_ms: Date.now() - startTime,
            model: selectedModel,
            confidence: exhaustedConfidence,
          });
          await logUsage();
          controller.close();
        } catch (err: any) {
          log.error('[AI Chat] Stream error:', err.message || err);
          sendEvent('error', { message: err.message || 'Stream error' });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err: any) {
    log.error('[AI Chat] Error:', err.message || err);
    return fallbackResponse();
  }
}, { serviceName: SERVICE_NAME });
