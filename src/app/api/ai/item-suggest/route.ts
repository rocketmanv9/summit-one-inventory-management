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
import { getGVClient } from '@/lib/gv';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const RequestSchema = z.object({
  name: z.string().min(1, 'Item name is required'),
  existing_categories: z.array(z.object({
    id: z.string(),
    name: z.string(),
    sku_prefix: z.string().nullable().optional(),
  })).optional().default([]),
});

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

  const { name, existing_categories } = parsed.data;

  const categoryList = existing_categories.length > 0
    ? existing_categories.map(c => `- "${c.name}" (prefix: ${c.sku_prefix || 'none'})`).join('\n')
    : '(no categories exist yet)';

  // Fetch valid UOM terms from GV for the AI prompt and validation
  let uomLabelMap: Record<string, string> = {}; // termId → label
  let uomLabels: string[];
  const FALLBACK_UOM_LABELS = ['Each', 'Box', 'Case', 'Pound', 'Kilogram', 'Ton', 'Gallon', 'Liter', 'Foot', 'Meter', 'Yard', 'Pallet', 'Roll', 'Bag', 'Drum', 'Square Foot', 'Square Yard', 'Cubic Yard', 'Linear Foot', 'Load'];
  try {
    const gv = getGVClient();
    const rawMap = await gv.buildLabelMap(session.tenantId!, 'uom');
    // Convert Map to plain Record if needed
    uomLabelMap = rawMap instanceof Map ? Object.fromEntries(rawMap) : rawMap as Record<string, string>;
    uomLabels = Object.keys(uomLabelMap).length > 0
      ? Object.values(uomLabelMap)
      : FALLBACK_UOM_LABELS;
  } catch {
    uomLabels = FALLBACK_UOM_LABELS;
  }

  // Build reverse lookup: lowercase label → termId
  const labelToTermId: Record<string, string> = {};
  for (const [termId, label] of Object.entries(uomLabelMap)) {
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
            'You are an inventory management specialist for construction, infrastructure, and industrial companies.',
            'Given an item name, suggest standardized catalog fields.',
            '',
            'Return ONLY a valid JSON object with these fields:',
            '  sku_prefix    — 2-5 char uppercase prefix for SKU generation (e.g. "HMA", "RB4", "DSL")',
            '  description   — concise professional description (1-2 sentences)',
            '  category      — pick the BEST match from the existing categories list below, or suggest a new one',
            '  category_match — "existing" if you picked from the list, "new" if suggesting a new category',
            `  unit_of_measure — one of: ${uomLabels.join(', ')}`,
            '  tracking_mode — one of: "stock" (bulk/quantity items), "serialized" (individual tracked assets like equipment), "both" (items that can be either)',
            '  suggested_identifier_types — array of label types to print: ["barcode"] for stock materials, ["barcode", "qr"] for serialized/high-value items',
            '  reorder_point — suggested default reorder point (integer) for a mid-size company',
            '  has_variants — boolean: true if this item naturally comes in multiple variants (sizes, colors, styles, grades, lengths, etc.)',
            '  variant_dimensions — array of dimension names if has_variants is true (e.g. ["size", "color"]). Omit or empty if has_variants is false.',
            '  variant_options — object mapping each dimension to its common options if has_variants is true (e.g. {"size": ["S", "M", "L", "XL"], "color": ["Red", "Blue", "Black"]}). Omit or empty if has_variants is false.',
            '',
            'EXISTING CATEGORIES:',
            categoryList,
            '',
            'Rules:',
            '- For category: prefer an existing category if it is a reasonable match. Only suggest "new" if nothing fits.',
            '- For unit_of_measure: use industry-standard UOM (cement → BAG or TON, lumber → FT or EA, fuel → GAL, fasteners → EA or BOX).',
            '- For tracking_mode: most materials are "stock". Equipment, tools, and high-value assets are "serialized".',
            '- For suggested_identifier_types: stock materials get ["barcode"]. Serialized equipment, tools, and high-value items get ["barcode", "qr"].',
            '- For has_variants: set true for items that naturally come in multiple sizes, colors, styles, or grades. Examples: t-shirts (size/color), gloves (size), pipe (diameter/length), paint (color/finish), PPE (size). Set false for bulk materials like cement, fuel, or single-form items like specific tools.',
            '- For variant_dimensions: use lowercase singular names like "size", "color", "style", "grade", "diameter", "length", "finish".',
            '- For variant_options: provide the most common industry-standard options for each dimension.',
            '- Do NOT wrap the JSON in markdown code fences.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Item name: "${name}"`,
        },
      ],
      temperature: 0.2,
      max_tokens: 600,
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

    // Resolve UOM to GV term ID
    const aiUom = suggestion.unit_of_measure || '';
    let uomLabel = aiUom;
    let uomTermId: string | null = labelToTermId[aiUom.toLowerCase()] || null;

    // Try partial match if exact label match failed
    if (!uomTermId && aiUom) {
      const lower = aiUom.toLowerCase();
      const entry = Object.entries(uomLabelMap).find(
        ([, label]) => label.toLowerCase().includes(lower) || lower.includes(label.toLowerCase())
      );
      if (entry) {
        uomTermId = entry[0];
        uomLabel = entry[1];
      }
    }

    // Fallback to "Each" if nothing matches
    if (!uomTermId) {
      const eachEntry = Object.entries(uomLabelMap).find(
        ([, label]) => label.toLowerCase() === 'each'
      );
      if (eachEntry) {
        uomTermId = eachEntry[0];
        uomLabel = eachEntry[1];
      } else {
        uomLabel = 'Each';
      }
    }

    const uom = uomLabel;

    // Validate tracking mode
    const VALID_MODES = ['stock', 'serialized', 'both'];
    const tracking = VALID_MODES.includes(suggestion.tracking_mode)
      ? suggestion.tracking_mode
      : 'stock';

    log.info(`[AI Item Suggest] name="${name}" → category="${suggestion.category}" uom=${uom} tracking=${tracking} has_variants=${!!suggestion.has_variants}`);

    // Validate suggested_identifier_types
    const VALID_ID_TYPES = ['barcode', 'qr'];
    const identifierTypes = Array.isArray(suggestion.suggested_identifier_types)
      ? suggestion.suggested_identifier_types.filter((t: string) => VALID_ID_TYPES.includes(t))
      : tracking === 'stock' ? ['barcode'] : ['barcode', 'qr'];

    // Validate variant fields
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
          if (Array.isArray(opts)) {
            variantOptions[dim] = opts.filter((o: unknown) => typeof o === 'string' && o.trim().length > 0);
          }
        }
      }
    }

    return Response.json({
      suggestion: {
        description: suggestion.description || '',
        sku_prefix: suggestion.sku_prefix || '',
        category_id,
        new_category_name,
        category_display: suggestion.category || '',
        uom: uom,
        uom_term_id: uomTermId,
        tracking_mode: tracking,
        reorder_point: typeof suggestion.reorder_point === 'number' ? suggestion.reorder_point : null,
        suggested_identifier_types: identifierTypes,
        has_variants: hasVariants,
        variant_dimensions: variantDimensions,
        variant_options: variantOptions,
      },
    });
  } catch (err: any) {
    log.error(`[AI Item Suggest] Failed: ${err.message}`);

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
