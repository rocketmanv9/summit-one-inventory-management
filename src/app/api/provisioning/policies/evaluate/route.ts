import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { evaluatePolicies, type EmployeeContext } from '@/lib/provisioning/policy-engine';
import { resolveItems } from '@/lib/provisioning/variant-resolver';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const EvaluateSchema = z.object({
  trigger_event: z.string().min(1),
  employee: z.object({
    employeeId: z.string().min(1),
    employeeName: z.string().optional(),
    position: z.string().optional(),
    division: z.string().optional(),
    location: z.string().optional(),
    certifications: z.array(z.string()).optional(),
    employmentType: z.string().optional(),
    shirtSize: z.string().optional(),
    attributes: z.record(z.unknown()).optional(),
  }),
});

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const body = EvaluateSchema.parse(await req.json());
  const tenantId = (await (supabase as any).auth.getUser()).data?.user?.app_metadata?.tenant_id;

  const result = await evaluatePolicies(
    supabase,
    tenantId,
    body.trigger_event,
    body.employee as EmployeeContext,
  );

  let resolvedItems = null;
  if (result.matched) {
    resolvedItems = await resolveItems(
      supabase,
      tenantId,
      body.employee as EmployeeContext,
      result.kitId,
      result.items,
    );
  }

  log.info('policy.evaluated', {
    matched: result.matched,
    ruleId: result.rule?.id,
    itemCount: resolvedItems?.length,
  });

  // Dry-run — no mutations, no real events
  return {
    data: {
      matched: result.matched,
      rule: result.rule ? { id: result.rule.id, name: result.rule.name, priority: result.rule.priority } : null,
      kitId: result.kitId,
      requiresApproval: result.requiresApproval,
      resolvedItems,
    },
    status: 200,
    events: [],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/provisioning/policies/evaluate' });
