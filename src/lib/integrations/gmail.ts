/**
 * Gmail REST API helpers (no SDK; raw traced fetch).
 *
 * Sends a MIME message via users.messages.send and reads inbound messages via
 * users.messages.list / .get. All calls take an OAuth access token (minted from
 * a stored refresh token — see google-connections.ts) and a traced fetch impl.
 */
import { requireOk } from '@rocketmanv9/chassis/observability';

type FetchLike = typeof fetch;

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailAttachment {
  filename: string;
  mimeType: string;
  /** Raw bytes of the attachment. */
  content: Uint8Array;
}

export interface GmailSendParams {
  from: string;
  to: string;
  cc?: string[];
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: GmailAttachment[];
  /** Gmail threadId to reply within (keeps vendor replies threaded). */
  threadId?: string;
}

export interface GmailSendResult {
  id: string;
  threadId: string;
}

/** Base64url-encode a string or buffer (no padding), as Gmail requires for `raw`. */
function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** Standard base64 with 76-char line wrapping, for MIME attachment bodies. */
function base64Mime(bytes: Uint8Array): string {
  const b64 = Buffer.from(bytes).toString('base64');
  return b64.replace(/.{76}/g, '$&\r\n');
}

function isAscii(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) > 127) return false;
  }
  return true;
}

function encodeHeader(value: string): string {
  // RFC 2047 encode non-ASCII header values (e.g. accented company names).
  if (isAscii(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`;
}

/**
 * Build a base64url-encoded RFC 5322 MIME message suitable for Gmail's `raw`
 * field. Produces multipart/alternative (text + html), wrapped in
 * multipart/mixed when attachments are present.
 */
export function buildMimeMessage(p: GmailSendParams): string {
  const altBoundary = `alt_${Math.abs(hashString(p.subject + p.to)).toString(36)}_b`;
  const mixedBoundary = `mix_${Math.abs(hashString(p.to + p.subject)).toString(36)}_b`;
  const hasAttachments = !!p.attachments?.length;

  const headers: string[] = [
    `From: ${encodeHeader(p.from)}`,
    `To: ${p.to}`,
  ];
  if (p.cc?.length) headers.push(`Cc: ${p.cc.join(', ')}`);
  if (p.replyTo) headers.push(`Reply-To: ${p.replyTo}`);
  headers.push(`Subject: ${encodeHeader(p.subject)}`);
  headers.push('MIME-Version: 1.0');

  const text = p.text ?? stripHtml(p.html);

  const altPart =
    `Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n` +
    `--${altBoundary}\r\n` +
    `Content-Type: text/plain; charset="UTF-8"\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${base64Mime(new TextEncoder().encode(text))}\r\n\r\n` +
    `--${altBoundary}\r\n` +
    `Content-Type: text/html; charset="UTF-8"\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${base64Mime(new TextEncoder().encode(p.html))}\r\n\r\n` +
    `--${altBoundary}--`;

  let body: string;
  if (!hasAttachments) {
    body = `${headers.join('\r\n')}\r\n${altPart}`;
  } else {
    const parts: string[] = [
      `${headers.join('\r\n')}\r\n` +
        `Content-Type: multipart/mixed; boundary="${mixedBoundary}"\r\n\r\n` +
        `--${mixedBoundary}\r\n${altPart}\r\n\r\n`,
    ];
    for (const att of p.attachments!) {
      parts.push(
        `--${mixedBoundary}\r\n` +
          `Content-Type: ${att.mimeType}; name="${att.filename}"\r\n` +
          `Content-Transfer-Encoding: base64\r\n` +
          `Content-Disposition: attachment; filename="${att.filename}"\r\n\r\n` +
          `${base64Mime(att.content)}\r\n\r\n`,
      );
    }
    parts.push(`--${mixedBoundary}--`);
    body = parts.join('');
  }

  return base64Url(body);
}

export async function sendGmailMessage(
  fetchImpl: FetchLike,
  accessToken: string,
  params: GmailSendParams,
): Promise<GmailSendResult> {
  const raw = buildMimeMessage(params);
  const res = await fetchImpl(`${GMAIL_BASE}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params.threadId ? { raw, threadId: params.threadId } : { raw }),
  });
  await requireOk(res, 'Gmail send');
  const data = (await res.json()) as { id: string; threadId: string };
  return { id: data.id, threadId: data.threadId };
}

export interface GmailMessageRef {
  id: string;
  threadId: string;
}

export async function listGmailMessages(
  fetchImpl: FetchLike,
  accessToken: string,
  query: string,
  maxResults = 25,
): Promise<GmailMessageRef[]> {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const res = await fetchImpl(`${GMAIL_BASE}/messages?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await requireOk(res, 'Gmail list messages');
  const data = (await res.json()) as { messages?: GmailMessageRef[] };
  return data.messages ?? [];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string | null;
  to: string | null;
  subject: string | null;
  snippet: string | null;
  bodyText: string | null;
  receivedAt: string | null;
  labelIds: string[];
}

export async function getGmailMessage(
  fetchImpl: FetchLike,
  accessToken: string,
  id: string,
): Promise<GmailMessage> {
  const res = await fetchImpl(`${GMAIL_BASE}/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  await requireOk(res, 'Gmail get message');
  const data = (await res.json()) as any;

  const headers: Array<{ name: string; value: string }> = data.payload?.headers ?? [];
  const header = (n: string) =>
    headers.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? null;

  const internalDate = data.internalDate ? new Date(Number(data.internalDate)).toISOString() : null;

  return {
    id: data.id,
    threadId: data.threadId,
    from: header('From'),
    to: header('To'),
    subject: header('Subject'),
    snippet: data.snippet ?? null,
    bodyText: extractPlainText(data.payload),
    receivedAt: internalDate,
    labelIds: data.labelIds ?? [],
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function extractPlainText(payload: any): string | null {
  if (!payload) return null;
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }
  for (const part of payload.parts ?? []) {
    const found = extractPlainText(part);
    if (found) return found;
  }
  // Fall back to HTML stripped to text if no plain part exists.
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return stripHtml(Buffer.from(payload.body.data, 'base64url').toString('utf-8'));
  }
  return null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

/** Parse the bare email address out of a `Name <addr@x>` From header. */
export function parseEmailAddress(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/<([^>]+)>/);
  return (match ? match[1] : header).trim().toLowerCase();
}
