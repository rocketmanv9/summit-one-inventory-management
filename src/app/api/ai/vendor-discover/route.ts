/**
 * Vendor Discovery API Route
 * Natural-language, location-aware web search that returns a LIST of candidate
 * vendors for the user to review and add. Distinct from /api/ai/vendor-search,
 * which enriches a single vendor by name.
 *
 * POST { query: string }
 *   e.g. "auto parts vendor near Portland", "a FleetPride branch in Vancouver WA"
 * Returns { results: VendorCandidate[] }
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import OpenAI from 'openai';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function empty() {
  return Response.json({ results: [] });
}

export const POST = createSessionReadRoute(async ({ req, log }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return empty();
  }

  try {
    const body = await req.json();
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      return empty();
    }

    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      web_search_options: {
        search_context_size: 'medium',
      },
      messages: [
        {
          role: 'system',
          content: [
            'You are a procurement research assistant for a construction / asphalt-paving company.',
            'The user describes a kind of supplier and (usually) a location — for example',
            '"auto parts vendor near Portland" or "a FleetPride branch in Vancouver WA".',
            'Use web search to find up to 6 REAL businesses that match the request.',
            'Strongly prefer the local branch/store that has a real street address and phone number',
            'over a national corporate headquarters. Correct obvious typos in company or place names first.',
            'Return ONLY a valid JSON object of the form {"results": [ ... ]}.',
            'Each item may include these fields (omit any you cannot find, but every result MUST have a name):',
            '  name      — official business / branch name',
            '  code      — short uppercase abbreviation (e.g. FLEETPRIDE)',
            '  category  — short label of what they sell (e.g. "Auto parts", "Heavy truck parts")',
            '  street1   — street address line',
            '  city      — city',
            '  state     — 2-letter state code',
            '  zip       — postal code',
            '  phone     — main phone number',
            '  email     — general / contact email if available',
            '  website   — website URL',
            'Drop any result that has neither a street address nor a phone number (too generic to be useful).',
            'Do NOT wrap the JSON in markdown code fences. If you find nothing, return {"results": []}.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: query,
        },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    } as any);

    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      return empty();
    }

    // Extract JSON (handle possible markdown fences the model may add anyway).
    let jsonStr = content.trim();
    const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
      jsonStr = fence[1].trim();
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return empty();
    }

    const rawList: any[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.results)
        ? parsed.results
        : [];

    const fields = ['name', 'code', 'category', 'street1', 'city', 'state', 'zip', 'phone', 'email', 'website'] as const;

    const results = rawList
      .map((item) => {
        const out: Record<string, string> = {};
        for (const f of fields) {
          const v = item?.[f];
          if (typeof v === 'string' && v.trim()) out[f] = v.trim();
        }
        return out;
      })
      // Require a name plus at least one locating detail (address or phone).
      .filter((r) => r.name && (r.street1 || r.phone))
      .slice(0, 6);

    return Response.json({ results });
  } catch (err: any) {
    log.error('[Vendor Discover] Error:', err?.message || err);
    return empty();
  }
}, { serviceName: SERVICE_NAME });
