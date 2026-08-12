import type { SessionUserInfo } from '@rocketmanv9/chassis/auth';
import { getAdminClient } from '@/utils/supabase/admin';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Self-healing local_users provisioning, run at every login/refresh.
 *
 * Background:
 *   local_users is normally created by the Summit Core `tenant.membership.created`
 *   webhook (src/app/api/webhooks/core-events/route.ts). When members are added to
 *   the tenant manually in Core, that event never fires, so the member can SSO into
 *   inventory but has no local_users row — which means the People & Limits page can't
 *   see them and per-user spending caps / budgets can't be applied to them.
 *
 *   The authoritative Core `user_id` is only ever known at ticket-exchange/refresh
 *   time (there is no Core members-list API available to this service), so the only
 *   robust backfill is to upsert the row the moment the authenticated identity passes
 *   through a login path. This is service-role only and therefore does NOT reopen the
 *   self-privilege-escalation hole that 20260529000001 closed (that was about *browser*
 *   writes via the authenticated RLS policy).
 *
 * Idempotency & safety:
 *   - Inserts a row only when one doesn't already exist (PK is user_id).
 *   - On an existing row it NEVER overwrites role / spending_limit / budget_* /
 *     position_id / hr_person_id — those are managed by admins and the HR sync.
 *     It only refreshes a changed email/name. A locally-granted admin is preserved.
 *   - Tolerates a missing table / any DB error: provisioning is best-effort and must
 *     never block authentication.
 *
 * Returns the (possibly role-enriched) user — a local 'admin' assignment overrides the
 * Core-provided role, matching the prior enrichRoleFromLocalUsers behavior.
 */
export async function provisionAndEnrichLocalUser(user: SessionUserInfo): Promise<SessionUserInfo> {
  // Skip non-real identities: no tenant, or the all-zeros "Pending Sync" placeholder.
  if (!user.tenantId || user.userId === ZERO_UUID || user.tenantId === ZERO_UUID) {
    return user;
  }

  try {
    const admin = getAdminClient();

    const { data: existing } = await admin
      .from('local_users')
      .select('role, email, name')
      .eq('user_id', user.userId)
      .eq('tenant_id', user.tenantId)
      .maybeSingle();

    if (!existing) {
      // Brand-new member (e.g. manually added in Core, no webhook fired). Insert with
      // the Core-provided role. onConflict guards against a race with the webhook.
      const email = user.email?.trim() || null;
      await admin
        .from('local_users')
        .upsert(
          {
            user_id: user.userId,
            tenant_id: user.tenantId,
            email,
            name: user.name || null,
            role: user.role || 'member',
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'user_id', ignoreDuplicates: true },
        );
      return user;
    }

    // Row exists — keep admin-managed columns untouched. Refresh identity fields only
    // when Core reports a changed, non-empty value (avoids a write on every refresh).
    const email = user.email?.trim() || null;
    const patch: Record<string, unknown> = {};
    if (email && email !== existing.email) patch.email = email;
    if (user.name && user.name !== existing.name) patch.name = user.name;
    if (Object.keys(patch).length > 0) {
      patch.synced_at = new Date().toISOString();
      await admin
        .from('local_users')
        .update(patch)
        .eq('user_id', user.userId)
        .eq('tenant_id', user.tenantId);
    }

    // A local admin grant overrides the Core role for this session.
    if (existing.role === 'admin') return { ...user, role: 'admin' };
    return user;
  } catch {
    // local_users may not exist yet, or a transient DB error — never block login.
    return user;
  }
}
