/**
 * POST /api/inventory/price-wars/requests/:id/send-invites
 *   { vendor_ids?: string[] }
 *
 * Send the war the way Grant pictures it: ONE email per vendor covering every
 * item in the request, sent once — not one email per product-round. draft-rfq
 * already composed a single combined RFQ per vendor and stored it on each of
 * that vendor's bids; this reads it once, stamps the correlation markers for all
 * of the vendor's line-bids so replies can be matched back, emails it, and marks
 * every one of that vendor's bids sent.
 *
 * Reuses the exact PO email transport (tenant Gmail preferred, Resend fallback)
 * via sendNotificationEmail. TRUTHFULNESS is preserved — we send the drafted
 * text as-is and never write a quote here.
 *
 * Idempotent: a vendor already sent is skipped, not re-blasted. Vendors without
 * a draft or without an email are reported, not failed. Requires
 * purchase_orders.manage.
 */

import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';
import { getAdminClient } from '@/utils/supabase/admin';
import { getSharedMailboxes, getUserConnection } from '@/lib/integrations/google-connections';
import { isEmailConfigured } from '@/lib/email/send';
import { sendNotificationEmail } from '@/lib/po/po-email-service';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractRequestId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('requests') + 1];
  if (!id) throw AppError.badRequest('Missing request id');
  return z.string().uuid().parse(id);
}

const BodySchema = z.object({
  /** Limit the send to specific vendors. Omitted = every vendor in the request. */
  vendor_ids: z.array(z.string().uuid()).max(50).optional(),
});

function splitDraft(draft: string): { subject: string; body: string } {
  const lines = draft.split('\n');
  const subject = (lines[0] ?? '').trim() || 'Quote request';
  const rest = lines.slice(1);
  while (rest.length && rest[0].trim() === '') rest.shift();
  const body = rest.join('\n').trim() || draft.trim();
  return { subject, body };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function bodyToHtml(body: string): string {
  const html = escapeHtml(body).replace(/\r?\n/g, '<br>');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.5;">${html}</div>`;
}

interface VendorResult {
  vendor_id: string;
  vendor_name: string;
  sent: boolean;
  line_count: number;
  skipped_reason?: 'no_draft' | 'no_email' | 'already_sent' | 'send_failed';
  to?: string | null;
  provider?: 'gmail' | 'resend' | null;
  error?: string | null;
}

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, fetch, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const requestId = extractRequestId(req);
  const body = BodySchema.parse(await req.json().catch(() => ({})));
  const tenantId = ctx.tenantId!;
  const userId = ctx.userId!;
  const sc = (supabase as any).schema('supply_chain');

  const { data: request, error: rqErr } = await sc
    .from('quote_requests').select('*').eq('id', requestId).eq('tenant_id', tenantId).maybeSingle();
  if (rqErr) throw AppError.internal(rqErr.message);
  if (!request) throw AppError.notFound('Price war request not found');

  // Only open rounds under this request can take invites.
  const { data: rounds, error: roErr } = await sc
    .from('quote_rounds').select('id, status').eq('request_id', requestId).eq('tenant_id', tenantId).limit(50);
  if (roErr) throw AppError.internal(roErr.message);
  const openRoundIds = (rounds ?? []).filter((r: any) => r.status === 'open').map((r: any) => r.id);
  if (openRoundIds.length === 0) throw AppError.conflict('This war is closed — invites only go out on open rounds.');

  const { data: bids, error: bErr } = await sc
    .from('quote_round_bids').select('*').in('round_id', openRoundIds).eq('tenant_id', tenantId).limit(1000);
  if (bErr) throw AppError.internal(bErr.message);

  // Fresh vendor contacts as a fallback to the invite-time snapshot.
  const vendorIds: string[] = Array.from(new Set(((bids ?? []) as any[]).map((b: any) => String(b.vendor_id))))
    .filter((id: string) => !body.vendor_ids || body.vendor_ids.includes(id));
  const vendorMap = new Map<string, any>();
  if (vendorIds.length > 0) {
    const { data: vendors } = await sc.from('vendors').select('id, name, contact_email, po_email').in('id', vendorIds).limit(100);
    for (const v of vendors ?? []) vendorMap.set(v.id, v);
  }

  // Is email configured for this tenant? Gmail connection OR Resend.
  const admin = getAdminClient();
  const shared = await getSharedMailboxes(admin, tenantId);
  const personal = shared.length === 0 ? await getUserConnection(admin, tenantId, userId) : null;
  const emailConfigured = shared.length > 0 || !!personal || isEmailConfigured();
  const monitoredMailbox =
    (shared[0]?.google_email || personal?.google_email || process.env.ORDER_EMAIL_FROM || '').trim() || null;

  const now = new Date().toISOString();
  const results: VendorResult[] = [];
  const events: any[] = [];

  for (const vendorId of vendorIds) {
    const vendor = vendorMap.get(vendorId);
    const vendorName = vendor?.name ?? 'Vendor';
    const vendorBids = (bids ?? []).filter((b: any) => b.vendor_id === vendorId && b.status !== 'declined');
    if (vendorBids.length === 0) continue;

    const base: VendorResult = { vendor_id: vendorId, vendor_name: vendorName, sent: false, line_count: vendorBids.length };

    // Already sent (any bid stamped) — don't re-blast.
    if (vendorBids.some((b: any) => b.sent_at)) {
      results.push({ ...base, skipped_reason: 'already_sent', provider: (vendorBids.find((b: any) => b.sent_method)?.sent_method as any) ?? null });
      continue;
    }
    const draftBid = vendorBids.find((b: any) => b.draft_message);
    if (!draftBid) { results.push({ ...base, skipped_reason: 'no_draft' }); continue; }
    const to = (draftBid.contact_email || vendor?.contact_email || vendor?.po_email || '').trim() || null;
    if (!to) { results.push({ ...base, skipped_reason: 'no_email', to }); continue; }

    const { subject: rawSubject, body: rawBody } = splitDraft(draftBid.draft_message);

    // Correlation: one combined email covers several line-bids, so list every
    // bid's [pw:<round>:<bid>] marker as a Ref block. A reply that keeps it lets
    // the inbox monitor match each line back; we also carry the first marker in
    // the subject for replies that only quote the subject line.
    const markers = vendorBids.map((b: any) => `[pw:${b.round_id}:${b.id}]`);
    const refBlock = `Ref: ${markers.join(' ')} (please keep this reference when you reply)`;
    const draftBody = rawBody.includes('[pw:') ? rawBody : `${rawBody.trimEnd()}\n\n${refBlock}`;
    const subject = rawSubject.includes('[pw:') ? rawSubject : `${rawSubject} ${markers[0]}`;

    try {
      const sent = await sendNotificationEmail({
        tenantId, to, subject,
        html: bodyToHtml(draftBody), text: draftBody,
        fetchImpl: fetch, userId, replyTo: monitoredMailbox ?? undefined,
      });

      // Mark every one of this vendor's line-bids sent (idempotent guard on each).
      for (const b of vendorBids) {
        const { error: upErr } = await sc
          .from('quote_round_bids')
          .update({
            sent_at: now, sent_by_user_id: userId, sent_method: sent.provider,
            sent_message_id: sent.messageId, sent_to_email: to,
            correlation_token: (b.correlation_token as string | null) ?? b.id.replace(/-/g, ''),
            updated_at: now, last_event_id: `${idempotencyKey}:${b.id}`,
          })
          .eq('id', b.id).eq('tenant_id', tenantId).is('sent_at', null);
        if (upErr) log.error('price_wars.request_invite_stamp_failed', { bidId: b.id, error: upErr.message });
      }

      results.push({ ...base, sent: true, to, provider: sent.provider });
      events.push({
        event_name: 'quote_round.invite_sent',
        payload: { request_id: requestId, vendor_id: vendorId, provider: sent.provider, to, line_count: vendorBids.length },
        last_event_id: `${idempotencyKey}:${vendorId}`,
      });
    } catch (err: any) {
      log.error('price_wars.request_invite_send_failed', { vendorId, error: err?.message });
      results.push({ ...base, skipped_reason: 'send_failed', to, error: err?.message ?? 'send failed' });
    }
  }

  const sentCount = results.filter((r) => r.sent).length;
  const noEmail = results.filter((r) => r.skipped_reason === 'no_email').length;
  const noDraft = results.filter((r) => r.skipped_reason === 'no_draft').length;
  const alreadySent = results.filter((r) => r.skipped_reason === 'already_sent').length;
  const failed = results.filter((r) => r.skipped_reason === 'send_failed').length;

  const message = !emailConfigured
    ? "Email isn't configured for this tenant — connect a Google account or set RESEND_API_KEY, or copy each draft and send it yourself."
    : sentCount > 0
      ? `Sent to ${sentCount} vendor${sentCount === 1 ? '' : 's'} — one email each covering every item.` +
        (noEmail ? ` ${noEmail} skipped (no email).` : '') +
        (noDraft ? ` ${noDraft} had no draft yet.` : '') +
        (alreadySent ? ` ${alreadySent} already sent.` : '') +
        (failed ? ` ${failed} failed.` : '')
      : failed > 0
        ? `No invites went out — ${failed} send${failed === 1 ? '' : 's'} failed. Copy the drafts and send them yourself.`
        : alreadySent > 0
          ? 'Already sent to these vendors.'
          : 'Nothing to send — no vendor has a draft and an email on file yet.';

  return {
    data: {
      request_id: requestId,
      email_configured: emailConfigured,
      sent_count: sentCount,
      skipped_no_email: noEmail,
      skipped_no_draft: noDraft,
      already_sent: alreadySent,
      failed,
      results,
      message,
    },
    status: 200,
    events,
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/price-wars/requests/[id]/send-invites' });
