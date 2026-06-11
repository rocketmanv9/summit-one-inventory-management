/**
 * GET /api/system/cron/integrity-check
 *
 * Scheduled background job: runs inventory.rpc_integrity_report for every
 * tenant that has stock on the books and logs a structured summary of
 * error/warning counts per tenant. Log-only for now — no email/alerting.
 *
 * Triggered by Vercel Cron (see vercel.json). Vercel sends
 * `Authorization: Bearer <CRON_SECRET>` automatically when CRON_SECRET is
 * set; we reject anything else so the endpoint isn't publicly runnable.
 */
import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Allow more headroom than a normal request — this fans out across tenants.
export const maxDuration = 60;

const MAX_TENANTS = 25;

export const GET = createReadRoute(
  async ({ req, log }) => {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization') || '';
    if (!secret || auth !== `Bearer ${secret}`) {
      throw AppError.unauthorized('Invalid or missing cron secret.');
    }

    // Enumerate tenants that actually carry stock — anyone with a
    // stock_balances row is a tenant whose invariants are worth checking.
    const admin = getAdminClient();
    const { data: balanceRows, error: tenantErr } = await admin
      .schema('inventory')
      .from('stock_balances')
      .select('tenant_id')
      .limit(2000);

    if (tenantErr) {
      log.error('integrity.cron_tenant_enum_failed', { error: tenantErr.message });
      throw AppError.internal(tenantErr.message);
    }

    const tenantIds = [
      ...new Set((balanceRows ?? []).map((r: any) => r.tenant_id as string)),
    ].slice(0, MAX_TENANTS);

    const perTenant: Array<{
      tenant_id: string;
      errors: number;
      warnings: number;
      failed?: boolean;
    }> = [];
    let totalErrors = 0;
    let totalWarnings = 0;
    let failedTenants = 0;

    for (const tenantId of tenantIds) {
      try {
        const supabase = await createTenantServiceClient({
          url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
          serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
          tenantId,
        });

        const { data, error } = await (supabase as any)
          .schema('inventory')
          .rpc('rpc_integrity_report', { p_tenant_id: tenantId });

        if (error) throw AppError.internal(error.message);

        const findings: Array<{ severity: string }> = Array.isArray(data) ? data : [];
        const errors = findings.filter((f) => f.severity === 'error').length;
        const warnings = findings.filter((f) => f.severity === 'warning').length;
        totalErrors += errors;
        totalWarnings += warnings;
        perTenant.push({ tenant_id: tenantId, errors, warnings });

        if (errors > 0 || warnings > 0) {
          log.warn('integrity.cron_findings', { tenantId, errors, warnings });
        }
      } catch (err) {
        // Isolate per-tenant failures so one bad tenant doesn't stop the sweep.
        failedTenants += 1;
        perTenant.push({ tenant_id: tenantId, errors: 0, warnings: 0, failed: true });
        log.error('integrity.cron_tenant_failed', {
          tenantId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const summary = {
      tenants: tenantIds.length,
      failed_tenants: failedTenants,
      total_errors: totalErrors,
      total_warnings: totalWarnings,
      per_tenant: perTenant,
    };

    log.info('integrity.cron_summary', { ...summary });
    return Response.json({ data: summary });
  },
  { serviceName: SERVICE_NAME, auth: 'public' },
);
