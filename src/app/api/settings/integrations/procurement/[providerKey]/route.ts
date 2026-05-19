/**
 * Procurement Provider Connection — Connect / Disconnect
 * POST  — connect a procurement provider (API key flow)
 * DELETE — disconnect a procurement provider
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';
import { getAdapter } from '@/lib/integrations/procurement';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Vault helpers ─────────────────────────────────────────────────────

function secretName(tenantId: string, providerId: string, key: string): string {
  return `provider-secret-${tenantId}-${providerId}-${key}`;
}

async function storeSecret(adminClient: any, name: string, value: string): Promise<string> {
  await adminClient.rpc('delete_secret_by_name', { secret_name: name });
  await adminClient.rpc('create_secret', { secret: value, name });
  return name;
}

// ── POST: Connect provider ────────────────────────────────────────────

const ConnectSchema = z.object({
  credentials: z.record(z.string(), z.string()).default({}),
  settings: z.record(z.string(), z.unknown()).default({}),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  const providerKey = (req as any).nextUrl?.pathname?.split('/').pop()
    || new URL(req.url).pathname.split('/').filter(Boolean).pop();

  // Extract providerKey from URL path: /api/settings/integrations/procurement/[providerKey]
  const pathParts = new URL(req.url).pathname.split('/');
  const providerKeyFromPath = pathParts[pathParts.length - 1];

  if (!providerKeyFromPath) throw AppError.badRequest('Missing provider key');

  const adapter = getAdapter(providerKeyFromPath);
  if (!adapter) throw AppError.notFound(`No adapter found for provider "${providerKeyFromPath}"`);

  const body = ConnectSchema.parse(await req.json());
  const adminClient = getAdminClient();
  const prov = (adminClient as any).schema('provisioning');

  const fullProviderKey = `${adapter.meta.key}-main`;

  // Check for existing provider
  const { data: existing } = await prov
    .from('providers')
    .select('id, config, last_event_id')
    .eq('tenant_id', ctx.tenantId!)
    .eq('provider_key', fullProviderKey)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Update existing provider
    const config: Record<string, unknown> = { ...existing.config, ...body.settings };

    // Store secrets in Vault
    for (const [key, value] of Object.entries(body.credentials)) {
      const ref = await storeSecret(adminClient, secretName(ctx.tenantId!, existing.id, key), String(value));
      config[`${key}_ref`] = ref;
    }

    const { error } = await prov
      .from('providers')
      .update({ config, is_active: true, last_event_id: idempotencyKey })
      .eq('id', existing.id);

    if (error) throw AppError.internal(error.message);

    return {
      data: { connected: true, provider_id: existing.id },
      status: 200,
      events: [{ event_name: 'procurement.provider.connected', payload: { provider: adapter.meta.key, action: 'updated' }, last_event_id: idempotencyKey }],
    };
  }

  // Create new provider
  const { data: provider, error } = await prov
    .from('providers')
    .upsert({
      tenant_id: ctx.tenantId!,
      provider_key: fullProviderKey,
      display_name: adapter.meta.displayName,
      provider_type: adapter.meta.providerType,
      config: body.settings,
      capabilities: adapter.meta.capabilities,
      priority: 100,
      is_active: true,
      last_event_id: idempotencyKey,
    }, { onConflict: 'last_event_id' })
    .select()
    .single();

  if (error) throw AppError.internal(error.message);

  // Store secrets in Vault
  const config: Record<string, unknown> = { ...provider.config };
  for (const [key, value] of Object.entries(body.credentials)) {
    const ref = await storeSecret(adminClient, secretName(ctx.tenantId!, provider.id, key), value);
    config[`${key}_ref`] = ref;
  }

  if (Object.keys(body.credentials).length > 0) {
    await prov
      .from('providers')
      .update({ config })
      .eq('id', provider.id);
  }

  return {
    data: { connected: true, provider_id: provider.id },
    status: 201,
    events: [{ event_name: 'procurement.provider.connected', payload: { provider: adapter.meta.key, action: 'created' }, last_event_id: idempotencyKey }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/settings/integrations/procurement/[providerKey]' });

// ── DELETE: Disconnect provider ───────────────────────────────────────

const DisconnectSchema = z.object({});

export const DELETE = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  DisconnectSchema.parse(await req.json());

  const pathParts = new URL(req.url).pathname.split('/');
  const providerKeyFromPath = pathParts[pathParts.length - 1];

  if (!providerKeyFromPath) throw AppError.badRequest('Missing provider key');

  const adapter = getAdapter(providerKeyFromPath);
  if (!adapter) throw AppError.notFound(`No adapter found for provider "${providerKeyFromPath}"`);

  const adminClient = getAdminClient();
  const prov = (adminClient as any).schema('provisioning');

  const { data: existing } = await prov
    .from('providers')
    .select('id')
    .eq('tenant_id', ctx.tenantId!)
    .like('provider_key', `${adapter.meta.key}%`)
    .in('provider_type', ['procurement_marketplace', 'procurement_distributor', 'procurement_direct'])
    .limit(1)
    .maybeSingle();

  if (!existing) throw AppError.notFound('No connection found for this provider');

  await prov
    .from('providers')
    .update({ is_active: false, last_event_id: idempotencyKey })
    .eq('id', existing.id);

  return {
    data: { disconnected: true },
    status: 200,
    events: [{ event_name: 'procurement.provider.disconnected', payload: { provider: adapter.meta.key }, last_event_id: idempotencyKey }],
  };
}, { serviceName: SERVICE_NAME, scope: 'DELETE /api/settings/integrations/procurement/[providerKey]' });
