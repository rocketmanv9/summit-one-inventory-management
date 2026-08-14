/**
 * POST /api/inventory/price-wars/extract-quote
 *   { text, item_name?, vendor_name? }
 *
 * A buyer pastes the vendor's reply ("we can do $41.50/ea on 100+, 5 day lead")
 * and gets back { unit_cost, currency, moq, lead_time_days, confidence }. The
 * buyer confirms before anything is written — this route persists NOTHING; the
 * PATCH on the round is what records a price, and a human always drives it.
 *
 * Degrades honestly: no key, unreadable text, or an AI error all return
 * confidence 0 with a message telling the buyer to type the number instead.
 *
 * Read route: it extracts and returns, mutating nothing (same shape as
 * /vendors/extract-card and /vendors/match).
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import OpenAI from 'openai';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';
const MODEL = 'gpt-4o';

const RequestSchema = z.object({
  text: z.string().min(1).max(20000),
  item_name: z.string().max(300).nullable().optional(),
  vendor_name: z.string().max(300).nullable().optional(),
});

interface ExtractedQuote {
  configured: boolean;
  unit_cost: number | null;
  currency: string;
  moq: number | null;
  lead_time_days: number | null;
  declined: boolean;
  /** 0-100 — how sure the model is that this is a real unit price for our item. */
  confidence: number;
  /** The exact snippet the price was read from, so a human can check it. */
  evidence: string | null;
  notes: string | null;
  message?: string;
}

function degraded(configured: boolean, message: string): ExtractedQuote {
  return {
    configured,
    unit_cost: null,
    currency: 'USD',
    moq: null,
    lead_time_days: null,
    declined: false,
    confidence: 0,
    evidence: null,
    notes: null,
    message,
  };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function clamp100(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

const SYSTEM_PROMPT = [
  'You read a supplier\'s emailed reply to a price request and pull out the numbers.',
  '',
  'Return ONLY a valid JSON object (no markdown fences):',
  '  unit_cost      — the price PER UNIT they are quoting, as a number, or null',
  '  currency       — ISO code, "USD" unless another currency is clearly stated',
  '  moq            — minimum order quantity if stated, else null',
  '  lead_time_days — lead time in DAYS if stated (convert weeks x7), else null',
  '  declined       — true only if they explicitly say they cannot or will not quote',
  '  confidence     — 0-100: how sure you are this is a firm unit price for the item asked about',
  '  evidence       — the exact sentence or fragment the unit price came from',
  '  notes          — any condition attached to the price (freight, validity, tiers), or null',
  '',
  'RULES:',
  '- NEVER invent a number. If no price is stated, unit_cost is null and confidence is 0.',
  '- If the reply gives a TOTAL for a quantity rather than a unit price, divide only when',
  '  the quantity is explicitly stated, and say so in notes. Otherwise return null.',
  '- If several tiered prices are given, return the one for the quantity mentioned in the',
  '  request context; if that is ambiguous, return the price for the SMALLEST tier and',
  '  explain the tiers in notes, with confidence at or below 60.',
  '- Prices "each"/"ea"/"per unit"/"/ea" are unit prices. Prices "per case"/"per pallet"',
  '  are NOT unit prices unless the pack size is stated — say so in notes and lower confidence.',
  '- If the text is not a supplier reply at all, return nulls with confidence 0.',
].join('\n');

export const POST = createSessionReadRoute(async ({ req, log }) => {
  const body = RequestSchema.parse(await req.json());

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(degraded(false,
      'AI reading unavailable (OPENAI_API_KEY not configured) — type the quoted price in manually.'));
  }

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            body.item_name ? `We asked about: ${body.item_name}` : null,
            body.vendor_name ? `Reply is from: ${body.vendor_name}` : null,
            '',
            'Their reply:',
            body.text.slice(0, 12000),
          ].filter((l) => l !== null).join('\n'),
        },
      ],
      temperature: 0.1,
      max_tokens: 500,
    });

    const content = completion.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return Response.json(degraded(true, 'AI returned nothing — type the quoted price in manually.'));
    }
    let jsonStr = content;
    const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) jsonStr = fence[1].trim();
    const raw = JSON.parse(jsonStr);

    const unitCost = num(raw?.unit_cost);
    const result: ExtractedQuote = {
      configured: true,
      unit_cost: unitCost,
      currency: typeof raw?.currency === 'string' && /^[A-Za-z]{3}$/.test(raw.currency) ? raw.currency.toUpperCase() : 'USD',
      moq: num(raw?.moq),
      lead_time_days: raw?.lead_time_days !== null && raw?.lead_time_days !== undefined && Number.isFinite(Number(raw.lead_time_days))
        ? Math.max(0, Math.round(Number(raw.lead_time_days)))
        : null,
      declined: raw?.declined === true,
      // No number read means no confidence, whatever the model claims.
      confidence: unitCost === null ? 0 : clamp100(raw?.confidence),
      evidence: typeof raw?.evidence === 'string' ? raw.evidence.trim().slice(0, 500) : null,
      notes: typeof raw?.notes === 'string' && raw.notes.trim() ? raw.notes.trim().slice(0, 1000) : null,
    };
    if (result.unit_cost === null && !result.declined) {
      result.message = 'No firm unit price found in that text — type the number in manually.';
    } else if (result.confidence < 60 && result.unit_cost !== null) {
      result.message = 'Low confidence — check this against the reply before you record it.';
    }

    log.info('price_wars.quote_extracted', { has_price: result.unit_cost !== null, confidence: result.confidence });
    return Response.json(result);
  } catch (err: any) {
    log.error('price_wars.extract_failed', { error: err?.message });
    return Response.json(degraded(true,
      `AI reading failed (${err?.message ?? 'unknown error'}) — type the quoted price in manually.`));
  }
}, { serviceName: SERVICE_NAME });
