/**
 * Handwritten-list photo → structured shopping-list lines (snap-and-buy item 04).
 *
 * POST /api/inventory/purchasing/shopping-list/extract
 *   { image_data }  — a base64 image data URL ("data:image/jpeg;base64,<...>"),
 *   the same encoding item 01's /vendors/extract-card and the mobile capture
 *   routes use (JPEG/PNG/WEBP, ≤5MB decoded).
 *
 *   → 200 {
 *       configured: true,
 *       legible: boolean,                       // false = photo is hopeless, don't guess
 *       lines: [ { qty, text, confidence } ],   // confidence 0-100 PER LINE
 *       raw_text: string | null,                // full transcription (or what was seen)
 *       message?: string,                       // human caveat when degraded/illegible
 *     }
 *
 * This is deliberately a dumb transcriber: it reads the handwriting into
 * qty+text lines and reports per-line confidence honestly (uncertain words are
 * transcribed with LOW confidence, never silently "fixed"). Catalog matching is
 * NOT done here — callers feed the lines to the existing deterministic matcher
 * via POST /shopping-list/suggest { text }, so web and mobile (item 06) share
 * one extraction contract and one matching path.
 *
 * No OPENAI_API_KEY → 200 { configured: false, ... } so clients degrade to the
 * manual/paste path (mirrors /vendors/extract-card and @/lib/external-orders).
 *
 * Session POST-that-extracts, mutating nothing — createSessionReadRoute, the
 * same factory item 01's extract-card landed for exactly this shape of call.
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import OpenAI from 'openai';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/** Vision model — same choice as extract-card and the guided-purchase capture
 *  extraction (plain gpt-4o; the search-preview gotcha is web-search only). */
const VISION_MODEL = 'gpt-4o';

const RequestSchema = z.object({
  image_data: z.string().min(1, 'image_data is required'),
});

// ── Response shape (item 06's mobile flow consumes this contract too) ─────────

export interface ExtractedListLine {
  /** How many the writer wants (1 when no quantity was written). */
  qty: number;
  /** The item as written — sizes/grades stay in the text ("2in ball valve"). */
  text: string;
  /** 0-100: how sure the model is it read THIS line correctly. */
  confidence: number;
}

interface ExtractListResponse {
  configured: boolean;
  legible: boolean;
  lines: ExtractedListLine[];
  raw_text: string | null;
  message?: string;
}

function degraded(configured: boolean, message: string, raw_text: string | null = null): ExtractListResponse {
  return { configured, legible: false, lines: [], raw_text, message };
}

// ── Normalization ─────────────────────────────────────────────────────────────

function clamp100(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Coerce the model's JSON into the strict response shape. Never invents lines. */
function normalizeListExtraction(raw: any): { legible: boolean; lines: ExtractedListLine[]; raw_text: string | null } {
  const legible = raw?.legible !== false; // default true when lines came back
  const rawLines: any[] = Array.isArray(raw?.lines) ? raw.lines : [];
  const lines: ExtractedListLine[] = [];
  for (const l of rawLines.slice(0, 100)) {
    const text = typeof l?.text === 'string' ? l.text.trim().slice(0, 300) : '';
    if (!text) continue;
    const qtyNum = typeof l?.qty === 'number' && Number.isFinite(l.qty) && l.qty > 0 ? l.qty : 1;
    lines.push({ qty: Math.min(qtyNum, 100000), text, confidence: clamp100(l?.confidence) });
  }
  const raw_text = typeof raw?.raw_text === 'string' && raw.raw_text.trim()
    ? raw.raw_text.trim().slice(0, 4000)
    : null;
  return { legible: legible && lines.length > 0, lines, raw_text };
}

const SYSTEM_PROMPT = [
  'You are a procurement assistant for a construction/industrial company.',
  'You will be shown a PHOTO of a handwritten (or printed) supply list — the kind a',
  'crew member scribbles on paper: one wanted item per line, sometimes with a count.',
  'Transcribe it into structured lines so the items can be bought.',
  '',
  'Return ONLY a valid JSON object (no markdown fences):',
  '  legible  — boolean: false ONLY if the photo cannot be read as a list at all',
  '  lines    — array, one entry per list line, in the order written:',
  '    qty        — the COUNT the writer wants (a leading/trailing number like "5",',
  '                 "x3", "(2)"). Default 1 when no count is written.',
  '    text       — the item as written. Sizes, grades and dimensions are part of the',
  '                 item, NOT the qty ("2in ball valve", "2x4 lumber" → qty stays 1',
  '                 unless a separate count is written).',
  '    confidence — 0-100: how sure you are you read THIS line correctly',
  '  raw_text — the full transcription as plain text with line breaks (or, when',
  '             legible is false, a one-line description of what the photo shows)',
  '',
  'CRITICAL RULES:',
  '- NEVER invent items or silently "fix" words you cannot read. Transcribe your best',
  '  reading and give the line a LOW confidence (below 50) so a human checks it.',
  '- A totally unreadable word becomes "[?]" inside the text.',
  '- Ignore crossed-out lines, doodles, headers like "NEED" / dates / signatures.',
  '- Keep shorthand as written ("qt", "gal", "pcs") — do not expand or translate it.',
  '- If the photo is not a list (or is too blurry/dark to read), return legible: false,',
  '  lines: [], and describe what you see in raw_text.',
].join('\n');

export const POST = createSessionReadRoute(async ({ req, log }) => {
  const body = RequestSchema.parse(await req.json());

  const match = body.image_data.match(/^data:image\/(\w+);base64,/);
  if (!match) {
    return Response.json({ error: 'image_data must be a base64 image data URL (data:image/...;base64,...)' }, { status: 400 });
  }
  // ~4/3 base64 expansion: bound the decoded size at 5MB like the capture routes.
  if (body.image_data.length > 7 * 1024 * 1024) {
    return Response.json({ error: 'Image exceeds the 5MB limit — retake or downscale the photo.' }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(degraded(false,
      'AI list reading unavailable (OPENAI_API_KEY not configured) — add the items manually instead.'));
  }

  let extracted: ReturnType<typeof normalizeListExtraction>;
  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Here is the photo of the supply list. Transcribe it as JSON.' },
            // 'high' detail: handwriting is small and messy — single image, bounded cost.
            { type: 'image_url', image_url: { url: body.image_data, detail: 'high' } },
          ] as any,
        },
      ],
      temperature: 0.1,
      max_tokens: 1500,
    });

    const content = completion.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return Response.json(degraded(true, 'AI returned an empty response — try again or add the items manually.'));
    }
    let jsonStr = content;
    const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) jsonStr = fence[1].trim();
    extracted = normalizeListExtraction(JSON.parse(jsonStr));
  } catch (err: any) {
    log.error('shopping_list.extract_failed', { error: err?.message });
    return Response.json(degraded(true,
      `AI list extraction failed (${err?.message ?? 'unknown error'}) — add the items manually instead.`));
  }

  log.info('shopping_list.extracted', {
    legible: extracted.legible,
    line_count: extracted.lines.length,
    low_confidence: extracted.lines.filter((l) => l.confidence < 50).length,
  });

  const response: ExtractListResponse = {
    configured: true,
    legible: extracted.legible,
    lines: extracted.lines,
    raw_text: extracted.raw_text,
    ...(extracted.legible
      ? {}
      : { message: "Couldn't read a list in this photo — lay it flat in good light and retake it, or add the items manually." }),
  };
  return Response.json(response);
}, { serviceName: SERVICE_NAME });
