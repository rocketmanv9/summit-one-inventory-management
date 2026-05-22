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

  // ── App-initiated flow (Amazon Business OAuth) ──────────────────────
  if (!provider.config?.application_id) {
    throw AppError.badRequest(
      'Application ID is required for Amazon Business authorization. Update your credentials with an Application ID.'
    );
  }

  const authUrl = new URL('https://www.amazon.com/b2b/abws/oauth');
  authUrl.searchParams.set('applicationId', provider.config.application_id);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: { Location: authUrl.toString() },
  });
}, { serviceName: SERVICE_NAME });
