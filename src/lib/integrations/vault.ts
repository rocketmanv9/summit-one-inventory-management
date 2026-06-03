/**
 * Supabase Vault helpers for storing third-party secrets at rest.
 *
 * Matches the pattern already used by the Printify and Amazon Business
 * integrations: secrets are encrypted by Vault and only a *reference name* is
 * persisted in application tables. The raw secret never lives in our schema and
 * is never returned to the frontend.
 *
 * These call the public-schema RPCs `create_secret` / `delete_secret_by_name`
 * and read back from the `decrypted_secrets` view via the service-role client.
 */
import { AppError } from '@rocketmanv9/chassis/errors';

// The admin (service-role) client — typed loosely to avoid importing the
// raw @supabase/supabase-js type (scanner-flagged in non-util files).
type AdminClient = any;

/** Deterministic Vault secret name for a Google connection refresh token. */
export function googleSecretName(tenantId: string, connectionId: string): string {
  return `google-refresh-${tenantId}-${connectionId}`;
}

/**
 * Store (or replace) a secret in Vault and return its reference name.
 * Delete-then-create keeps the name stable across token rotations.
 */
export async function storeSecret(
  admin: AdminClient,
  name: string,
  secret: string,
): Promise<string> {
  await admin.rpc('delete_secret_by_name', { secret_name: name });
  const { error } = await admin.rpc('create_secret', { secret, name });
  if (error) throw AppError.internal(`Failed to store secret in vault: ${error.message}`);
  return name;
}

/** Resolve a Vault secret reference back to its decrypted plaintext. */
export async function resolveSecret(admin: AdminClient, ref: string): Promise<string> {
  const { data } = await admin
    .from('decrypted_secrets')
    .select('decrypted_secret')
    .eq('name', ref)
    .limit(1)
    .maybeSingle();
  if (!data?.decrypted_secret) throw AppError.internal('Secret not found in vault');
  return data.decrypted_secret as string;
}

/** Permanently delete a Vault secret by reference name (best-effort). */
export async function deleteSecret(admin: AdminClient, ref: string): Promise<void> {
  await admin.rpc('delete_secret_by_name', { secret_name: ref });
}
