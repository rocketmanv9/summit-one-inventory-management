import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { resolveUserCapabilities } from '@/lib/access-server';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/positions/my-access
 * The current user's effective capability keys, or `null` for full access
 * (admin / no position / unconfigured position). The client uses this to
 * enforce real per-position access (hide buttons/sections).
 *
 * Also returns the caller's own HR position (id + title). Inventory is the one
 * service that already resolves the signed-in user's position server-side
 * (local_users.position_id → positions.title), so the mobile portal shell reuses
 * this route as its shell-wide position source for position-gated quick actions.
 */
export const GET = createSessionReadRoute(async ({ session }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const { data: me } = await supabase
    .from('local_users').select('role, position_id').eq('user_id', session.userId!).eq('tenant_id', session.tenantId!).maybeSingle();

  // Resolve the caller's position title (best-effort) from the positions mirror.
  let positionTitle: string | null = null;
  if (me?.position_id) {
    const { data: pos } = await supabase
      .from('positions').select('title').eq('id', me.position_id).eq('tenant_id', session.tenantId!).maybeSingle();
    positionTitle = pos?.title ?? null;
  }

  const caps = await resolveUserCapabilities(supabase, session.tenantId!, session.userId!, session.isDeveloper);

  // is_admin is authoritative (local_users.role) — the JWT role claim can be
  // weaker, so the client trusts this for showing the "view as" picker + editor.
  return Response.json({
    data: {
      capabilities: caps === null ? null : Array.from(caps),
      is_admin: me?.role === 'admin',
      position_id: me?.position_id ?? null,
      position_title: positionTitle,
    },
  });
}, { serviceName: SERVICE_NAME });
