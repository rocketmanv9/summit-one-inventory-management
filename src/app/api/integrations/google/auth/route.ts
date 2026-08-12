/**
 * GET /api/integrations/google/auth
 *
 * Starts the Gmail OAuth flow. Builds a Google authorization URL with a signed
 * state (tenant_id, user_id, nonce, timestamp) and returns it. The frontend
 * navigates the browser to that URL; Google redirects back to the callback.
 *
 * Query params:
 *   connection_type = 'user' | 'shared_mailbox'   (default 'user')
 *   display_name    = label for a shared mailbox   (optional)
 *   login_hint      = pre-fill the Google account picker (optional)
 *   redirect=1      = 302 to Google instead of returning JSON
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import {
  buildGoogleAuthUrl,
  signOAuthState,
  getGoogleOAuthConfig,
} from '@/lib/integrations/google-oauth';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(
  async ({ req, session, log }) => {
    getGoogleOAuthConfig(); // throws AppError.badRequest if env not configured

    const url = new URL(req.url);
    const connectionType =
      url.searchParams.get('connection_type') === 'shared_mailbox' ? 'shared_mailbox' : 'user';
    const displayName = url.searchParams.get('display_name')?.trim() || undefined;
    const loginHint = url.searchParams.get('login_hint')?.trim() || undefined;

    const state = await signOAuthState({
      tenant_id: session.tenantId,
      user_id: session.userId,
      nonce: crypto.randomUUID(),
      connection_type: connectionType,
      display_name: displayName,
    });

    const authUrl = buildGoogleAuthUrl({ state, loginHint });
    log.info('google_oauth.started', { connectionType });

    if (url.searchParams.get('redirect') === '1') {
      return Response.redirect(authUrl, 302);
    }
    return Response.json({ data: { url: authUrl } });
  },
  { serviceName: SERVICE_NAME },
);
