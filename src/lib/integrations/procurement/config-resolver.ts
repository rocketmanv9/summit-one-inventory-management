/**
 * Procurement Provider Config Resolver
 *
 * Reads the provider record from provisioning.providers and resolves
 * credentials from Supabase Vault. Follows the same pattern as
 * src/lib/integrations/printify.ts:175-220.
 */

import { AppError } from '@rocketmanv9/chassis/errors';
import type { ProcurementProviderConfig } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

/**
 * Resolve a procurement provider config for a tenant + provider key.
 * Looks up the provider row from provisioning.providers and resolves
 * any Vault secret references in the config.
 */
export async function resolveProcurementConfig(
  adminClient: SupabaseClient,
  tenantId: string,
  providerId: string
): Promise<ProcurementProviderConfig> {
  const prov = (adminClient as SupabaseClient).schema('provisioning');

  const { data: provider } = await prov
    .from('providers')
    .select('id, tenant_id, provider_key, display_name, provider_type, config, is_active')
    .eq('id', providerId)
    .eq('tenant_id', tenantId)
    .limit(1)
    .maybeSingle();

  if (!provider) {
    throw AppError.notFound('Procurement provider not found');
  }

  if (!provider.is_active) {
    throw AppError.badRequest('Procurement provider is not active. Reconnect it in Settings > Integrations.');
  }

  // Resolve secrets from Vault
  const credentials: Record<string, string> = {};
  const config = provider.config || {};

  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'string' && value.startsWith('provider-secret-')) {
      const { data: secretRow } = await adminClient
        .from('decrypted_secrets')
        .select('decrypted_secret')
        .eq('name', value)
        .limit(1)
        .single();

      if (!secretRow?.decrypted_secret) {
        throw AppError.internal(`Secret "${key}" not found in Vault for provider ${provider.provider_key}`);
      }

      credentials[key.replace(/_ref$/, '')] = secretRow.decrypted_secret;
    }
  }

  return {
    providerId: provider.id,
    tenantId: provider.tenant_id,
    providerKey: provider.provider_key,
    displayName: provider.display_name,
    providerType: provider.provider_type,
    isActive: provider.is_active,
    settings: config,
    credentials,
  };
}

/**
 * Resolve a procurement provider by provider_key prefix (e.g., 'amazon-business').
 * Finds the first active provider matching the key prefix for the tenant.
 */
export async function resolveProcurementConfigByKey(
  adminClient: SupabaseClient,
  tenantId: string,
  providerKeyPrefix: string
): Promise<ProcurementProviderConfig> {
  const prov = (adminClient as SupabaseClient).schema('provisioning');

  const { data: provider } = await prov
    .from('providers')
    .select('id')
    .eq('tenant_id', tenantId)
    .like('provider_key', `${providerKeyPrefix}%`)
    .in('provider_type', ['procurement_marketplace', 'procurement_distributor', 'procurement_direct'])
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (!provider) {
    throw AppError.notFound(`No active procurement provider found matching "${providerKeyPrefix}"`);
  }

  return resolveProcurementConfig(adminClient, tenantId, provider.id);
}
