import { createWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { requireMobileSession } from '@/lib/mobile-auth';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const POST = createWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const session = await requireMobileSession(req);
  const inv = (supabase as any).schema('inventory');

  const { data, error } = await inv
    .from('cycle_counts')
    .update({
      status: 'under_review',
      completed_at: new Date().toISOString(),
      last_event_id: idempotencyKey,
    })
    .eq('id', session.cycleCountId)
    .eq('tenant_id', session.tenantId)
    .eq('status', 'in_progress')
    .select()
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      throw AppError.notFound('Cycle count not found or not in progress');
    }
    throw AppError.internal(error.message);
  }

  log.info('cycle_count.submitted', { cycleCountId: session.cycleCountId, source: 'mobile' });

  return {
    data: { success: true },
    status: 200,
    events: [{
      event_name: 'cycle_count.submitted',
      payload: { cycle_count_id: session.cycleCountId, source: 'mobile' },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/m/count/submit',
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
