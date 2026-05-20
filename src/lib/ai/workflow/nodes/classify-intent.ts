/**
 * Intent Classification Node
 */
import type { ChatGraphState, ChatGraphUpdate } from '../graph-types';

export async function classifyIntentNode(state: ChatGraphState): Promise<ChatGraphUpdate> {
  const msg = state.userMessage.toLowerCase().trim();

  // Simple heuristic classification (OpenAI does the real work via tool selection)
  let intent = 'general';
  let confidence = 0.7;

  const GREETING = /^(hi|hey|hello|good\s+(morning|afternoon|evening)|what's up)/i;
  const ANALYTICS = /\b(value|worth|kpi|turnover|forecast|dead stock|velocity|summary|overview)\b/i;
  const WORKFLOW = /\b(reorder|rebalance|auto|workflow|dashboard)\b/i;
  const SEARCH = /\b(find|search|look up|where|who supplies|substitute)\b/i;

  if (GREETING.test(msg)) { intent = 'greeting'; confidence = 0.95; }
  else if (ANALYTICS.test(msg)) { intent = 'analytics'; confidence = 0.8; }
  else if (WORKFLOW.test(msg)) { intent = 'workflow'; confidence = 0.8; }
  else if (SEARCH.test(msg)) { intent = 'search'; confidence = 0.75; }

  return {
    intent,
    intentConfidence: confidence,
    nodesVisited: ['classify_intent'],
  };
}
