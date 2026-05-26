import { z } from 'zod';
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const VALID_PALETTE_KEYS = [
  'primary_color', 'secondary_color', 'tertiary_color',
  'accent_color', 'text_color', 'background_color',
] as const;

const AssignmentsSchema = z.object({
  assignments: z.record(z.string(), z.enum(VALID_PALETTE_KEYS)),
});

// ── GET: Fetch current tenant branding ────────────────────────────────────

export const GET = createSessionReadRoute(async ({ session }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const { data, error } = await supabase
    .from('tenant_branding')
    .select('*')
    .eq('tenant_id', session.tenantId!)
    .limit(1)
    .maybeSingle();

  if (error) throw AppError.internal(error.message);

  return Response.json({ data: data ?? null });
}, { serviceName: SERVICE_NAME });

// ── POST: Save color assignments to theme_config ──────────────────────────

export const POST = createSessionWriteRoute(async ({ req, ctx, log, supabase, idempotencyKey }) => {
  const body = AssignmentsSchema.parse(await req.json());

  const { data, error } = await supabase
    .from('tenant_branding')
    .upsert(
      {
        tenant_id: ctx.tenantId!,
        theme_config: { assignments: body.assignments },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' },
    )
    .select()
    .single();

  if (error) throw AppError.internal(error.message);

  log.info('branding.updated', { tenantId: ctx.tenantId });

  return {
    data,
    status: 200,
    events: [{
      event_name: 'branding.updated',
      payload: { tenant_id: ctx.tenantId },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/settings/branding' });
