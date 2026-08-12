/**
 * Google OAuth 2.0 — low-level helpers (no SDK; raw traced fetch).
 *
 * Implements the authorization-code flow for Gmail with offline access so we
 * receive a refresh token we can use to mint short-lived access tokens later.
 *
 * Scopes requested:
 *   openid, email, profile                       — identify the connected account
 *   gmail.send                                   — send POs on the user's behalf
 *   gmail.readonly                               — read vendor replies
 *
 * State is a short-lived signed JWT (HS256) carrying tenant_id, user_id, a
 * nonce and a timestamp, so the callback can trust who initiated the flow
 * without server-side session storage.
 */
import { SignJWT, jwtVerify } from 'jose';
import { AppError } from '@rocketmanv9/chassis/errors';
import { requireOk } from '@rocketmanv9/chassis/observability';

type FetchLike = typeof fetch;

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
] as const;

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

const STATE_TTL_SECONDS = 600; // 10 minutes

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Reads + validates Google OAuth env config. Throws a clear error if missing. */
export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw AppError.badRequest(
      'Google integration is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
    );
  }
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SERVICE_BASE_URL || '';
  const redirectUri =
    process.env.GOOGLE_OAUTH_REDIRECT_URI || `${base.replace(/\/$/, '')}/api/integrations/google/callback`;
  if (!redirectUri || redirectUri.startsWith('/api')) {
    throw AppError.badRequest(
      'Google OAuth redirect URI is not configured. Set GOOGLE_OAUTH_REDIRECT_URI or NEXT_PUBLIC_APP_URL.',
    );
  }
  return { clientId, clientSecret, redirectUri };
}

/** Whether the Google integration has the minimum env config to run. */
export function isGoogleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// ── Signed state ────────────────────────────────────────────────────────────

export interface OAuthStatePayload {
  tenant_id: string;
  user_id: string;
  nonce: string;
  connection_type: 'user' | 'shared_mailbox';
  display_name?: string;
}

function stateSecret(): Uint8Array {
  const secret = process.env.GOOGLE_OAUTH_STATE_SECRET || process.env.INTERNAL_JWT_SECRET;
  if (!secret) throw AppError.internal('No signing secret available for OAuth state.');
  return new TextEncoder().encode(secret);
}

export async function signOAuthState(payload: OAuthStatePayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${STATE_TTL_SECONDS}s`)
    .sign(stateSecret());
}

export async function verifyOAuthState(token: string): Promise<OAuthStatePayload> {
  try {
    const { payload } = await jwtVerify(token, stateSecret());
    if (!payload.tenant_id || !payload.user_id) {
      throw AppError.badRequest('Invalid OAuth state: missing claims.');
    }
    return {
      tenant_id: String(payload.tenant_id),
      user_id: String(payload.user_id),
      nonce: String(payload.nonce ?? ''),
      connection_type: (payload.connection_type as 'user' | 'shared_mailbox') ?? 'user',
      display_name: payload.display_name ? String(payload.display_name) : undefined,
    };
  } catch {
    throw AppError.badRequest('Invalid or expired OAuth state.');
  }
}

// ── Authorization URL ────────────────────────────────────────────────────────

export function buildGoogleAuthUrl(opts: { state: string; loginHint?: string }): string {
  const { clientId, redirectUri } = getGoogleOAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: opts.state,
  });
  if (opts.loginHint) params.set('login_hint', opts.loginHint);
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// ── Token exchange / refresh ─────────────────────────────────────────────────

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
  token_type?: string;
}

export async function exchangeCodeForTokens(
  fetchImpl: FetchLike,
  code: string,
): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  await requireOk(res, 'Google token exchange');
  return (await res.json()) as GoogleTokenResponse;
}

export async function refreshGoogleAccessToken(
  fetchImpl: FetchLike,
  refreshToken: string,
): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = getGoogleOAuthConfig();
  const res = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }).toString(),
  });
  await requireOk(res, 'Google token refresh');
  return (await res.json()) as GoogleTokenResponse;
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export async function getGoogleUserInfo(
  fetchImpl: FetchLike,
  accessToken: string,
): Promise<GoogleUserInfo> {
  const res = await fetchImpl(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await requireOk(res, 'Google userinfo');
  return (await res.json()) as GoogleUserInfo;
}

/** Best-effort revocation of a token at Google (does not throw on failure). */
export async function revokeGoogleToken(fetchImpl: FetchLike, token: string): Promise<void> {
  try {
    await fetchImpl(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    // Revocation is best-effort; the connection is marked revoked regardless.
  }
}
