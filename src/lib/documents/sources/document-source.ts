/**
 * DocumentSource — the ingestion abstraction.
 *
 * A source knows how to find and fetch candidate documents from an external
 * system (Gmail today; Outlook, carrier APIs, Amazon Business, or bank feeds
 * later). Everything downstream (extraction, matching, storage) consumes plain
 * RawDocument objects and never learns which source produced them — this is the
 * seam that keeps Gmail-specific logic out of purchasing.
 */
import type { RawDocument } from '../types';

export interface DocumentSearchQuery {
  /** Provider-native query string (e.g. a Gmail search expression). */
  raw: string;
  /** Only consider messages newer than this many days. */
  newerThanDays?: number;
  maxMessages?: number;
}

export interface DocumentSource {
  /** Stable provider name stored on each document ('gmail', 'outlook', …). */
  readonly name: string;
  /** Find + fetch candidate documents (attachments and/or bodies). */
  search(query: DocumentSearchQuery): Promise<RawDocument[]>;
}
