import { createWebhookRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'my-service';

/**
 * Webhook endpoint for receiving events from Summit Core.
 *
 * createWebhookRoute automatically enforces:
 *   - HMAC signature verification (fail-closed)
 *   - Exactly-once processing via consumerTryBegin
 *   - Tenant-scoped Supabase client via your createClient callback
 *   - Structured logging for observability
 *   - AppError catch → structured error JSON response
 *
 * Register your subscription in Core:
 *   INSERT INTO public.event_subscriptions (name, endpoint_url, event_types, is_active)
 *   VALUES ('My Service', 'https://my-service.example.com/api/webhooks/core-events',
 *           ARRAY['tenant.membership.created', 'profile.updated'], true);
 */
export const POST = createWebhookRoute(async ({ eventType, payload, supabase, log, tenantId }) => {
  switch (eventType) {
    case 'tenant.membership.created':
      await handleMembershipCreated(supabase, payload, tenantId);
      break;
    case 'tenant.membership.updated':
      await handleMembershipUpdated(supabase, payload, tenantId);
      break;
    case 'profile.updated':
      await handleProfileUpdated(supabase, payload, tenantId);
      break;
    default:
      log.warn('webhook.unhandled', { eventType });
  }
}, {
  serviceName: SERVICE_NAME,
  consumerKey: `${SERVICE_NAME}.webhook_v1`,
  createClient: async (tenantId) => createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  }),
});

// ---- Event Handlers (customise these for your service) ----

/**
 * A locally-granted admin must never be downgraded by a Core membership sync —
 * Core isn't the source of truth for this service's admins. If the existing
 * local row is 'admin', keep it regardless of what Core reports.
 */
async function resolveRoleKeepingLocalAdmin(
  supabase: SupabaseClient,
  user_id: string,
  tenantId: string,
  coreRole: string,
): Promise<string> {
  const { data } = await supabase
    .from('local_users')
    .select('role')
    .eq('user_id', user_id)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return data?.role === 'admin' ? 'admin' : coreRole;
}

async function handleMembershipCreated(supabase: SupabaseClient, payload: any, tenantId: string) {
  const { user_id, role, email, name } = payload;
  const finalRole = await resolveRoleKeepingLocalAdmin(supabase, user_id, tenantId, role);
  await supabase.from('local_users').upsert({
    user_id,
    tenant_id: tenantId,
    email,
    name,
    role: finalRole,
    synced_at: new Date().toISOString(),
  });
}

async function handleMembershipUpdated(supabase: SupabaseClient, payload: any, tenantId: string) {
  const { user_id, role } = payload;
  const finalRole = await resolveRoleKeepingLocalAdmin(supabase, user_id, tenantId, role);
  await supabase
    .from('local_users')
    .update({ role: finalRole, synced_at: new Date().toISOString() })
    .eq('user_id', user_id)
    .eq('tenant_id', tenantId);
}

async function handleProfileUpdated(supabase: SupabaseClient, payload: any, tenantId: string) {
  const { user_id, first_name, last_name, email } = payload;
  await supabase
    .from('local_users')
    .update({
      email,
      name: [first_name, last_name].filter(Boolean).join(' '),
      synced_at: new Date().toISOString(),
    })
    .eq('user_id', user_id)
    .eq('tenant_id', tenantId);
}
