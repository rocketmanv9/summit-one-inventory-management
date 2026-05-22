/**
 * Amazon Business OAuth — Login URI
 *
 * GET — Initiates the OAuth authorization flow by redirecting to Amazon.
 * This is also the OAuth Login URI registered in the Solution Provider Portal.
 *
 * Flow:
 *   1. Tenant saves client_id + client_secret via POST /api/settings/integrations/amazon-business
 *   2. Tenant clicks "Authorize with Amazon" → browser navigates here
 *   3. This route redirects to Amazon's consent page
 *   4. Amazon redirects back to /api/settings/integrations/amazon-business/callback
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { cookies, headers } from 'next/headers';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ session, req }) => {
  const adminClient = getAdminClient();
  const prov = (adminClient as any).schema('provisioning');
  const url = new URL(req.url);

  // Check if this is Amazon-initiated (Marketplace Appstore sends these params)
  const amazonCallbackUri = url.searchParams.get('amazon_callback_uri');
  const amazonState = url.searchParams.get('amazon_state');

  // Find the tenant's Amazon Business provider
  const { data: provider } = await prov
    .from('providers')
    .select('id, config')
    .eq('tenant_id', session.tenantId!)
    .eq('provider_type', 'procurement_marketplace')
    .like('provider_key', 'amazon-business%')
    .limit(1)
    .maybeSingle();

  if (!provider?.config?.client_id_ref) {
    throw AppError.badRequest(
      'Save your Client ID and Client Secret first, then authorize with Amazon.'
    );
  }

  // Generate CSRF state and store in cookie
  const state = crypto.randomUUID();
  const cookieStore = await cookies();
  cookieStore.set('amazon_oauth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  });

  // Determine callback URL from request
  const h = await headers();
  const host = h.get('host')!;
  const proto = h.get('x-forwarded-proto') || 'https';
  const redirectUri = `${proto}://${host}/api/settings/integrations/amazon-business/callback`;

  // ── Amazon-initiated flow (Marketplace Appstore) ──────────────────────
  if (amazonCallbackUri) {
    const authUrl = new URL(amazonCallbackUri);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    if (amazonState) authUrl.searchParams.set('amazon_state', amazonState);
    authUrl.searchParams.set('state', state);
    return new Response(null, {
      status: 302,
      headers: { Location: authUrl.toString() },
    });
  }

  // ── App-initiated flow ────────────────────────────────────────────────
  const applicationId = provider.config?.application_id;

  if (applicationId) {
    // SP-API consent page (preferred when application_id is available)
    const authUrl = new URL(
      'https://sellercentral.amazon.com/apps/authorize/consent'
    );
    authUrl.searchParams.set('application_id', applicationId);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('version', 'beta');
    return new Response(null, {
      status: 302,
      headers: { Location: authUrl.toString() },
    });
  }

  // Fallback to LWA authorization
  const { data: secretData } = await adminClient
    .from('decrypted_secrets')
    .select('decrypted_secret')
    .eq('name', provider.config.client_id_ref)
    .limit(1)
    .single();

  if (!secretData?.decrypted_secret) {
    throw AppError.internal('Client ID not found in vault');
  }

  const authUrl = new URL('https://www.amazon.com/ap/oa');
  authUrl.searchParams.set('client_id', secretData.decrypted_secret);
  authUrl.searchParams.set('scope', 'profile');
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: { Location: authUrl.toString() },
  });
}, { serviceName: SERVICE_NAME });
