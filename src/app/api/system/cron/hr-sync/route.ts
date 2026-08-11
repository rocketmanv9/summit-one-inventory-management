/**
 * GET /api/system/cron/hr-sync
 *
 * Daily HR mirror sync + healing for every tenant (see vercel.json crons).
 * Runs the exact sync the admin button runs (src/lib/hr-sync.ts): mirrors
 * positions + people and deactivates mirror rows whose HR source id is gone,
 * so the position-title buying gates (purchase links / buyable groups) can't
 * silently break when HR reseeds or dedupes.
 *
 * Triggered by Vercel Cron, CRON_SECRET gated (mirrors the other cron routes).
 */
import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { isHRConfigured } from '@/lib/hr';
import { runHRSync } from '@/lib/hr-sync';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const maxDuration = 60;

export const GET = createReadRoute(
  async ({ req, log }) => {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization') || '';
    if (!secret || auth !== `Bearer ${secret}`) {
      throw AppError.unauthorized('Invalid or missing cron secret.');
    }

    if (!isHRConfigured()) {
      return Response.json({ data: { configured: false, tenants: 0 } });
    }

    // Every tenant that has ever synced an HR roster (cross-tenant admin read).
    const admin = getAdminClient();
    const { data: tenantRows, error: tErr } = await admin
      .from('hr_people').select('tenant_id').limit(5000);
    if (tErr) throw AppError.internal(`tenant enumeration failed: ${tErr.message}`);
    const tenantIds = [...new Set((tenantRows ?? []).map((r) => r.tenant_id as string))];

    const results: Array<Record<string, unknown>> = [];
    for (const tenantId of tenantIds) {
      try {
        const supabase = await createTenantServiceClient({
          url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
          serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          tenantId,
        });
        const summary = await runHRSync(supabase, tenantId, log);
        results.push({ tenantId, ...summary });
      } catch (err) {
        // Per-tenant isolation — one bad tenant doesn't stop the sweep.
        const message = err instanceof Error ? err.message : String(err);
        log.warn('hr_sync.cron_tenant_failed', { tenantId, error: message });
        results.push({ tenantId, error: message });
      }
    }

    log.info('hr_sync.cron_run', { tenants: tenantIds.length });
    return Response.json({ data: { configured: true, tenants: tenantIds.length, results } });
  },
  { serviceName: SERVICE_NAME, auth: 'public' },
);
