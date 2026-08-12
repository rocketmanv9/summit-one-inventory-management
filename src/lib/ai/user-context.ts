/**
 * Who is Isabelle talking to?
 *
 * Resolves the logged-in user's identity from the local mirrors:
 *   - public.local_users  → name, email, app role, spending limit, links
 *   - public.positions    → position title + role level (HR mirror)
 *   - public.hr_people    → preferred/first name (HR mirror)
 *
 * Plain sequential lookups (no PostgREST FK embeds) so this works regardless
 * of FK metadata, cached in-memory per user for 5 minutes so every chat turn
 * doesn't re-hit the DB. Every failure degrades to null — identity is
 * flavor, never a reason to fail a chat request.
 */

export interface AiUserContext {
  name: string | null;
  firstName: string | null;
  email: string | null;
  role: string | null;
  positionTitle: string | null;
  roleLevel: string | null;
  spendingLimit: number | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; ctx: AiUserContext | null }>();

// HR sometimes stores names in ALL CAPS ("GRANT ANDERSON") — normalize so
// Isabelle doesn't shout at people.
function humanizeName(raw: string | null | undefined): string | null {
  const s = (raw || '').trim();
  if (!s) return null;
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export async function getAiUserContext(
  supabase: any,
  userId: string,
  tenantId: string
): Promise<AiUserContext | null> {
  const key = `${tenantId}:${userId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.ctx;

  let ctx: AiUserContext | null = null;
  try {
    const { data: user } = await supabase
      .from('local_users')
      .select('name, email, role, spending_limit, position_id, hr_person_id')
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (user) {
      let positionTitle: string | null = null;
      let roleLevel: string | null = null;
      if (user.position_id) {
        const { data: pos } = await supabase
          .from('positions')
          .select('title, name, role_level')
          .eq('id', user.position_id)
          .maybeSingle();
        positionTitle = pos?.title || pos?.name || null;
        roleLevel = pos?.role_level || null;
      }

      let hrFirst: string | null = null;
      let hrLast: string | null = null;
      if (user.hr_person_id) {
        const { data: hp } = await supabase
          .from('hr_people')
          .select('first_name, preferred_name, last_name')
          .eq('hr_person_id', user.hr_person_id)
          .eq('tenant_id', tenantId)
          .maybeSingle();
        hrFirst = humanizeName(hp?.preferred_name || hp?.first_name);
        hrLast = humanizeName(hp?.last_name);
      }

      const name = humanizeName(user.name) || (hrFirst ? [hrFirst, hrLast].filter(Boolean).join(' ') : null);
      const firstName = hrFirst || (name ? name.split(' ')[0] : null);

      ctx = {
        name,
        firstName,
        email: user.email || null,
        role: user.role || null,
        positionTitle,
        roleLevel,
        spendingLimit: user.spending_limit != null ? Number(user.spending_limit) : null,
      };
    }
  } catch {
    ctx = null;
  }

  cache.set(key, { at: Date.now(), ctx });
  return ctx;
}

/** Render the identity block that goes into the system prompt. */
export function formatUserContextForPrompt(ctx: AiUserContext | null): string {
  if (!ctx || (!ctx.name && !ctx.email)) return '';
  const lines: string[] = ['', 'WHO YOU ARE TALKING TO:'];
  if (ctx.name) {
    lines.push(`- Name: ${ctx.name}${ctx.firstName && ctx.firstName !== ctx.name ? ` (goes by ${ctx.firstName})` : ''}`);
  }
  if (ctx.positionTitle) {
    lines.push(`- Position: ${ctx.positionTitle}${ctx.roleLevel ? ` (${ctx.roleLevel} level)` : ''}`);
  }
  if (ctx.role) lines.push(`- App role: ${ctx.role}`);
  if (ctx.email) lines.push(`- Email: ${ctx.email}`);
  if (ctx.spendingLimit != null) lines.push(`- PO spending limit: $${ctx.spendingLimit.toLocaleString()}`);
  lines.push(
    `Use their first name naturally like a colleague would — occasionally, not every message. ` +
    `Tailor answers to their position (a manager gets the big picture first; a field/ops person gets the practical next step). ` +
    `Never ask who they are and never call them "user" — you already know them.`
  );
  return lines.join('\n');
}
