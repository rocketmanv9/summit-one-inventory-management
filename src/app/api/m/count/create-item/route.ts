import { z } from 'zod';
import { createWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { requireMobileSession } from '@/lib/mobile-auth';
import { getTenantGVClient } from '@/lib/gv';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CreateItemSchema = z.object({
  name: z.string().min(1, 'Item name is required').max(200),
  description: z.string().max(1000).optional(),
  sku_prefix: z.string().max(10).optional(),
  category_id: z.string().uuid().optional(),
  new_category_name: z.string().max(100).optional(),
  uom_term_id: z.string().uuid().optional(),
  unit_of_measure: z.string().optional(),
  tracking_mode: z.enum(['stock', 'serialized', 'both']).default('stock'),
  image_data: z.string().optional(),
  add_to_count: z.boolean().default(true),
});

export const POST = createWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const session = await requireMobileSession(req);
  const body = CreateItemSchema.parse(await req.json());

  const inv = (supabase as any).schema('inventory');

  // Resolve UOM term_id from label if needed
  let uomTermId = body.uom_term_id || null;
  if (!uomTermId && body.unit_of_measure) {
    try {
      const gv = await getTenantGVClient(session.tenantId);
      uomTermId = await gv.resolveTermId(session.tenantId, 'uom', body.unit_of_measure, true);
    } catch (e) {
      log.warn('mobile_count.uom_resolve_failed', { uom: body.unit_of_measure, error: (e as Error).message });
    }
  }

  // Create new category if requested
  let categoryId = body.category_id || null;
  if (!categoryId && body.new_category_name) {
    const { data: cat, error: catError } = await inv
      .from('item_categories')
      .upsert({
        name: body.new_category_name,
        tenant_id: session.tenantId,
      }, { onConflict: 'tenant_id,name' })
      .select('id')
      .single();

    if (catError) {
      log.error('mobile_count.create_category_inline_failed', { error: catError.message });
      throw AppError.internal(`Failed to create category: ${catError.message}`);
    }
    categoryId = cat.id;
  }

  // Generate SKU
  let sku: string | null = null;
  if (body.sku_prefix) {
    const prefix = body.sku_prefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    // Find next sequential number for this prefix
    const { data: existing } = await inv
      .from('catalog_items')
      .select('sku')
      .ilike('sku', `${prefix}-%`)
      .order('sku', { ascending: false })
      .limit(1);

    let seq = 1;
    if (existing && existing.length > 0) {
      const lastSku = existing[0].sku as string;
      const match = lastSku.match(/-(\d+)$/);
      if (match) seq = parseInt(match[1], 10) + 1;
    }
    sku = `${prefix}-${String(seq).padStart(4, '0')}`;
  }

  // Create catalog item
  const { data: item, error: itemError } = await inv
    .from('catalog_items')
    .upsert({
      name: body.name,
      description: body.description || null,
      sku: sku,
      category_id: categoryId,
      uom_term_id: uomTermId,
      tracking_mode: body.tracking_mode,
      tenant_id: session.tenantId,
    })
    .select('id, name, sku, barcode, tracking_mode, uom_term_id, category_id')
    .single();

  if (itemError) {
    log.error('mobile_count.create_item_failed', { error: itemError.message });
    throw AppError.internal(itemError.message);
  }

  // Upload image if provided
  if (body.image_data) {
    try {
      const match = body.image_data.match(/^data:image\/\w+;base64,(.+)$/);
      if (match) {
        const base64 = match[1];
        const buffer = Buffer.from(base64, 'base64');

        if (buffer.length <= 5 * 1024 * 1024) {
          const storagePath = `${session.tenantId}/catalog_item/${item.id}.jpg`;

          await supabase.storage
            .from('entity-images')
            .upload(storagePath, buffer, {
              contentType: 'image/jpeg',
              upsert: true,
            });

          await supabase
            .from('entity_images')
            .upsert(
              {
                tenant_id: session.tenantId,
                entity_type: 'catalog_item',
                entity_id: item.id,
                storage_path: storagePath,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'tenant_id,entity_type,entity_id' }
            );
        }
      }
    } catch (imgErr) {
      log.warn('mobile_count.image_upload_failed', { error: (imgErr as Error).message });
      // Non-fatal — item still created
    }
  }

  // Add to count if requested
  let countLine = null;
  if (body.add_to_count) {
    const { data: lineData, error: lineError } = await inv.rpc('rpc_inv_cycle_count_add_line', {
      p_cycle_count_id: session.cycleCountId,
      p_catalog_item_id: item.id,
      p_tenant_id: session.tenantId,
      p_last_event_id: `${idempotencyKey}-addline`,
    });

    if (lineError) {
      log.warn('mobile_count.add_to_count_failed', { error: lineError.message });
      // Non-fatal — item was created
    } else {
      countLine = lineData;
    }
  }

  log.info('mobile_count.item_created', {
    itemId: item.id,
    name: body.name,
    addedToCount: !!countLine,
  });

  return {
    data: {
      item,
      count_line: countLine ? {
        id: countLine.id,
        catalog_item_id: item.id,
        catalog_item: item,
        qty_expected: countLine.qty_expected ?? 0,
        qty_counted: null,
      } : null,
      category_id: categoryId,
    },
    status: 201,
    events: [{
      event_name: 'catalog_item.created',
      payload: {
        id: item.id,
        name: item.name,
        tenant_id: session.tenantId,
        added_to_count: session.cycleCountId,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, {
  serviceName: SERVICE_NAME,
  scope: 'POST /api/m/count/create-item',
  authenticate: async (req: Request) => {
    const session = await requireMobileSession(req);
    const supabase = await createTenantServiceClient({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      tenantId: session.tenantId,
    });
    return { tenantId: session.tenantId, userId: session.userId, supabase };
  },
});
