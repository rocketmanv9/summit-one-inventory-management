/**
 * Business-card scan → vendor intake (snap-and-buy item 01).
 *
 * POST /api/inventory/vendors/extract-card
 *   { image_data }  — a base64 image data URL ("data:image/jpeg;base64,<...>"),
 *   the same encoding the mobile side sends to /api/ai/item-image/analyze and
 *   /api/inventory/external-orders/[id]/captures (JPEG/PNG/WEBP, ≤5MB decoded).
 *
 *   → 200 {
 *       configured: true,
 *       vendor: { name, phone, email, website, address:{line1,city,state,zip},
 *                 contact:{first,last,title} },
 *       confidence: 0-100,
 *       field_confidence: { name, phone, email, website, address, contact },
 *       raw_text,
 *       match_candidates: VendorMatch[],   // dedup, inline — one round trip
 *       strongThreshold, hintThreshold,
 *     }
 *
 * The extracted fields are ALSO run through the existing vendor matcher
 * (rpc_vendor_match_candidates via findVendorMatches — the exact path
 * POST /api/inventory/vendors/match uses) so the client gets duplicate
 * candidates without a second call. This route only reads/extracts — creating
 * the vendor still goes through the normal POST /api/inventory/vendors
 * 409-unless-force gate, which this feature feeds, never bypasses.
 *
 * No OPENAI_API_KEY → 200 { configured: false, ... } so clients can degrade to
 * manual entry (mirrors the graceful path in @/lib/external-orders).
 *
 * Session POST-that-extracts, mutating nothing — createSessionReadRoute, same
 * as /vendors/match, /ai/vendor-suggest, and /ai/item-image/analyze.
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import OpenAI from 'openai';
import { z } from 'zod';

import {
  findVendorMatches,
  STRONG_MATCH_THRESHOLD,
  HINT_MATCH_THRESHOLD,
  type VendorMatch,
} from '@/lib/vendor-match';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/** Vision model for extraction. Plain gpt-4o is the vision-capable model — the
 *  gpt-4o-search-preview gotcha only applies to web-search calls. Same choice
 *  as the guided-purchase screenshot extraction in @/lib/external-orders. */
const VISION_MODEL = 'gpt-4o';

const RequestSchema = z.object({
  image_data: z.string().min(1, 'image_data is required'),
});

// ── Response shapes ───────────────────────────────────────────────────────────

export interface ExtractedCardVendor {
  name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: { line1: string | null; city: string | null; state: string | null; zip: string | null };
  contact: { first: string | null; last: string | null; title: string | null };
}

interface ExtractCardResponse {
  configured: boolean;
  /** Null when not configured or nothing legible was extracted. */
  vendor: ExtractedCardVendor | null;
  /** Overall 0–100 — how confident the model is this is a business card it read correctly. */
  confidence: number;
  /** Per-field 0–100 confidences. */
  field_confidence: Record<string, number>;
  /** Everything legible on the card, as plain text (for manual fallback/review). */
  raw_text: string | null;
  match_candidates: VendorMatch[];
  strongThreshold: number;
  hintThreshold: number;
  /** Human-readable caveat when degraded (no key / unreadable card / AI error). */
  message?: string;
}

const EMPTY_ADDRESS = { line1: null, city: null, state: null, zip: null };
const EMPTY_CONTACT = { first: null, last: null, title: null };

function degraded(configured: boolean, message: string): ExtractCardResponse {
  return {
    configured,
    vendor: null,
    confidence: 0,
    field_confidence: {},
    raw_text: null,
    match_candidates: [],
    strongThreshold: STRONG_MATCH_THRESHOLD,
    hintThreshold: HINT_MATCH_THRESHOLD,
    message,
  };
}

// ── Normalization helpers ─────────────────────────────────────────────────────

function str(v: unknown, max = 200): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

function clamp100(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** "https://www.acme.com/x" or "sales@acme.com" → "acme.com"; null if implausible. */
function toDomain(input: string | null): string | null {
  if (!input) return null;
  let d = input.trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#\s]/)[0] || '';
  if (d.includes('@')) d = d.split('@')[1] || '';
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d) ? d : null;
}

/** Coerce the model's JSON into the strict card shape. Never invents fields. */
// NOTE: not exported — Next's generated route type check (TS2344) rejects any
// non-HTTP export from a route file, which fails tsc and the Vercel build.
function normalizeCardExtraction(raw: any): {
  vendor: ExtractedCardVendor;
  confidence: number;
  field_confidence: Record<string, number>;
  raw_text: string | null;
} {
  const v = raw?.vendor ?? {};
  const addr = v?.address ?? {};
  const contact = v?.contact ?? {};
  const fc = raw?.field_confidence ?? {};
  const field_confidence: Record<string, number> = {};
  for (const key of ['name', 'phone', 'email', 'website', 'address', 'contact']) {
    field_confidence[key] = clamp100(fc?.[key]);
  }
  return {
    vendor: {
      name: str(v.name),
      phone: str(v.phone, 50),
      email: str(v.email)?.toLowerCase() ?? null,
      website: str(v.website),
      address: {
        line1: str(addr.line1),
        city: str(addr.city, 100),
        state: str(addr.state, 50),
        zip: str(addr.zip, 20),
      },
      contact: {
        first: str(contact.first, 100),
        last: str(contact.last, 100),
        title: str(contact.title, 150),
      },
    },
    confidence: clamp100(raw?.confidence),
    field_confidence,
    raw_text: str(raw?.raw_text, 2000),
  };
}

const SYSTEM_PROMPT = [
  'You are a procurement assistant for a construction/industrial company.',
  'You will be shown a PHOTO of a business card (or a card-like layout). Extract the',
  'company and contact details so a vendor record can be pre-filled.',
  '',
  'Return ONLY a valid JSON object (no markdown fences):',
  '  vendor: {',
  '    name     — the COMPANY name on the card (not the person), or null',
  '    phone    — best business phone number as printed, or null',
  '    email    — the email address printed on the card, or null',
  '    website  — the website printed on the card (add https:// if missing), or null',
  '    address  — { line1, city, state, zip } from the printed address; each null if absent',
  '    contact  — { first, last, title } for the PERSON named on the card; each null if absent',
  '  }',
  '  confidence       — 0-100 overall: how sure you are this is a business card you read correctly',
  '  field_confidence — { name, phone, email, website, address, contact } each 0-100',
  '  raw_text         — ALL legible text on the card, as plain text with line breaks',
  '',
  'CRITICAL RULES:',
  '- NEVER invent or complete details that are not printed on the card. Absent → null.',
  '- Transcribe exactly what is printed (fix obvious OCR spacing only).',
  '- If the person\'s name is shown but not split, split it into first/last sensibly.',
  '- If the image is not a business card (or is unreadable), return all-null fields,',
  '  confidence ≤ 10, and describe what you see in raw_text.',
].join('\n');

export const POST = createSessionReadRoute(async ({ req, session, log }) => {
  const body = RequestSchema.parse(await req.json());

  const match = body.image_data.match(/^data:image\/(\w+);base64,/);
  if (!match) {
    return Response.json({ error: 'image_data must be a base64 image data URL (data:image/...;base64,...)' }, { status: 400 });
  }
  // ~4/3 base64 expansion: bound the decoded size at 5MB like the capture route.
  if (body.image_data.length > 7 * 1024 * 1024) {
    return Response.json({ error: 'Image exceeds the 5MB limit — retake or downscale the photo.' }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(degraded(false,
      'AI card scanning unavailable (OPENAI_API_KEY not configured) — enter the vendor details manually.'));
  }

  let extracted: ReturnType<typeof normalizeCardExtraction>;
  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Here is the business card photo. Extract the vendor as JSON.' },
            // 'high' detail: card text is small — this is a single image, so the
            // cost stays bounded (unlike the 8-capture guided-purchase batch).
            { type: 'image_url', image_url: { url: body.image_data, detail: 'high' } },
          ] as any,
        },
      ],
      temperature: 0.1,
      max_tokens: 900,
    });

    const content = completion.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return Response.json(degraded(true, 'AI returned an empty response — try again or enter the details manually.'));
    }
    let jsonStr = content;
    const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) jsonStr = fence[1].trim();
    extracted = normalizeCardExtraction(JSON.parse(jsonStr));
  } catch (err: any) {
    log.error('vendor.card_extract_failed', { error: err?.message });
    return Response.json(degraded(true,
      `AI card extraction failed (${err?.message ?? 'unknown error'}) — enter the vendor details manually.`));
  }

  // Dedup wiring: score the extracted vendor against existing vendors via the
  // same matcher /vendors/match uses, returned inline. Matcher failures never
  // block extraction (findVendorMatches logs and returns []).
  let matchCandidates: VendorMatch[] = [];
  const name = extracted.vendor.name;
  if (name && name.length >= 2) {
    const supabase = await createTenantServiceClient({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      tenantId: session.tenantId!,
    });
    const sc = (supabase as any).schema('supply_chain');
    matchCandidates = await findVendorMatches(sc, session.tenantId!, {
      name,
      street1: extracted.vendor.address.line1,
      city: extracted.vendor.address.city,
      state: extracted.vendor.address.state,
      zip: extracted.vendor.address.zip,
      website: extracted.vendor.website,
      email: extracted.vendor.email,
      domain: toDomain(extracted.vendor.email) ?? toDomain(extracted.vendor.website),
      phone: extracted.vendor.phone,
    }, log);
  }

  log.info('vendor.card_extracted', {
    has_name: !!name,
    confidence: extracted.confidence,
    match_count: matchCandidates.length,
  });

  const response: ExtractCardResponse = {
    configured: true,
    vendor: extracted.vendor,
    confidence: extracted.confidence,
    field_confidence: extracted.field_confidence,
    raw_text: extracted.raw_text,
    match_candidates: matchCandidates,
    strongThreshold: STRONG_MATCH_THRESHOLD,
    hintThreshold: HINT_MATCH_THRESHOLD,
  };
  return Response.json(response);
}, { serviceName: SERVICE_NAME });
