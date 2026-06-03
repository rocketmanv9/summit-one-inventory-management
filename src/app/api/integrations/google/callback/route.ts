/**
 * GET /api/integrations/google/callback
 *
 * Google redirects the browser here after consent. We:
 *   1. verify the signed state and cross-check it against the live session
 *   2. exchange the auth code for tokens (must include a refresh_token)
 *   3. look up the connected account's email/sub
 *   4. store the refresh token in Vault and upsert the connection row
 *   5. redirect back to Settings → Integrations with a status flag
 *
 * Errors are surfaced as query params on the redirect rather than raw 500s so
 * the user always lands back on the integrations page.
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { getAdminClient } from '@/utils/supabase/admin';
import {
  verifyOAuthState,
  exchangeCodeForTokens,
  getGoogleUserInfo,
  GOOGLE_SCOPES,
} from '@/lib/integrations/google-oauth';
import { upsertGoogleConnection } from '@/lib/integrations/google-connections';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(
  async ({ req, session, fetch, log }) => {
    const url = new URL(req.url);
    const base = (process.env.NEXT_PUBLIC_APP_URL || url.origin).replace(/\/$/, '');
    const settings = `${base}/settings/integrations?tab=gmail`;
    const fail = (reason: string) =>
      Response.redirect(`${settings}&gmail_error=${encodeURIComponent(reason)}`, 302);

    const oauthError = url.searchParams.get('error');
    if (oauthError) return fail(oauthError);

    const code = url.searchParams.get('code');
    const stateRaw = url.searchParams.get('state');
    if (!code || !stateRaw) return fail('missing_code_or_state');

    try {
      const state = await verifyOAuthState(stateRaw);

      // Defense in depth: the signed state must match the logged-in session.
      if (state.tenant_id !== session.tenantId || state.user_id !== session.userId) {
        log.warn('google_oauth.session_mismatch', { stateTenant: state.tenant_id });
        return fail('session_mismatch');
      }

      const tokens = await exchangeCodeForTokens(fetch, code);
      if (!tokens.refresh_token) {
        // Happens when the user previously granted access without revoking.
        // prompt=consent should force a new refresh token; if it's still
        // missing, ask them to remove the app's access and retry.
        return fail('no_refresh_token');
      }

      const userInfo = await getGoogleUserInfo(fetch, tokens.access_token);
      if (!userInfo.email) return fail('no_email');

      const scopes = tokens.scope ? tokens.scope.split(' ') : [...GOOGLE_SCOPES];
      const displayName =
        state.display_name ||
        (state.connection_type === 'shared_mailbox' ? userInfo.email.split('@')[0] : userInfo.name || null);

      await upsertGoogleConnection(getAdminClient(), {
        tenantId: state.tenant_id,
        userId: state.user_id,
        connectionType: state.connection_type,
        googleEmail: userInfo.email,
        googleSub: userInfo.sub,
        displayName,
        refreshToken: tokens.refresh_token,
        scopes,
        lastEventId: crypto.randomUUID(),
      });

      log.info('google_oauth.connected', {
        email: userInfo.email,
        connectionType: state.connection_type,
      });

      return Response.redirect(
        `${settings}&gmail=connected&email=${encodeURIComponent(userInfo.email)}`,
        302,
      );
    } catch (e: any) {
      log.error('google_oauth.callback_failed', { error: e?.message });
      return fail('connection_failed');
    }
  },
  { serviceName: SERVICE_NAME },
);
