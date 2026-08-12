/**
 * Intent Classification Node
 *
 * Uses heuristic regex patterns to classify user messages into intent categories.
 * OpenAI does deeper classification via tool selection, but this pre-classifies
 * for the graph to select tools and route accordingly.
 */
import type { ChatGraphState, ChatGraphUpdate } from '../graph-types';

interface IntentPattern {
  intent: string;
  pattern: RegExp;
  confidence: number;
}

/**
 * Ordered by specificity — first match wins.
 * More specific patterns (mutations, CRUD) come before general ones.
 */
const INTENT_PATTERNS: IntentPattern[] = [
  // ── Greetings ──────────────────────────────────────────────────────
  { intent: 'greeting', pattern: /^(hi|hey|hello|good\s+(morning|afternoon|evening)|what'?s up|howdy)/i, confidence: 0.95 },
  { intent: 'help', pattern: /^(help|what can you do|commands|capabilities)/i, confidence: 0.95 },

  // ── Mutations (high specificity) ───────────────────────────────────
  { intent: 'adjust_stock', pattern: /\b(set\s+(stock|quantity|qty|balance)|adjust\s+(stock|balance|qty)|stock\s+adjust)/i, confidence: 0.85 },
  { intent: 'adjust_stock_delta', pattern: /\b(add|remove|subtract|increment|decrement)\s+\d+/i, confidence: 0.85 },
  { intent: 'issue_inventory', pattern: /\b(issue|dispense|hand\s*out|give\s+out)\s+(inventory|stock|material)/i, confidence: 0.85 },
  { intent: 'create_transfer', pattern: /\b(transfer|move)\s+(stock|inventory|material|items?)/i, confidence: 0.85 },
  { intent: 'create_po', pattern: /\b(create|new|draft|make)\s+(a\s+)?(purchase\s+order|po)\b/i, confidence: 0.85 },
  { intent: 'create_reservation', pattern: /\b(reserve|hold|allocate)\s+(stock|inventory|material)/i, confidence: 0.85 },
  { intent: 'create_asset', pattern: /\b(register|create|add)\s+(an?\s+)?asset\b/i, confidence: 0.85 },

  // ── CRUD: Create ───────────────────────────────────────────────────
  { intent: 'add_vendor', pattern: /\b(add|create|new)\s+(a\s+)?vendor\b/i, confidence: 0.85 },
  { intent: 'add_item', pattern: /\b(add|create|new)\s+(a\s+)?(catalog\s+)?item\b/i, confidence: 0.85 },
  { intent: 'add_location', pattern: /\b(add|create|new)\s+(a\s+)?location\b/i, confidence: 0.85 },
  { intent: 'add_category', pattern: /\b(add|create|new)\s+(a\s+)?category\b/i, confidence: 0.85 },

  // ── CRUD: Update ───────────────────────────────────────────────────
  { intent: 'update_vendor', pattern: /\b(update|edit|change|modify)\s+(a\s+)?vendor\b/i, confidence: 0.85 },
  { intent: 'update_item', pattern: /\b(update|edit|change|modify)\s+(a\s+)?(catalog\s+)?item\b/i, confidence: 0.85 },

  // ── CRUD: Delete ───────────────────────────────────────────────────
  { intent: 'delete_vendor', pattern: /\b(delete|remove)\s+(a\s+)?vendor\b/i, confidence: 0.85 },
  { intent: 'delete_item', pattern: /\b(delete|remove)\s+(a\s+)?(catalog\s+)?item\b/i, confidence: 0.85 },

  // ── CRUD: Read / List ──────────────────────────────────────────────
  { intent: 'list', pattern: /\b(list|show|get|display)\s+(all\s+)?(vendors?|items?|locations?|assets?|transfers?|receipts?|categories|pos?|purchase\s+orders?|reservations?)\b/i, confidence: 0.8 },
  { intent: 'check_stock', pattern: /\b(check|what'?s|how\s+much|stock\s+(level|on\s+hand)|in\s+stock)\b/i, confidence: 0.8 },

  // ── Analytics ──────────────────────────────────────────────────────
  { intent: 'analytics', pattern: /\b(value|worth|kpi|turnover|forecast|dead\s*stock|velocity|summary|overview|valuation|report|analytics?|trend)/i, confidence: 0.8 },
  { intent: 'analytics', pattern: /\b(low\s+stock|running\s+low|reorder\s+point|stock\s+out)/i, confidence: 0.8 },
  { intent: 'analytics', pattern: /\b(how\s+(is|are)|what'?s\s+(the|our))\s+(inventory|stock)/i, confidence: 0.75 },

  // ── Workflow ───────────────────────────────────────────────────────
  { intent: 'workflow', pattern: /\b(reorder|rebalance|auto|workflow)\b/i, confidence: 0.8 },
  { intent: 'dashboard', pattern: /\b(dashboard|widget|create\s+dashboard)\b/i, confidence: 0.8 },

  // ── Search / Ontology ──────────────────────────────────────────────
  { intent: 'search', pattern: /\b(find|search|look\s*up|where|who\s+supplies|substitute|alternative)/i, confidence: 0.75 },

  // ── Navigation ─────────────────────────────────────────────────────
  { intent: 'navigate', pattern: /\b(go\s+to|navigate\s+to|open|take\s+me\s+to|show\s+me)\s+(the\s+)?\w+\s*(page|screen|section|tab)?/i, confidence: 0.75 },

  // ── General mutation detection (catch-all for unmatched creates/updates/deletes)
  { intent: 'mutation', pattern: /\b(create|add|update|edit|delete|remove|adjust|set|modify|change)\b/i, confidence: 0.6 },
];

export async function classifyIntentNode(state: ChatGraphState): Promise<ChatGraphUpdate> {
  const msg = state.userMessage.toLowerCase().trim();

  for (const { intent, pattern, confidence } of INTENT_PATTERNS) {
    if (pattern.test(msg)) {
      return {
        intent,
        intentConfidence: confidence,
        nodesVisited: ['classify_intent'],
      };
    }
  }

  return {
    intent: 'general',
    intentConfidence: 0.5,
    nodesVisited: ['classify_intent'],
  };
}
