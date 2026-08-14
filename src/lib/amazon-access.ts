/**
 * Amazon purchaser access — "who is allowed to punch out?" (item 06, sprint
 * 2026-08-14).
 *
 * Backed by supply_chain.amazon_purchaser_accounts. One rule, stated plainly:
 *
 *   • Registry EMPTY for the tenant  → DORMANT. Everyone is allowed, exactly as
 *     they were before this file existed. Nobody gets locked out of a feature
 *     because an admin hasn't filled in a new settings page yet.
 *   • Registry NON-EMPTY             → it is the list. You need an active row
 *     with can_punch_out = true. Admins included — the whole point is that the
 *     list is the answer to "who has an Amazon seat", and an admin without a
 *     seat genuinely can't punch out.
 *
 * Denials are SOFT: a friendly, renderable payload ("ask an admin to add you as
 * an Amazon purchaser"), never a bare 403 the UI has to guess at.
 *
 * cXML punchout only. The SP-API dev account lapsed on purpose (2026-08) —
 * nothing here talks to a signed Amazon API.
 *
 * SERVER-ONLY — takes the route's tenant-scoped/admin supabase client.
 */

import { AppError } from '@rocketmanv9/chassis/errors';

export interface AmazonPurchaserAccount {
  id: string;
  user_id: string;
  amazon_email: string | null;
  account_type: 'business' | 'personal';
  can_punch_out: boolean;
  active: boolean;
  notes: string | null;
}

export interface PunchOutAccessDecision {
  /** May this user start a punchout session? */
  allowed: boolean;
  /**
   * True when the tenant has no registry rows at all. Allowed is also true in
   * this case — the feature is dormant until an admin configures it.
   */
  dormant: boolean;
  /** Machine-readable denial cause, null when allowed. */
  reason: 'not_registered' | 'punchout_disabled' | 'account_inactive' | null;
  /** Always safe to show a user verbatim. */
  message: string;
  /** The caller's registry row when they have one. */
  account: AmazonPurchaserAccount | null;
}

const ALLOWED_DORMANT =
  'Amazon purchasing is open to everyone — no purchaser registry has been configured yet.';
const ALLOWED_REGISTERED = 'Registered Amazon purchaser.';

const DENY_NOT_REGISTERED =
  "You're not set up as an Amazon purchaser. Ask an admin to add you in Settings → Integrations → Amazon.";
const DENY_PUNCHOUT_OFF =
  'Your Amazon account is on file but punchout is switched off for you. Ask an admin to enable it in Settings → Integrations → Amazon.';
const DENY_INACTIVE =
  'Your Amazon purchaser access has been deactivated. Ask an admin to reactivate it in Settings → Integrations → Amazon.';

/** Rows are read through the supply_chain schema on whatever client is passed in. */
function purchasers(supabase: any) {
  return (supabase as any).schema('supply_chain').from('amazon_purchaser_accounts');
}

/**
 * The tenant's full registry (both active and inactive), newest-updated first.
 * Used by the settings hub; the gate uses the narrower query below.
 */
export async function listPurchaserAccounts(
  supabase: any,
  tenantId: string,
): Promise<AmazonPurchaserAccount[]> {
  const { data } = await purchasers(supabase)
    .select('id, user_id, amazon_email, account_type, can_punch_out, active, notes, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .limit(500);
  return (data ?? []) as AmazonPurchaserAccount[];
}

/**
 * Decide whether `userId` may start an Amazon punchout session.
 *
 * Two queries, both tiny: "does this tenant have any registry rows at all"
 * (the dormancy check) and "does this user have one". The dormancy check has to
 * be independent of the user lookup — otherwise a tenant with a registry and a
 * caller who isn't in it would look identical to a tenant with no registry.
 */
export async function canUserPunchOut(
  supabase: any,
  tenantId: string,
  userId: string | null | undefined,
): Promise<PunchOutAccessDecision> {
  const { count } = await purchasers(supabase)
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  const registrySize = count ?? 0;

  // Dormant: nothing configured, so behave exactly as before.
  if (registrySize === 0) {
    return { allowed: true, dormant: true, reason: null, message: ALLOWED_DORMANT, account: null };
  }

  // Registry exists but we have no user to check (service-to-service / token
  // sessions without a user id). Don't invent a denial we can't justify — the
  // registry gates PEOPLE, and there's no person here.
  if (!userId) {
    return { allowed: true, dormant: false, reason: null, message: ALLOWED_REGISTERED, account: null };
  }

  const { data: row } = await purchasers(supabase)
    .select('id, user_id, amazon_email, account_type, can_punch_out, active, notes')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!row) {
    return { allowed: false, dormant: false, reason: 'not_registered', message: DENY_NOT_REGISTERED, account: null };
  }

  const account = row as AmazonPurchaserAccount;

  if (!account.active) {
    return { allowed: false, dormant: false, reason: 'account_inactive', message: DENY_INACTIVE, account };
  }
  if (!account.can_punch_out) {
    return { allowed: false, dormant: false, reason: 'punchout_disabled', message: DENY_PUNCHOUT_OFF, account };
  }

  return { allowed: true, dormant: false, reason: null, message: ALLOWED_REGISTERED, account };
}

/** Error code the UI keys off to render the "ask an admin" panel. */
export const AMAZON_PURCHASER_REQUIRED = 'amazon_purchaser_required';

/**
 * Route-side gate: returns the decision when allowed, throws a 403 AppError
 * when not. The thrown error carries `code = 'amazon_purchaser_required'` and
 * a `reason` detail, so the UI renders the friendly copy verbatim instead of
 * sniffing status codes.
 */
export async function assertCanPunchOut(
  supabase: any,
  tenantId: string,
  userId: string | null | undefined,
): Promise<PunchOutAccessDecision> {
  const decision = await canUserPunchOut(supabase, tenantId, userId);
  if (decision.allowed) return decision;

  throw new AppError(decision.message, AMAZON_PURCHASER_REQUIRED, 403, {
    reason: decision.reason,
    allowed: false,
  });
}
