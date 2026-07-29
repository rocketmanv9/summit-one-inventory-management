import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-one-inventory-management';

const CreateSchema = z.object({
  service: z.string().max(40).default('inventory'),
  description: z.string().min(3).max(4000),
  severity: z.enum(['annoying', 'normal', 'blocking']).default('normal'),
  page_url: z.string().max(500).nullable().optional(),
});

/** POST /api/bugs — anyone in the tenant files a bug (who/where attach automatically). */
export const POST = createSessionWriteRoute(async ({ ctx, body, supabase, idempotencyKey }) => {
  const tenantId = ctx.tenantId!;
  const input = body as z.infer<typeof CreateSchema>;
  const { data: me } = await supabase
    .from('local_users').select('name, email').eq('tenant_id', tenantId).eq('user_id', ctx.userId!).limit(1);
  const { data, error } = await supabase
    .from('bug_reports')
    .upsert({
      tenant_id: tenantId,
      service: input.service,
      reporter_user_id: ctx.userId ?? null,
      reporter_name: me?.[0]?.name || me?.[0]?.email || null,
      page_url: input.page_url ?? null,
      description: input.description,
      severity: input.severity,
    }, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw AppError.internal(error.message);
  return {
    data,
    status: 201,
    events: [{
      event_name: 'bug.reported',
      payload: { bug_id: data.id, service: data.service, severity: data.severity, tenant_id: tenantId },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: CreateSchema, serviceName: SERVICE_NAME, scope: 'POST /api/bugs' });

