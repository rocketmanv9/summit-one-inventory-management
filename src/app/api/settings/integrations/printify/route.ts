/**
 * Printify Integration API
 * GET  — check if Printify is connected
 * POST — connect/update Printify credentials
 * DELETE — disconnect Printify
 */
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Vault helpers (inlined — no provisioning dependency) ────────────

function secretName(tenantId: string, providerId: string): string {
  return `provider-secret-${tenantId}-${providerId}`;
}

async function storeSecret(adminClient: any, tenantId: string, providerId: string, token: string): Promise<string> {
  const name = secretName(tenantId, providerId);
  await adminClient.rpc('delete_secret_by_name', { secret_name: name });
  await adminClient.rpc('create_secret', { secret: token, name });
  return name;
}

async function resolveSecret(adminClient: any, ref: string): Promise<string> {
  const { data } = await adminClient
    .from('decrypted_secrets')
    .select('decrypted_secret')
    .eq('name', ref)
    .limit(1)
    .single();
  if (!data?.decrypted_secret) throw AppError.internal('Secret not found in vault');
  return data.decrypted_secret;
}

// ── GET: Check connection status ────────────────────────────────────

export const GET = createSessionReadRoute(async ({ session, log }) => {
  const adminClient = getAdminClient();
  const prov = (adminClient as any).schema('provisioning');

  const { data } = await prov
    .from('providers')
    .select('id, display_name, provider_key, provider_type, config, is_active, webhook_status, last_event_id')
    .eq('tenant_id', session.tenantId!)
    .eq('provider_type', 'print_on_demand')
    .like('provider_key', 'printify%')
    .limit(1)
    .maybeSingle();

  if (!data) {
    return Response.json({ data: { connected: false } });
  }

  // Mask the token
  const config = { ...data.config };
  if (config.api_token_ref) config.api_token_ref = '********';

  return Response.json({
    data: {
      connected: data.is_active,
      provider_id: data.id,
      shop_id: config.shop_id || null,
      webhook_status: data.webhook_status || 'unknown',
      last_event_id: data.last_event_id,
    },
  });
}, { serviceName: SERVICE_NAME });

// ── POST: Connect or update Printify ────────────────────────────────

const ConnectSchema = z.object({
  api_token: z.string().min(1).optional(),
  shop_id: z.string().min(1),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  const body = ConnectSchema.parse(await req.json());
  const adminClient = getAdminClient();
  const prov = (adminClient as any).schema('provisioning');

  // Check for existing provider
  const { data: existing } = await prov
    .from('providers')
    .select('id, config, last_event_id')
    .eq('tenant_id', ctx.tenantId!)
    .eq('provider_type', 'print_on_demand')
    .like('provider_key', 'printify%')
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Update existing
    const config: Record<string, unknown> = { ...existing.config, shop_id: body.shop_id };

    if (body.api_token) {
      const vaultRef = await storeSecret(adminClient, ctx.tenantId!, existing.id, body.api_token);
      config.api_token_ref = vaultRef;
    }

    const { error } = await prov
      .from('providers')
      .update({ config, is_active: true, last_event_id: idempotencyKey })
      .eq('id', existing.id);

    if (error) throw AppError.internal(error.message);

    // Validate connection
    const valid = await validatePrintify(adminClient, config);

    return {
      data: { connected: true, valid, provider_id: existing.id },
      status: 200,
      events: [{ event_name: 'integration.updated', payload: { provider: 'printify' }, last_event_id: idempotencyKey }],
    };
  }

  // Create new
  const { data: provider, error } = await prov
    .from('providers')
    .upsert({
      tenant_id: ctx.tenantId!,
      provider_key: 'printify-main',
      display_name: 'Printify',
      provider_type: 'print_on_demand',
      config: { shop_id: body.shop_id },
      capabilities: ['apparel', 'print_on_demand'],
      priority: 100,
      is_active: true,
      last_event_id: idempotencyKey,
    }, { onConflict: 'last_event_id' })
    .select()
    .single();

  if (error) throw AppError.internal(error.message);

  // Store token in vault
  if (body.api_token) {
    const vaultRef = await storeSecret(adminClient, ctx.tenantId!, provider.id, body.api_token);
    await prov
      .from('providers')
      .update({ config: { ...provider.config, api_token_ref: vaultRef } })
      .eq('id', provider.id);
  }

  const config = { shop_id: body.shop_id, api_token_ref: secretName(ctx.tenantId!, provider.id) };
  const valid = await validatePrintify(adminClient, config);

  return {
    data: { connected: true, valid, provider_id: provider.id },
    status: 201,
    events: [{ event_name: 'integration.created', payload: { provider: 'printify' }, last_event_id: idempotencyKey }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/settings/integrations/printify' });

// ── DELETE: Disconnect Printify ─────────────────────────────────────

const DisconnectSchema = z.object({});

export const DELETE = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  DisconnectSchema.parse(await req.json());
  const adminClient = getAdminClient();
  const prov = (adminClient as any).schema('provisioning');

  const { data: existing } = await prov
    .from('providers')
    .select('id')
    .eq('tenant_id', ctx.tenantId!)
    .eq('provider_type', 'print_on_demand')
    .like('provider_key', 'printify%')
    .limit(1)
    .maybeSingle();

  if (!existing) throw AppError.notFound('No Printify connection found');

  await prov
    .from('providers')
    .update({ is_active: false, last_event_id: idempotencyKey })
    .eq('id', existing.id);

  return {
    data: { disconnected: true },
    status: 200,
    events: [{ event_name: 'integration.disconnected', payload: { provider: 'printify' }, last_event_id: idempotencyKey }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'DELETE /api/settings/integrations/printify' });

// ── Validate Printify credentials ───────────────────────────────────

async function validatePrintify(adminClient: any, config: Record<string, unknown>): Promise<boolean> {
  try {
    const ref = config.api_token_ref as string;
    if (!ref || !config.shop_id) return false;

    const token = ref.startsWith('provider-secret-')
      ? await resolveSecret(adminClient, ref)
      : ref;

    const res = await fetch(`https://api.printify.com/v1/shops/${config.shop_id}.json`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
