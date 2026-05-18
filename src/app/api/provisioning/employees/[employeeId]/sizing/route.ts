import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getEmployeeSizing, upsertEmployeeSizing } from '@/lib/provisioning/employee-sizing';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const employeeId = req.url.split('/employees/')[1]?.split('/')[0];
  if (!employeeId) throw AppError.badRequest('Employee ID required');

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const sizing = await getEmployeeSizing(supabase, session.tenantId!, employeeId);
  if (!sizing) {
    throw AppError.notFound(`No sizing profile found for employee ${employeeId}`);
  }

  return Response.json({ data: sizing });
}, { serviceName: SERVICE_NAME });

const PatchSizingSchema = z.object({
  shirt_size: z.string().nullable().optional(),
  hoodie_size: z.string().nullable().optional(),
  jacket_size: z.string().nullable().optional(),
  pants_size: z.string().nullable().optional(),
  boot_size: z.string().nullable().optional(),
  preferred_fit: z.enum(['slim', 'regular', 'relaxed']).nullable().optional(),
});

export const PATCH = createSessionWriteRoute(async ({ req, ctx, log, supabase, idempotencyKey }) => {
  const employeeId = req.url.split('/employees/')[1]?.split('/')[0];
  if (!employeeId) throw AppError.badRequest('Employee ID required');

  const body = PatchSizingSchema.parse(await req.json());

  const data = await upsertEmployeeSizing(
    supabase,
    ctx.tenantId!,
    employeeId,
    body,
    idempotencyKey,
  );

  return {
    data,
    status: 200,
    events: [
      {
        event_name: 'employee_sizing.updated',
        payload: { employee_id: employeeId, sizing: data },
        last_event_id: idempotencyKey,
      },
    ],
  };
}, { serviceName: SERVICE_NAME, scope: 'PATCH /api/provisioning/employees/[employeeId]/sizing' });
