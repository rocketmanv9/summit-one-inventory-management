/**
 * Provider Secret Management (Supabase Vault)
 *
 * Stores and retrieves provider API tokens using Supabase Vault
 * so that plaintext secrets never live in the providers.config column.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@rocketmanv9/chassis/errors';

/**
 * Build the canonical vault secret name for a provider.
 */
function secretName(tenantId: string, providerId: string): string {
  return `provider-secret-${tenantId}-${providerId}`;
}

/**
 * Store a provider secret in Supabase Vault.
 * Returns the vault reference name (stored in config.api_token_ref).
 */
export async function storeProviderSecret(
  supabase: SupabaseClient,
  tenantId: string,
  providerId: string,
  secretValue: string,
): Promise<string> {
  const name = secretName(tenantId, providerId);

  // Delete existing secret if present (vault.create_secret would fail on duplicate name)
  await supabase.rpc('delete_secret_by_name', { secret_name: name }).catch(() => {
    // Ignore — may not exist yet
  });

  const { error } = await supabase.rpc('create_secret', {
    secret: secretValue,
    name,
  });

  if (error) {
    throw AppError.internal(`Failed to store provider secret: ${error.message}`);
  }

  return name;
}

/**
 * Resolve a provider secret from Supabase Vault.
 * Reads from vault.decrypted_secrets view by secret name.
 */
export async function resolveProviderSecret(
  supabase: SupabaseClient,
  vaultRefName: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('decrypted_secrets')
    .select('decrypted_secret')
    .eq('name', vaultRefName)
    .limit(1)
    .single();

  if (error || !data?.decrypted_secret) {
    throw AppError.internal(`Provider secret not found in vault: ${vaultRefName}`);
  }

  return data.decrypted_secret;
}

/**
 * Delete a provider secret from Supabase Vault.
 */
export async function deleteProviderSecret(
  supabase: SupabaseClient,
  tenantId: string,
  providerId: string,
): Promise<void> {
  const name = secretName(tenantId, providerId);

  const { error } = await supabase.rpc('delete_secret_by_name', {
    secret_name: name,
  });

  if (error) {
    // Non-fatal — secret may already be gone
  }
}

/**
 * Check whether a config value is a vault reference (vs. plaintext).
 */
export function isVaultRef(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.startsWith('provider-secret-');
}

/**
 * Mask sensitive fields in provider config for API responses.
 * Replaces api_token_ref with "********" so the raw token / vault ref
 * never reaches the frontend.
 */
export function maskProviderConfig(config: Record<string, unknown>): Record<string, unknown> {
  if (!config) return config;
  const masked = { ...config };
  if (masked.api_token_ref) {
    masked.api_token_ref = '********';
  }
  return masked;
}
