// Position resolution for external purchase links (item 04).
//
// The consumer endpoint (/api/inventory/external-purchase-links/mine) gates
// links by HR POSITION TITLE, server-side. Position source of truth is HR;
// positions.title carries the shared vocabulary the mobile identity pattern
// (position_title) also uses, so allowed_positions stores title strings.
//
// We resolve the caller's title by matching their app-user email against the HR
// mirror (hr_people.work_email / personal_email) → hr_position_id → positions.title.
// Admins (local_users.role = 'admin') see all links and get isAdmin = true.
//
// SERVER-ONLY — pass in the route's tenant-scoped supabase service client.

export interface CallerPurchaseIdentity {
  /** Admins see every active link regardless of allowed_positions. */
  isAdmin: boolean;
  /** The caller's HR position title, or null if not on the roster / no position. */
  positionTitle: string | null;
  /**
   * The caller's HR roster id (hr_people.hr_person_id), or null if their email
   * isn't on the mirror. Used by buyable-group external_link items to resolve
   * per-person URLs (snap-and-buy item 02).
   */
  hrPersonId: string | null;
}

/**
 * Resolve the caller's admin flag and HR position title for link gating.
 */
export async function resolveCallerPurchaseIdentity(
  supabase: any,
  tenantId: string,
  userId: string,
): Promise<CallerPurchaseIdentity> {
  const { data: me } = await supabase
    .from('local_users')
    .select('role, email')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle();

  const isAdmin = me?.role === 'admin';
  const email = (me?.email || '').trim().toLowerCase();
  if (!email) return { isAdmin, positionTitle: null, hrPersonId: null };

  // Match the app-user email against the HR mirror to find their position.
  const { data: person } = await supabase
    .from('hr_people')
    .select('hr_person_id, hr_position_id, work_email, personal_email')
    .eq('tenant_id', tenantId)
    .or(`work_email.ilike.${email},personal_email.ilike.${email}`)
    .limit(1)
    .maybeSingle();

  const hrPersonId = person?.hr_person_id ?? null;
  if (!person?.hr_position_id) return { isAdmin, positionTitle: null, hrPersonId };

  const { data: pos } = await supabase
    .from('positions')
    .select('title')
    .eq('tenant_id', tenantId)
    .eq('hr_position_id', person.hr_position_id)
    .maybeSingle();

  return { isAdmin, positionTitle: pos?.title ?? null, hrPersonId };
}
