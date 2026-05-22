/**
 * Amazon Business OAuth — Redirect URI (Callback)
 *
 * GET — Receives the authorization code from Amazon after the tenant
 *       consents, exchanges it for a refresh token via LWA, stores the
 *       token in Vault, marks the provider as active, and redirects
 *       back to the integrations settings page.
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { getAdminClient } from '@/utils/supabase/admin';
import { cookies, headers } from 'next/headers';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';
const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

/** Build a redirect Response to the integrations settings page. */
function settingsRedirect(
  baseUrl: string,
  params: Record<string, string>
): Response {
  const url = new URL('/settings/integrations', baseUrl);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString() },
  });
}

export const GET = createSessionReadRoute(async ({ session, req }) => {
  const url = new URL(req.url);
  const h = await headers();
  const host = h.get('host')!;
  const proto = h.get('x-forwarded-proto') || 'https';
  const baseUrl = `${proto}://${host}`;

  // ── Parse Amazon response ─────────────────────────────────────────────
  const code =
    url.searchParams.get('spapi_oauth_code') || url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    return settingsRedirect(baseUrl, {
      amazon_error: url.searchParams.get('error_description') || errorParam,
    });
  }

  // ── Verify CSRF state ─────────────────────────────────────────────────
  const cookieStore = await cookies();
  const storedState = cookieStore.get('amazon_oauth_state')?.value;
  cookieStore.delete('amazon_oauth_state');

  if (!state || state !== storedState) {
    return settingsRedirect(baseUrl, {
      amazon_error: 'Invalid state parameter. Please try authorizing again.',
    });
  }

  if (!code) {
    return settingsRedirect(baseUrl, {
      amazon_error: 'No authorization code received from Amazon.',
    });
  }

  // ── Look up tenant provider & secrets ─────────────────────────────────
  const adminClient = getAdminClient();
  const prov = (adminClient as any).schema('provisioning');

  const { data: provider } = await prov
    .from('providers')
    .select('id, config')
    .eq('tenant_id', session.tenantId!)
    .eq('provider_type', 'procurement_marketplace')
    .like('provider_key', 'amazon-business%')
    .limit(1)
    .maybeSingle();

  if (
    !provider?.config?.client_id_ref ||
    !provider?.config?.client_secret_ref
  ) {
    return settingsRedirect(baseUrl, {
      amazon_error:
        'No saved credentials found. Save your Client ID and Secret first.',
    });
  }

  const resolveSecret = async (ref: string): Promise<string> => {
    const { data } = await adminClient
      .from('decrypted_secrets')
      .select('decrypted_secret')
      .eq('name', ref)
      .limit(1)
      .single();
    return data?.decrypted_secret || '';
  };

  const [clientId, clientSecret] = await Promise.all([
    resolveSecret(provider.config.client_id_ref),
    resolveSecret(provider.config.client_secret_ref),
  ]);

  if (!clientId || !clientSecret) {
    return settingsRedirect(baseUrl, {
      amazon_error: 'Could not resolve stored credentials from vault.',
    });
  }

  // ── Exchange authorization code for tokens ────────────────────────────
  const redirectUri = `${baseUrl}/api/settings/integrations/amazon-business/callback`;

  try {
    const tokenRes = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenRes.ok) {
      const errorBody = await tokenRes.text().catch(() => 'unknown');
      console.error(
        'Amazon LWA token exchange failed:',
        tokenRes.status,
        errorBody
      );
      return settingsRedirect(baseUrl, {
        amazon_error: `Token exchange failed (${tokenRes.status}). Please try again.`,
      });
    }

    const tokenData = await tokenRes.json();
    const refreshToken = tokenData.refresh_token;

    if (!refreshToken) {
      return settingsRedirect(baseUrl, {
        amazon_error: 'No refresh token received from Amazon.',
      });
    }

    // ── Store refresh token in Vault ──────────────────────────────────
    const secretName = `amazon-biz-refresh-token-${session.tenantId}-${provider.id}`;
    await adminClient.rpc('delete_secret_by_name', { secret_name: secretName });
    await adminClient.rpc('create_secret', {
      secret: refreshToken,
      name: secretName,
    });

    // ── Activate provider ─────────────────────────────────────────────
    await prov
      .from('providers')
      .update({
        config: { ...provider.config, refresh_token_ref: secretName },
        is_active: true,
      })
      .eq('id', provider.id);

    return settingsRedirect(baseUrl, {
      amazon_success: 'Successfully authorized with Amazon Business.',
    });
  } catch (err) {
    console.error('Amazon OAuth callback error:', err);
    return settingsRedirect(baseUrl, {
      amazon_error: 'An unexpected error occurred during authorization.',
    });
  }
}, { serviceName: SERVICE_NAME });
