/**
 * Spend-management / expense-platform DocumentSource (EXTENSION STUB).
 *
 * Demonstrates how a non-email provider — Bank of America Spend Management, a
 * corporate-card feed, or another expense platform — plugs into the exact same
 * pipeline as Gmail. It implements `DocumentSource`, so the extractor, matching
 * engine, storage, and reconciliation stages consume its output unchanged.
 *
 * This is intentionally inert until credentials are configured; `search()`
 * returns [] when unconfigured so wiring it into the collector is a no-op in
 * environments without the integration. See docs/receipt-collector.md for the
 * BofA integration options (transaction feed as a source, and/or pushing our
 * stored receipt images back to BofA's receipt store as a sink).
 */
import { AppError } from '@rocketmanv9/chassis/errors';
import type { RawDocument } from '../types';
import type { DocumentSource, DocumentSearchQuery } from './document-source';

type FetchLike = typeof fetch;

export interface SpendManagementConfig {
  /** Provider identifier stored on documents, e.g. 'bofa_spend' or 'expense'. */
  provider: string;
  apiBaseUrl?: string;
  apiKey?: string;
  accountId?: string;
}

export class SpendManagementDocumentSource implements DocumentSource {
  readonly name: string;

  constructor(
    private readonly config: SpendManagementConfig,
    private readonly fetchImpl: FetchLike,
  ) {
    this.name = config.provider;
    void this.fetchImpl; // retained for the future API implementation
  }

  /** Whether this source has enough configuration to run. */
  isConfigured(): boolean {
    return !!(this.config.apiBaseUrl && this.config.apiKey);
  }

  async search(_query: DocumentSearchQuery): Promise<RawDocument[]> {
    if (!this.isConfigured()) return [];
    // Future: call the expense platform's transactions/receipts API, download
    // each receipt image/PDF, and map to RawDocument (source = this.name). Every
    // downstream stage then treats it identically to a Gmail attachment.
    throw AppError.internal(`${this.name}: transaction/receipt ingestion not yet implemented.`);
  }
}
