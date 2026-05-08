/**
 * Multi-Model Router
 * Routes queries to the most cost-effective model based on complexity.
 */

export type ModelId = 'gpt-4.1' | 'gpt-4.1-mini' | 'gpt-4.1-nano';

interface RoutingContext {
  messageCount: number;
  hasImage: boolean;
  hasToolHistory: boolean;
  lastUserMessage: string;
}

/**
 * Select the optimal model for a given conversation context.
 * - Image messages -> gpt-4.1 (vision required)
 * - Complex multi-turn with tools -> gpt-4.1 (reasoning)
 * - Simple single-turn greetings/questions -> gpt-4.1-mini (cost savings)
 */
export function selectModel(ctx: RoutingContext): ModelId {
  // Image content requires full model
  if (ctx.hasImage) return 'gpt-4.1';

  // Complex multi-turn conversations with tool history need full model
  if (ctx.hasToolHistory && ctx.messageCount > 4) return 'gpt-4.1';

  // Long messages or multi-turn -> full model
  if (ctx.lastUserMessage.length > 500) return 'gpt-4.1';
  if (ctx.messageCount > 10) return 'gpt-4.1';

  // Simple single-turn conversations can use mini
  if (ctx.messageCount <= 2 && !ctx.hasToolHistory) return 'gpt-4.1-mini';

  // Default to full model
  return 'gpt-4.1';
}
