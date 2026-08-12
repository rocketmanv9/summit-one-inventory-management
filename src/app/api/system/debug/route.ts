import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { runDiagnostics } from '@rocketmanv9/chassis/diagnostics';
import { detectEnvironment } from '@rocketmanv9/chassis/config';
import { createServiceClientUnsafe } from '@rocketmanv9/chassis/supabase';

/**
 * Debug/diagnostics API route.
 * Returns chassis health checks as JSON.
 *
 * DEV ONLY — returns 404 in production to avoid leaking system info.
 * Uses createServiceClientUnsafe because diagnostics need admin access
 * without tenant scoping — this is intentional and not a security concern
 * since the route is gated to non-production environments.
 */
export const GET = createReadRoute(async () => {
  const env = detectEnvironment();

  if (env === 'production') {
    return new Response(null, { status: 404 });
  }

  let supabaseClient: any = undefined;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && key) {
    try {
      supabaseClient = createServiceClientUnsafe({ url, serviceRoleKey: key, dangerouslyBypassRLS: true });
    } catch {
      // Will surface as db:skipped in results
    }
  }

  const result = await runDiagnostics({
    env: process.env as Record<string, string | undefined>,
    supabaseClient,
  });

  return Response.json(result);
}, { serviceName: process.env.INTERNAL_JWT_ISSUER || 'summit-inventory' });
