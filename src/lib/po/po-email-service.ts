/**
 * Purchase Order email service.
 *
 * Sends a PO to its vendor preferring the tenant's Gmail connection (personal
 * account or shared mailbox like purchasing@company.com) and falling back to the
 * Resend transactional sender when no Google account is connected. Generates a
 * PDF attachment, records an audit row in supply_chain.purchase_order_emails,
 * and can sync vendor replies back to the originating PO.
 */
import OpenAI from 'openai';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { buildPurchaseOrderEmail, type POEmailLine } from '@/lib/email/order-email';
import { sendEmail } from '@/lib/email/send';
import { sendGmailMessage, listGmailMessages, getGmailMessage, parseEmailAddress } from '@/lib/integrations/gmail';
import {
  resolveSendingConnection,
  getAccessTokenForConnection,
  getSharedMailboxes,
  getUserConnection,
  type GoogleConnectionRow,
} from '@/lib/integrations/google-connections';
import { loadPOContext, type POContext } from './po-context';
import { generatePurchaseOrderPdf } from './po-pdf';

type AdminClient = any;
type FetchLike = typeof fetch;

// ── Send a PO ────────────────────────────────────────────────────────────────

export interface SendPurchaseOrderEmailInput {
  tenantId: string;
  userId: string;
  purchaseOrderId: string;
  /** Override the vendor's on-file address. */
  vendorEmail?: string;
  /** Personalised note prepended to the body. */
  message?: string;
  /** Address to CC + reply-to (typically the requesting user). */
  requesterEmail?: string;
  requesterName?: string;
  /** Force a specific Google connection (e.g. a chosen shared mailbox). */
  preferConnectionId?: string;
  /** Traced fetch from the route handler. */
  fetchImpl: FetchLike;
  /** Idempotency key — used as the audit row's last_event_id. */
  lastEventId: string;
}

export interface SendPurchaseOrderEmailResult {
  provider: 'gmail' | 'resend';
  messageId: string | null;
  threadId: string | null;
  recipient: string;
  from: string;
  poNumber: string;
  connectionId: string | null;
  emailRecordId: string | null;
}

function ctxLinesToEmailLines(ctx: POContext): POEmailLine[] {
  return ctx.lines.map((l) => ({
    description: l.sku ? `${l.description} (${l.sku})` : l.description,
    quantity: l.quantity,
    uom: l.uom,
    unitPrice: l.unitPrice,
  }));
}

export async function sendPurchaseOrderEmail(
  input: SendPurchaseOrderEmailInput,
): Promise<SendPurchaseOrderEmailResult> {
  const admin = getAdminClient();
  const ctx = await loadPOContext(admin, input.tenantId, input.purchaseOrderId);

  const recipient = (input.vendorEmail || ctx.vendorEmail || '').trim();
  if (!recipient) {
    throw AppError.badRequest(
      `${ctx.vendorName} has no email on file. Add a vendor email or pass one to send to.`,
    );
  }

  const requesterEmail = input.requesterEmail || ctx.company.email || undefined;
  const { subject, html, text } = buildPurchaseOrderEmail({
    poNumber: ctx.poNumber,
    vendorName: ctx.vendorName,
    shipTo: ctx.shipToName,
    lines: ctxLinesToEmailLines(ctx),
    neededBy: ctx.neededBy,
    notes: ctx.notes,
    message: input.message ?? null,
    requesterName: input.requesterName ?? ctx.company.name,
    requesterEmail: requesterEmail ?? recipient,
  });

  // PDF attachment (best-effort — a render failure must not block sending).
  let pdf: Uint8Array | null = null;
  try {
    pdf = await generatePurchaseOrderPdf(ctx);
  } catch {
    pdf = null;
  }
  const pdfFilename = `PO-${ctx.poNumber}.pdf`;

  // Decide Gmail vs Resend.
  const connection = await resolveSendingConnection(admin, input.tenantId, input.userId, {
    preferConnectionId: input.preferConnectionId,
  });

  let result: SendPurchaseOrderEmailResult;
  if (connection) {
    result = await sendViaGmail(admin, connection, {
      ctx,
      recipient,
      requesterEmail,
      subject,
      html,
      text,
      pdf,
      pdfFilename,
      fetchImpl: input.fetchImpl,
    });
  } else {
    result = await sendViaResend({
      ctx,
      recipient,
      requesterEmail,
      requesterName: input.requesterName ?? ctx.company.name,
      subject,
      html,
      text,
      pdf,
      pdfFilename,
      fetchImpl: input.fetchImpl,
    });
  }

  // Audit row.
  const emailRecordId = await recordSentEmail(admin, {
    tenantId: input.tenantId,
    purchaseOrderId: ctx.poId,
    connectionId: result.connectionId,
    provider: result.provider,
    gmailMessageId: result.provider === 'gmail' ? result.messageId : null,
    gmailThreadId: result.threadId,
    sentByUserId: input.userId,
    fromEmail: result.from,
    recipientEmail: recipient,
    subject,
    lastEventId: input.lastEventId,
  });

  // Best-effort stamp on the PO itself (mirrors the existing Resend route).
  try {
    await admin
      .schema('supply_chain')
      .from('purchase_orders')
      .update({ sent_at: new Date().toISOString(), sent_by_user_id: input.userId })
      .eq('id', ctx.poId)
      .eq('tenant_id', input.tenantId);
  } catch {
    // non-fatal
  }

  return { ...result, recipient, poNumber: ctx.poNumber, emailRecordId };
}

async function sendViaGmail(
  admin: AdminClient,
  connection: GoogleConnectionRow,
  args: {
    ctx: POContext;
    recipient: string;
    requesterEmail?: string;
    subject: string;
    html: string;
    text: string;
    pdf: Uint8Array | null;
    pdfFilename: string;
    fetchImpl: FetchLike;
  },
): Promise<SendPurchaseOrderEmailResult> {
  const accessToken = await getAccessTokenForConnection(admin, connection, args.fetchImpl);
  const fromName = connection.display_name || args.ctx.company.name;
  const from = `${fromName} <${connection.google_email}>`;

  const sent = await sendGmailMessage(args.fetchImpl, accessToken, {
    from,
    to: args.recipient,
    cc: args.requesterEmail ? [args.requesterEmail] : undefined,
    replyTo: args.requesterEmail,
    subject: args.subject,
    html: args.html,
    text: args.text,
    attachments: args.pdf
      ? [{ filename: args.pdfFilename, mimeType: 'application/pdf', content: args.pdf }]
      : undefined,
  });

  return {
    provider: 'gmail',
    messageId: sent.id,
    threadId: sent.threadId,
    recipient: args.recipient,
    from: connection.google_email,
    poNumber: args.ctx.poNumber,
    connectionId: connection.id,
    emailRecordId: null,
  };
}

async function sendViaResend(args: {
  ctx: POContext;
  recipient: string;
  requesterEmail?: string;
  requesterName?: string | null;
  subject: string;
  html: string;
  text: string;
  pdf: Uint8Array | null;
  pdfFilename: string;
  fetchImpl: FetchLike;
}): Promise<SendPurchaseOrderEmailResult> {
  const rawSender = process.env.ORDER_EMAIL_FROM || args.requesterEmail || '';
  const senderAddress = rawSender.includes('<') ? rawSender.replace(/.*<([^>]+)>.*/, '$1').trim() : rawSender.trim();
  const fromName = args.requesterName?.trim();
  const from = fromName ? `${fromName} <${senderAddress}>` : senderAddress;

  const sent = await sendEmail(args.fetchImpl, {
    from,
    to: args.recipient,
    cc: args.requesterEmail ? [args.requesterEmail] : undefined,
    replyTo: args.requesterEmail,
    subject: args.subject,
    html: args.html,
    text: args.text,
    attachments: args.pdf
      ? [{ filename: args.pdfFilename, content: Buffer.from(args.pdf).toString('base64') }]
      : undefined,
  });

  return {
    provider: 'resend',
    messageId: sent.id,
    threadId: null,
    recipient: args.recipient,
    from: senderAddress,
    poNumber: args.ctx.poNumber,
    connectionId: null,
    emailRecordId: null,
  };
}

async function recordSentEmail(
  admin: AdminClient,
  row: {
    tenantId: string;
    purchaseOrderId: string;
    connectionId: string | null;
    provider: 'gmail' | 'resend';
    gmailMessageId: string | null;
    gmailThreadId: string | null;
    sentByUserId: string;
    fromEmail: string;
    recipientEmail: string;
    subject: string;
    lastEventId: string;
  },
): Promise<string | null> {
  const { data } = await admin
    .schema('supply_chain')
    .from('purchase_order_emails')
    .insert({
      tenant_id: row.tenantId,
      purchase_order_id: row.purchaseOrderId,
      connection_id: row.connectionId,
      provider: row.provider,
      gmail_message_id: row.gmailMessageId,
      gmail_thread_id: row.gmailThreadId,
      sent_by_user_id: row.sentByUserId,
      from_email: row.fromEmail,
      recipient_email: row.recipientEmail,
      subject: row.subject,
      status: 'sent',
      last_event_id: row.lastEventId,
    })
    .select('id')
    .single();
  return data?.id ?? null;
}

// ── AI draft helper ──────────────────────────────────────────────────────────

export type EmailUrgency = 'normal' | 'urgent' | 'follow_up';

export interface GeneratePOEmailDraftInput {
  ctx: POContext;
  urgency?: EmailUrgency;
}

export interface POEmailDraft {
  subject: string;
  body: string;
}

/**
 * Produce a professional PO email body. Uses OpenAI when configured; otherwise
 * falls back to a deterministic template so the feature degrades gracefully.
 */
export async function generatePurchaseOrderEmailDraft(
  input: GeneratePOEmailDraftInput,
): Promise<POEmailDraft> {
  const { ctx } = input;
  const urgency = input.urgency ?? 'normal';
  const subject = `Purchase Order ${ctx.poNumber}`;

  if (!process.env.OPENAI_API_KEY) {
    return { subject, body: templateDraft(ctx, urgency) };
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const itemSummary = ctx.lines
      .map((l) => `- ${l.description}${l.sku ? ` (${l.sku})` : ''}: ${l.quantity}${l.uom ? ` ${l.uom}` : ''}`)
      .join('\n');
    const urgencyHint =
      urgency === 'urgent'
        ? 'This order is time-sensitive; politely convey urgency and request expedited handling.'
        : urgency === 'follow_up'
          ? 'This is a follow-up on a previously sent order; politely ask for a status/confirmation.'
          : 'Standard, courteous tone.';

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content:
            'You write concise, professional B2B purchase-order emails for a construction/asphalt supply company. Plain text only, no markdown. 4–8 sentences. Always ask the vendor to confirm receipt and provide estimated delivery.',
        },
        {
          role: 'user',
          content:
            `Company: ${ctx.company.name}\n` +
            `Vendor: ${ctx.vendorName}${ctx.vendorContactName ? ` (attn: ${ctx.vendorContactName})` : ''}\n` +
            `PO Number: ${ctx.poNumber}\n` +
            `Needed by: ${ctx.neededBy ?? 'not specified'}\n` +
            `Ship to: ${ctx.shipToName ?? 'see instructions'}\n` +
            `Items:\n${itemSummary}\n\n` +
            `${urgencyHint}\n` +
            `Write the email body only (no subject line).`,
        },
      ],
    });
    const body = completion.choices[0]?.message?.content?.trim();
    return { subject, body: body || templateDraft(ctx, urgency) };
  } catch {
    return { subject, body: templateDraft(ctx, urgency) };
  }
}

function templateDraft(ctx: POContext, urgency: EmailUrgency): string {
  const greeting = ctx.vendorContactName ? `Hello ${ctx.vendorContactName},` : 'Hello,';
  const lead =
    urgency === 'urgent'
      ? `Please find attached Purchase Order ${ctx.poNumber}. This order is time-sensitive — we would appreciate expedited handling.`
      : urgency === 'follow_up'
        ? `Following up on Purchase Order ${ctx.poNumber} sent previously — could you confirm receipt and status?`
        : `Please find attached Purchase Order ${ctx.poNumber}.`;
  return [
    greeting,
    '',
    lead,
    '',
    'Please confirm receipt and provide estimated delivery information.',
    ctx.neededBy ? `We would need delivery by ${ctx.neededBy}.` : '',
    '',
    'Thank you.',
    '',
    ctx.company.name,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

// ── Reply sync ───────────────────────────────────────────────────────────────

export interface SyncVendorRepliesResult {
  scannedConnections: number;
  newReplies: number;
}

/**
 * Read recent Gmail messages across the user's connections (personal + shared
 * mailboxes), match them to sent POs by thread id or PO number in the subject,
 * and store inbound vendor replies linked to the originating PO.
 */
export async function syncVendorReplies(args: {
  tenantId: string;
  userId: string;
  fetchImpl: FetchLike;
  lookbackDays?: number;
}): Promise<SyncVendorRepliesResult> {
  const admin = getAdminClient();
  const lookback = args.lookbackDays ?? 30;

  // Gather candidate connections (personal + shared).
  const connections: GoogleConnectionRow[] = [];
  const personal = await getUserConnection(admin, args.tenantId, args.userId);
  if (personal) connections.push(personal);
  connections.push(...(await getSharedMailboxes(admin, args.tenantId)));
  if (connections.length === 0) {
    return { scannedConnections: 0, newReplies: 0 };
  }

  // Build lookup maps from sent PO emails.
  const { data: sentEmails } = await admin
    .schema('supply_chain')
    .from('purchase_order_emails')
    .select('id, purchase_order_id, gmail_thread_id, subject')
    .eq('tenant_id', args.tenantId)
    .eq('provider', 'gmail')
    .order('sent_at', { ascending: false })
    .limit(500);

  const threadToPO = new Map<string, { poId: string; emailId: string }>();
  const poNumberToPO = new Map<string, { poId: string; emailId: string }>();
  for (const e of sentEmails ?? []) {
    if (e.gmail_thread_id) threadToPO.set(e.gmail_thread_id, { poId: e.purchase_order_id, emailId: e.id });
    const m = (e.subject ?? '').match(/Purchase Order\s+(\S+)/i);
    if (m) poNumberToPO.set(m[1].toLowerCase(), { poId: e.purchase_order_id, emailId: e.id });
  }

  let newReplies = 0;
  for (const conn of connections) {
    let accessToken: string;
    try {
      accessToken = await getAccessTokenForConnection(admin, conn, args.fetchImpl);
    } catch {
      continue; // skip connections whose token can't be refreshed
    }
    const refs = await listGmailMessages(
      args.fetchImpl,
      accessToken,
      `newer_than:${lookback}d -in:sent -in:drafts`,
      50,
    );
    for (const ref of refs) {
      let msg;
      try {
        msg = await getGmailMessage(args.fetchImpl, accessToken, ref.id);
      } catch {
        continue;
      }
      const fromAddr = parseEmailAddress(msg.from);
      if (!fromAddr || fromAddr === conn.google_email.toLowerCase()) continue; // skip our own sends

      // Match to a PO: thread first, then PO number in subject.
      let match = msg.threadId ? threadToPO.get(msg.threadId) : undefined;
      if (!match && msg.subject) {
        const m = msg.subject.match(/Purchase Order\s+(\S+)/i);
        if (m) match = poNumberToPO.get(m[1].toLowerCase());
      }
      if (!match) continue;

      const { error } = await admin
        .schema('supply_chain')
        .from('purchase_order_email_replies')
        .upsert(
          {
            tenant_id: args.tenantId,
            purchase_order_id: match.poId,
            po_email_id: match.emailId,
            connection_id: conn.id,
            gmail_message_id: msg.id,
            gmail_thread_id: msg.threadId,
            from_email: fromAddr,
            subject: msg.subject,
            snippet: msg.snippet,
            body_text: msg.bodyText,
            received_at: msg.receivedAt,
            last_event_id: crypto.randomUUID(),
          },
          { onConflict: 'tenant_id,gmail_message_id', ignoreDuplicates: true },
        )
        .select('id');
      if (!error) newReplies += 1;
    }
  }

  return { scannedConnections: connections.length, newReplies };
}
