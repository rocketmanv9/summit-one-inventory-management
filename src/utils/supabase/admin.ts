import { createServiceClientUnsafe } from '@rocketmanv9/chassis/supabase';

/**
 * Service-role client WITHOUT RLS scoping.
 * Only use for cross-tenant admin operations, migrations, or system tasks.
 * For tenant-scoped work, use createTenantServiceClient() instead.
 */
export function getAdminClient() {
  return createServiceClientUnsafe({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    dangerouslyBypassRLS: true,
  });
}
