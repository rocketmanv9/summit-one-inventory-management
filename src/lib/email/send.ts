/**
 * Transactional email sending via Resend (https://resend.com).
 *
 * Pass the route's injected (traced) `fetch` so calls show up in tracing.
 * Requires RESEND_API_KEY. The sender address (`from`) is supplied by the caller
 * — typically the requesting user's own address — and its DOMAIN must be verified
 * in Resend. ORDER_EMAIL_FROM is used as a fallback when no `from` is given.
 */
import { requireOk } from '@rocketmanv9/chassis/observability';
import { AppError } from '@rocketmanv9/chassis/errors';

type FetchLike = typeof fetch;

export interface SendEmailAttachment {
  filename: string;
  /** Base64-encoded file content. */
  content: string;
}

export interface SendEmailParams {
  /** Sender address, e.g. "Grant Anderson <grant@acmoate.com>". Domain must be Resend-verified. */
  from?: string;
  to: string;
  cc?: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: SendEmailAttachment[];
}

/** Whether email sending is configured in this environment. */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export async function sendEmail(
  fetchImpl: FetchLike,
  params: SendEmailParams,
): Promise<{ id: string | null }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw AppError.badRequest(
      'Email sending is not configured. Add RESEND_API_KEY (and ORDER_EMAIL_FROM, a Resend-verified sender) to the environment.',
    );
  }

  const from = params.from || process.env.ORDER_EMAIL_FROM;
  if (!from) {
    throw AppError.badRequest(
      'No sender address available. The signed-in user has no email, and no ORDER_EMAIL_FROM fallback is set.',
    );
  }

  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      cc: params.cc && params.cc.length > 0 ? params.cc : undefined,
      reply_to: params.replyTo || undefined,
      subject: params.subject,
      html: params.html,
      text: params.text,
      attachments:
        params.attachments && params.attachments.length > 0 ? params.attachments : undefined,
    }),
  });

  await requireOk(res, 'Resend send email');
  const data = await res.json().catch(() => ({} as any));
  return { id: data?.id ?? null };
}
