/**
 * Nightly auto-reorder loop.
 *
 * For every tenant with supply_chain settings, calls
 * supply_chain.rpc_generate_reorder_pos_v2 (creates draft POs grouped by
 * vendor+location from inventory.v_reorder_suggestions, idempotent per run_id)
 * and emails a digest of the newly created draft POs so a human can review and
 * send them from /inventory/purchasing.
 *
 * Per-tenant failures are isolated: one bad tenant never aborts the rest.
 */
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { sendNotificationEmail } from '@/lib/po/po-email-service';

type FetchLike = typeof fetch;

interface CreatedPO {
  po_id: string;
  po_number: string;
  vendor_id: string;
  location_id: string;
  line_count: number;
  estimated_total: number;
}

interface GenerateResult {
  run_id: string;
  created: CreatedPO[];
  created_count: number;
  skipped_existing: number;
}

export interface AutoReorderTenantResult {
  tenantId: string;
  createdCount: number;
  skippedExisting: number;
  emailSent: boolean;
  emailRecipient: string | null;
  error?: string;
}

export interface AutoReorderSummary {
  runId: string;
  tenantsProcessed: number;
  posCreated: number;
  skippedExisting: number;
  emailsSent: number;
  emailsSkipped: number;
  errors: Array<{ tenantId: string; error: string }>;
  tenants: AutoReorderTenantResult[];
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) return String((err as any).message);
  return String(err);
}

/** Today's run id, e.g. "20260611" (UTC, matches the RPC's default). */
function todayRunId(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SERVICE_BASE_URL || '').replace(/\/$/, '');
}

function fmtMoney(n: number): string {
  return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Digest recipient, in priority order:
 *  1. supply_chain.tenant_settings has NO notification-email column today
 *     (verified against the schema), so that rung is skipped.
 *  2. Email of the tenant's most recent PO creator (purchase_orders.created_by_user_id
 *     → public.local_users.email, the Core-synced user mirror).
 *  3. REORDER_DIGEST_EMAIL env fallback.
 *  4. null → caller skips the email with a warning.
 */
async function resolveDigestRecipient(
  admin: any,
  tenantId: string,
): Promise<{ email: string | null; userId: string | null }> {
  const { data: recentPOs } = await admin
    .schema('supply_chain')
    .from('purchase_orders')
    .select('created_by_user_id, created_at')
    .eq('tenant_id', tenantId)
    .not('created_by_user_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);

  const userIds: string[] = [
    ...new Set(((recentPOs ?? []) as any[]).map((r) => r.created_by_user_id as string).filter(Boolean)),
  ];

  if (userIds.length > 0) {
    const { data: users } = await admin
      .from('local_users')
      .select('user_id, email')
      .eq('tenant_id', tenantId)
      .in('user_id', userIds)
      .limit(10);
    const byId = new Map(((users ?? []) as any[]).map((u) => [u.user_id, u.email]));
    // Most recent creator with a usable email wins.
    for (const id of userIds) {
      const email = (byId.get(id) || '').trim();
      if (email && email.includes('@')) return { email, userId: id };
    }
  }

  const fallback = (process.env.REORDER_DIGEST_EMAIL || '').trim();
  if (fallback) return { email: fallback, userId: null };
  return { email: null, userId: null };
}

function buildDigestEmail(args: {
  created: CreatedPO[];
  vendorNames: Map<string, string>;
  runId: string;
}): { subject: string; html: string; text: string } {
  const { created, vendorNames, runId } = args;
  const count = created.length;
  const subject = `${count} draft purchase order${count === 1 ? '' : 's'} ready for review`;
  const link = `${appBaseUrl()}/inventory/purchasing`;
  const grandTotal = created.reduce((s, po) => s + Number(po.estimated_total || 0), 0);

  const rowsHtml = created
    .map((po) => {
      const vendor = vendorNames.get(po.vendor_id) || 'Unknown vendor';
      return (
        `<tr>` +
        `<td style="padding:6px 12px;border-bottom:1px solid #eee;">${escapeHtml(po.po_number)}</td>` +
        `<td style="padding:6px 12px;border-bottom:1px solid #eee;">${escapeHtml(vendor)}</td>` +
        `<td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">${po.line_count}</td>` +
        `<td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">${fmtMoney(Number(po.estimated_total))}</td>` +
        `</tr>`
      );
    })
    .join('');

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:640px;">
  <h2 style="margin:0 0 8px;">Nightly reorder: ${count} draft PO${count === 1 ? '' : 's'} created</h2>
  <p style="margin:0 0 16px;color:#555;">
    The auto-reorder run (${escapeHtml(runId)}) created the following draft purchase orders from
    low-stock suggestions. Review and send them when ready.
  </p>
  <table style="border-collapse:collapse;width:100%;font-size:14px;">
    <thead>
      <tr style="background:#f5f5f5;">
        <th style="padding:6px 12px;text-align:left;">PO #</th>
        <th style="padding:6px 12px;text-align:left;">Vendor</th>
        <th style="padding:6px 12px;text-align:right;">Lines</th>
        <th style="padding:6px 12px;text-align:right;">Est. Total</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
    <tfoot>
      <tr>
        <td colspan="3" style="padding:8px 12px;text-align:right;font-weight:bold;">Total</td>
        <td style="padding:8px 12px;text-align:right;font-weight:bold;">${fmtMoney(grandTotal)}</td>
      </tr>
    </tfoot>
  </table>
  <p style="margin:16px 0;">
    <a href="${link}" style="background:#1a56db;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block;">
      Review in Purchasing
    </a>
  </p>
  <p style="margin:0;color:#999;font-size:12px;">Sent automatically by the Summit One inventory auto-reorder job.</p>
</div>`.trim();

  const textLines = created.map((po) => {
    const vendor = vendorNames.get(po.vendor_id) || 'Unknown vendor';
    return `- ${po.po_number} | ${vendor} | ${po.line_count} line${po.line_count === 1 ? '' : 's'} | ${fmtMoney(Number(po.estimated_total))}`;
  });
  const text = [
    `Nightly reorder run ${runId} created ${count} draft purchase order${count === 1 ? '' : 's'}:`,
    '',
    ...textLines,
    '',
    `Total: ${fmtMoney(grandTotal)}`,
    '',
    `Review and send: ${link}`,
  ].join('\n');

  return { subject, html, text };
}

/**
 * Run the auto-reorder loop for every tenant with supply_chain settings
 * (tenant_settings is auto-created the first time a tenant touches purchasing,
 * so it doubles as the active-tenant roster). `maxTenants` bounds work per
 * invocation to stay within the route timeout.
 */
export async function runAutoReorderForAllTenants(args: {
  fetchImpl: FetchLike;
  maxTenants?: number;
  log?: { info: (msg: string, meta?: any) => void; warn: (msg: string, meta?: any) => void };
}): Promise<AutoReorderSummary> {
  const admin = getAdminClient();
  const runId = todayRunId();
  const log = args.log;

  const { data: settingsRows, error: settingsError } = await admin
    .schema('supply_chain')
    .from('tenant_settings')
    .select('tenant_id, reorder_mode')
    .order('created_at', { ascending: true })
    .limit(1000);
  if (settingsError) {
    throw AppError.internal(`Failed to enumerate tenants from tenant_settings: ${settingsError.message}`);
  }

  // Only tenants who opted into automatic draft creation. 'notify' tenants get
  // an in-app heads-up from the agent-suggestions cron instead — no POs made
  // on their behalf here.
  const tenantIds = [
    ...new Set(
      ((settingsRows ?? []) as any[])
        .filter((r) => (r.reorder_mode || 'auto_draft') !== 'notify')
        .map((r) => r.tenant_id as string),
    ),
  ].slice(0, args.maxTenants ?? 15);

  const summary: AutoReorderSummary = {
    runId,
    tenantsProcessed: 0,
    posCreated: 0,
    skippedExisting: 0,
    emailsSent: 0,
    emailsSkipped: 0,
    errors: [],
    tenants: [],
  };

  for (const tenantId of tenantIds) {
    const tenantResult: AutoReorderTenantResult = {
      tenantId,
      createdCount: 0,
      skippedExisting: 0,
      emailSent: false,
      emailRecipient: null,
    };

    try {
      const { data, error } = await admin
        .schema('supply_chain')
        .rpc('rpc_generate_reorder_pos_v2', { p_tenant_id: tenantId, p_run_id: runId });
      if (error) throw AppError.internal(error.message);

      const result = (data ?? {}) as GenerateResult;
      const created: CreatedPO[] = Array.isArray(result.created) ? result.created : [];
      tenantResult.createdCount = Number(result.created_count ?? created.length) || 0;
      tenantResult.skippedExisting = Number(result.skipped_existing ?? 0) || 0;
      summary.posCreated += tenantResult.createdCount;
      summary.skippedExisting += tenantResult.skippedExisting;

      if (tenantResult.createdCount > 0 && created.length > 0) {
        // Vendor names for the digest table.
        const vendorIds = [...new Set(created.map((po) => po.vendor_id).filter(Boolean))];
        const vendorNames = new Map<string, string>();
        if (vendorIds.length > 0) {
          const { data: vendors } = await admin
            .schema('supply_chain')
            .from('vendors')
            .select('id, name')
            .eq('tenant_id', tenantId)
            .in('id', vendorIds)
            .limit(vendorIds.length);
          for (const v of (vendors ?? []) as any[]) vendorNames.set(v.id, v.name);
        }

        const { email: recipient, userId } = await resolveDigestRecipient(admin, tenantId);
        if (!recipient) {
          summary.emailsSkipped += 1;
          log?.warn('reorder.digest_skipped_no_recipient', {
            tenantId,
            createdCount: tenantResult.createdCount,
            hint: 'No PO creator email in local_users and REORDER_DIGEST_EMAIL is unset.',
          });
        } else {
          const { subject, html, text } = buildDigestEmail({ created, vendorNames, runId });
          try {
            await sendNotificationEmail({
              tenantId,
              to: recipient,
              subject,
              html,
              text,
              fetchImpl: args.fetchImpl,
              userId: userId ?? undefined,
            });
            tenantResult.emailSent = true;
            tenantResult.emailRecipient = recipient;
            summary.emailsSent += 1;
          } catch (emailErr) {
            // The POs are already created — an email failure is reported but
            // must not mark the tenant run as failed.
            summary.emailsSkipped += 1;
            summary.errors.push({ tenantId, error: `digest email failed: ${errMessage(emailErr)}` });
            log?.warn('reorder.digest_send_failed', { tenantId, recipient, error: errMessage(emailErr) });
          }
        }
      }

      summary.tenantsProcessed += 1;
    } catch (err) {
      tenantResult.error = errMessage(err);
      summary.errors.push({ tenantId, error: tenantResult.error });
      log?.warn('reorder.tenant_failed', { tenantId, error: tenantResult.error });
    }

    summary.tenants.push(tenantResult);
  }

  return summary;
}
