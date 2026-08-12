import { z } from 'zod';
import { createWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { requireMobileSession } from '@/lib/mobile-auth';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const AddItemSchema = z.object({
  catalog_item_id: z.string().uuid(),
});

export const POST = createWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const session = await requireMobileSession(req);
  const body = AddItemSchema.parse(await req.json());
  const inv = (supabase as any).schema('inventory');

  // If the item is a parent with variants, add a line per variant child so
  // each can be counted separately — adding the parent alone would leave no
  // way to record per-variant quantities. Plain items add just themselves.
  const { data: children } = await inv
    .from('catalog_items')
    .select('id')
    .eq('tenant_id', session.tenantId)
    .eq('parent_item_id', body.catalog_item_id)
    .eq('active', true)
    .limit(200);

  const targetIds: string[] = children && children.length > 0
    ? children.map((c: any) => c.id)
    : [body.catalog_item_id];

  const lines: any[] = [];
  for (const itemId of targetIds) {
    const { data, error } = await inv.rpc('rpc_inv_cycle_count_add_line', {
      p_cycle_count_id: session.cycleCountId,
      p_catalog_item_id: itemId,
      p_tenant_id: session.tenantId,
      p_last_event_id: crypto.randomUUID(),
    });
    if (error) {
      log.error('mobile_count.add_item_failed', { itemId, error: error.message });
      throw AppError.internal(error.message);
    }
    if (data) lines.push(data);
  }

  // Enrich variant lines with attributes + parent name so the UI can tell
  // them apart (the RPC's catalog_item payload omits these).
  if (children && children.length > 0 && lines.length > 0) {
    const { data: meta } = await inv
      .from('catalog_items')
      .select('id, variant_attributes, parent:parent_item_id(name)')
      .in('id', targetIds)
      .limit(200);
    const metaById = new Map((meta || []).map((m: any) => [m.id, m]));
    for (const line of lines) {
      const m: any = metaById.get(line.catalog_item_id);
      if (m && line.catalog_item) {
        line.catalog_item.variant_attributes = m.variant_attributes ?? null;
        line.catalog_item.parent_name = m.parent?.name ?? null;
      }
    }
  }

  log.info('mobile_count.item_added', {
    cycleCountId: session.cycleCountId,
    catalogItemId: body.catalog_item_id,
    variantCount: targetIds.length,
  });

  // Back-compat: `data` stays the first line (existing single-line callers),
  // `lines` carries them all so variant-aware callers can append every child.
  return {
    data: { ...lines[0], lines },
    status: 201,
    events: [{
      event_name: 'cycle_count_line.added',
      payload: {
        cycle_count_id: session.cycleCountId,
        catalog_item_id: body.catalog_item_id,
        line_count: lines.length,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/m/count/add-item',
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
