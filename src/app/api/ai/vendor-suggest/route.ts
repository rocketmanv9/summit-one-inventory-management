/**
 * AI Vendor Suggest API Route
 *
 * Given a vendor name OR a website URL, uses OpenAI to suggest a full vendor
 * record for the quick-add flow:
 * - canonical name
 * - vendor code (2-6 uppercase)
 * - website
 * - likely email domain(s) (for supply_chain.vendor_email_domains — the
 *   email → item-suggestions scanner uses these to match vendors)
 * - vendor type (resolved to a GV vendor_type term)
 * - one-line description
 * - likely HQ city/state if broadly known
 *
 * Phone numbers and exact street addresses are never invented — always null.
 * Mirrors the item-suggest route (gpt-4.1-mini, JSON response, zod-validated).
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import OpenAI from 'openai';
import { z } from 'zod';
import { getGVClient } from '@/lib/gv';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const RequestSchema = z.object({
  name_or_url: z.string().min(2, 'Vendor name or website is required'),
});

// Personal-mail domains are never useful for vendor matching.
const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'aol.com', 'icloud.com', 'me.com', 'live.com',
]);

/** Normalize a domain-ish string ("https://www.grainger.com/cat", "sales@x.com")
 *  to a bare lowercase domain, or null if it isn't a plausible company domain. */
function normalizeDomain(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let d = input.trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '');
  d = d.split(/[/?#\s]/)[0] || '';
  if (d.includes('@')) d = d.split('@')[1] || '';
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d)) return null;
  if (FREEMAIL_DOMAINS.has(d)) return null;
  return d;
}

/** Sanitize an AI-suggested vendor code to 2-6 uppercase alphanumerics, falling
 *  back to a prefix of the vendor name. Returns '' if nothing usable (the UI
 *  leaves the field blank so tenant sequential codes can kick in). */
function sanitizeVendorCode(raw: unknown, fallbackName: string): string {
  let code = typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  if (code.length < 2) code = fallbackName.toUpperCase().replace(/[^A-Z0-9]/g, '');
  code = code.slice(0, 6);
  return code.length >= 2 ? code : '';
}

/** Normalize a website value to an https URL, or null. */
function normalizeWebsite(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const v = raw.trim();
  if (/^https?:\/\//i.test(v)) return v;
  const domain = normalizeDomain(v);
  return domain ? `https://${domain}` : null;
}

export const POST = createSessionReadRoute(async ({ req, session, log }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'AI suggestions unavailable — OPENAI_API_KEY not configured.' },
      { status: 503 }
    );
  }

  const body = await req.json();
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || 'Invalid request' },
      { status: 400 }
    );
  }

  const { name_or_url } = parsed.data;
  // If the user pasted a website, its domain is ground truth — keep it.
  const inputDomain = normalizeDomain(name_or_url);

  // Fetch valid vendor_type terms from GV for the prompt and term resolution.
  let typeLabelMap: Record<string, string> = {}; // termId → label
  let typeLabels: string[];
  const FALLBACK_TYPE_LABELS = ['Supplier', 'Distributor', 'Subcontractor', 'Equipment Rental'];
  try {
    const gv = getGVClient();
    const rawMap = await gv.buildLabelMap(session.tenantId!, 'vendor_type');
    typeLabelMap = rawMap instanceof Map ? Object.fromEntries(rawMap) : rawMap as Record<string, string>;
    typeLabels = Object.keys(typeLabelMap).length > 0
      ? Object.values(typeLabelMap)
      : FALLBACK_TYPE_LABELS;
  } catch {
    typeLabels = FALLBACK_TYPE_LABELS;
  }

  // Reverse lookup: lowercase label → termId.
  const labelToTermId: Record<string, string> = {};
  for (const [termId, label] of Object.entries(typeLabelMap)) {
    labelToTermId[label.toLowerCase()] = termId;
  }

  try {
    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: [
            'You are a procurement and vendor-management specialist for construction, infrastructure, and industrial companies.',
            'Given a vendor/supplier company name or website, suggest standardized vendor-record fields.',
            '',
            'Return ONLY a valid JSON object with these fields:',
            '  name          — canonical company name as commonly written (e.g. "Grainger", "Home Depot", "Fastenal")',
            '  code          — 2-6 char uppercase code for internal reference (e.g. "GRAING", "HD", "FASTL")',
            '  website       — the company\'s main public website URL, or null if not confidently known',
            '  email_domains — array of email domains the company sends business email from (e.g. ["grainger.com"]); include the primary corporate domain and any well-known transactional sender domains; [] if not confidently known',
            `  vendor_type   — the BEST match from: ${typeLabels.join(', ')} — or null if none fits`,
            '  description   — one concise sentence describing what they supply or do',
            '  city          — headquarters city if broadly known, else null',
            '  state         — headquarters state/region abbreviation if broadly known, else null',
            '',
            'Rules:',
            '- Only state facts that are broadly known about the company. When unsure, use null (or [] for email_domains).',
            '- NEVER invent phone numbers or exact street addresses — they are not part of this schema.',
            '- email_domains must be bare lowercase domains ("grainger.com"), never full URLs or addresses.',
            '- If the input is a website URL, derive the company from that domain.',
            '- Do NOT wrap the JSON in markdown code fences.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Vendor name or website: "${name_or_url}"`,
        },
      ],
      temperature: 0.2,
      max_tokens: 400,
    });

    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      return Response.json({ error: 'AI returned empty response' }, { status: 502 });
    }

    // Parse JSON (strip code fences if present)
    let jsonStr = content.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    const suggestion = JSON.parse(jsonStr);

    const name: string = typeof suggestion.name === 'string' && suggestion.name.trim()
      ? suggestion.name.trim()
      : (inputDomain ? inputDomain.split('.')[0] : name_or_url.trim());

    // Email domains: sanitize, drop freemail, always keep a pasted-URL domain.
    const emailDomains = new Set<string>();
    if (inputDomain) emailDomains.add(inputDomain);
    if (Array.isArray(suggestion.email_domains)) {
      for (const d of suggestion.email_domains) {
        const norm = normalizeDomain(d);
        if (norm) emailDomains.add(norm);
        if (emailDomains.size >= 5) break;
      }
    }

    // Website: AI value, else derive from the pasted/derived domain.
    const website = normalizeWebsite(suggestion.website)
      || (inputDomain ? `https://${inputDomain}` : null)
      || (emailDomains.size > 0 ? `https://${[...emailDomains][0]}` : null);

    // Resolve vendor type to a GV term id (exact, then partial label match).
    const aiType = typeof suggestion.vendor_type === 'string' ? suggestion.vendor_type : '';
    let vendorTypeLabel: string | null = aiType || null;
    let vendorTypeTermId: string | null = aiType ? labelToTermId[aiType.toLowerCase()] || null : null;
    if (!vendorTypeTermId && aiType) {
      const lower = aiType.toLowerCase();
      const entry = Object.entries(typeLabelMap).find(
        ([, label]) => label.toLowerCase().includes(lower) || lower.includes(label.toLowerCase())
      );
      if (entry) {
        vendorTypeTermId = entry[0];
        vendorTypeLabel = entry[1];
      }
    }
    if (!vendorTypeTermId) vendorTypeLabel = aiType || null;

    const code = sanitizeVendorCode(suggestion.code, name);

    log.info(`[AI Vendor Suggest] input="${name_or_url}" → name="${name}" code=${code || '(none)'} domains=[${[...emailDomains].join(', ')}] type=${vendorTypeLabel || '-'}`);

    return Response.json({
      suggestion: {
        name,
        code,
        website,
        email_domains: [...emailDomains],
        vendor_type_term_id: vendorTypeTermId,
        vendor_type_label: vendorTypeLabel,
        description: typeof suggestion.description === 'string' ? suggestion.description.trim() : '',
        city: typeof suggestion.city === 'string' && suggestion.city.trim() ? suggestion.city.trim() : null,
        state: typeof suggestion.state === 'string' && suggestion.state.trim() ? suggestion.state.trim() : null,
        // Never AI-invented — always null by contract.
        phone: null,
        street: null,
      },
    });
  } catch (err: any) {
    log.error(`[AI Vendor Suggest] Failed: ${err.message}`);

    // Surface specific OpenAI errors to the user
    if (err.status === 429 || err.code === 'insufficient_quota') {
      return Response.json(
        { error: 'AI quota exceeded — please check OpenAI billing or try again later.' },
        { status: 503 }
      );
    }
    if (err.status === 401) {
      return Response.json(
        { error: 'AI service authentication failed — check OPENAI_API_KEY.' },
        { status: 503 }
      );
    }

    return Response.json({ error: 'Failed to generate suggestions. Try again.' }, { status: 500 });
  }
}, { serviceName: SERVICE_NAME });
