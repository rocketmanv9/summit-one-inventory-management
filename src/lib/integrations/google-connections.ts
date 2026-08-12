/**
 * Google connection service — the data layer for supply_chain.google_connections.
 *
 * Responsibilities:
 *   • persist connections (refresh token → Vault, only a ref in our table)
 *   • resolve the right connection to send from (personal → shared mailbox)
 *   • mint short-lived access tokens from the stored refresh token
 *
 * Refresh tokens are never returned from this module. The only thing that leaves
 * is a freshly-minted, short-lived ACCESS token used immediately for a Gmail call.
 */
import { getAdminClient } from '@/utils/supabase/admin';
import { AppError } from '@rocketmanv9/chassis/errors';
import {
  googleSecretName,
  storeSecret,
  resolveSecret,
  deleteSecret,
} from './vault';
import {
  refreshGoogleAccessToken,
  revokeGoogleToken,
  type GoogleTokenResponse,
} from './google-oauth';

type AdminClient = any;
type FetchLike = typeof fetch;

export type ConnectionType = 'user' | 'shared_mailbox';

export interface GoogleConnectionRow {
  id: string;
  tenant_id: string;
  user_id: string;
  connection_type: ConnectionType;
  google_email: string;
  google_sub: string | null;
  display_name: string | null;
  refresh_token_secret_ref: string;
  scopes: string[];
  connected_at: string;
  revoked_at: string | null;
  last_event_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Public-safe view of a connection (no token material). */
export interface GoogleConnectionPublic {
  id: string;
  connection_type: ConnectionType;
  google_email: string;
  display_name: string | null;
  scopes: string[];
  connected_at: string;
  revoked_at: string | null;
  is_active: boolean;
}

export function toPublicConnection(row: GoogleConnectionRow): GoogleConnectionPublic {
  return {
    id: row.id,
    connection_type: row.connection_type,
    google_email: row.google_email,
    display_name: row.display_name,
    scopes: row.scopes ?? [],
    connected_at: row.connected_at,
    revoked_at: row.revoked_at,
    is_active: !row.revoked_at,
  };
}

const TABLE = 'google_connections';
function sc(admin: AdminClient) {
  return admin.schema('supply_chain');
}

// ── Persistence ──────────────────────────────────────────────────────────────

export interface UpsertConnectionInput {
  tenantId: string;
  userId: string;
  connectionType: ConnectionType;
  googleEmail: string;
  googleSub?: string | null;
  displayName?: string | null;
  refreshToken: string;
  scopes: string[];
  lastEventId: string;
}

/**
 * Create or update a connection. The refresh token is written to Vault and only
 * its reference is stored on the row. Re-connecting the same account rotates the
 * stored token and clears any prior revocation.
 */
export async function upsertGoogleConnection(
  admin: AdminClient,
  input: UpsertConnectionInput,
): Promise<GoogleConnectionRow> {
  // Find an existing row to reuse its id (keeps the Vault secret name stable).
  const existing = await findExisting(admin, input);
  const connectionId = existing?.id ?? crypto.randomUUID();

  const ref = googleSecretName(input.tenantId, connectionId);
  await storeSecret(admin, ref, input.refreshToken);

  const rowValues = {
    id: connectionId,
    tenant_id: input.tenantId,
    user_id: input.userId,
    connection_type: input.connectionType,
    google_email: input.googleEmail.toLowerCase(),
    google_sub: input.googleSub ?? null,
    display_name: input.displayName ?? null,
    refresh_token_secret_ref: ref,
    scopes: input.scopes,
    revoked_at: null,
    connected_at: new Date().toISOString(),
    last_event_id: input.lastEventId,
  };

  if (existing) {
    const { data, error } = await sc(admin)
      .from(TABLE)
      .update(rowValues)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw AppError.internal(`Failed to update Google connection: ${error.message}`);
    return data as GoogleConnectionRow;
  }

  const { data, error } = await sc(admin)
    .from(TABLE)
    .insert(rowValues)
    .select()
    .single();
  if (error) throw AppError.internal(`Failed to save Google connection: ${error.message}`);
  return data as GoogleConnectionRow;
}

async function findExisting(
  admin: AdminClient,
  input: { tenantId: string; userId: string; connectionType: ConnectionType; googleEmail: string },
): Promise<{ id: string } | null> {
  const email = input.googleEmail.toLowerCase();
  let q = sc(admin).from(TABLE).select('id').eq('tenant_id', input.tenantId).eq('google_email', email);
  // Shared mailboxes are unique per tenant+email; personal ones per tenant+user+email.
  q = input.connectionType === 'shared_mailbox'
    ? q.eq('connection_type', 'shared_mailbox')
    : q.eq('user_id', input.userId).eq('connection_type', 'user');
  const { data } = await q.limit(1).maybeSingle();
  return data ?? null;
}

// ── Lookups ──────────────────────────────────────────────────────────────────

export async function getConnectionById(
  admin: AdminClient,
  tenantId: string,
  id: string,
): Promise<GoogleConnectionRow | null> {
  const { data } = await sc(admin)
    .from(TABLE)
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .limit(1)
    .maybeSingle();
  return (data as GoogleConnectionRow) ?? null;
}

/** The user's own active personal Gmail connection, if any. */
export async function getUserConnection(
  admin: AdminClient,
  tenantId: string,
  userId: string,
): Promise<GoogleConnectionRow | null> {
  const { data } = await sc(admin)
    .from(TABLE)
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .eq('connection_type', 'user')
    .is('revoked_at', null)
    .order('connected_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as GoogleConnectionRow) ?? null;
}

/** Active shared mailboxes for the tenant (purchasing@, orders@, …). */
export async function getSharedMailboxes(
  admin: AdminClient,
  tenantId: string,
): Promise<GoogleConnectionRow[]> {
  const { data } = await sc(admin)
    .from(TABLE)
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('connection_type', 'shared_mailbox')
    .is('revoked_at', null)
    .order('connected_at', { ascending: false })
    .limit(50);
  return (data as GoogleConnectionRow[]) ?? [];
}

/**
 * Pick the connection to send a PO from. A tenant that has set up a shared
 * mailbox usually wants everything sent from it ("don't send from personal
 * email"), so shared mailboxes win; otherwise fall back to the user's own Gmail.
 * Returns null when neither exists (caller falls back to Resend).
 */
export async function resolveSendingConnection(
  admin: AdminClient,
  tenantId: string,
  userId: string,
  opts?: { preferConnectionId?: string },
): Promise<GoogleConnectionRow | null> {
  if (opts?.preferConnectionId) {
    const chosen = await getConnectionById(admin, tenantId, opts.preferConnectionId);
    if (chosen && !chosen.revoked_at) return chosen;
  }
  const shared = await getSharedMailboxes(admin, tenantId);
  if (shared.length > 0) return shared[0];
  return getUserConnection(admin, tenantId, userId);
}

/** All connections visible to a user: their personal one + tenant shared mailboxes. */
export async function listConnectionsForUser(
  admin: AdminClient,
  tenantId: string,
  userId: string,
): Promise<GoogleConnectionPublic[]> {
  const { data } = await sc(admin)
    .from(TABLE)
    .select('*')
    .eq('tenant_id', tenantId)
    .or(`and(user_id.eq.${userId},connection_type.eq.user),connection_type.eq.shared_mailbox`)
    .order('connection_type', { ascending: true })
    .order('connected_at', { ascending: false })
    .limit(50);
  return ((data as GoogleConnectionRow[]) ?? []).map(toPublicConnection);
}

// ── Revocation ───────────────────────────────────────────────────────────────

export async function revokeConnection(
  admin: AdminClient,
  tenantId: string,
  id: string,
  opts: { lastEventId: string; fetchImpl?: FetchLike },
): Promise<GoogleConnectionRow> {
  const conn = await getConnectionById(admin, tenantId, id);
  if (!conn) throw AppError.notFound('Google connection not found.');

  // Best-effort: revoke the refresh token at Google, then drop the Vault secret.
  try {
    const refreshToken = await resolveSecret(admin, conn.refresh_token_secret_ref);
    await revokeGoogleToken(opts.fetchImpl ?? fetch, refreshToken);
  } catch {
    // ignore — we still mark the connection revoked locally
  }
  await deleteSecret(admin, conn.refresh_token_secret_ref);

  const { data, error } = await sc(admin)
    .from(TABLE)
    .update({ revoked_at: new Date().toISOString(), last_event_id: opts.lastEventId })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select()
    .single();
  if (error) throw AppError.internal(`Failed to revoke connection: ${error.message}`);
  return data as GoogleConnectionRow;
}

// ── Access-token minting ─────────────────────────────────────────────────────

// Small in-memory cache so we don't hit Google's token endpoint on every send.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function mintAccessToken(
  admin: AdminClient,
  conn: GoogleConnectionRow,
  fetchImpl: FetchLike,
): Promise<string> {
  const cached = tokenCache.get(conn.id);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token;
  }
  const refreshToken = await resolveSecret(admin, conn.refresh_token_secret_ref);
  let tokens: GoogleTokenResponse;
  try {
    tokens = await refreshGoogleAccessToken(fetchImpl, refreshToken);
  } catch (e: any) {
    throw AppError.badRequest(
      `Google rejected the stored credentials for ${conn.google_email}. Reconnect the account. (${e?.message ?? 'refresh failed'})`,
    );
  }
  tokenCache.set(conn.id, {
    token: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  });
  return tokens.access_token;
}

export interface UserAccessToken {
  accessToken: string;
  connection: GoogleConnectionRow;
}

/**
 * Load the user's (or their tenant's shared) Gmail connection, decrypt the
 * refresh token from Vault, refresh it, and return a valid access token.
 *
 * @throws AppError.notFound when no usable connection exists.
 */
export async function getGoogleAccessTokenForUser(
  tenantId: string,
  userId: string,
  opts?: { fetchImpl?: FetchLike; admin?: AdminClient; preferConnectionId?: string },
): Promise<UserAccessToken> {
  const admin = opts?.admin ?? getAdminClient();
  const fetchImpl = opts?.fetchImpl ?? fetch;

  const conn = await resolveSendingConnection(admin, tenantId, userId, {
    preferConnectionId: opts?.preferConnectionId,
  });
  if (!conn) {
    throw AppError.notFound('No connected Google account for this user or tenant.');
  }
  const accessToken = await mintAccessToken(admin, conn, fetchImpl);
  return { accessToken, connection: conn };
}

/** Mint an access token for a specific known connection row. */
export async function getAccessTokenForConnection(
  admin: AdminClient,
  conn: GoogleConnectionRow,
  fetchImpl: FetchLike,
): Promise<string> {
  return mintAccessToken(admin, conn, fetchImpl);
}
