/**
 * Amazon Business Integration API
 * GET  — check if Amazon Business is connected
 * POST — connect/update Amazon Business credentials
 * DELETE — disconnect Amazon Business
 */
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';
import { validateConnection } from '@/lib/integrations/amazon-business';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Vault helpers ────────────────────────────────────────────────────────

function secretName(tenantId: string, providerId: string, key: string): string {
  return `amazon-biz-${key}-${tenantId}-${providerId}`;
}

async function storeSecret(
  adminClient: any, tenantId: string, providerId: string, key: string, value: string
): Promise<string> {
  const name = secretName(tenantId, providerId, key);
  await adminClient.rpc('delete_secret_by_name', { secret_name: name });
  await adminClient.rpc('create_secret', { secret: value, name });
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

// ── GET: Check connection status ─────────────────────────────────────────

export const GET = createSessionReadRoute(async ({ session }) => {
  const adminClient = getAdminClient();
  const prov = (adminClient as any).schema('provisioning');

  const { data } = await prov
    .from('providers')
    .select('id, display_name, provider_key, provider_type, config, is_active, last_event_id')
    .eq('tenant_id', session.tenantId!)
    .eq('provider_type', 'procurement_marketplace')
    .like('provider_key', 'amazon-business%')
    .limit(1)
    .maybeSingle();

  if (!data) {
    return Response.json({ data: { connected: false, needs_authorization: false } });
  }

  return Response.json({
    data: {
      connected: data.is_active,
      provider_id: data.id,
      application_id: data.config?.application_id || null,
      sandbox: data.config?.sandbox || false,
      needs_authorization: !!(data.config?.client_id_ref && !data.config?.refresh_token_ref),
      last_event_id: data.last_event_id,
    },
  });
}, { serviceName: SERVICE_NAME });

// ── POST: Connect or update Amazon Business ──────────────────────────────

const ConnectSchema = z.object({
  application_id: z.string().min(1).optional(),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  refresh_token: z.string().min(1).optional().or(z.literal('')).transform(v => v || undefined),
  sandbox: z.boolean().optional(),
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
    .eq('provider_type', 'procurement_marketplace')
    .like('provider_key', 'amazon-business%')
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Update existing — store client_id + client_secret always
    const clientIdRef = await storeSecret(adminClient, ctx.tenantId!, existing.id, 'client-id', body.client_id);
    const clientSecretRef = await storeSecret(adminClient, ctx.tenantId!, existing.id, 'client-secret', body.client_secret);

    // Only store refresh_token if provided (otherwise keep existing ref)
    let refreshTokenRef = existing.config?.refresh_token_ref;
    if (body.refresh_token) {
      refreshTokenRef = await storeSecret(adminClient, ctx.tenantId!, existing.id, 'refresh-token', body.refresh_token);
    }

    const hasRefreshToken = !!refreshTokenRef;
    const config = {
      ...existing.config,
      application_id: body.application_id || existing.config?.application_id,
      sandbox: body.sandbox ?? existing.config?.sandbox ?? false,
      client_id_ref: clientIdRef,
      client_secret_ref: clientSecretRef,
      ...(refreshTokenRef ? { refresh_token_ref: refreshTokenRef } : {}),
    };

    const { error } = await prov
      .from('providers')
      .update({ config, is_active: hasRefreshToken, last_event_id: idempotencyKey })
      .eq('id', existing.id);

    if (error) throw AppError.internal(error.message);

    // Validate connection only if we have all three credentials
    let valid = false;
    if (body.refresh_token) {
      valid = await validateConnection({
        clientId: body.client_id,
        clientSecret: body.client_secret,
        refreshToken: body.refresh_token,
        sandbox: body.sandbox ?? existing.config?.sandbox ?? false,
      });
    }

    return {
      data: {
        connected: hasRefreshToken,
        valid,
        provider_id: existing.id,
        needs_authorization: !hasRefreshToken,
      },
      status: 200,
      events: [{ event_name: 'integration.updated', payload: { provider: 'amazon-business' }, last_event_id: idempotencyKey }],
    };
  }

  // Create new — provider starts inactive until refresh_token is obtained via OAuth
  const hasRefreshToken = !!body.refresh_token;
  const { data: provider, error } = await prov
    .from('providers')
    .upsert({
      tenant_id: ctx.tenantId!,
      provider_key: 'amazon-business-main',
      display_name: 'Amazon Business',
      provider_type: 'procurement_marketplace',
      config: { application_id: body.application_id, sandbox: body.sandbox ?? false },
      capabilities: ['procurement', 'marketplace'],
      priority: 100,
      is_active: hasRefreshToken,
      last_event_id: idempotencyKey,
    }, { onConflict: 'last_event_id' })
    .select()
    .single();

  if (error) throw AppError.internal(error.message);

  // Store secrets in Vault
  const clientIdRef = await storeSecret(adminClient, ctx.tenantId!, provider.id, 'client-id', body.client_id);
  const clientSecretRef = await storeSecret(adminClient, ctx.tenantId!, provider.id, 'client-secret', body.client_secret);

  let refreshTokenRef: string | undefined;
  if (body.refresh_token) {
    refreshTokenRef = await storeSecret(adminClient, ctx.tenantId!, provider.id, 'refresh-token', body.refresh_token);
  }

  await prov
    .from('providers')
    .update({
      config: {
        ...provider.config,
        client_id_ref: clientIdRef,
        client_secret_ref: clientSecretRef,
        ...(refreshTokenRef ? { refresh_token_ref: refreshTokenRef } : {}),
      },
    })
    .eq('id', provider.id);

  // Validate connection only if we have all credentials
  let valid = false;
  if (body.refresh_token) {
    valid = await validateConnection({
      clientId: body.client_id,
      clientSecret: body.client_secret,
      refreshToken: body.refresh_token,
      sandbox: body.sandbox ?? false,
    });
  }

  return {
    data: {
      connected: hasRefreshToken,
      valid,
      provider_id: provider.id,
      needs_authorization: !hasRefreshToken,
    },
    status: 201,
    events: [{ event_name: 'integration.created', payload: { provider: 'amazon-business' }, last_event_id: idempotencyKey }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/settings/integrations/amazon-business' });

// ── DELETE: Disconnect Amazon Business ───────────────────────────────────

const DisconnectSchema = z.object({});

export const DELETE = createSessionWriteRoute(async ({ req, ctx, idempotencyKey }) => {
  DisconnectSchema.parse(await req.json());
  const adminClient = getAdminClient();
  const prov = (adminClient as any).schema('provisioning');

  const { data: existing } = await prov
    .from('providers')
    .select('id, config')
    .eq('tenant_id', ctx.tenantId!)
    .eq('provider_type', 'procurement_marketplace')
    .like('provider_key', 'amazon-business%')
    .limit(1)
    .maybeSingle();

  if (!existing) throw AppError.notFound('No Amazon Business connection found');

  // Clean up secrets from Vault
  const refs = [
    existing.config?.client_id_ref,
    existing.config?.client_secret_ref,
    existing.config?.refresh_token_ref,
  ].filter(Boolean);
  for (const ref of refs) {
    await adminClient.rpc('delete_secret_by_name', { secret_name: ref });
  }

  // Delete the provider record entirely so UI returns to credential entry
  await prov
    .from('providers')
    .delete()
    .eq('id', existing.id);

  return {
    data: { disconnected: true },
    status: 200,
    events: [{ event_name: 'integration.disconnected', payload: { provider: 'amazon-business' }, last_event_id: idempotencyKey }],
  };
}, { serviceName: SERVICE_NAME, scope: 'DELETE /api/settings/integrations/amazon-business' });
