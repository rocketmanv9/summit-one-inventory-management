import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { requireMobileSession } from '@/lib/mobile-auth';
import { getGVClient } from '@/lib/gv';
import OpenAI from 'openai';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const RequestSchema = z.object({
  image_data: z.string().optional(),
  name: z.string().optional(),
}).refine(
  (data) => data.image_data || data.name,
  { message: 'Either image_data or name is required' }
);

const FALLBACK_UOM_LABELS = [
  'Each', 'Box', 'Case', 'Pound', 'Kilogram', 'Ton', 'Gallon', 'Liter',
  'Foot', 'Meter', 'Yard', 'Pallet', 'Roll', 'Bag', 'Drum',
  'Square Foot', 'Square Yard', 'Cubic Yard', 'Linear Foot', 'Load',
];

export const POST = createReadRoute(async ({ req, log }) => {
  const session = await requireMobileSession(req);

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

  const { image_data, name } = parsed.data;

  // Fetch existing categories
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId,
  });

  const inv = (supabase as any).schema('inventory');
  const { data: categories } = await inv
    .from('item_categories')
    .select('id, name, sku_prefix')
    .eq('tenant_id', session.tenantId)
    .order('name', { ascending: true })
    .limit(100);

  const categoryList = (categories && categories.length > 0)
    ? categories.map((c: any) => `- "${c.name}" (prefix: ${c.sku_prefix || 'none'})`).join('\n')
    : '(no categories exist yet)';

  // Existing top-level catalog items — so the AI (and our own matcher) can reuse
  // one instead of minting a duplicate of something already in the catalog.
  const { data: existingItems } = await inv
    .from('catalog_items')
    .select('id, name, sku, tracking_mode, uom_term_id')
    .eq('tenant_id', session.tenantId)
    .eq('active', true)
    .is('parent_item_id', null)
    .order('name', { ascending: true })
    .limit(300);

  const existingItemList = (existingItems && existingItems.length > 0)
    ? existingItems.slice(0, 80).map((i: any) => `- "${i.name}"${i.sku ? ` (${i.sku})` : ''}`).join('\n')
    : '(no items exist yet)';

  // Fetch valid UOM terms from GV
  let uomLabelMap: Record<string, string> = {};
  let uomLabels: string[];
  try {
    const gv = getGVClient();
    const rawMap = await gv.buildLabelMap(session.tenantId, 'uom');
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

    const systemPrompt = [
      'You are an inventory management specialist for construction, infrastructure, and industrial companies.',
      image_data
        ? 'You are given a photo of an inventory item. Analyze the photo to identify the item and suggest standardized catalog fields.'
        : 'Given an item name, suggest standardized catalog fields.',
      '',
      'Return ONLY a valid JSON object with these fields:',
      '  name               — the item name (use the photo to identify it, or clean up the provided name)',
      '  existing_item_name — if the item matches one of the EXISTING CATALOG ITEMS below, copy its EXACT name here; otherwise null',
      '  sku_prefix         — 2-5 char uppercase prefix for SKU generation (e.g. "HMA", "RB4", "DSL")',
      '  description        — concise professional description (1-2 sentences)',
      '  category           — pick the BEST match from the existing categories list below, or suggest a new one',
      '  category_match     — "existing" if you picked from the list, "new" if suggesting a new category',
      `  unit_of_measure    — one of: ${uomLabels.join(', ')}`,
      '  tracking_mode      — one of: "stock" (bulk/quantity items), "serialized" (individual tracked assets like equipment), "both" (items that can be either)',
      '',
      'EXISTING CATALOG ITEMS (strongly prefer reusing one of these over creating a duplicate):',
      existingItemList,
      '',
      'EXISTING CATEGORIES:',
      categoryList,
      '',
      'Rules:',
      '- For existing_item_name: if the photographed/named item is already one of the EXISTING CATALOG ITEMS, return that item\'s EXACT name. Do NOT create a near-duplicate (e.g. a second "Monitor") when one already exists.',
      '- For category: prefer an existing category if it is a reasonable match. Only suggest "new" if nothing fits.',
      '- For unit_of_measure: use industry-standard UOM (cement → BAG or TON, lumber → FT or EA, fuel → GAL, fasteners → EA or BOX).',
      '- For tracking_mode: most materials are "stock". Equipment, tools, and high-value assets are "serialized".',
      '- Do NOT wrap the JSON in markdown code fences.',
    ].join('\n');

    const userContent: any[] = [];

    if (image_data) {
      userContent.push({
        type: 'image_url',
        image_url: { url: image_data, detail: 'low' },
      });
    }

    const textPart = name
      ? `Item name: "${name}". ${image_data ? 'Use the photo to refine your suggestions.' : ''}`
      : 'Identify this item from the photo and suggest catalog fields.';
    userContent.push({ type: 'text', text: textPart });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.2,
      max_tokens: 500,
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
      const match = (categories || []).find(
        (c: any) => c.name.toLowerCase() === suggestion.category.toLowerCase()
      );
      if (match) {
        category_id = match.id;
      } else {
        const lower = suggestion.category.toLowerCase();
        const fuzzy = (categories || []).find(
          (c: any) => c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase())
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

    const VALID_MODES = ['stock', 'serialized', 'both'];
    const tracking = VALID_MODES.includes(suggestion.tracking_mode)
      ? suggestion.tracking_mode
      : 'stock';

    // Find existing catalog items the photographed item likely already is, so
    // the user can reuse one instead of creating a duplicate. Combine the AI's
    // explicit pick (existing_item_name) with our own token-overlap matcher.
    const norm = (s: string) =>
      String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const tokenize = (s: string) => norm(s).split(' ').filter((w) => w.length >= 3);

    const suggestedName = suggestion.name || name || '';
    const aiPick = norm(suggestion.existing_item_name);
    const suggestedNorm = norm(suggestedName);
    const suggestedTokens = new Set(tokenize(suggestedName));

    const scored = (existingItems || []).map((it: any) => {
      const itName = norm(it.name);
      const itTokens = tokenize(it.name);
      let overlap = 0;
      for (const t of itTokens) if (suggestedTokens.has(t)) overlap++;
      const union = new Set([...suggestedTokens, ...itTokens]).size || 1;
      let score = overlap / union;
      if (itName && itName === suggestedNorm) score = 1; // exact name match
      if (aiPick && itName === aiPick) score = Math.max(score, 0.99); // AI chose it
      return { it, score };
    });

    const matches = scored
      .filter((x: any) => x.score >= 0.3)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 5)
      .map((x: any) => ({
        id: x.it.id,
        name: x.it.name,
        sku: x.it.sku || null,
        tracking_mode: x.it.tracking_mode,
        uom_term_id: x.it.uom_term_id || null,
      }));

    log.info('mobile_count.ai_photo_suggest', {
      name: suggestion.name || name,
      category: suggestion.category,
      uom: uomLabel,
      tracking,
      hasImage: !!image_data,
      matchCount: matches.length,
      aiPickedExisting: !!aiPick,
    });

    return Response.json({
      // Existing items this likely already is — best match first. The client
      // should offer these before falling back to "create new".
      matches,
      suggestion: {
        name: suggestion.name || name || '',
        description: suggestion.description || '',
        sku_prefix: suggestion.sku_prefix || '',
        category_id,
        new_category_name,
        category_display: suggestion.category || '',
        uom: uomLabel,
        uom_term_id: uomTermId,
        tracking_mode: tracking,
      },
    });
  } catch (err: any) {
    log.error('mobile_count.ai_photo_suggest_failed', { error: err.message });

    if (err.status === 429 || err.code === 'insufficient_quota') {
      return Response.json(
        { error: 'AI quota exceeded — please try again later.' },
        { status: 503 }
      );
    }
    if (err.status === 401) {
      return Response.json(
        { error: 'AI service authentication failed.' },
        { status: 503 }
      );
    }

    return Response.json({ error: 'Failed to generate suggestions. Try again.' }, { status: 500 });
  }
}, { serviceName: SERVICE_NAME, auth: 'public' });
