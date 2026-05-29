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

// Core Supabase instances — palette source of truth
const CORE_URL = process.env.NEXT_PUBLIC_CORE_SUPABASE_URL || '';
const CORE_KEY = process.env.NEXT_PUBLIC_CORE_SUPABASE_ANON_KEY || '';
const CORE_STAGE_URL = 'https://ycszguaqawbxjwehhhqx.supabase.co';
const CORE_STAGE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inljc3pndWFxYXdieGp3ZWhoaHF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NjUzMDksImV4cCI6MjA5MTI0MTMwOX0.gwTth23_dGqrnnhnfdZ4KB9KRBxmwBZSemwewBzopMg';

/**
 * Fetch tenant palette from a Core Supabase instance via get_public_branding RPC.
 */
async function fetchCorePalette(
  url: string,
  key: string,
  tenantId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${url}/rest/v1/rpc/get_public_branding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ target_tenant_id: tenantId }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object' || !data.tenant_id) return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Fetch tenant palette from Core, falling back to Core stage.
 */
async function fetchPaletteFromCore(tenantId: string): Promise<Record<string, unknown> | null> {
  if (CORE_URL && CORE_KEY) {
    const result = await fetchCorePalette(CORE_URL, CORE_KEY, tenantId);
    if (result) return result;
  }
  if (CORE_URL !== CORE_STAGE_URL) {
    const result = await fetchCorePalette(CORE_STAGE_URL, CORE_STAGE_KEY, tenantId);
    if (result) return result;
  }
  return null;
}

// ── GET: Fetch current tenant branding ────────────────────────────────────

export const GET = createSessionReadRoute(async ({ session }) => {
  const tenantId = session.tenantId!;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });

  // Fetch local row (assignments live here) and Core palette in parallel
  const [localResult, corePalette] = await Promise.all([
    supabase
      .from('tenant_branding')
      .select('*')
      .eq('tenant_id', tenantId)
      .limit(1)
      .maybeSingle(),
    fetchPaletteFromCore(tenantId),
  ]);

  if (localResult.error) throw AppError.internal(localResult.error.message);

  const local = localResult.data;

  // Merge: Core palette is authoritative for colors, local holds assignments
  const merged = {
    ...(local ?? {}),
    ...(corePalette
      ? {
          primary_color: corePalette.primary_color,
          secondary_color: corePalette.secondary_color,
          tertiary_color: corePalette.tertiary_color,
          accent_color: corePalette.accent_color,
          text_color: corePalette.text_color,
          background_color: corePalette.background_color,
          display_name: corePalette.display_name,
        }
      : {}),
    // Always preserve local assignments
    theme_config: local?.theme_config ?? null,
  };

  return Response.json({ data: merged, core_palette: corePalette ? true : false });
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
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/settings/branding' });
