/**
 * POST /api/inventory/price-wars/rounds/:id/send-invites
 *   { bid_ids?: string[] }
 *
 * Close the loop on price wars: actually EMAIL the AI-drafted RFQ to each vendor
 * so they really do bid against each other, instead of the buyer copy/pasting it
 * by hand. This reuses the exact PO email transport (tenant Gmail preferred,
 * Resend fallback) via sendNotificationEmail.
 *
 * TRUTHFULNESS is preserved: we send the `draft_message` text as-is. The AI never
 * invents a price and nothing here writes a quote — this only carries the message
 * a human already drafted (and can still Copy / open-in-mail as a fallback).
 *
 * Scope: bid_ids (default = every invited bid that has a draft AND a contact
 * email). Bids without a draft or without an email are SKIPPED and reported, not
 * failed. If a bid was already sent, it's skipped as already-sent (idempotent —
 * we don't re-blast a vendor). If neither Gmail nor Resend is configured for the
 * tenant we degrade with a clear "email isn't configured — copy it instead"
 * message rather than hard-failing.
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

function extractId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('rounds') + 1];
  if (!id) throw AppError.badRequest('Missing round id');
  return z.string().uuid().parse(id);
}

const BodySchema = z.object({
  /** Which vendors to invite. Omitted = all invited bids with a draft + email. */
  bid_ids: z.array(z.string().uuid()).max(100).optional(),
});

/** A draft is stored as "subject\n\nbody". Split it back apart for the email. */
function splitDraft(draft: string): { subject: string; body: string } {
  const lines = draft.split('\n');
  const subject = (lines[0] ?? '').trim() || 'Quote request';
  // Everything after the first blank line is the body; be tolerant of no blank line.
  const rest = lines.slice(1);
  while (rest.length && rest[0].trim() === '') rest.shift();
  const body = rest.join('\n').trim() || draft.trim();
  return { subject, body };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Wrap the plain-text body in minimal, safe HTML (newlines → <br>). */
function bodyToHtml(body: string): string {
  const html = escapeHtml(body).replace(/\r?\n/g, '<br>');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;line-height:1.5;">${html}</div>`;
}

interface InviteResult {
  bid_id: string;
  vendor_id: string;
  vendor_name: string;
  sent: boolean;
  skipped_reason?: 'no_draft' | 'no_email' | 'already_sent' | 'send_failed';
  to?: string | null;
  provider?: 'gmail' | 'resend' | null;
  message_id?: string | null;
  error?: string | null;
}

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, fetch, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const roundId = extractId(req);
  const body = BodySchema.parse(await req.json().catch(() => ({})));
  const tenantId = ctx.tenantId!;
  const userId = ctx.userId!;
  const sc = (supabase as any).schema('supply_chain');

  const { data: round, error: rErr } = await sc
    .from('quote_rounds').select('*').eq('id', roundId).eq('tenant_id', tenantId).maybeSingle();
  if (rErr) throw AppError.internal(rErr.message);
  if (!round) throw AppError.notFound('Price war not found');
  if (round.status !== 'open') {
    throw AppError.conflict('This price war is closed — invites can only go out on an open round.');
  }

  const { data: bids, error: bErr } = await sc
    .from('quote_round_bids').select('*').eq('round_id', roundId).eq('tenant_id', tenantId).limit(100);
  if (bErr) throw AppError.internal(bErr.message);

  // Resolve fresh vendor contact emails as a fallback to the invite-time snapshot.
  const vendorIds = [...new Set((bids ?? []).map((b: any) => b.vendor_id))];
  const vendorMap = new Map<string, any>();
  if (vendorIds.length > 0) {
    const { data: vendors } = await sc
      .from('vendors').select('id, name, contact_email, po_email').in('id', vendorIds).limit(100);
    for (const v of vendors ?? []) vendorMap.set(v.id, v);
  }

  // Which bids are we sending? Default = every non-declined invited bid.
  const requested = body.bid_ids ? new Set(body.bid_ids) : null;
  const targets = (bids ?? []).filter((b: any) => {
    if (requested) return requested.has(b.id);
    return b.status !== 'declined';
  });
  if (requested && targets.length === 0) {
    throw AppError.badRequest('None of the requested bids belong to this round.');
  }

  // Is email even configured for this tenant? Gmail connection OR Resend.
  const admin = getAdminClient();
  const shared = await getSharedMailboxes(admin, tenantId);
  const personal = shared.length === 0 ? await getUserConnection(admin, tenantId, userId) : null;
  const emailConfigured = shared.length > 0 || !!personal || isEmailConfigured();

  const now = new Date().toISOString();
  const results: InviteResult[] = [];
  const eventPayloads: any[] = [];

  for (const bid of targets) {
    const vendor = vendorMap.get(bid.vendor_id);
    const vendorName = vendor?.name ?? 'Vendor';
    const to = (bid.contact_email || vendor?.contact_email || vendor?.po_email || '').trim() || null;
    const base: InviteResult = { bid_id: bid.id, vendor_id: bid.vendor_id, vendor_name: vendorName, sent: false, to };

    if (!bid.draft_message) { results.push({ ...base, skipped_reason: 'no_draft' }); continue; }
    if (!to) { results.push({ ...base, skipped_reason: 'no_email' }); continue; }
    if (bid.sent_at) {
      results.push({ ...base, skipped_reason: 'already_sent', provider: (bid.sent_method as any) ?? null, message_id: bid.sent_message_id ?? null });
      continue;
    }

    const { subject, body: draftBody } = splitDraft(bid.draft_message);

    try {
      const sent = await sendNotificationEmail({
        tenantId,
        to,
        subject,
        html: bodyToHtml(draftBody),
        text: draftBody,
        fetchImpl: fetch,
        userId,
      });

      const { error: upErr } = await sc
        .from('quote_round_bids')
        .update({
          sent_at: now,
          sent_by_user_id: userId,
          sent_method: sent.provider,
          sent_message_id: sent.messageId,
          sent_to_email: to,
          updated_at: now,
          last_event_id: idempotencyKey,
        })
        .eq('id', bid.id)
        .eq('tenant_id', tenantId)
        .is('sent_at', null); // idempotent guard — don't overwrite an earlier send
      if (upErr) log.error('price_wars.invite_stamp_failed', { bidId: bid.id, error: upErr.message });

      results.push({ ...base, sent: true, provider: sent.provider, message_id: sent.messageId });
      eventPayloads.push({
        event_name: 'quote_round.invite_sent',
        payload: { round_id: roundId, vendor_id: bid.vendor_id, provider: sent.provider, to },
        last_event_id: `${idempotencyKey}:${bid.id}`,
      });
    } catch (err: any) {
      log.error('price_wars.invite_send_failed', { bidId: bid.id, error: err?.message });
      results.push({ ...base, skipped_reason: 'send_failed', error: err?.message ?? 'send failed' });
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
      ? `Sent ${sentCount} invite${sentCount === 1 ? '' : 's'}.` +
        (noEmail ? ` ${noEmail} skipped (no email — copy those instead).` : '') +
        (noDraft ? ` ${noDraft} had no draft yet.` : '') +
        (alreadySent ? ` ${alreadySent} already sent.` : '') +
        (failed ? ` ${failed} failed.` : '')
      : failed > 0
        ? `No invites went out — ${failed} send${failed === 1 ? '' : 's'} failed. Copy the drafts and send them yourself.`
        : 'Nothing to send — the selected vendors have no draft or no email on file. Copy those drafts instead.';

  return {
    data: {
      round_id: roundId,
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
    events: eventPayloads,
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/price-wars/rounds/[id]/send-invites' });
