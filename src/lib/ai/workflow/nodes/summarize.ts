/**
 * Summarize Node — Composes final response from tool results and context.
 */
import type { ChatGraphState, ChatGraphUpdate } from '../graph-types';
import { estimateConfidence, shouldHedge, getHedgeText } from '../../confidence';

export async function summarizeNode(state: ChatGraphState): Promise<ChatGraphUpdate> {
  if (state.permissionDenied) {
    return { response: state.permissionDenied, confidence: 0, nodesVisited: ['summarize'] };
  }

  let response = state.response || '';
  if (state.toolResults.length > 0) {
    const summaries = state.toolResults.map((t) => t.result.text).filter(Boolean);
    response = summaries.join('\n\n') || response;
  }

  const confidence = estimateConfidence({
    content: response,
    toolResults: state.toolResults.map((t) => ({ success: t.success, name: t.name })),
    dataDisplayPresent: !!state.dataDisplay,
  });

  if (shouldHedge(confidence)) response += getHedgeText();

  return { response, confidence, nodesVisited: ['summarize'] };
}
