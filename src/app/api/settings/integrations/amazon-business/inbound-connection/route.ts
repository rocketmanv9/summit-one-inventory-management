/**
 * Amazon Business INBOUND connection (Order Confirmation + Ship Notification).
 *
 * Amazon posts cXML ConfirmationRequest / ShipNoticeRequest back to us, gated by
 * HTTP Basic auth that WE define. Each tenant gets a unique username + password
 * stored in Vault; the inbound webhooks resolve the tenant by matching those
 * credentials (see resolveTenantFromConfirmationAuth). This route lets a tenant
 * self-serve: generate/rotate their credentials and read the exact webhook URLs +
 * values to paste into Amazon Business → Connections.
 *
 * GET  — current username + webhook URLs + whether inbound is configured.
 * POST — (re)generate the inbound credentials and return them for display.
 */
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { randomBytes } from 'crypto';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function webhookBase(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SERVICE_BASE_URL;
  if (env) return env.replace(/\/+$/, '');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : '';
}

function urls(req: Request) {
  const base = webhookBase(req);
  return {
    order_confirmation_url: base ? `${base}/api/webhooks/amazon-business/order-confirmation` : '',
    ship_notice_url: base ? `${base}/api/webhooks/amazon-business/ship-notice` : '',
  };
}

async function getProvider(adminClient: any, tenantId: string) {
  const prov = adminClient.schema('provisioning');
  const { data } = await prov
    .from('providers')
    .select('id, config')
    .eq('tenant_id', tenantId)
    .eq('provider_type', 'procurement_marketplace')
    .like('provider_key', 'amazon-business%')
    .limit(1)
    .maybeSingle();
  return data;
}

async function readSecret(adminClient: any, name: string | undefined): Promise<string | null> {
  if (!name) return null;
  const { data } = await adminClient
    .from('decrypted_secrets')
    .select('decrypted_secret')
    .eq('name', name)
    .limit(1)
    .maybeSingle();
  return data?.decrypted_secret ?? null;
}

// ── GET: current inbound credentials + the URLs to paste into Amazon ──────────
export const GET = createSessionReadRoute(
  async ({ req, session }) => {
    const adminClient = getAdminClient();
    const provider = await getProvider(adminClient, session.tenantId!);

    const userRef = provider?.config?.confirmation_auth_user_ref;
    const secretRef = provider?.config?.confirmation_auth_secret_ref;
    const [username, password] = await Promise.all([
      readSecret(adminClient, userRef),
      readSecret(adminClient, secretRef),
    ]);

    return Response.json({
      data: {
        provider_exists: !!provider,
        configured: !!(username && password),
        username: username ?? '',
        // Surfaced so the tenant can copy it into Amazon; it's their own credential.
        password: password ?? '',
        ...urls(req),
      },
    });
  },
  { serviceName: SERVICE_NAME },
);

// ── POST: (re)generate the inbound credentials ────────────────────────────────
export const POST = createSessionWriteRoute(
  async ({ req, ctx, idempotencyKey }) => {
    const adminClient = getAdminClient();
    const tenantId = ctx.tenantId!;
    const provider = await getProvider(adminClient, tenantId);
    if (!provider) {
      throw AppError.badRequest('Connect Amazon Business first, then generate the inbound credentials.');
    }

    // Stable username per tenant (so regenerating only changes the password);
    // the random password is the real security anchor and makes the tenant match
    // unambiguous. base64url avoids ":" which would break HTTP Basic auth.
    const username = (provider.config?.confirmation_auth_user_ref
      ? (await readSecret(adminClient, provider.config.confirmation_auth_user_ref))
      : null) || `summit-${tenantId.replace(/-/g, '').slice(0, 12)}`;
    const password = randomBytes(24).toString('base64url');

    const prov = adminClient.schema('provisioning');
    const userName = `amazon-cxml-confirm-user-${tenantId}-${provider.id}`;
    const secretName = `amazon-cxml-confirm-secret-${tenantId}-${provider.id}`;
    for (const [name, value] of [[userName, username], [secretName, password]] as const) {
      await adminClient.rpc('delete_secret_by_name', { secret_name: name });
      await adminClient.rpc('create_secret', { secret: value, name });
    }

    await prov
      .from('providers')
      .update({
        config: {
          ...(provider.config ?? {}),
          confirmation_auth_user_ref: userName,
          confirmation_auth_secret_ref: secretName,
        },
      })
      .eq('id', provider.id);

    return {
      data: { username, password, ...urls(req) },
      status: 200,
      events: [
        {
          event_name: 'amazon_inbound_credentials.rotated',
          payload: { provider_id: provider.id, tenant_id: tenantId },
          last_event_id: idempotencyKey,
        },
      ],
    };
  },
  {
    bodySchema: 'raw',
    serviceName: SERVICE_NAME,
    scope: 'POST /api/settings/integrations/amazon-business/inbound-connection',
  },
);
