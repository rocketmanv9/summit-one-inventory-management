import { z } from 'zod';
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a valid hex color (e.g. #1e40af)');

const BrandingSchema = z.object({
  // Core 6 — required
  primary_color: hexColor,
  secondary_color: hexColor,
  tertiary_color: hexColor,
  accent_color: hexColor,
  text_color: hexColor,
  background_color: hexColor,

  // Extended palette — optional
  button_color: hexColor.optional().nullable(),
  button_text_color: hexColor.optional().nullable(),
  button_hover_color: hexColor.optional().nullable(),
  button_active_color: hexColor.optional().nullable(),
  call_to_action_color: hexColor.optional().nullable(),
  call_to_action_hover_color: hexColor.optional().nullable(),
  disabled_color: hexColor.optional().nullable(),
  disabled_text_color: hexColor.optional().nullable(),

  surface_color: hexColor.optional().nullable(),
  surface_alt_color: hexColor.optional().nullable(),
  overlay_color: hexColor.optional().nullable(),

  text_muted_color: hexColor.optional().nullable(),
  text_disabled_color: hexColor.optional().nullable(),
  text_on_primary_color: hexColor.optional().nullable(),
  text_on_surface_color: hexColor.optional().nullable(),

  border_color: hexColor.optional().nullable(),
  border_subtle_color: hexColor.optional().nullable(),
  border_focus_color: hexColor.optional().nullable(),

  primary_hover_color: hexColor.optional().nullable(),
  primary_active_color: hexColor.optional().nullable(),
  primary_disabled_color: hexColor.optional().nullable(),
  primary_focus_color: hexColor.optional().nullable(),
  secondary_hover_color: hexColor.optional().nullable(),

  success_color: hexColor.optional().nullable(),
  success_hover_color: hexColor.optional().nullable(),
  warning_color: hexColor.optional().nullable(),
  warning_hover_color: hexColor.optional().nullable(),
  error_color: hexColor.optional().nullable(),
  error_hover_color: hexColor.optional().nullable(),
  info_color: hexColor.optional().nullable(),
  info_hover_color: hexColor.optional().nullable(),
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

// ── POST: Save/update tenant branding colors ──────────────────────────────

export const POST = createSessionWriteRoute(async ({ req, ctx, log, supabase, idempotencyKey }) => {
  const body = BrandingSchema.parse(await req.json());

  // Strip null optional fields so we don't overwrite with nulls unnecessarily
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) {
      cleaned[key] = value;
    }
  }

  const { data, error } = await supabase
    .from('tenant_branding')
    .upsert(
      {
        ...cleaned,
        tenant_id: ctx.tenantId!,
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
    status: 201,
    events: [{
      event_name: 'branding.updated',
      payload: { tenant_id: ctx.tenantId },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/settings/branding' });
