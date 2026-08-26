/**
 * Price wars — shared quote extraction.
 *
 * A supplier's emailed reply ("we can do $41.50/ea on 100+, 5 day lead") goes in;
 * a structured { unit_cost, currency, moq, lead_time_days, declined, confidence,
 * evidence, notes } comes out. The model NEVER invents a number — no price in the
 * text means unit_cost null and confidence 0.
 *
 * Both the buyer-paste route (POST /extract-quote) and the inbox monitor
 * (POST /ingest-replies) call this so the two paths read a price the same way.
 */

import OpenAI from 'openai';

const MODEL = 'gpt-4o';

export interface ExtractedQuote {
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

export interface ExtractQuoteInput {
  text: string;
  item_name?: string | null;
  vendor_name?: string | null;
}

export function degradedQuote(configured: boolean, message: string): ExtractedQuote {
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

// ── Multi-line extraction (one reply quoting SEVERAL items) ──────────────────
//
// Since send-invites mails ONE combined RFQ per vendor covering every line of a
// request, a vendor naturally answers with one email quoting several items. The
// caller (ingest-replies) passes the vendor's open lines as CANDIDATES; the
// model may only attach prices to those refs — it can neither invent an item
// nor invent a number. An item the vendor didn't price simply doesn't appear.

/** One line the vendor was asked to quote — server-provided, model may only pick from these. */
export interface QuoteLineCandidate {
  /** Opaque server-assigned ref ("L1", "L2", …) the model must echo back. */
  ref: string;
  item_name: string;
  qty?: number | null;
}

/** One line the vendor actually quoted. Only refs from the candidate list survive validation. */
export interface ExtractedQuoteLine {
  ref: string;
  unit_cost: number;
  currency: string;
  moq: number | null;
  lead_time_days: number | null;
  confidence: number;
  evidence: string | null;
  notes: string | null;
}

export interface ExtractedQuoteLines {
  configured: boolean;
  /** True only when the vendor explicitly bows out of quoting altogether. */
  declined: boolean;
  /** The lines that carried a firm price. Empty + !declined = price unclear. */
  lines: ExtractedQuoteLine[];
  notes: string | null;
  message?: string;
}

export interface ExtractQuoteLinesInput {
  text: string;
  vendor_name?: string | null;
  candidates: QuoteLineCandidate[];
}

function degradedQuoteLines(configured: boolean, message: string): ExtractedQuoteLines {
  return { configured, declined: false, lines: [], notes: null, message };
}

const MULTI_SYSTEM_PROMPT = [
  'You read a supplier\'s emailed reply to a request-for-quote that covered SEVERAL items,',
  'and pull out the price for each item they actually quoted.',
  '',
  'You are given the list of items we asked about, each with a ref code (L1, L2, ...).',
  'Return ONLY a valid JSON object (no markdown fences):',
  '  {',
  '    "declined": bool — true only if they explicitly say they cannot or will not quote AT ALL,',
  '    "notes": string or null — anything that applies to the whole reply (freight, validity),',
  '    "lines": [',
  '      {',
  '        "ref"            — the ref code of the item this price belongs to (MUST be from the list),',
  '        "unit_cost"      — the price PER UNIT they quoted for that item, as a number,',
  '        "currency"       — ISO code, "USD" unless another currency is clearly stated,',
  '        "moq"            — minimum order quantity for that line if stated, else null,',
  '        "lead_time_days" — lead time in DAYS if stated (convert weeks x7), else null,',
  '        "confidence"     — 0-100: how sure you are this is a firm unit price for THAT item,',
  '        "evidence"       — the exact sentence or fragment the price came from,',
  '        "notes"          — any condition attached to that line, or null',
  '      }',
  '    ]',
  '  }',
  '',
  'RULES:',
  '- NEVER invent a number and NEVER invent an item. Only include a line when the reply',
  '  states a price you can confidently attach to one of the listed refs.',
  '- "We are reviewing", "we will get back to you", "pricing coming next week" and similar',
  '  hold-tight replies are NOT a decline: set declined to false and return no lines.',
  '  declined is ONLY for an explicit refusal ("we cannot quote", "we do not carry any of',
  '  these", "not interested").',
  '- An item the reply does not price is simply OMITTED from lines — no placeholder, no guess.',
  '- If a price is stated but you cannot tell WHICH listed item it belongs to, omit it and',
  '  explain in notes.',
  '- At most one line per ref. If the reply gives a TOTAL for a quantity rather than a unit',
  '  price, divide only when the quantity is explicitly stated, and say so in that line\'s notes.',
  '- If several tiered prices are given for an item, use the tier matching the quantity we',
  '  asked for; if ambiguous, use the SMALLEST tier, explain in notes, confidence <= 60.',
  '- Prices "each"/"ea"/"per unit"/"/ea" are unit prices. "per case"/"per pallet" are NOT',
  '  unless the pack size is stated — note it and lower confidence.',
  '- If the text is not a supplier reply at all, return {"declined": false, "lines": []}.',
].join('\n');

/**
 * Read per-item unit prices out of a supplier reply that may quote several of
 * the lines we invited them on. Same honesty contract as `extractQuoteFromText`:
 * degrades to zero lines (never a guess), and only refs from `candidates`
 * survive. Mutates nothing.
 */
export async function extractQuoteLinesFromText(input: ExtractQuoteLinesInput): Promise<ExtractedQuoteLines> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return degradedQuoteLines(false,
      'AI reading unavailable (OPENAI_API_KEY not configured) — type the quoted prices in manually.');
  }
  if (input.candidates.length === 0) {
    return degradedQuoteLines(true, 'No open lines to match prices against.');
  }

  try {
    const openai = new OpenAI({ apiKey });
    const candidateBlock = input.candidates
      .map((c) => `  ${c.ref}: ${c.item_name}${c.qty ? ` (we asked about qty ${c.qty})` : ''}`)
      .join('\n');
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: MULTI_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            'Items we asked this vendor to quote:',
            candidateBlock,
            input.vendor_name ? `\nReply is from: ${input.vendor_name}` : null,
            '',
            'Their reply:',
            input.text.slice(0, 12000),
          ].filter((l) => l !== null).join('\n'),
        },
      ],
      temperature: 0.1,
      max_tokens: 1500,
    });

    const content = completion.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return degradedQuoteLines(true, 'AI returned nothing — type the quoted prices in manually.');
    }
    let jsonStr = content;
    const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) jsonStr = fence[1].trim();
    const raw = JSON.parse(jsonStr);

    // Server-side validation: only known refs, one line per ref, real numbers only.
    const validRefs = new Set(input.candidates.map((c) => c.ref));
    const seen = new Set<string>();
    const lines: ExtractedQuoteLine[] = [];
    for (const l of Array.isArray(raw?.lines) ? raw.lines : []) {
      const ref = typeof l?.ref === 'string' ? l.ref.trim() : '';
      if (!validRefs.has(ref) || seen.has(ref)) continue; // model may not invent items
      const unitCost = num(l?.unit_cost);
      if (unitCost === null) continue; // no firm number read for this line — never a guess
      seen.add(ref);
      lines.push({
        ref,
        unit_cost: unitCost,
        currency: typeof l?.currency === 'string' && /^[A-Za-z]{3}$/.test(l.currency) ? l.currency.toUpperCase() : 'USD',
        moq: num(l?.moq),
        lead_time_days: l?.lead_time_days !== null && l?.lead_time_days !== undefined && Number.isFinite(Number(l.lead_time_days))
          ? Math.max(0, Math.round(Number(l.lead_time_days)))
          : null,
        confidence: clamp100(l?.confidence),
        evidence: typeof l?.evidence === 'string' ? l.evidence.trim().slice(0, 500) : null,
        notes: typeof l?.notes === 'string' && l.notes.trim() ? l.notes.trim().slice(0, 1000) : null,
      });
    }

    const result: ExtractedQuoteLines = {
      configured: true,
      declined: raw?.declined === true,
      lines,
      notes: typeof raw?.notes === 'string' && raw.notes.trim() ? raw.notes.trim().slice(0, 1000) : null,
    };
    if (lines.length === 0 && !result.declined) {
      result.message = 'No firm unit prices found in that text — type the numbers in manually.';
    }
    return result;
  } catch (err: any) {
    return degradedQuoteLines(true,
      `AI reading failed (${err?.message ?? 'unknown error'}) — type the quoted prices in manually.`);
  }
}

/**
 * Read a unit price out of a supplier reply. Degrades honestly: no key,
 * unreadable text, or an AI error all return confidence 0 with a message telling
 * the caller to type the number instead. Mutates nothing.
 */
export async function extractQuoteFromText(input: ExtractQuoteInput): Promise<ExtractedQuote> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return degradedQuote(false,
      'AI reading unavailable (OPENAI_API_KEY not configured) — type the quoted price in manually.');
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
            input.item_name ? `We asked about: ${input.item_name}` : null,
            input.vendor_name ? `Reply is from: ${input.vendor_name}` : null,
            '',
            'Their reply:',
            input.text.slice(0, 12000),
          ].filter((l) => l !== null).join('\n'),
        },
      ],
      temperature: 0.1,
      max_tokens: 500,
    });

    const content = completion.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return degradedQuote(true, 'AI returned nothing — type the quoted price in manually.');
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
    return result;
  } catch (err: any) {
    return degradedQuote(true,
      `AI reading failed (${err?.message ?? 'unknown error'}) — type the quoted price in manually.`);
  }
}
