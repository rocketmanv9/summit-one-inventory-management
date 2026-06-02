/**
 * Amazon Business cXML Integration API
 * GET  — check if Amazon Business cXML is configured
 * POST — save/update cXML credentials (From Identity, Shared Secret, URLs)
 * DELETE — disconnect Amazon Business
 */
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Vault helpers ────────────────────────────────────────────────────────

function secretName(tenantId: string, providerId: string, key: string): string {
  return `amazon-cxml-${key}-${tenantId}-${providerId}`;
}

async function storeSecret(
  adminClient: any, tenantId: string, providerId: string, key: string, value: string
): Promise<string> {
  const name = secretName(tenantId, providerId, key);
  await adminClient.rpc('delete_secret_by_name', { secret_name: name });
  await adminClient.rpc('create_secret', { secret: value, name });
  return name;
}

// ── Vendor auto-provisioning ─────────────────────────────────────────────

async function ensureAmazonVendor(adminClient: any, tenantId: string, idempotencyKey: string): Promise<void> {
  const sc = (adminClient as any).schema('supply_chain');

  const { data: existing } = await sc
    .from('vendors')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('code', 'AMAZON-BIZ')
    .limit(1)
    .maybeSingle();

  if (existing) return;

  await sc
    .from('vendors')
    .upsert({
      tenant_id: tenantId,
      name: 'Amazon Business',
      code: 'AMAZON-BIZ',
      active: true,
      payment_terms: 'CARD',
      ordering_mode: 'amazon_punchout',
      notes: 'Auto-created by Amazon Business cXML integration',
      last_event_id: `amazon-biz-vendor-${idempotencyKey}`,
    }, { onConflict: 'tenant_id,code' })
    .select()
    .single();
}

// ── GET: Check connection status ─────────────────────────────────────────

export const GET = createSessionReadRoute(async ({ session }) => {
  const adminClient = getAdminClient();
  const prov = (adminClient as any).schema('provisioning');

  const { data } = await prov
    .from('providers')
    .select('id, display_name, provider_key, provider_type, config, is_active, integration_mode, last_event_id')
    .eq('tenant_id', session.tenantId!)
    .eq('provider_type', 'procurement_marketplace')
    .like('provider_key', 'amazon-business%')
    .limit(1)
    .maybeSingle();

  if (!data) {
    return Response.json({ data: { connected: false, configured: false } });
  }

  const hasCredentials = !!(data.config?.from_identity_ref && data.config?.shared_secret_ref);
  const hasPoUrl = !!data.config?.po_request_url;

  return Response.json({
    data: {
      connected: data.is_active && hasCredentials,
      configured: hasCredentials && hasPoUrl,
      provider_id: data.id,
      integration_mode: data.integration_mode ?? 'test',
      sandbox: data.config?.sandbox ?? true,
      po_request_url_set: hasPoUrl,
      punchout_urls: data.config?.punchout_urls ?? [],
      last_event_id: data.last_event_id,
    },
  });
}, { serviceName: SERVICE_NAME });

// ── POST: Save or update cXML credentials ────────────────────────────────

const ConnectSchema = z.object({
  from_identity: z.string().min(1),
  shared_secret: z.string().min(1),
  po_request_url: z.string().url(),
  punchout_urls: z.array(z.string().url()).optional().default([]),
  // Optional and NOT defaulted: test/live is owned by the PATCH mode toggle.
  // Re-saving credentials must never silently flip an existing connection back
  // to test mode, so we only honor sandbox here if explicitly provided.
  sandbox: z.boolean().optional(),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, idempotencyKey }) => {
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
    const fromIdentityRef = await storeSecret(adminClient, ctx.tenantId!, existing.id, 'from-identity', body.from_identity);
    const sharedSecretRef = await storeSecret(adminClient, ctx.tenantId!, existing.id, 'shared-secret', body.shared_secret);

    const config = {
      ...existing.config,
      // Preserve the current mode unless the caller explicitly sets it.
      sandbox: body.sandbox ?? existing.config?.sandbox ?? true,
      from_identity_ref: fromIdentityRef,
      shared_secret_ref: sharedSecretRef,
      po_request_url: body.po_request_url,
      punchout_urls: body.punchout_urls,
    };

    // Remove stale OAuth refs if they exist from the old SP-API integration
    delete config.client_id_ref;
    delete config.client_secret_ref;
    delete config.refresh_token_ref;
    delete config.application_id;

    const { error } = await prov
      .from('providers')
      .update({ config, is_active: true, last_event_id: idempotencyKey })
      .eq('id', existing.id);

    if (error) throw AppError.internal(error.message);

    await ensureAmazonVendor(adminClient, ctx.tenantId!, idempotencyKey);

    const configured = !!(body.from_identity && body.shared_secret && body.po_request_url);

    return {
      data: {
        connected: true,
        configured,
        provider_id: existing.id,
      },
      status: 200,
      events: [{ event_name: 'integration.updated', payload: { provider: 'amazon-business', mechanism: 'cxml' }, last_event_id: idempotencyKey }],
    };
  }

  // Create new provider — always starts in test mode
  const { data: provider, error } = await prov
    .from('providers')
    .upsert({
      tenant_id: ctx.tenantId!,
      provider_key: 'amazon-business-main',
      display_name: 'Amazon Business',
      provider_type: 'procurement_marketplace',
      config: {
        sandbox: body.sandbox ?? true,
        po_request_url: body.po_request_url,
        punchout_urls: body.punchout_urls,
      },
      capabilities: ['procurement', 'marketplace'],
      priority: 100,
      is_active: true,
      integration_mode: 'test',
      last_event_id: idempotencyKey,
    }, { onConflict: 'last_event_id' })
    .select()
    .single();

  if (error) throw AppError.internal(error.message);

  const fromIdentityRef = await storeSecret(adminClient, ctx.tenantId!, provider.id, 'from-identity', body.from_identity);
  const sharedSecretRef = await storeSecret(adminClient, ctx.tenantId!, provider.id, 'shared-secret', body.shared_secret);

  await prov
    .from('providers')
    .update({
      config: {
        ...provider.config,
        from_identity_ref: fromIdentityRef,
        shared_secret_ref: sharedSecretRef,
      },
    })
    .eq('id', provider.id);

  await ensureAmazonVendor(adminClient, ctx.tenantId!, idempotencyKey);

  const configured = !!(body.from_identity && body.shared_secret && body.po_request_url);

  return {
    data: {
      connected: true,
      configured,
      provider_id: provider.id,
    },
    status: 201,
    events: [{ event_name: 'integration.created', payload: { provider: 'amazon-business', mechanism: 'cxml' }, last_event_id: idempotencyKey }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/settings/integrations/amazon-business' });

// ── PATCH: Flip sandbox (test) ↔ live mode ───────────────────────────────
// Lightweight mode switch that doesn't require re-entering credentials. sandbox
// drives the cXML deploymentMode (test|production) Amazon shows in its banner.

const ModeSchema = z.object({ sandbox: z.boolean() });

export const PATCH = createSessionWriteRoute(async ({ req, ctx, idempotencyKey }) => {
  const { sandbox } = ModeSchema.parse(await req.json());
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

  const { error } = await prov
    .from('providers')
    .update({
      config: { ...existing.config, sandbox },
      integration_mode: sandbox ? 'test' : 'active',
      last_event_id: idempotencyKey,
    })
    .eq('id', existing.id);

  if (error) throw AppError.internal(error.message);

  return {
    data: { sandbox, integration_mode: sandbox ? 'test' : 'active' },
    status: 200,
    events: [{
      event_name: 'integration.updated',
      payload: { provider: 'amazon-business', sandbox },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'PATCH /api/settings/integrations/amazon-business' });

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

  // Clean up all secrets from Vault (both old OAuth refs and new cXML refs)
  const refs = [
    existing.config?.from_identity_ref,
    existing.config?.shared_secret_ref,
    existing.config?.client_id_ref,
    existing.config?.client_secret_ref,
    existing.config?.refresh_token_ref,
  ].filter(Boolean);
  for (const ref of refs) {
    await adminClient.rpc('delete_secret_by_name', { secret_name: ref });
  }

  await prov
    .from('providers')
    .delete()
    .eq('id', existing.id);

  return {
    data: { disconnected: true },
    status: 200,
    events: [{ event_name: 'integration.disconnected', payload: { provider: 'amazon-business' }, last_event_id: idempotencyKey }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'DELETE /api/settings/integrations/amazon-business' });
