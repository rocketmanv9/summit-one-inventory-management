/**
 * GET /api/system/cron/schema-drift-audit
 *
 * Nightly schema-drift tripwire: runs public.rpc_schema_drift_audit(), which
 * lints every plpgsql function/trigger against the LIVE schema via
 * plpgsql_check (missing columns/tables, type errors, GROUP BY mistakes) and
 * flags dangerous source patterns (positional emit_event calls, root-only JWT
 * tenant reads). Emails a digest when anything is found so this class of bug
 * is caught before a user hits it.
 *
 * Recipient: SCHEMA_AUDIT_EMAIL, falling back to REORDER_DIGEST_EMAIL. With
 * neither set, findings still land in the cron logs and the JSON response.
 */
import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { sendEmail, isEmailConfigured } from '@/lib/email/send';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const maxDuration = 60;

export const GET = createReadRoute(
  async ({ req, fetch, log }) => {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization') || '';
    if (!secret || auth !== `Bearer ${secret}`) {
      throw AppError.unauthorized('Invalid or missing cron secret.');
    }

    const admin = getAdminClient();
    const { data, error } = await (admin as any).rpc('rpc_schema_drift_audit');
    if (error) throw AppError.internal(`Audit failed: ${error.message}`);

    const lintErrors: Array<{ fn: string; message: string }> = data?.lint_errors || [];
    const patternFindings: Array<{ fn: string; pattern: string }> = data?.pattern_findings || [];
    const total = lintErrors.length + patternFindings.length;

    log.info('schema_drift_audit.run', {
      lintErrors: lintErrors.length,
      patternFindings: patternFindings.length,
    });

    const recipient = process.env.SCHEMA_AUDIT_EMAIL || process.env.REORDER_DIGEST_EMAIL;
    let emailSent = false;
    if (total > 0 && recipient && isEmailConfigured()) {
      const lintHtml = lintErrors
        .map((e) => `<li><code>${e.fn}</code> — ${e.message}</li>`)
        .join('');
      const patternHtml = patternFindings
        .map((p) => `<li><code>${p.fn}</code> — ${p.pattern}</li>`)
        .join('');
      try {
        await sendEmail(fetch, {
          to: recipient,
          subject: `Schema drift audit: ${lintErrors.length} broken function(s), ${patternFindings.length} risky pattern(s)`,
          html: `
            <p>Nightly lint of database functions against the live schema.</p>
            ${lintErrors.length > 0 ? `<h3>Broken (will error when the code path runs)</h3><ul>${lintHtml}</ul>` : ''}
            ${patternFindings.length > 0 ? `<h3>Risky patterns</h3><ul>${patternHtml}</ul>` : ''}
            <p style="color:#888;font-size:12px">Summit One Inventory — schema drift audit</p>
          `,
          text: [
            'Schema drift audit findings:',
            ...lintErrors.map((e) => `- [broken] ${e.fn}: ${e.message}`),
            ...patternFindings.map((p) => `- [pattern] ${p.fn}: ${p.pattern}`),
          ].join('\n'),
        });
        emailSent = true;
      } catch (err: any) {
        log.warn('schema_drift_audit.email_failed', { error: err?.message });
      }
    }

    return Response.json({
      data: {
        lint_error_count: lintErrors.length,
        pattern_finding_count: patternFindings.length,
        email_sent: emailSent,
        lint_errors: lintErrors,
        pattern_findings: patternFindings,
      },
    });
  },
  { serviceName: SERVICE_NAME, auth: 'public' },
);
