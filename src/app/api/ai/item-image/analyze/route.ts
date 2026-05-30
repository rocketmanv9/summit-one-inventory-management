/**
 * AI Item Image Analyze API Route
 *
 * Given a photo of an item, uses an OpenAI vision model to identify it and
 * suggest standardized catalog fields (name, description, category, UOM,
 * tracking mode, variants) — the photo-driven counterpart to item-suggest.
 * Used by the "Add New Item" wizard and the item detail page.
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import OpenAI from 'openai';
import { z } from 'zod';
import { getGVClient } from '@/lib/gv';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const RequestSchema = z.object({
  image_data: z.string().min(1, 'image_data is required'),
  existing_categories: z.array(z.object({
    id: z.string(),
    name: z.string(),
    sku_prefix: z.string().nullable().optional(),
  })).optional().default([]),
});

export const POST = createSessionReadRoute(async ({ req, session, log }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'AI image analysis unavailable — OPENAI_API_KEY not configured.' }, { status: 503 });
  }

  const parsed = RequestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  }
  const { image_data, existing_categories } = parsed.data;

  if (!/^data:image\/\w+;base64,/.test(image_data)) {
    return Response.json({ error: 'image_data must be a base64 image data URL' }, { status: 400 });
  }

  const categoryList = existing_categories.length > 0
    ? existing_categories.map(c => `- "${c.name}" (prefix: ${c.sku_prefix || 'none'})`).join('\n')
    : '(no categories exist yet)';

  // Fetch valid UOM terms from GV for the prompt + validation.
  let uomLabelMap: Record<string, string> = {};
  let uomLabels: string[];
  const FALLBACK_UOM_LABELS = ['Each', 'Box', 'Case', 'Pound', 'Kilogram', 'Ton', 'Gallon', 'Liter', 'Foot', 'Meter', 'Yard', 'Pallet', 'Roll', 'Bag', 'Drum', 'Square Foot', 'Square Yard', 'Cubic Yard', 'Linear Foot', 'Load'];
  try {
    const gv = getGVClient();
    const rawMap = await gv.buildLabelMap(session.tenantId!, 'uom');
    uomLabelMap = rawMap instanceof Map ? Object.fromEntries(rawMap) : rawMap as Record<string, string>;
    uomLabels = Object.keys(uomLabelMap).length > 0 ? Object.values(uomLabelMap) : FALLBACK_UOM_LABELS;
  } catch {
    uomLabels = FALLBACK_UOM_LABELS;
  }

  const labelToTermId: Record<string, string> = {};
  for (const [termId, label] of Object.entries(uomLabelMap)) labelToTermId[label.toLowerCase()] = termId;

  try {
    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: [
            'You are an inventory specialist for construction, infrastructure, and industrial companies.',
            'You will be shown a PHOTO of a single inventory item. Identify it and return standardized catalog fields.',
            '',
            'Return ONLY a valid JSON object (no markdown fences) with these fields:',
            '  name           — concise product name for the item in the photo (e.g. "Nitrile Work Gloves", "Crackfill Melter")',
            '  description    — concise professional description (1-2 sentences) of what is shown',
            '  sku_prefix     — 2-5 char uppercase prefix for SKU generation',
            '  category       — pick the BEST match from the existing categories list below, or suggest a new one',
            '  category_match — "existing" if you picked from the list, "new" otherwise',
            `  unit_of_measure — one of: ${uomLabels.join(', ')}`,
            '  tracking_mode  — "stock" (bulk/quantity), "serialized" (individually tracked equipment/tools), or "both"',
            '  reorder_point  — suggested default reorder point (integer) for a mid-size company',
            '  has_variants   — boolean: true if this item naturally comes in multiple sizes/colors/styles/grades',
            '  variant_dimensions — array of lowercase dimension names if has_variants (e.g. ["size","color"]) else []',
            '  variant_options — object mapping each dimension to common options if has_variants else {}',
            '  confidence     — your confidence the identification is correct, 0..1',
            '',
            'EXISTING CATEGORIES:',
            categoryList,
            '',
            'Rules:',
            '- Identify only what is clearly visible; if unsure, give your best guess and lower confidence.',
            '- Prefer an existing category when reasonable; only use "new" if nothing fits.',
            '- Most materials are "stock"; equipment/tools/high-value assets are "serialized".',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Identify this inventory item and return the JSON.' },
            { type: 'image_url', image_url: { url: image_data, detail: 'low' } },
          ] as any,
        },
      ],
      temperature: 0.2,
      max_tokens: 700,
    });

    const content = completion.choices?.[0]?.message?.content;
    if (!content) return Response.json({ error: 'AI returned empty response' }, { status: 502 });

    let jsonStr = content.trim();
    const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) jsonStr = fence[1].trim();
    const suggestion = JSON.parse(jsonStr);

    // Resolve category to an existing ID if matched.
    let category_id: string | null = null;
    let new_category_name: string | null = null;
    if (suggestion.category_match === 'existing' && suggestion.category) {
      const match = existing_categories.find(c => c.name.toLowerCase() === suggestion.category.toLowerCase());
      if (match) category_id = match.id;
      else {
        const lower = suggestion.category.toLowerCase();
        const fuzzy = existing_categories.find(c => c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase()));
        if (fuzzy) category_id = fuzzy.id; else new_category_name = suggestion.category;
      }
    } else if (suggestion.category) {
      new_category_name = suggestion.category;
    }

    // Resolve UOM to a GV term ID.
    const aiUom = suggestion.unit_of_measure || '';
    let uomLabel = aiUom;
    let uomTermId: string | null = labelToTermId[aiUom.toLowerCase()] || null;
    if (!uomTermId && aiUom) {
      const lower = aiUom.toLowerCase();
      const entry = Object.entries(uomLabelMap).find(([, label]) => label.toLowerCase().includes(lower) || lower.includes(label.toLowerCase()));
      if (entry) { uomTermId = entry[0]; uomLabel = entry[1]; }
    }
    if (!uomTermId) {
      const eachEntry = Object.entries(uomLabelMap).find(([, label]) => label.toLowerCase() === 'each');
      if (eachEntry) { uomTermId = eachEntry[0]; uomLabel = eachEntry[1]; } else uomLabel = 'Each';
    }

    const VALID_MODES = ['stock', 'serialized', 'both'];
    const tracking = VALID_MODES.includes(suggestion.tracking_mode) ? suggestion.tracking_mode : 'stock';

    const hasVariants = !!suggestion.has_variants;
    let variantDimensions: string[] = [];
    const variantOptions: Record<string, string[]> = {};
    if (hasVariants && Array.isArray(suggestion.variant_dimensions)) {
      variantDimensions = suggestion.variant_dimensions
        .filter((d: unknown) => typeof d === 'string' && d.trim().length > 0)
        .map((d: string) => d.trim().toLowerCase());
      if (suggestion.variant_options && typeof suggestion.variant_options === 'object') {
        for (const dim of variantDimensions) {
          const opts = suggestion.variant_options[dim];
          if (Array.isArray(opts)) variantOptions[dim] = opts.filter((o: unknown) => typeof o === 'string' && o.trim().length > 0);
        }
      }
    }

    log.info(`[AI Item Image Analyze] name="${suggestion.name}" category="${suggestion.category}" uom=${uomLabel} tracking=${tracking} confidence=${suggestion.confidence}`);

    return Response.json({
      suggestion: {
        name: typeof suggestion.name === 'string' ? suggestion.name : '',
        description: suggestion.description || '',
        sku_prefix: suggestion.sku_prefix || '',
        category_id,
        new_category_name,
        category_display: suggestion.category || '',
        uom: uomLabel,
        uom_term_id: uomTermId,
        tracking_mode: tracking,
        reorder_point: typeof suggestion.reorder_point === 'number' ? suggestion.reorder_point : null,
        has_variants: hasVariants,
        variant_dimensions: variantDimensions,
        variant_options: variantOptions,
        confidence: typeof suggestion.confidence === 'number' ? suggestion.confidence : null,
      },
    });
  } catch (err: any) {
    log.error(`[AI Item Image Analyze] Failed: ${err.message}`);
    if (err.status === 429 || err.code === 'insufficient_quota') {
      return Response.json({ error: 'AI quota exceeded — check OpenAI billing or try again later.' }, { status: 503 });
    }
    if (err.status === 401) {
      return Response.json({ error: 'AI service authentication failed — check OPENAI_API_KEY.' }, { status: 503 });
    }
    return Response.json({ error: 'Failed to analyze image. Try again.' }, { status: 500 });
  }
}, { serviceName: SERVICE_NAME });
