import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { resolveUserCapabilities } from '@/lib/access-server';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/positions/my-access
 * The current user's effective capability keys, or `null` for full access
 * (admin / no position / unconfigured position). The client uses this to
 * enforce real per-position access (hide buttons/sections).
 */
export const GET = createSessionReadRoute(async ({ session }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const caps = await resolveUserCapabilities(supabase, session.tenantId!, session.userId!, session.isDeveloper);

  return Response.json({ data: { capabilities: caps === null ? null : Array.from(caps) } });
}, { serviceName: SERVICE_NAME });
