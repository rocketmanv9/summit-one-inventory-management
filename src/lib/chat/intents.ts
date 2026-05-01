/**
 * Chat Intent Parser
 * Analyzes user messages and extracts structured intents + parameters
 */

export type IntentType =
  | 'add_vendor'
  | 'update_vendor'
  | 'delete_vendor'
  | 'list_vendors'
  | 'add_item'
  | 'update_item'
  | 'delete_item'
  | 'list_items'
  | 'update_stock'
  | 'adjust_stock'
  | 'check_stock'
  | 'low_stock'
  | 'issue_inventory'
  | 'create_po'
  | 'list_pos'
  | 'list_locations'
  | 'add_location'
  | 'late_orders'
  | 'create_transfer'
  | 'list_transfers'
  | 'create_asset'
  | 'list_assets'
  | 'list_receipts'
  | 'create_reservation'
  | 'release_reservation'
  | 'list_reservations'
  | 'receive_po'
  | 'list_categories'
  | 'add_category'
  | 'global_search'
  | 'inventory_summary'
  | 'navigate'
  | 'help'
  | 'unknown';

export interface ParsedIntent {
  type: IntentType;
  confidence: number;
  extractedParams: Record<string, string>;
  rawMessage: string;
}

interface IntentPattern {
  type: IntentType;
  patterns: RegExp[];
  keywords: string[][];
  paramExtractors?: Record<string, RegExp>;
}

const INTENT_PATTERNS: IntentPattern[] = [
  // Vendor operations
  {
    type: 'add_vendor',
    patterns: [
      /add\s+(a\s+)?(new\s+)?vendor/i,
      /create\s+(a\s+)?(new\s+)?vendor/i,
      /new\s+vendor/i,
      /register\s+(a\s+)?vendor/i,
    ],
    keywords: [['add', 'vendor'], ['create', 'vendor'], ['new', 'vendor']],
    paramExtractors: {
      name: /(?:named?|called?)\s+["']?([^"'\n,]+)["']?/i,
      code: /(?:code|id)\s+["']?([A-Z0-9-]+)["']?/i,
      email: /([\w.-]+@[\w.-]+\.\w+)/i,
      phone: /(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/,
    },
  },
  {
    type: 'update_vendor',
    patterns: [
      /update\s+(a\s+)?vendor/i,
      /edit\s+(a\s+)?vendor/i,
      /change\s+vendor/i,
      /modify\s+vendor/i,
    ],
    keywords: [['update', 'vendor'], ['edit', 'vendor'], ['change', 'vendor']],
    paramExtractors: {
      name: /(?:vendor\s+)?["']?([^"'\n,]+)["']?\s+(?:to|with|set)/i,
    },
  },
  {
    type: 'list_vendors',
    patterns: [
      /(?:list|show|get|view|see)\s+(?:all\s+)?(?:my\s+)?vendors/i,
      /what\s+vendors/i,
      /which\s+vendors/i,
      /vendor\s+list/i,
    ],
    keywords: [['list', 'vendors'], ['show', 'vendors'], ['view', 'vendors']],
  },

  // Item operations
  {
    type: 'add_item',
    patterns: [
      /add\s+(a\s+)?(new\s+)?(catalog\s+)?item/i,
      /create\s+(a\s+)?(new\s+)?(catalog\s+)?item/i,
      /new\s+(catalog\s+)?item/i,
    ],
    keywords: [['add', 'item'], ['create', 'item'], ['new', 'item']],
    paramExtractors: {
      name: /(?:named?|called?)\s+["']?([^"'\n,]+)["']?/i,
      sku: /(?:sku|code)\s+["']?([A-Z0-9-]+)["']?/i,
    },
  },
  {
    type: 'list_items',
    patterns: [
      /(?:list|show|get|view|see)\s+(?:all\s+)?(?:my\s+)?(?:catalog\s+)?items/i,
      /what\s+items/i,
      /which\s+items/i,
    ],
    keywords: [['list', 'items'], ['show', 'items'], ['view', 'items']],
  },

  // Stock operations
  {
    type: 'adjust_stock',
    patterns: [
      /(?:update|adjust|change|set|correct)\s+(?:the\s+)?stock\s*(?:balance|level|qty|quantity)?/i,
      /(?:update|adjust|change|set|correct)\s+(?:the\s+)?inventory\s*(?:balance|level|qty|quantity)?/i,
      /stock\s+(?:adjustment|correction)/i,
    ],
    keywords: [
      ['update', 'stock'], ['adjust', 'stock'], ['change', 'stock'],
      ['set', 'stock'], ['correct', 'stock'], ['update', 'inventory'],
      ['adjust', 'inventory'],
    ],
    paramExtractors: {
      item: /(?:for|of|on)\s+["']?([^"'\n,]+?)["']?\s*(?:to|at|$)/i,
      quantity: /(?:to|=|at)\s+(\d+(?:\.\d+)?)/i,
    },
  },
  {
    type: 'check_stock',
    patterns: [
      /(?:check|view|see|what(?:'?s| is))\s+(?:the\s+)?(?:current\s+)?stock/i,
      /(?:how\s+much|how\s+many)\s+(?:\w+\s+)?(?:do\s+(?:we|i)\s+have|in\s+stock)/i,
      /stock\s+(?:level|balance|check)/i,
    ],
    keywords: [['check', 'stock'], ['view', 'stock'], ['stock', 'level']],
  },
  {
    type: 'low_stock',
    patterns: [
      /(?:low|below)\s+stock/i,
      /(?:items?|products?)\s+(?:running\s+)?low/i,
      /(?:what(?:'?s| is))\s+(?:running\s+)?low/i,
      /reorder\s+(?:needed|alert|report)/i,
      /out\s+of\s+stock/i,
    ],
    keywords: [['low', 'stock'], ['running', 'low'], ['below', 'minimum']],
  },

  // PO operations
  {
    type: 'create_po',
    patterns: [
      /create\s+(a\s+)?(new\s+)?(?:purchase\s+order|po)/i,
      /new\s+(?:purchase\s+order|po)/i,
      /make\s+(a\s+)?(?:purchase\s+order|po)/i,
    ],
    keywords: [['create', 'po'], ['new', 'po'], ['create', 'purchase', 'order']],
  },
  {
    type: 'list_pos',
    patterns: [
      /(?:list|show|get|view|see)\s+(?:all\s+)?(?:my\s+)?(?:purchase\s+orders?|pos)/i,
      /(?:what|which)\s+(?:purchase\s+orders?|pos)/i,
      /(?:open|pending|active)\s+(?:purchase\s+orders?|pos)/i,
    ],
    keywords: [['list', 'po'], ['show', 'po'], ['list', 'purchase', 'order']],
  },
  {
    type: 'late_orders',
    patterns: [
      /(?:late|overdue|delayed)\s+(?:purchase\s+)?orders?/i,
      /(?:what|which)\s+(?:purchase\s+)?orders?\s+(?:are\s+)?late/i,
    ],
    keywords: [['late', 'orders'], ['overdue', 'orders'], ['delayed', 'orders']],
  },

  // Delete vendor
  {
    type: 'delete_vendor',
    patterns: [
      /delete\s+(a\s+)?vendor/i,
      /remove\s+(a\s+)?vendor/i,
      /deactivate\s+(a\s+)?vendor/i,
    ],
    keywords: [['delete', 'vendor'], ['remove', 'vendor'], ['deactivate', 'vendor']],
    paramExtractors: {
      name: /(?:vendor\s+)?["']?([^"'\n,]+)["']?\s*$/i,
    },
  },

  // Update item
  {
    type: 'update_item',
    patterns: [
      /update\s+(a\s+)?(catalog\s+)?item/i,
      /edit\s+(a\s+)?(catalog\s+)?item/i,
      /change\s+(a\s+)?(catalog\s+)?item/i,
      /modify\s+(a\s+)?(catalog\s+)?item/i,
    ],
    keywords: [['update', 'item'], ['edit', 'item'], ['change', 'item'], ['modify', 'item']],
    paramExtractors: {
      name: /(?:item\s+)?["']?([^"'\n,]+)["']?\s+(?:to|with|set)/i,
    },
  },

  // Delete item
  {
    type: 'delete_item',
    patterns: [
      /delete\s+(a\s+)?(catalog\s+)?item/i,
      /remove\s+(a\s+)?(catalog\s+)?item/i,
    ],
    keywords: [['delete', 'item'], ['remove', 'item']],
    paramExtractors: {
      name: /(?:item\s+)?["']?([^"'\n,]+)["']?\s*$/i,
    },
  },

  // Issue inventory
  {
    type: 'issue_inventory',
    patterns: [
      /issue\s+(?:some\s+)?(?:inventory|stock|material)/i,
      /release\s+(?:some\s+)?(?:inventory|stock|material)/i,
    ],
    keywords: [['issue', 'inventory'], ['issue', 'stock'], ['release', 'stock'], ['release', 'material']],
  },

  // Transfer operations
  {
    type: 'create_transfer',
    patterns: [
      /create\s+(a\s+)?(new\s+)?transfer/i,
      /new\s+transfer/i,
      /move\s+stock\s+(?:from|to)/i,
      /transfer\s+stock/i,
      /transfer\s+inventory/i,
    ],
    keywords: [['create', 'transfer'], ['new', 'transfer'], ['move', 'stock'], ['transfer', 'stock']],
  },
  {
    type: 'list_transfers',
    patterns: [
      /(?:list|show|get|view|see)\s+(?:all\s+)?(?:recent\s+)?transfers/i,
    ],
    keywords: [['list', 'transfers'], ['show', 'transfers'], ['view', 'transfers']],
  },

  // Asset operations
  {
    type: 'create_asset',
    patterns: [
      /create\s+(a\s+)?(new\s+)?asset/i,
      /register\s+(a\s+)?(new\s+)?asset/i,
      /add\s+(a\s+)?(new\s+)?asset/i,
    ],
    keywords: [['create', 'asset'], ['register', 'asset'], ['add', 'asset'], ['new', 'asset']],
  },
  {
    type: 'list_assets',
    patterns: [
      /(?:list|show|get|view|see)\s+(?:all\s+)?(?:my\s+)?assets/i,
      /(?:list|show|get|view|see)\s+(?:all\s+)?(?:my\s+)?equipment/i,
    ],
    keywords: [['list', 'assets'], ['show', 'assets'], ['list', 'equipment'], ['show', 'equipment']],
  },

  // Receipts
  {
    type: 'list_receipts',
    patterns: [
      /(?:list|show|get|view|see)\s+(?:all\s+)?(?:recent\s+)?receipts/i,
    ],
    keywords: [['list', 'receipts'], ['show', 'receipts'], ['view', 'receipts']],
  },

  // Reservation operations
  {
    type: 'create_reservation',
    patterns: [
      /create\s+(a\s+)?(new\s+)?reservation/i,
      /reserve\s+(?:some\s+)?(?:stock|inventory|material|items?)/i,
      /reserve\s+\d+/i,
    ],
    keywords: [['create', 'reservation'], ['reserve', 'stock'], ['reserve']],
    paramExtractors: {
      item: /(?:of|for)\s+["']?([^"'\n,]+?)["']?\s*(?:at|from|$)/i,
      quantity: /(\d+(?:\.\d+)?)\s+(?:units?|bags?|tons?|each|gallons?|pieces?)/i,
    },
  },
  {
    type: 'release_reservation',
    patterns: [
      /release\s+(a\s+)?(the\s+)?reservation/i,
      /cancel\s+(a\s+)?(the\s+)?reservation/i,
      /unreserve/i,
    ],
    keywords: [['release', 'reservation'], ['cancel', 'reservation'], ['unreserve']],
  },
  {
    type: 'list_reservations',
    patterns: [
      /(?:list|show|get|view|see)\s+(?:all\s+)?(?:my\s+)?(?:active\s+)?reservations/i,
      /(?:what|which)\s+reservations/i,
    ],
    keywords: [['list', 'reservations'], ['show', 'reservations'], ['view', 'reservations']],
  },

  // Receive PO
  {
    type: 'receive_po',
    patterns: [
      /receive\s+(a\s+)?(?:purchase\s+order|po|delivery|shipment)/i,
      /record\s+(a\s+)?receipt/i,
      /log\s+(a\s+)?receipt/i,
    ],
    keywords: [['receive', 'po'], ['receive', 'order'], ['record', 'receipt']],
  },

  // Category operations
  {
    type: 'list_categories',
    patterns: [
      /(?:list|show|get|view|see)\s+(?:all\s+)?(?:item\s+)?categories/i,
      /(?:what|which)\s+categories/i,
    ],
    keywords: [['list', 'categories'], ['show', 'categories']],
  },
  {
    type: 'add_category',
    patterns: [
      /(?:add|create)\s+(a\s+)?(new\s+)?(?:item\s+)?category/i,
      /new\s+category/i,
    ],
    keywords: [['add', 'category'], ['create', 'category'], ['new', 'category']],
    paramExtractors: {
      name: /(?:named?|called?)\s+["']?([^"'\n,]+)["']?/i,
    },
  },

  // Global search
  {
    type: 'global_search',
    patterns: [
      /search\s+(?:for\s+)?(?:everything|all|across)/i,
      /find\s+(?:everything|all|across)/i,
      /global\s+search/i,
      /search\s+(?:for\s+)?["']?(.+?)["']?$/i,
    ],
    keywords: [['search', 'everything'], ['search', 'all'], ['global', 'search'], ['find', 'everything']],
    paramExtractors: {
      query: /(?:search|find)\s+(?:for\s+)?["']?(.+?)["']?$/i,
    },
  },

  // Location operations
  {
    type: 'list_locations',
    patterns: [
      /(?:list|show|get|view|see)\s+(?:all\s+)?(?:my\s+)?locations?/i,
      /(?:what|which)\s+locations?/i,
    ],
    keywords: [['list', 'locations'], ['show', 'locations']],
  },
  {
    type: 'add_location',
    patterns: [
      /add\s+(a\s+)?(new\s+)?location/i,
      /create\s+(a\s+)?(new\s+)?location/i,
    ],
    keywords: [['add', 'location'], ['create', 'location'], ['new', 'location']],
  },

  // Summary / Dashboard
  {
    type: 'inventory_summary',
    patterns: [
      /(?:inventory|stock)\s+(?:summary|overview|dashboard|report)/i,
      /(?:show|give)\s+(?:me\s+)?(?:a\s+)?summary/i,
    ],
    keywords: [['inventory', 'summary'], ['stock', 'summary'], ['overview']],
  },

  // Navigation
  {
    type: 'navigate',
    patterns: [
      /(?:go\s+to|open|take\s+me\s+to|navigate\s+to)\s+(.+)/i,
    ],
    keywords: [['go', 'to'], ['open'], ['navigate']],
  },

  // Help
  {
    type: 'help',
    patterns: [
      /^(?:help|what\s+can\s+you\s+do|commands?)$/i,
      /(?:what|how)\s+can\s+(?:you|i)\s+(?:do|use)/i,
    ],
    keywords: [['help']],
  },
];

export function parseIntent(message: string): ParsedIntent {
  const lower = message.toLowerCase().trim();
  const words = lower.split(/\s+/);

  let bestMatch: { type: IntentType; confidence: number } = {
    type: 'unknown',
    confidence: 0,
  };

  for (const pattern of INTENT_PATTERNS) {
    // Check regex patterns first (high confidence)
    for (const regex of pattern.patterns) {
      if (regex.test(message)) {
        const confidence = 0.9;
        if (confidence > bestMatch.confidence) {
          bestMatch = { type: pattern.type, confidence };
        }
      }
    }

    // Check keyword combos (medium confidence)
    for (const keywordGroup of pattern.keywords) {
      const allPresent = keywordGroup.every((kw) =>
        words.some((w) => w.includes(kw))
      );
      if (allPresent) {
        const confidence = 0.7;
        if (confidence > bestMatch.confidence) {
          bestMatch = { type: pattern.type, confidence };
        }
      }
    }
  }

  // Extract parameters
  const extractedParams: Record<string, string> = {};
  const matchedPattern = INTENT_PATTERNS.find((p) => p.type === bestMatch.type);
  if (matchedPattern?.paramExtractors) {
    for (const [key, regex] of Object.entries(matchedPattern.paramExtractors)) {
      const match = message.match(regex);
      if (match?.[1]) {
        extractedParams[key] = match[1].trim();
      }
    }
  }

  return {
    type: bestMatch.type,
    confidence: bestMatch.confidence,
    extractedParams,
    rawMessage: message,
  };
}
