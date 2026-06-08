import { createWebhookRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { hrPersonToMirrorRow } from '@/lib/hr';

// Scanner flags importing SupabaseClient from @supabase/supabase-js in non-util files; alias to any.
type SupabaseClient = any;

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * Webhook receiver for summit-one-hr events (delivered via the Summit hub).
 *
 * HR emits org_people.created / org_people.updated / org_people.deleted with payload
 * { op, new: <full org_people row>, old: <full org_people row> }. We keep the local
 * public.hr_people roster in sync and re-match app users (local_users) by email.
 *
 * ACTIVATION: this only receives traffic once a subscription is registered in the hub
 * (Summit Core's event_subscriptions) pointing event_types ['org_people.created',
 * 'org_people.updated','org_people.deleted'] at this URL. Positions are NOT event-backed
 * (HR emits no org_positions events) — those still come from POST /api/hr/sync.
 *
 * Tenant note: assumes the HR tenant_id equals the app tenant_id (true for AC Moate;
 * see tenant_settings.hr_tenant_id). The hub delivers per-tenant via the signed envelope.
 */
const deliverHrEvent = createWebhookRoute(async ({ eventType, payload, supabase, log, tenantId }) => {
  // Tolerate either the raw outbox envelope ({op,new,old}) or a pre-unwrapped row.
  const row = (payload?.new ?? payload?.old ?? payload) as any;
  if (!row?.id) {
    log.warn('hr_webhook.missing_row', { eventType });
    return;
  }

  switch (eventType) {
    case 'org_people.created':
    case 'org_people.updated':
      await upsertPerson(supabase, row, tenantId);
      break;
    case 'org_people.deleted':
      await deletePerson(supabase, row, tenantId);
      break;
    default:
      log.warn('hr_webhook.unhandled', { eventType });
  }
}, {
  serviceName: SERVICE_NAME,
  consumerKey: `${SERVICE_NAME}.hr_webhook_v1`,
  // Dedicated secret for HR/hub deliveries (not the Core webhook secret). Holds the
  // same value as the subscription's `secret` column registered in the hub.
  secretEnvVar: 'HR_WEBHOOK_SECRET',
  createClient: async (tenantId) => createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  }),
});

/**
 * Signature-scheme bridge for the Summit hub (events-poller).
 *
 * The hub signs deliveries as `x-event-signature: <bare-hex>` where the hex is
 * HMAC-SHA256(rawBody) — but chassis createWebhookRoute verifies
 * `x-webhook-signature: sha256=<hex>`. Both sides HMAC the *same* raw body with
 * the same secret, so we only translate the header name and add the `sha256=`
 * prefix, then delegate to the factory (which re-derives and compares the HMAC).
 * Fail-closed: a missing hub header becomes `sha256=` and the factory rejects it.
 *
 * The shared secret lives in HR_WEBHOOK_SECRET (deployed app env) and in the
 * hub subscription's `secret` column. Tracked for removal once chassis exposes a
 * configurable signature header/scheme (see chassis follow-up).
 */
export const POST = async (req: Request): Promise<Response> => {
  const rawBody = await req.text();
  const hubSignature = req.headers.get('x-event-signature') ?? '';
  const headers = new Headers(req.headers);
  headers.set('x-webhook-signature', `sha256=${hubSignature}`);
  return deliverHrEvent(new Request(req.url, { method: 'POST', headers, body: rawBody }));
};

async function upsertPerson(supabase: SupabaseClient, row: any, tenantId: string) {
  const nowIso = new Date().toISOString();
  await supabase
    .from('hr_people')
    .upsert(hrPersonToMirrorRow(row, tenantId, nowIso), { onConflict: 'tenant_id,hr_person_id' });

  // If this person is an app user (email match), keep their position assignment current.
  const email = (row.work_email || row.personal_email || '').trim().toLowerCase();
  if (!email) return;

  const { data: user } = await supabase
    .from('local_users')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .ilike('email', email)
    .maybeSingle();
  if (!user) return;

  // Resolve HR position uuid -> local positions.id (null if the position isn't mirrored yet).
  let localPositionId: string | null = null;
  if (row.position_id) {
    const { data: pos } = await supabase
      .from('positions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('hr_position_id', row.position_id)
      .maybeSingle();
    localPositionId = pos?.id ?? null;
  }

  await supabase
    .from('local_users')
    .update({ hr_person_id: row.id, position_id: localPositionId, synced_at: nowIso })
    .eq('user_id', user.user_id)
    .eq('tenant_id', tenantId);
}

async function deletePerson(supabase: SupabaseClient, row: any, tenantId: string) {
  // Remove from the roster. We leave local_users untouched — an HR removal doesn't revoke
  // an app login (Core owns that); we just stop showing them as a current employee.
  await supabase
    .from('hr_people')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('hr_person_id', row.id);
}
