/**
 * AI extraction of structured PO status signals from a vendor's reply email.
 *
 * Turns free-text replies ("Confirmed — shipping Thursday, 2 pails backordered
 * ~1wk, order #AMZ-99821") into a list of discrete, machine-actionable actions.
 * Uses OpenAI structured outputs when configured; degrades to a conservative
 * keyword heuristic (low confidence → everything becomes a human suggestion).
 */
import OpenAI from 'openai';

export type ReplyActionType =
  | 'acknowledged'
  | 'shipped'
  | 'delivery_update'
  | 'backordered'
  | 'price_change'
  | 'qty_change'
  | 'delay'
  | 'cancelled'
  | 'question'
  | 'other';

export interface ReplyAction {
  type: ReplyActionType;
  confidence: number;
  detail: string;
  expected_delivery_date: string | null; // YYYY-MM-DD
  external_order_number: string | null;
  tracking_number: string | null;
  items: string[] | null;
}

export interface ReplyExtraction {
  summary: string;
  overall_confidence: number;
  actions: ReplyAction[];
}

export interface ExtractorInput {
  subject: string | null;
  bodyText: string | null;
  snippet: string | null;
  poNumber: string;
  vendorName: string;
  currentExpectedDelivery?: string | null;
  itemDescriptions?: string[];
}

const ACTION_TYPES: ReplyActionType[] = [
  'acknowledged',
  'shipped',
  'delivery_update',
  'backordered',
  'price_change',
  'qty_change',
  'delay',
  'cancelled',
  'question',
  'other',
];

const JSON_SCHEMA = {
  name: 'po_reply_extraction',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'overall_confidence', 'actions'],
    properties: {
      summary: { type: 'string', description: 'One-sentence plain summary of the reply.' },
      overall_confidence: { type: 'number' },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'type',
            'confidence',
            'detail',
            'expected_delivery_date',
            'external_order_number',
            'tracking_number',
            'items',
          ],
          properties: {
            type: { type: 'string', enum: ACTION_TYPES },
            confidence: { type: 'number' },
            detail: { type: 'string' },
            expected_delivery_date: { type: ['string', 'null'], description: 'YYYY-MM-DD or null' },
            external_order_number: { type: ['string', 'null'] },
            tracking_number: { type: ['string', 'null'] },
            items: { type: ['array', 'null'], items: { type: 'string' } },
          },
        },
      },
    },
  },
} as const;

export async function extractReplyInsights(input: ExtractorInput): Promise<ReplyExtraction> {
  const text = [input.subject, input.bodyText || input.snippet].filter(Boolean).join('\n\n').slice(0, 8000);
  if (!text.trim()) {
    return { summary: 'Empty reply.', overall_confidence: 0, actions: [] };
  }
  if (!process.env.OPENAI_API_KEY) {
    return heuristicExtract(input, text);
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_schema', json_schema: JSON_SCHEMA as any },
      messages: [
        {
          role: 'system',
          content:
            'You analyze a vendor’s reply to a purchase order and extract discrete status actions. ' +
            'Return one action per distinct fact (acknowledgement, ship/tracking, delivery date, ' +
            'backorder, price change, quantity change, delay, cancellation, or a question needing a human). ' +
            'Only include an action if the reply genuinely supports it. Confidence is 0–1. ' +
            'Dates must be ISO YYYY-MM-DD; if the vendor gives a relative date ("Thursday", "next week") ' +
            'leave expected_delivery_date null unless an absolute date is stated. Never invent order or ' +
            'tracking numbers.',
        },
        {
          role: 'user',
          content:
            `PO: ${input.poNumber}\nVendor: ${input.vendorName}\n` +
            (input.currentExpectedDelivery ? `Current expected delivery: ${input.currentExpectedDelivery}\n` : '') +
            (input.itemDescriptions?.length ? `Items: ${input.itemDescriptions.slice(0, 20).join('; ')}\n` : '') +
            `\n--- Vendor reply ---\n${text}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return heuristicExtract(input, text);
    const parsed = JSON.parse(raw) as ReplyExtraction;
    parsed.actions = (parsed.actions ?? []).filter((a) => ACTION_TYPES.includes(a.type));
    return parsed;
  } catch {
    return heuristicExtract(input, text);
  }
}

// ── Conservative keyword fallback (no model) ─────────────────────────────────

function heuristicExtract(input: ExtractorInput, text: string): ReplyExtraction {
  const lower = text.toLowerCase();
  const actions: ReplyAction[] = [];
  const base = (type: ReplyActionType, detail: string, extra: Partial<ReplyAction> = {}): ReplyAction => ({
    type,
    confidence: 0.4, // low — forces human confirmation in the tracker
    detail,
    expected_delivery_date: null,
    external_order_number: null,
    tracking_number: null,
    items: null,
    ...extra,
  });

  const isoDate = lower.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (/(confirm|acknowledg|received your order|order received|we have your)/.test(lower)) {
    actions.push(base('acknowledged', 'Reply appears to confirm the order.'));
  }
  if (/(ship|dispatch|on its way|out for delivery|tracking)/.test(lower)) {
    actions.push(base('shipped', 'Reply mentions shipping/tracking.'));
  }
  if (isoDate && /(deliver|arrive|eta|expected|by)/.test(lower)) {
    actions.push(base('delivery_update', `Mentions a delivery date (${isoDate[1]}).`, { expected_delivery_date: isoDate[1] }));
  }
  if (/(back ?order|out of stock|unavailable|on hold)/.test(lower)) {
    actions.push(base('backordered', 'Reply mentions a backorder/stock issue.'));
  }
  if (/(price|cost|increase|surcharge|quote)/.test(lower)) {
    actions.push(base('price_change', 'Reply mentions pricing — review.'));
  }
  if (/(cancel|void)/.test(lower)) {
    actions.push(base('cancelled', 'Reply may indicate cancellation — review.'));
  }
  if (/\?/.test(text) && actions.length === 0) {
    actions.push(base('question', 'Vendor asked a question.'));
  }
  if (actions.length === 0) {
    actions.push(base('other', 'Vendor reply received.'));
  }

  return {
    summary: input.snippet || actions[0]?.detail || 'Vendor reply received.',
    overall_confidence: 0.4,
    actions,
  };
}
