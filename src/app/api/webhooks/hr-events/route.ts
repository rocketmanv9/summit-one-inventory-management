import { createWebhookRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { hrPersonToMirrorRow } from '@/lib/hr';
import { provisionHire } from '@/lib/position-kits';

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
export const POST = createWebhookRoute(async ({ eventType, payload, supabase, log, tenantId }) => {
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
      // Position kits (sprint 2026-08-14 item 04): the REALTIME half of new-hire
      // provisioning. On stage this webhook is the only realtime path — Vercel
      // crons don't fire on preview builds, so runHRSync (GH Action
      // stage-hr-sync.yml) is the nightly catch-up, not the trigger. Runs after
      // the mirror upsert so the engine reads the person it was just told about.
      // Fire-and-log: a kit failure must never make the hub retry the mirror.
      await provisionIfNew(supabase, row, tenantId, log);
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
  // The Summit hub's events-poller signs as `x-event-signature: <bare-hex>`
  // (HMAC-SHA256 of the raw body), unlike Core's `x-webhook-signature: sha256=<hex>`.
  // (chassis >=2.1.0 verifies this scheme natively.)
  signatureHeader: 'x-event-signature',
  signatureEncoding: 'hex',
  createClient: async (tenantId) => createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  }),
});

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

/**
 * Kit the person this event is about — if they're genuinely new.
 *
 * "If" is entirely the engine's call: supply_chain.position_kit_provisions
 * already holds a row for every human who existed when the feature shipped
 * (backfill) and for every hire already handled, so a replayed webhook or an
 * unrelated org_people.updated lands as a `noop`. That's why this is safe to
 * call on `updated` as well as `created` — a person whose position/location is
 * filled in a minute after creation still gets kitted.
 */
async function provisionIfNew(supabase: SupabaseClient, row: any, tenantId: string, log: any) {
  try {
    const outcome = await provisionHire(supabase, {
      tenantId,
      hrPersonId: row.id,
      source: 'webhook',
      log,
    });
    if (outcome.status !== 'noop') {
      log.info('hr_webhook.kit_provision', {
        hr_person_id: row.id,
        status: outcome.status,
        kit_id: outcome.kit_id,
        reservations: outcome.reservation_ids.length,
        purchase_orders: outcome.purchase_order_ids.length,
      });
    }
  } catch (err: any) {
    // Never fail the mirror over a kit — the nightly sync-diff pass will retry.
    log.warn('hr_webhook.kit_provision_failed', { hr_person_id: row.id, error: err?.message });
  }
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
