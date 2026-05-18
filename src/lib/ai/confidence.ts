/**
 * Confidence Scoring
 * Estimates response confidence based on content analysis and tool results.
 */

interface ConfidenceContext {
  content: string;
  toolResults?: Array<{ success: boolean; name: string }>;
  dataDisplayPresent: boolean;
}

const UNCERTAINTY_PHRASES = [
  "i'm not sure",
  "i think",
  "it might",
  "possibly",
  "i believe",
  "it seems",
  "maybe",
  "not certain",
  "unclear",
  "i don't know",
  "i can't find",
  "no data",
  "couldn't find",
];

/**
 * Estimate confidence of an AI response.
 * Returns a value between 0 and 1.
 */
export function estimateConfidence(ctx: ConfidenceContext): number {
  let score = 0.85; // Base confidence

  // Penalize uncertainty language
  const lower = ctx.content.toLowerCase();
  for (const phrase of UNCERTAINTY_PHRASES) {
    if (lower.includes(phrase)) {
      score -= 0.1;
      break; // Only penalize once for uncertainty language
    }
  }

  // Boost if data display is present (concrete data shown)
  if (ctx.dataDisplayPresent) {
    score += 0.1;
  }

  // Penalize failed tool calls
  if (ctx.toolResults) {
    const failedCount = ctx.toolResults.filter((t) => !t.success).length;
    score -= failedCount * 0.15;
  }

  // Boost for longer, detailed responses (more likely substantive)
  if (ctx.content.length > 200) {
    score += 0.05;
  }

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}

const HEDGE_THRESHOLD = 0.5;

/**
 * Determine if the response confidence is too low and should be hedged.
 * Returns true when the AI should suggest the user verify the answer.
 */
export function shouldHedge(score: number): boolean {
  return score < HEDGE_THRESHOLD;
}

/**
 * Generate a hedge disclaimer to append to low-confidence responses.
 */
export function getHedgeText(): string {
  return '\n\n_Note: I\'m not fully confident in this answer. Please verify the details before acting on it._';
}
