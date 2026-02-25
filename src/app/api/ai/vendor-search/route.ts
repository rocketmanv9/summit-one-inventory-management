/**
 * Vendor Web Search API Route
 * Uses OpenAI's web_search tool to look up vendor/company contact details.
 *
 * POST { name: string }
 * Returns { found: true, vendor: {...} } or { found: false }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import OpenAI from 'openai';

function notFound() {
  return NextResponse.json({ found: false });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return notFound();
  }

  try {
    const body = await request.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';

    if (!name) {
      return notFound();
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
            'You are a company research assistant.',
            'The company name may contain typos or misspellings. Correct them before searching. For example "oldea casstle" means "Old Castle", "home depo" means "Home Depot". Always search for the most likely correct company name.',
            'Search the web for the given company and return a JSON object with whatever contact details you can find.',
            'Return ONLY a valid JSON object with these fields (omit any you cannot find):',
            '  name           — official company name',
            '  code           — short uppercase abbreviation (e.g. ACME)',
            '  contact_name   — a key contact person (e.g. CEO, sales manager)',
            '  contact_email  — main contact or general email',
            '  contact_phone  — main phone number',
            '  address        — full business address (street, city, state, zip)',
            '  website        — company website URL',
            'Do NOT wrap the JSON in markdown code fences.',
            'If you cannot find the company at all, return: {"not_found": true}',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Look up this company: "${name}"`,
        },
      ],
      temperature: 0.2,
      max_tokens: 400,
    } as any);

    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      return notFound();
    }

    // Extract JSON from the response (handle possible markdown fences)
    let jsonStr = content.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    if (parsed.not_found) {
      return notFound();
    }

    // Only keep known fields with non-empty string values
    const fields = ['name', 'code', 'contact_name', 'contact_email', 'contact_phone', 'address', 'website'] as const;
    const vendor: Record<string, string> = {};
    for (const field of fields) {
      const val = parsed[field];
      if (typeof val === 'string' && val.trim()) {
        vendor[field] = val.trim();
      }
    }

    if (Object.keys(vendor).length === 0) {
      return notFound();
    }

    return NextResponse.json({ found: true, vendor });
  } catch (err: any) {
    console.error('[Vendor Search] Error:', err.message || err);
    return notFound();
  }
}
