import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { orchestrateProvisioning } from '@/lib/provisioning/orchestrator';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });
  const prov = (supabase as any).schema('provisioning');

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const employeeId = url.searchParams.get('employee_id');

  let query = prov
    .from('provisioning_requests')
    .select('*, provisioning_lines(count), policy_rules(name)')
    .eq('tenant_id', session.tenantId!)
    .order('created_at', { ascending: false })
    .limit(200);

  if (status) query = query.eq('status', status);
  if (employeeId) query = query.eq('employee_id', employeeId);

  const { data, error } = await query;
  if (error) {
    log.error('requests.list_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

const CreateRequestSchema = z.object({
  employee_id: z.string().min(1),
  employee_name: z.string().optional(),
  trigger_event: z.string().min(1).default('manual.provision'),
  employee_attributes: z.record(z.unknown()).optional().default({}),
  kit_id: z.string().uuid().optional(),
  delivery_method: z.string().optional(),
  shipping_address: z.record(z.unknown()).optional(),
  priority: z.number().int().optional(),
  needed_by: z.string().optional(),
  skip_policy_evaluation: z.boolean().optional().default(false),
});

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const body = CreateRequestSchema.parse(await req.json());
  const tenantId = (await (supabase as any).rpc('get_my_tenant_id')).data
    ?? (supabase as any)._tenantId;

  // Extract tenant_id from the service client context
  const { data: reqCheck } = await (supabase as any).schema('provisioning')
    .from('providers')
    .select('tenant_id')
    .limit(1);
  const resolvedTenantId = reqCheck?.[0]?.tenant_id ?? body.employee_attributes?.tenantId as string;

  const result = await orchestrateProvisioning(
    supabase,
    resolvedTenantId || '',
    body.trigger_event,
    {
      employeeId: body.employee_id,
      employeeName: body.employee_name,
      ...(body.employee_attributes as Record<string, any>),
    },
    idempotencyKey,
    {
      deliveryMethod: body.delivery_method,
      shippingAddress: body.shipping_address,
      priority: body.priority,
      neededBy: body.needed_by,
      skipPolicyEvaluation: body.skip_policy_evaluation,
      kitId: body.kit_id,
    },
  );

  if (!result.requestId) {
    return {
      data: { message: 'No matching policy or items found', status: result.status },
      status: 200,
      events: [],
    };
  }

  log.info('request.created', { requestId: result.requestId, lineCount: result.lines.length });

  return {
    data: result,
    status: 201,
    events: result.events,
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/provisioning/requests' });
