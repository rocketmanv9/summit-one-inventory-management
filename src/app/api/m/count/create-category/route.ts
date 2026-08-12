import { z } from 'zod';
import { createWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { requireMobileSession } from '@/lib/mobile-auth';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CreateCategorySchema = z.object({
  name: z.string().min(1, 'Category name is required').max(100),
  sku_prefix: z.string().max(10).optional(),
});

export const POST = createWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const session = await requireMobileSession(req);
  const body = CreateCategorySchema.parse(await req.json());

  const inv = (supabase as any).schema('inventory');

  const { data, error } = await inv
    .from('item_categories')
    .upsert({
      name: body.name,
      sku_prefix: body.sku_prefix || null,
      tenant_id: session.tenantId,
      last_event_id: idempotencyKey,
    }, { onConflict: 'tenant_id,name' })
    .select('id, name, sku_prefix')
    .single();

  if (error) {
    log.error('mobile_count.create_category_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('mobile_count.category_created', {
    categoryId: data.id,
    name: body.name,
  });

  return {
    data,
    status: 201,
    events: [{
      event_name: 'item_category.created',
      payload: { id: data.id, name: data.name, tenant_id: session.tenantId },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/m/count/create-category',
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
