/**
 * AI Cost Estimation Utility
 *
 * Model pricing and token cost calculation for observability dashboards.
 * Prices are per 1M tokens (input/output).
 */

// Model pricing per 1M tokens (input/output) — updated 2026-05-08
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
  'text-embedding-3-small': { input: 0.02, output: 0 },
};

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/**
 * Estimate the USD cost for a given model and token usage.
 * Falls back to gpt-4.1 pricing if the model is not recognized.
 */
export function estimateCost(model: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gpt-4.1'];
  const inputCost = (usage.prompt_tokens / 1_000_000) * pricing.input;
  const outputCost = (usage.completion_tokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}
