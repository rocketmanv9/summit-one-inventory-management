/**
 * AI Item Suggest API Route
 *
 * Given a catalog item name (and existing categories), uses OpenAI to suggest:
 * - SKU prefix
 * - Description
 * - Category (matched to existing or suggested new)
 * - Unit of measure
 * - Tracking mode
 *
 * Used by the "Add New Item" wizard for AI-powered auto-fill.
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import OpenAI from 'openai';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const RequestSchema = z.object({
  name: z.string().min(1, 'Item name is required'),
  existing_categories: z.array(z.object({
    id: z.string(),
    name: z.string(),
    sku_prefix: z.string().nullable().optional(),
  })).optional().default([]),
});

export const POST = createSessionReadRoute(async ({ req, log }) => {
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

  const { name, existing_categories } = parsed.data;

  const categoryList = existing_categories.length > 0
    ? existing_categories.map(c => `- "${c.name}" (prefix: ${c.sku_prefix || 'none'})`).join('\n')
    : '(no categories exist yet)';

  try {
    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: [
            'You are an inventory management specialist for construction, infrastructure, and industrial companies.',
            'Given an item name, suggest standardized catalog fields.',
            '',
            'Return ONLY a valid JSON object with these fields:',
            '  sku_prefix    — 2-5 char uppercase prefix for SKU generation (e.g. "HMA", "RB4", "DSL")',
            '  description   — concise professional description (1-2 sentences)',
            '  category      — pick the BEST match from the existing categories list below, or suggest a new one',
            '  category_match — "existing" if you picked from the list, "new" if suggesting a new category',
            '  unit_of_measure — one of: EA, BOX, CASE, LB, KG, TON, GAL, LTR, FT, M, YD, PALLET, ROLL, BAG, DRUM',
            '  tracking_mode — one of: "stock" (bulk/quantity items), "serialized" (individual tracked assets like equipment), "both" (items that can be either)',
            '  reorder_point — suggested default reorder point (integer) for a mid-size company',
            '',
            'EXISTING CATEGORIES:',
            categoryList,
            '',
            'Rules:',
            '- For category: prefer an existing category if it is a reasonable match. Only suggest "new" if nothing fits.',
            '- For unit_of_measure: use industry-standard UOM (cement → BAG or TON, lumber → FT or EA, fuel → GAL, fasteners → EA or BOX).',
            '- For tracking_mode: most materials are "stock". Equipment, tools, and high-value assets are "serialized".',
            '- Do NOT wrap the JSON in markdown code fences.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Item name: "${name}"`,
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

    // Resolve category to existing ID if matched
    let category_id: string | null = null;
    let new_category_name: string | null = null;

    if (suggestion.category_match === 'existing' && suggestion.category) {
      const match = existing_categories.find(
        c => c.name.toLowerCase() === suggestion.category.toLowerCase()
      );
      if (match) {
        category_id = match.id;
      } else {
        // Fuzzy fallback — find closest
        const lower = suggestion.category.toLowerCase();
        const fuzzy = existing_categories.find(
          c => c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase())
        );
        if (fuzzy) {
          category_id = fuzzy.id;
        } else {
          new_category_name = suggestion.category;
        }
      }
    } else if (suggestion.category) {
      new_category_name = suggestion.category;
    }

    // Validate UOM against allowed values
    const VALID_UOMS = ['EA', 'BOX', 'CASE', 'LB', 'KG', 'TON', 'GAL', 'LTR', 'FT', 'M', 'YD', 'PALLET', 'ROLL', 'BAG', 'DRUM'];
    const uom = VALID_UOMS.includes(suggestion.unit_of_measure?.toUpperCase())
      ? suggestion.unit_of_measure.toUpperCase()
      : 'EA';

    // Validate tracking mode
    const VALID_MODES = ['stock', 'serialized', 'both'];
    const tracking = VALID_MODES.includes(suggestion.tracking_mode)
      ? suggestion.tracking_mode
      : 'stock';

    log.info(`[AI Item Suggest] name="${name}" → category="${suggestion.category}" uom=${uom} tracking=${tracking}`);

    return Response.json({
      suggestion: {
        description: suggestion.description || '',
        sku_prefix: suggestion.sku_prefix || '',
        category_id,
        new_category_name,
        category_display: suggestion.category || '',
        unit_of_measure: uom,
        tracking_mode: tracking,
        reorder_point: typeof suggestion.reorder_point === 'number' ? suggestion.reorder_point : null,
      },
    });
  } catch (err: any) {
    log.error(`[AI Item Suggest] Failed: ${err.message}`);
    return Response.json({ error: 'Failed to generate suggestions. Try again.' }, { status: 500 });
  }
}, { serviceName: SERVICE_NAME });
