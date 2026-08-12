/**
 * Gmail implementation of DocumentSource.
 *
 * Wraps the existing raw-fetch Gmail helpers (src/lib/integrations/gmail.ts) —
 * reusing the OAuth/Vault token plumbing already in place — and turns matching
 * messages into RawDocuments: one per file attachment (PDF/image), plus the
 * email body itself as a fallback document when a message carries no usable
 * attachment (many receipts are HTML-only).
 */
import {
  listGmailMessages,
  getGmailMessage,
  getGmailAttachment,
  parseEmailAddress,
} from '@/lib/integrations/gmail';
import type { RawDocument } from '../types';
import type { DocumentSource, DocumentSearchQuery } from './document-source';

type FetchLike = typeof fetch;

const ATTACHMENT_TYPES = /^(application\/pdf|image\/(jpeg|jpg|png|webp|gif|heic|heif))/i;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export class GmailDocumentSource implements DocumentSource {
  readonly name = 'gmail';

  constructor(
    private readonly fetchImpl: FetchLike,
    private readonly accessToken: string,
  ) {}

  async search(query: DocumentSearchQuery): Promise<RawDocument[]> {
    const q = query.newerThanDays
      ? `(${query.raw}) newer_than:${query.newerThanDays}d`
      : query.raw;

    const refs = await listGmailMessages(this.fetchImpl, this.accessToken, q, query.maxMessages ?? 25);
    const out: RawDocument[] = [];

    for (const ref of refs) {
      let msg;
      try {
        msg = await getGmailMessage(this.fetchImpl, this.accessToken, ref.id);
      } catch {
        continue; // skip a message we can't read; keep collecting the rest
      }
      const sender = parseEmailAddress(msg.from);

      const usableAttachments = msg.attachments.filter(
        (a) => ATTACHMENT_TYPES.test(a.mimeType) && a.size <= MAX_ATTACHMENT_BYTES,
      );

      for (const att of usableAttachments) {
        let bytes: Uint8Array | null = null;
        try {
          bytes = await getGmailAttachment(this.fetchImpl, this.accessToken, msg.id, att.attachmentId);
        } catch {
          bytes = null;
        }
        if (!bytes || bytes.length === 0) continue;
        out.push({
          source: this.name,
          sourceRef: msg.id,
          sourceAttachmentId: att.attachmentId,
          senderEmail: sender,
          subject: msg.subject,
          receivedAt: msg.receivedAt,
          fileName: att.filename,
          contentType: att.mimeType,
          bytes,
          text: msg.bodyText,
          html: null,
        });
      }

      // Fallback: the message body itself as an HTML/text receipt.
      if (usableAttachments.length === 0 && (msg.bodyHtml || msg.bodyText)) {
        out.push({
          source: this.name,
          sourceRef: msg.id,
          sourceAttachmentId: null,
          senderEmail: sender,
          subject: msg.subject,
          receivedAt: msg.receivedAt,
          fileName: `${(msg.subject || 'email').slice(0, 60).replace(/[^\w.-]+/g, '_')}.html`,
          contentType: msg.bodyHtml ? 'text/html' : 'text/plain',
          bytes: null,
          text: msg.bodyText,
          html: msg.bodyHtml,
        });
      }
    }

    return out;
  }
}
