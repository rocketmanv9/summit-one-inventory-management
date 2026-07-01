/**
 * Receipt Collector orchestration + persistence.
 *
 * Ties the layers together for a single purchase order:
 *   1. Build a targeted Gmail search from the PO's identifiers + vendor domains.
 *   2. Pull candidate documents via the DocumentSource.
 *   3. Extract structured data (text-first, vision fallback).
 *   4. Refine with any vendor-specific parser.
 *   5. Score each document against the PO (confidence engine).
 *   6. Store the original file (private bucket) + a purchase_documents row.
 *   7. At ≥0.95 auto-reconcile the PO from the document (audited); 0.70–0.94 is
 *      left as a review suggestion; below that stays unmatched.
 *
 * Also exposes reconcileDocument(), which resolves the extracted line items to
 * PO lines and calls rpc_reconcile_po_from_document to write the real numbers
 * back onto the PO (so the on-the-fly PO PDF reflects actuals) with a full audit
 * trail.
 */
import crypto from 'crypto';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { getGoogleAccessTokenForUser } from '@/lib/integrations/google-connections';
import type { ExtractedDocument, PoMatchContext } from './types';
import { MATCH_AUTO_THRESHOLD, MATCH_SUGGEST_THRESHOLD } from './types';
import { getDocumentExtractor } from './extraction/extractor';
import { scoreDocumentAgainstPo } from './matching/engine';
import { resolveVendorParser, gmailHintsForVendor } from './vendors/registry';
import { GmailDocumentSource } from './sources/gmail-source';
import type { RawDocument } from './types';

type FetchLike = typeof fetch;
/** A supabase-js client that can reach supply_chain + storage (tenant-scoped). */
type Db = any;

const BUCKET = 'purchase-documents';
const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'me.com', 'live.com',
]);

/** PO statuses at which the vendor can no longer produce new documents. */
const TERMINAL_PO_STATUS = new Set(['cancelled', 'voided']);
/** PO statuses meaning the goods have arrived (order lifecycle effectively done). */
const RECEIVED_PO_STATUS = new Set(['received', 'fully_received', 'closed', 'partially_received']);

/** Document "rank" — a later, higher-rank document supersedes earlier lower ones. */
const DOC_RANK: Record<string, number> = {
  other: 0, warranty: 0,
  order_confirmation: 1, shipping_notification: 1,
  packing_slip: 2, delivery_confirmation: 2,
  receipt: 3, credit_memo: 3, invoice: 4,
};
/** Financial documents whose presence (once matched) closes out collection. */
const FINANCIAL_DOC_TYPES = new Set(['invoice', 'receipt', 'credit_memo']);

// ── PO context ────────────────────────────────────────────────────────────

export async function loadPoMatchContext(
  db: Db,
  tenantId: string,
  poId: string,
): Promise<{ ctx: PoMatchContext; vendorCode: string | null } | null> {
  const sc = db.schema('supply_chain');

  const { data: po } = await sc
    .from('purchase_orders')
    .select('id, po_number, external_order_number, vendor_id, vendor_name_snapshot, order_date')
    .eq('id', poId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!po) return null;

  const [{ data: lines }, { data: shipments }, { data: domains }] = await Promise.all([
    sc.from('purchase_order_lines')
      .select('qty_ordered, unit_cost, estimated_unit_cost')
      .eq('po_id', poId).eq('tenant_id', tenantId),
    sc.from('po_shipments')
      .select('tracking_number')
      .eq('purchase_order_id', poId).eq('tenant_id', tenantId),
    po.vendor_id
      ? sc.from('vendor_email_domains').select('domain').eq('vendor_id', po.vendor_id).eq('tenant_id', tenantId).eq('is_active', true)
      : Promise.resolve({ data: [] as { domain: string }[] }),
  ]);

  let vendorCode: string | null = null;
  if (po.vendor_id) {
    const { data: vendor } = await sc.from('vendors').select('code').eq('id', po.vendor_id).eq('tenant_id', tenantId).maybeSingle();
    vendorCode = vendor?.code ?? null;
  }

  const poTotal = (lines ?? []).reduce(
    (sum: number, l: any) => sum + Number(l.qty_ordered || 0) * Number(l.unit_cost ?? l.estimated_unit_cost ?? 0),
    0,
  );

  const ctx: PoMatchContext = {
    poId: po.id,
    poNumber: po.po_number,
    externalOrderNumber: po.external_order_number,
    vendorId: po.vendor_id,
    vendorName: po.vendor_name_snapshot,
    vendorDomains: (domains ?? []).map((d: any) => String(d.domain).toLowerCase()),
    poTotal: poTotal || null,
    orderDate: po.order_date,
    trackingNumbers: (shipments ?? []).map((s: any) => s.tracking_number).filter(Boolean),
  };
  return { ctx, vendorCode };
}

/** Build a targeted Gmail search expression for a PO. */
export function buildGmailQueryForPo(ctx: PoMatchContext, vendorCode: string | null): string {
  const terms: string[] = [`"${ctx.poNumber}"`];
  if (ctx.externalOrderNumber) terms.push(`"${ctx.externalOrderNumber}"`);

  const domains = ctx.vendorDomains.filter((d) => !GENERIC_EMAIL_DOMAINS.has(d));
  if (domains.length) terms.push(`from:(${domains.join(' OR ')})`);
  if (ctx.vendorName && ctx.vendorName.length > 2) terms.push(`"${ctx.vendorName}"`);

  for (const hint of gmailHintsForVendor(vendorCode, domains)) terms.push(hint);

  return `(${terms.join(' OR ')}) -in:sent -in:drafts`;
}

// ── Persistence ─────────────────────────────────────────────────────────────

function extForContentType(contentType: string, fileName: string): string {
  const fromName = fileName.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  const ct = contentType.toLowerCase();
  if (ct.includes('pdf')) return 'pdf';
  if (ct.includes('png')) return 'png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('html')) return 'html';
  if (ct.includes('webp')) return 'webp';
  return 'bin';
}

function bytesForStorage(raw: RawDocument): { buffer: Buffer; contentType: string } {
  if (raw.bytes && raw.bytes.length) return { buffer: Buffer.from(raw.bytes), contentType: raw.contentType };
  const body = raw.html ?? raw.text ?? '';
  return { buffer: Buffer.from(body, 'utf-8'), contentType: raw.html ? 'text/html' : 'text/plain' };
}

export interface PersistedDocument {
  id: string;
  match_status: string;
  match_confidence: number;
  doc_type: string;
}

/**
 * Upload a raw document's original file to the private bucket and insert its
 * purchase_documents row with the extracted data + match result.
 */
async function persistDocument(
  db: Db,
  tenantId: string,
  poId: string | null,
  vendorId: string | null,
  raw: RawDocument,
  extracted: ExtractedDocument,
  match: { confidence: number; signals: Record<string, number> },
  matchStatus: string,
): Promise<PersistedDocument> {
  const id = crypto.randomUUID();
  const { buffer, contentType } = bytesForStorage(raw);
  const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const ext = extForContentType(contentType, raw.fileName);
  const folder = poId ?? 'unmatched';
  const storagePath = `${tenantId}/${folder}/${id}.${ext}`;

  const { error: upErr } = await db.storage.from(BUCKET).upload(storagePath, buffer, { contentType, upsert: true });
  if (upErr) throw AppError.internal(`Document storage upload failed: ${upErr.message}`);

  const row = {
    id,
    tenant_id: tenantId,
    purchase_order_id: poId,
    doc_type: extracted.doc_type,
    source: raw.source,
    source_ref: raw.sourceRef,
    source_attachment_id: raw.sourceAttachmentId,
    sender_email: raw.senderEmail,
    subject: raw.subject,
    document_date: extracted.document_date,
    storage_path: storagePath,
    file_name: raw.fileName,
    content_type: contentType,
    byte_size: buffer.length,
    content_hash: contentHash,
    vendor_id: vendorId,
    vendor_name: extracted.vendor_name,
    po_number_detected: extracted.po_number,
    order_number: extracted.order_number,
    invoice_number: extracted.invoice_number,
    receipt_number: extracted.receipt_number,
    tracking_numbers: extracted.tracking_numbers,
    subtotal: extracted.subtotal,
    tax: extracted.tax,
    shipping: extracted.shipping,
    total: extracted.total,
    currency: extracted.currency ?? 'USD',
    payment_method: extracted.payment_method,
    store_number: extracted.store_number,
    line_items: extracted.line_items,
    extracted: extracted as unknown as Record<string, unknown>,
    extraction_status: extracted.method === 'unsupported' ? 'unsupported' : 'extracted',
    match_status: matchStatus,
    match_confidence: match.confidence,
    match_signals: match.signals,
    matched_at: matchStatus === 'matched' || matchStatus === 'suggested' ? new Date().toISOString() : null,
    last_event_id: id,
  };

  const { error: insErr } = await db.schema('supply_chain').from('purchase_documents').insert(row);
  if (insErr) throw AppError.internal(`Failed to save document: ${insErr.message}`);

  return { id, match_status: matchStatus, match_confidence: match.confidence, doc_type: extracted.doc_type };
}

/** Has this exact source document already been collected? */
async function alreadyCollected(db: Db, tenantId: string, raw: RawDocument): Promise<boolean> {
  const { data } = await db.schema('supply_chain')
    .from('purchase_documents')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('source', raw.source)
    .eq('source_ref', raw.sourceRef ?? '')
    .is('source_attachment_id', raw.sourceAttachmentId ?? null)
    .limit(1)
    .maybeSingle();
  return !!data;
}

// ── Collection ────────────────────────────────────────────────────────────

export interface CollectResult {
  scanned: number;
  collected: number;
  matched: number;
  suggested: number;
  reconciled: number;
  documents: PersistedDocument[];
}

export interface CollectParams {
  db: Db;
  fetchImpl: FetchLike;
  accessToken: string;
  tenantId: string;
  userId: string;
  poId: string;
  newerThanDays?: number;
  maxMessages?: number;
  /** Auto-reconcile invoices/receipts that score ≥ 0.95 (default true). */
  autoReconcile?: boolean;
}

export async function collectForPurchaseOrder(params: CollectParams): Promise<CollectResult> {
  const { db, fetchImpl, accessToken, tenantId, userId, poId } = params;
  const loaded = await loadPoMatchContext(db, tenantId, poId);
  if (!loaded) throw AppError.notFound('Purchase order not found.');
  const { ctx, vendorCode } = loaded;

  const source = new GmailDocumentSource(fetchImpl, accessToken);
  const raws = await source.search({
    raw: buildGmailQueryForPo(ctx, vendorCode),
    newerThanDays: params.newerThanDays ?? 60,
    maxMessages: params.maxMessages ?? 25,
  });

  const extractor = getDocumentExtractor();
  const result: CollectResult = { scanned: raws.length, collected: 0, matched: 0, suggested: 0, reconciled: 0, documents: [] };

  for (const raw of raws) {
    if (await alreadyCollected(db, tenantId, raw)) continue;

    let extracted = await extractor.extract({
      fileName: raw.fileName,
      contentType: raw.contentType,
      bytes: raw.bytes,
      text: raw.text,
      html: raw.html,
      subject: raw.subject,
      senderEmail: raw.senderEmail,
    });

    const parser = resolveVendorParser(raw.senderEmail, vendorCode);
    if (parser) extracted = parser.refine(extracted, { senderEmail: raw.senderEmail, subject: raw.subject, vendorCode });

    const match = scoreDocumentAgainstPo(extracted, ctx, raw.senderEmail);

    let matchStatus = 'unmatched';
    let linkedPo: string | null = null;
    if (match.confidence >= MATCH_AUTO_THRESHOLD) { matchStatus = 'matched'; linkedPo = poId; }
    else if (match.confidence >= MATCH_SUGGEST_THRESHOLD) { matchStatus = 'suggested'; linkedPo = poId; }

    const persisted = await persistDocument(db, tenantId, linkedPo, ctx.vendorId, raw, extracted, match, matchStatus);
    result.collected += 1;
    result.documents.push(persisted);
    if (matchStatus === 'matched') result.matched += 1;
    if (matchStatus === 'suggested') result.suggested += 1;

    // Auto-reconcile high-confidence invoices/receipts.
    const reconcilable = extracted.doc_type === 'invoice' || extracted.doc_type === 'receipt' || extracted.doc_type === 'credit_memo';
    if (matchStatus === 'matched' && reconcilable && (params.autoReconcile ?? true)) {
      try {
        await reconcileDocument(db, tenantId, persisted.id, userId);
        result.reconciled += 1;
      } catch {
        // Leave it matched-but-unreconciled for manual review rather than fail the run.
      }
    }
  }

  // Let a better document (e.g. the invoice) supersede earlier lower-rank ones.
  if (result.collected > 0) await applySupersession(db, tenantId, poId).catch(() => {});

  return result;
}

/**
 * When multiple documents are linked to a PO, mark the lower-rank ones that are
 * still just "matched"/"suggested" (and not reconciled) as superseded by the
 * highest-rank document present — e.g. an invoice supersedes the earlier order
 * confirmation. Reconciled documents are never superseded.
 */
export async function applySupersession(db: Db, tenantId: string, poId: string): Promise<void> {
  const sc = db.schema('supply_chain');
  const { data: docs } = await sc
    .from('purchase_documents')
    .select('id, doc_type, match_status, reconciled_at')
    .eq('tenant_id', tenantId)
    .eq('purchase_order_id', poId)
    .in('match_status', ['matched', 'suggested']);
  if (!docs || docs.length < 2) return;

  const ranked = docs.map((d: any) => ({ ...d, rank: DOC_RANK[d.doc_type] ?? 0 }));
  const maxRank = Math.max(...ranked.map((d: any) => d.rank));
  const keeper = ranked.find((d: any) => d.rank === maxRank);
  if (!keeper) return;

  const losers = ranked.filter((d: any) => d.rank < maxRank && !d.reconciled_at).map((d: any) => d.id);
  if (!losers.length) return;

  await sc.from('purchase_documents')
    .update({ match_status: 'superseded', superseded_by_document_id: keeper.id, updated_at: new Date().toISOString() })
    .in('id', losers)
    .eq('tenant_id', tenantId);
}

/** Whether a PO's document collection is "done" (financial doc + goods arrived). */
export async function evaluatePoCollectionComplete(db: Db, tenantId: string, poId: string, poStatus: string): Promise<boolean> {
  if (TERMINAL_PO_STATUS.has((poStatus || '').toLowerCase())) return true;

  const sc = db.schema('supply_chain');
  const { data: fin } = await sc
    .from('purchase_documents')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('purchase_order_id', poId)
    .in('doc_type', Array.from(FINANCIAL_DOC_TYPES))
    .in('match_status', ['matched'])
    .limit(1)
    .maybeSingle();
  if (!fin) return false;

  if (RECEIVED_PO_STATUS.has((poStatus || '').toLowerCase())) return true;

  // Or a delivered shipment.
  const { data: delivered } = await sc
    .from('po_shipments')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('purchase_order_id', poId)
    .not('delivery_date', 'is', null)
    .limit(1)
    .maybeSingle();
  return !!delivered;
}

// ── Tenant-wide background collection (cron) ────────────────────────────────

export interface TenantCollectResult {
  tenantId: string;
  posScanned: number;
  collected: number;
  matched: number;
  reconciled: number;
  completed: number;
  skippedNoConnection: boolean;
}

export interface TenantCollectParams {
  db: Db;            // admin (service-role) client
  fetchImpl: FetchLike;
  tenantId: string;
  maxPos?: number;
  newerThanDays?: number;
}

/**
 * Sweep a tenant's open POs for new documents. Runs from the collection cron.
 * Uses each PO creator's (or the tenant shared mailbox's) Gmail connection; if
 * the tenant has no usable connection at all, returns early.
 */
export async function collectForTenant(params: TenantCollectParams): Promise<TenantCollectResult> {
  const { db, fetchImpl, tenantId } = params;
  const res: TenantCollectResult = {
    tenantId, posScanned: 0, collected: 0, matched: 0, reconciled: 0, completed: 0, skippedNoConnection: false,
  };

  const { data: pos } = await db.schema('supply_chain')
    .from('purchase_orders')
    .select('id, status, created_by_user_id')
    .eq('tenant_id', tenantId)
    .eq('docs_collection_complete', false)
    .order('docs_last_collected_at', { ascending: true, nullsFirst: true })
    .limit(params.maxPos ?? 15);

  for (const po of (pos ?? [])) {
    if (TERMINAL_PO_STATUS.has((po.status || '').toLowerCase())) {
      await markCollected(db, tenantId, po.id, true);
      continue;
    }

    let accessToken: string;
    try {
      const tok = await getGoogleAccessTokenForUser(tenantId, po.created_by_user_id, { fetchImpl });
      accessToken = tok.accessToken;
    } catch {
      // No connection for this user/tenant — no point trying the rest.
      res.skippedNoConnection = true;
      break;
    }

    res.posScanned += 1;
    try {
      const c = await collectForPurchaseOrder({
        db, fetchImpl, accessToken, tenantId,
        userId: po.created_by_user_id, poId: po.id,
        newerThanDays: params.newerThanDays ?? 90,
      });
      res.collected += c.collected;
      res.matched += c.matched;
      res.reconciled += c.reconciled;
    } catch {
      // isolate a failing PO; keep sweeping the rest
    }

    const complete = await evaluatePoCollectionComplete(db, tenantId, po.id, po.status).catch(() => false);
    await markCollected(db, tenantId, po.id, complete);
    if (complete) res.completed += 1;
  }

  return res;
}

async function markCollected(db: Db, tenantId: string, poId: string, complete: boolean): Promise<void> {
  await db.schema('supply_chain')
    .from('purchase_orders')
    .update({ docs_last_collected_at: new Date().toISOString(), docs_collection_complete: complete })
    .eq('id', poId)
    .eq('tenant_id', tenantId);
}

export interface AllTenantsCollectResult {
  tenants: number;
  collected: number;
  matched: number;
  reconciled: number;
  completed: number;
  perTenant: TenantCollectResult[];
}

/**
 * Fan out background collection across every tenant with an active Gmail
 * connection. Entry point for the collection cron.
 */
export async function collectAllTenants(opts: {
  fetchImpl: FetchLike;
  maxTenants?: number;
  maxPosPerTenant?: number;
  newerThanDays?: number;
}): Promise<AllTenantsCollectResult> {
  const admin = getAdminClient();
  const { data: conns } = await admin
    .schema('supply_chain')
    .from('google_connections')
    .select('tenant_id')
    .is('revoked_at', null);

  const tenantIds = Array.from(new Set((conns ?? []).map((c: any) => c.tenant_id))).slice(0, opts.maxTenants ?? 15);
  const perTenant: TenantCollectResult[] = [];
  for (const tenantId of tenantIds) {
    try {
      perTenant.push(await collectForTenant({
        db: admin,
        fetchImpl: opts.fetchImpl,
        tenantId,
        maxPos: opts.maxPosPerTenant,
        newerThanDays: opts.newerThanDays,
      }));
    } catch {
      // skip a failing tenant
    }
  }

  return {
    tenants: tenantIds.length,
    collected: perTenant.reduce((a, r) => a + r.collected, 0),
    matched: perTenant.reduce((a, r) => a + r.matched, 0),
    reconciled: perTenant.reduce((a, r) => a + r.reconciled, 0),
    completed: perTenant.reduce((a, r) => a + r.completed, 0),
    perTenant,
  };
}

// ── Manual upload ───────────────────────────────────────────────────────────

export interface UploadParams {
  db: Db;
  tenantId: string;
  poId: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  /** Optional caller-asserted document type override. */
  docTypeHint?: string;
}

/**
 * Ingest a manually-uploaded document for a PO: extract it, link it to the PO
 * (user-asserted match), and store it as a review suggestion. Reconciliation is
 * an explicit follow-up action so a manual upload never silently rewrites a PO.
 */
export async function ingestUploadedDocument(params: UploadParams): Promise<PersistedDocument> {
  const { db, tenantId, poId } = params;
  const loaded = await loadPoMatchContext(db, tenantId, poId);
  if (!loaded) throw AppError.notFound('Purchase order not found.');
  const { ctx } = loaded;

  const raw: RawDocument = {
    source: 'upload',
    sourceRef: crypto.randomUUID(),
    sourceAttachmentId: null,
    senderEmail: null,
    subject: params.fileName,
    receivedAt: new Date().toISOString(),
    fileName: params.fileName,
    contentType: params.contentType,
    bytes: params.bytes,
    text: null,
    html: null,
  };

  let extracted = await getDocumentExtractor().extract({
    fileName: raw.fileName,
    contentType: raw.contentType,
    bytes: raw.bytes,
    text: null,
    html: null,
    subject: raw.subject,
    senderEmail: null,
  });
  if (params.docTypeHint) extracted = { ...extracted, doc_type: params.docTypeHint as any };

  // The user explicitly attached this to the PO — score for explainability but
  // link regardless, and hold at 'suggested' pending an explicit reconcile.
  const match = scoreDocumentAgainstPo(extracted, ctx, null);
  match.confidence = Math.max(match.confidence, 0.9);

  return persistDocument(db, tenantId, poId, ctx.vendorId, raw, extracted, match, 'suggested');
}

// ── Reconciliation ──────────────────────────────────────────────────────────

function norm(s: string | null | undefined): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Resolve extracted line items to PO lines and write the document's actuals back
 * onto the PO via rpc_reconcile_po_from_document (audited + reversible).
 */
export async function reconcileDocument(
  db: Db,
  tenantId: string,
  documentId: string,
  userId: string,
): Promise<any> {
  const sc = db.schema('supply_chain');

  const { data: doc } = await sc.from('purchase_documents').select('*').eq('id', documentId).eq('tenant_id', tenantId).maybeSingle();
  if (!doc) throw AppError.notFound('Document not found.');
  if (!doc.purchase_order_id) throw AppError.badRequest('Document is not matched to a purchase order yet.');

  const { data: poLines } = await sc
    .from('purchase_order_lines')
    .select('id, line_number, item_description, item_vendor_sku, unit_cost')
    .eq('po_id', doc.purchase_order_id)
    .eq('tenant_id', tenantId)
    .order('line_number', { ascending: true });

  const items: any[] = Array.isArray(doc.line_items) ? doc.line_items : [];
  const lineUpdates: Array<{ po_line_id: string; unit_cost: number }> = [];
  const usedItems = new Set<number>();

  for (let i = 0; i < (poLines ?? []).length; i++) {
    const line = poLines[i];
    let idx = -1;
    // (a) SKU match
    if (line.item_vendor_sku) {
      idx = items.findIndex((it, j) => !usedItems.has(j) && it?.sku && norm(it.sku) === norm(line.item_vendor_sku));
    }
    // (b) description overlap
    if (idx < 0 && line.item_description) {
      const target = norm(line.item_description);
      idx = items.findIndex((it, j) => {
        if (usedItems.has(j) || !it?.description) return false;
        const d = norm(it.description);
        return d.length > 3 && (d.includes(target) || target.includes(d));
      });
    }
    // (c) positional fallback only when counts line up exactly
    if (idx < 0 && items.length === (poLines ?? []).length) {
      if (!usedItems.has(i)) idx = i;
    }
    if (idx >= 0) {
      const unit = items[idx]?.unit_price;
      if (typeof unit === 'number' && unit >= 0) {
        usedItems.add(idx);
        lineUpdates.push({ po_line_id: line.id, unit_cost: unit });
      }
    }
  }

  const header: Record<string, unknown> = {};
  if (doc.order_number) header.external_order_number = doc.order_number;
  if (doc.doc_type === 'delivery_confirmation' && doc.document_date) header.expected_delivery_date = doc.document_date;

  const expense = {
    amount: doc.total,
    tax: doc.tax,
    invoice_number: doc.invoice_number || doc.receipt_number || null,
    receipt_url: doc.storage_path,
    expense_date: doc.document_date,
  };

  const { data, error } = await sc.rpc('rpc_reconcile_po_from_document', {
    p_tenant_id: tenantId,
    p_document_id: documentId,
    p_line_updates: lineUpdates,
    p_header: header,
    p_expense: expense,
    p_actor: userId,
  });
  if (error) throw AppError.internal(`Reconciliation failed: ${error.message}`);
  return data;
}

/** Generate short-lived signed URLs for a set of storage paths. */
export async function signedUrlsFor(db: Db, paths: string[], expiresSec = 300): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    paths.filter(Boolean).map(async (p) => {
      const { data } = await db.storage.from(BUCKET).createSignedUrl(p, expiresSec);
      if (data?.signedUrl) out[p] = data.signedUrl;
    }),
  );
  return out;
}
