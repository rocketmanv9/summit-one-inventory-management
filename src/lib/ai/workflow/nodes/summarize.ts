/**
 * Summarize Node — Composes final response from tool results and context.
 *
 * Uses resolved entity names to provide human-readable context in responses.
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

  // Prepend entity context when entities were resolved and used
  if (state.resolvedEntities.length > 0 && response) {
    const entityContext = state.resolvedEntities
      .map((e) => e.canonical_name)
      .join(', ');

    // Only add context prefix if the response doesn't already mention the entities
    const responseLower = response.toLowerCase();
    const alreadyMentioned = state.resolvedEntities.some(
      (e) => responseLower.includes(e.canonical_name.toLowerCase())
    );

    if (!alreadyMentioned) {
      response = `Regarding **${entityContext}**:\n\n${response}`;
    }
  }

  const confidence = estimateConfidence({
    content: response,
    toolResults: state.toolResults.map((t) => ({ success: t.success, name: t.name })),
    dataDisplayPresent: !!state.dataDisplay,
  });

  if (shouldHedge(confidence)) response += getHedgeText();

  return { response, confidence, nodesVisited: ['summarize'] };
}
