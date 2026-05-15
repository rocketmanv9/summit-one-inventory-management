import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const ReturnSchema = z.object({
  notes: z.string().optional(),
});

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey, ctx }) => {
  const urlParts = req.url.split('/employees/');
  const rest = urlParts[1] ?? '';
  const employeeId = rest.split('/')[0];
  const provisionId = rest.split('/provisions/')[1]?.split('/')[0];
  if (!employeeId || !provisionId) throw AppError.badRequest('Employee ID and Provision ID required');

  ReturnSchema.parse(await req.json());
  const prov = (supabase as any).schema('provisioning');

  const { data: provision } = await prov
    .from('employee_provisions')
    .select('*')
    .eq('id', provisionId)
    .eq('employee_id', employeeId)
    .eq('tenant_id', ctx.tenantId)
    .limit(1)
    .single();

  if (!provision) throw AppError.notFound('Employee provision not found');
  if (provision.status !== 'active') {
    throw AppError.badRequest(`Cannot return provision in status: ${provision.status}`);
  }

  await prov
    .from('employee_provisions')
    .update({
      status: 'returned',
      returned_at: new Date().toISOString(),
      last_event_id: idempotencyKey,
    })
    .eq('id', provisionId);

  await prov
    .from('provisioning_history')
    .insert({
      tenant_id: ctx.tenantId,
      line_id: provision.provisioning_line_id,
      action: 'item_returned',
      old_status: 'active',
      new_status: 'returned',
      actor_user_id: ctx.userId,
      details: { employee_id: employeeId, catalog_item_id: provision.catalog_item_id },
    });

  log.info('provision.returned', { provisionId, employeeId });

  return {
    data: { returned: true, provision_id: provisionId },
    status: 200,
    events: [{
      event_name: 'employee_provision.returned',
      payload: { provision_id: provisionId, employee_id: employeeId },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/provisioning/employees/[employeeId]/provisions/[id]/return' });
