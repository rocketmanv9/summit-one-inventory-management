import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { orchestrateProvisioning } from '@/lib/provisioning/orchestrator';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey, ctx }) => {
  const id = req.url.split('/requests/')[1]?.split('/')[0];
  if (!id) throw AppError.badRequest('Request ID required');

  const prov = (supabase as any).schema('provisioning');

  // Load existing request for context
  const { data: request } = await prov
    .from('provisioning_requests')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .limit(1)
    .single();

  if (!request) throw AppError.notFound('Request not found');

  // Re-run with dry-run flag
  const result = await orchestrateProvisioning(
    supabase,
    ctx.tenantId,
    request.trigger_event || 'dry_run',
    {
      employeeId: request.employee_id,
      employeeName: request.employee_name,
      position: request.employee_attributes?.position,
      division: request.employee_attributes?.division,
      location: request.employee_attributes?.location,
      certifications: request.employee_attributes?.certifications,
      employmentType: request.employee_attributes?.employmentType,
      shirtSize: request.employee_attributes?.shirtSize,
      attributes: request.employee_attributes,
    },
    `dry-run-${idempotencyKey}`,
    {
      dryRun: true,
      kitId: request.kit_id,
      shippingAddress: request.shipping_address,
      skipPolicyEvaluation: true,
    },
  );

  log.info('request.dry_run', { requestId: id, resultStatus: result.status });

  return {
    data: {
      request_id: id,
      dry_run_result: result,
    },
    status: 200,
    events: [],  // Dry-run doesn't emit real events
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/provisioning/requests/[id]/dry-run' });
