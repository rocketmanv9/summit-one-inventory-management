/**
 * Procurement Provider OAuth Flow
 * GET  — get OAuth authorization URL
 * POST — exchange authorization code for tokens
 */
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';
import { getAdapter, resolveProcurementConfigByKey } from '@/lib/integrations/procurement';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── GET: Get OAuth URL ────────────────────────────────────────────────

export const GET = createSessionReadRoute(async ({ req, session }) => {
  const pathParts = new URL(req.url).pathname.split('/');
  // Path: /api/settings/integrations/procurement/[providerKey]/oauth
  const providerKeyFromPath = pathParts[pathParts.length - 2];

  if (!providerKeyFromPath) throw AppError.badRequest('Missing provider key');

  const adapter = getAdapter(providerKeyFromPath);
  if (!adapter) throw AppError.notFound(`No adapter found for provider "${providerKeyFromPath}"`);
  if (!adapter.getOAuthUrl) throw AppError.badRequest('This provider does not support OAuth');

  const adminClient = getAdminClient();

  // Build a minimal config for OAuth URL generation
  const prov = (adminClient as any).schema('provisioning');
  const { data: existing } = await prov
    .from('providers')
    .select('id, config')
    .eq('tenant_id', session.tenantId!)
    .like('provider_key', `${adapter.meta.key}%`)
    .limit(1)
    .maybeSingle();

  const config = {
    providerId: existing?.id || '',
    tenantId: session.tenantId!,
    providerKey: `${adapter.meta.key}-main`,
    displayName: adapter.meta.displayName,
    providerType: adapter.meta.providerType,
    isActive: false,
    settings: existing?.config || {},
    credentials: {},
  };

  const redirectUri = `${new URL(req.url).origin}/api/settings/integrations/procurement/${providerKeyFromPath}/oauth`;
  const result = await adapter.getOAuthUrl(config, redirectUri);

  return Response.json({ data: result });
}, { serviceName: SERVICE_NAME });

// ── POST: Exchange OAuth code ─────────────────────────────────────────

const ExchangeSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, log, idempotencyKey }) => {
  const body = ExchangeSchema.parse(await req.json());

  const pathParts = new URL(req.url).pathname.split('/');
  const providerKeyFromPath = pathParts[pathParts.length - 2];

  if (!providerKeyFromPath) throw AppError.badRequest('Missing provider key');

  const adapter = getAdapter(providerKeyFromPath);
  if (!adapter) throw AppError.notFound(`No adapter found for provider "${providerKeyFromPath}"`);
  if (!adapter.exchangeOAuthCode) throw AppError.badRequest('This provider does not support OAuth');

  const adminClient = getAdminClient();
  const prov = (adminClient as any).schema('provisioning');

  // Get or create provider row
  const { data: existing } = await prov
    .from('providers')
    .select('id, config')
    .eq('tenant_id', ctx.tenantId!)
    .like('provider_key', `${adapter.meta.key}%`)
    .limit(1)
    .maybeSingle();

  const config = {
    providerId: existing?.id || '',
    tenantId: ctx.tenantId!,
    providerKey: `${adapter.meta.key}-main`,
    displayName: adapter.meta.displayName,
    providerType: adapter.meta.providerType,
    isActive: false,
    settings: existing?.config || {},
    credentials: {},
  };

  const redirectUri = `${new URL(req.url).origin}/api/settings/integrations/procurement/${providerKeyFromPath}/oauth`;
  const tokens = await adapter.exchangeOAuthCode(config, body.code, redirectUri);

  // Store tokens in Vault and update provider
  const secretPrefix = `provider-secret-${ctx.tenantId!}`;

  if (existing) {
    // Update existing
    const provConfig: Record<string, unknown> = { ...existing.config };

    const tokenSecretName = `${secretPrefix}-${existing.id}-access_token`;
    await adminClient.rpc('delete_secret_by_name', { secret_name: tokenSecretName });
    await adminClient.rpc('create_secret', { secret: tokens.accessToken, name: tokenSecretName });
    provConfig.access_token_ref = tokenSecretName;

    if (tokens.refreshToken) {
      const refreshSecretName = `${secretPrefix}-${existing.id}-refresh_token`;
      await adminClient.rpc('delete_secret_by_name', { secret_name: refreshSecretName });
      await adminClient.rpc('create_secret', { secret: tokens.refreshToken, name: refreshSecretName });
      provConfig.refresh_token_ref = refreshSecretName;
    }

    if (tokens.expiresAt) provConfig.token_expires_at = tokens.expiresAt;

    await prov
      .from('providers')
      .update({ config: provConfig, is_active: true, last_event_id: idempotencyKey })
      .eq('id', existing.id);

    return {
      data: { connected: true, provider_id: existing.id },
      status: 200,
      events: [{ event_name: 'procurement.provider.connected', payload: { provider: adapter.meta.key, method: 'oauth' }, last_event_id: idempotencyKey }],
    };
  }

  // Create new provider
  const { data: provider, error } = await prov
    .from('providers')
    .upsert({
      tenant_id: ctx.tenantId!,
      provider_key: `${adapter.meta.key}-main`,
      display_name: adapter.meta.displayName,
      provider_type: adapter.meta.providerType,
      config: {},
      capabilities: adapter.meta.capabilities,
      priority: 100,
      is_active: true,
      last_event_id: idempotencyKey,
    }, { onConflict: 'last_event_id' })
    .select()
    .single();

  if (error) throw AppError.internal(error.message);

  // Store tokens
  const tokenSecretName = `${secretPrefix}-${provider.id}-access_token`;
  await adminClient.rpc('create_secret', { secret: tokens.accessToken, name: tokenSecretName });
  const provConfig: Record<string, unknown> = { access_token_ref: tokenSecretName };

  if (tokens.refreshToken) {
    const refreshSecretName = `${secretPrefix}-${provider.id}-refresh_token`;
    await adminClient.rpc('create_secret', { secret: tokens.refreshToken, name: refreshSecretName });
    provConfig.refresh_token_ref = refreshSecretName;
  }

  if (tokens.expiresAt) provConfig.token_expires_at = tokens.expiresAt;

  await prov.from('providers').update({ config: provConfig }).eq('id', provider.id);

  return {
    data: { connected: true, provider_id: provider.id },
    status: 201,
    events: [{ event_name: 'procurement.provider.connected', payload: { provider: adapter.meta.key, method: 'oauth' }, last_event_id: idempotencyKey }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/settings/integrations/procurement/[providerKey]/oauth' });
