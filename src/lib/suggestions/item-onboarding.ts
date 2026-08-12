/**
 * Email → item onboarding suggestions.
 *
 * Scans recent purchase-looking Gmail messages on each tenant's connected
 * accounts, extracts line items with AI, drops anything already tracked in
 * inventory.catalog_items, and queues the rest in
 * inventory.item_onboarding_suggestions for Accept/Dismiss on
 * /inventory/item-suggestions.
 *
 * Idempotency: processed Gmail message ids are recorded in
 * inventory.item_suggestion_scanned_messages, so a message is only ever mined
 * once per tenant. Suggestions dedupe on (tenant_id, lower(item_name)) —
 * repeat sightings bump `occurrences`; accepted/dismissed rows are never
 * resurrected by later scans.
 */
import OpenAI from 'openai';
import { getAdminClient } from '@/utils/supabase/admin';
import {
  getAccessTokenForConnection,
  type GoogleConnectionRow,
} from '@/lib/integrations/google-connections';
import {
  listGmailMessages,
  getGmailMessage,
  parseEmailAddress,
} from '@/lib/integrations/gmail';

type FetchLike = typeof fetch;
type Logger = {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
};

const GMAIL_QUERY =
  '-in:chats -in:sent (subject:(order OR receipt OR invoice OR shipped OR confirmation) ' +
  'OR "order confirmation" OR "your order" OR "packing slip")';

const MAX_MESSAGES_PER_RUN = 10;
const MAX_CONNECTIONS_PER_TENANT = 3;
const MIN_CONFIDENCE = 0.5;

export interface ExtractedCandidate {
  name: string;
  description: string | null;
  quantity: number | null;
  unit_cost: number | null;
  vendor_name: string | null;
  confidence: number;
  rationale: string | null;
}

export interface TenantScanResult {
  tenantId: string;
  connectionsTried: number;
  messagesScanned: number;
  candidatesExtracted: number;
  suggestionsCreated: number;
  suggestionsBumped: number;
  skippedNoConnection: boolean;
  skippedNoOpenAI: boolean;
}

export interface AllTenantsScanResult {
  tenants: number;
  messagesScanned: number;
  suggestionsCreated: number;
  suggestionsBumped: number;
  errors: Array<{ tenantId: string; error: string }>;
  perTenant: TenantScanResult[];
}

const normalizeName = (name: string) =>
  name.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);

/** Extract untracked purchase line items from one email via OpenAI. */
async function extractCandidates(
  openai: OpenAI,
  email: { subject: string | null; from: string | null; body: string },
  catalogNames: string[],
): Promise<ExtractedCandidate[]> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0.1,
    max_tokens: 900,
    messages: [
      {
        role: 'system',
        content: [
          'You extract purchased products from order/receipt/invoice emails for an inventory system.',
          'Given an email, return a JSON object: {"items": [...]} where each item has:',
          '  name        — short canonical product name (e.g. "Nitrile Gloves XL", not the full SKU listing text)',
          '  description — one-sentence description, or null',
          '  quantity    — number purchased, or null',
          '  unit_cost   — per-unit price as a number, or null',
          '  vendor_name — the selling company, or null',
          '  confidence  — 0..1 that this is a real physical product purchase worth tracking in inventory',
          '  rationale   — one short sentence on why this is (or is not) worth tracking',
          '',
          'RULES:',
          '- ONLY physical products a construction/industrial company would stock: materials, parts, consumables, tools, safety gear, shop supplies.',
          '- EXCLUDE: services, subscriptions, software, shipping/tax lines, warranties, marketing emails with no actual purchase.',
          '- EXCLUDE anything that matches (or is clearly a variant of) an item already tracked. Already tracked:',
          catalogNames.length > 0 ? catalogNames.map((n) => `    * ${n}`).join('\n') : '    (nothing tracked yet)',
          '- If the email is not an actual purchase (newsletter, cart reminder, ad), return {"items": []}.',
          '- Return ONLY the JSON object, no markdown fences.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `From: ${email.from ?? '(unknown)'}`,
          `Subject: ${email.subject ?? '(none)'}`,
          '',
          email.body.slice(0, 12000),
        ].join('\n'),
      },
    ],
  });

  const content = completion.choices?.[0]?.message?.content ?? '';
  let jsonStr = content.trim();
  const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) jsonStr = fence[1].trim();

  try {
    const parsed = JSON.parse(jsonStr);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return items
      .filter((i: any) => typeof i?.name === 'string' && i.name.trim().length > 1)
      .map((i: any): ExtractedCandidate => ({
        name: i.name.trim().slice(0, 200),
        description: typeof i.description === 'string' ? i.description.slice(0, 500) : null,
        quantity: typeof i.quantity === 'number' && isFinite(i.quantity) ? i.quantity : null,
        unit_cost: typeof i.unit_cost === 'number' && isFinite(i.unit_cost) ? i.unit_cost : null,
        vendor_name: typeof i.vendor_name === 'string' ? i.vendor_name.slice(0, 200) : null,
        confidence: typeof i.confidence === 'number' ? Math.max(0, Math.min(1, i.confidence)) : 0,
        rationale: typeof i.rationale === 'string' ? i.rationale.slice(0, 500) : null,
      }));
  } catch {
    return [];
  }
}

/** Scan one tenant's connected mailboxes for item-onboarding candidates. */
export async function scanTenantForItemSuggestions(opts: {
  tenantId: string;
  fetchImpl: FetchLike;
  log: Logger;
  newerThanDays?: number;
  maxMessages?: number;
}): Promise<TenantScanResult> {
  const { tenantId, fetchImpl, log } = opts;
  const res: TenantScanResult = {
    tenantId, connectionsTried: 0, messagesScanned: 0, candidatesExtracted: 0,
    suggestionsCreated: 0, suggestionsBumped: 0, skippedNoConnection: false, skippedNoOpenAI: false,
  };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.skippedNoOpenAI = true; return res; }
  const openai = new OpenAI({ apiKey });

  const admin = getAdminClient();
  const sc = admin.schema('supply_chain');
  const inv = admin.schema('inventory');

  const { data: connections } = await sc
    .from('google_connections')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('revoked_at', null)
    .limit(MAX_CONNECTIONS_PER_TENANT);

  if (!connections || connections.length === 0) {
    res.skippedNoConnection = true;
    return res;
  }

  // Context loaded once per tenant: what's already tracked + vendor matching.
  const [{ data: catalogItems }, { data: vendorDomains }, { data: vendors }] = await Promise.all([
    inv.from('catalog_items').select('name').is('deleted_at', null).limit(500),
    sc.from('vendor_email_domains').select('vendor_id, domain').eq('tenant_id', tenantId).eq('is_active', true).limit(500),
    sc.from('vendors').select('id, name').eq('tenant_id', tenantId).limit(500),
  ]);
  const catalogNames: string[] = (catalogItems ?? []).map((c: any) => c.name);
  const domainToVendor = new Map<string, string>();
  for (const d of vendorDomains ?? []) domainToVendor.set(String(d.domain).toLowerCase(), d.vendor_id);
  const vendorByName = new Map<string, { id: string; name: string }>();
  for (const v of vendors ?? []) vendorByName.set(String(v.name).toLowerCase(), v);

  const days = opts.newerThanDays ?? 14;
  const query = `${GMAIL_QUERY} newer_than:${days}d`;
  const maxMessages = opts.maxMessages ?? MAX_MESSAGES_PER_RUN;

  for (const conn of connections as GoogleConnectionRow[]) {
    if (res.messagesScanned >= maxMessages) break;
    res.connectionsTried += 1;

    let accessToken: string;
    try {
      accessToken = await getAccessTokenForConnection(admin, conn, fetchImpl);
    } catch (err) {
      log.warn('item_suggestions.token_failed', { tenantId, connectionId: conn.id, error: (err as Error).message });
      continue;
    }

    let refs;
    try {
      refs = await listGmailMessages(fetchImpl, accessToken, query, 25);
    } catch (err) {
      log.warn('item_suggestions.list_failed', { tenantId, connectionId: conn.id, error: (err as Error).message });
      continue;
    }
    if (refs.length === 0) continue;

    // Skip anything this tenant has already mined.
    const { data: seen } = await inv
      .from('item_suggestion_scanned_messages')
      .select('message_id')
      .eq('tenant_id', tenantId)
      .in('message_id', refs.map((r) => r.id))
      .limit(refs.length);
    const seenIds = new Set((seen ?? []).map((s: any) => s.message_id));
    const fresh = refs.filter((r) => !seenIds.has(r.id));

    for (const ref of fresh) {
      if (res.messagesScanned >= maxMessages) break;

      let msg;
      try {
        msg = await getGmailMessage(fetchImpl, accessToken, ref.id);
      } catch {
        continue;
      }
      res.messagesScanned += 1;

      const body = msg.bodyText || msg.snippet || '';
      let candidates: ExtractedCandidate[] = [];
      if (body.trim().length > 20) {
        try {
          candidates = await extractCandidates(openai, { subject: msg.subject, from: msg.from, body }, catalogNames);
        } catch (err) {
          log.warn('item_suggestions.extract_failed', { tenantId, messageId: ref.id, error: (err as Error).message });
        }
      }

      const senderEmail = parseEmailAddress(msg.from);
      const senderDomain = senderEmail?.split('@')[1]?.toLowerCase() ?? null;

      for (const cand of candidates) {
        if (cand.confidence < MIN_CONFIDENCE) continue;
        res.candidatesExtracted += 1;

        const dedupeKey = normalizeName(cand.name);
        // Vendor match: sender-domain crosswalk first, then exact name.
        const vendorId =
          (senderDomain && domainToVendor.get(senderDomain)) ||
          (cand.vendor_name && vendorByName.get(cand.vendor_name.toLowerCase())?.id) ||
          null;

        const { data: existing } = await inv
          .from('item_onboarding_suggestions')
          .select('id, status, occurrences')
          .eq('tenant_id', tenantId)
          .eq('dedupe_key', dedupeKey)
          .limit(1)
          .maybeSingle();

        if (existing) {
          // Never resurrect accepted/dismissed suggestions; bump live ones.
          if (existing.status === 'suggested') {
            await inv
              .from('item_onboarding_suggestions')
              .update({
                occurrences: (existing.occurrences ?? 1) + 1,
                last_seen_at: new Date().toISOString(),
                unit_cost: cand.unit_cost ?? undefined,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existing.id)
              .eq('tenant_id', tenantId);
            res.suggestionsBumped += 1;
          }
        } else {
          const { error: insErr } = await inv
            .from('item_onboarding_suggestions')
            .upsert({
              tenant_id: tenantId,
              source: 'email',
              source_ref: ref.id,
              email_subject: msg.subject,
              email_from: msg.from,
              email_date: msg.receivedAt,
              vendor_id: vendorId,
              vendor_name: cand.vendor_name,
              item_name: cand.name,
              item_description: cand.description,
              quantity: cand.quantity,
              unit_cost: cand.unit_cost,
              confidence: cand.confidence,
              rationale: cand.rationale,
              dedupe_key: dedupeKey,
              last_event_id: `item-suggestion:${tenantId}:${dedupeKey}`,
            }, { onConflict: 'tenant_id,dedupe_key', ignoreDuplicates: true });
          if (!insErr) res.suggestionsCreated += 1;
        }
      }

      // Mark mined regardless of outcome so we never re-bill this message.
      await inv
        .from('item_suggestion_scanned_messages')
        .upsert(
          { tenant_id: tenantId, message_id: ref.id, connection_id: conn.id },
          { onConflict: 'tenant_id,message_id', ignoreDuplicates: true },
        );
    }
  }

  return res;
}

/** Cron entry point: scan every tenant that has an active Gmail connection. */
export async function scanAllTenantsForItemSuggestions(opts: {
  fetchImpl: FetchLike;
  log: Logger;
  maxTenants?: number;
}): Promise<AllTenantsScanResult> {
  const admin = getAdminClient();
  const { data: rows } = await admin
    .schema('supply_chain')
    .from('google_connections')
    .select('tenant_id')
    .is('revoked_at', null)
    .limit(200);

  const tenantIds = [...new Set((rows ?? []).map((r: any) => r.tenant_id))].slice(0, opts.maxTenants ?? 15);

  const out: AllTenantsScanResult = {
    tenants: 0, messagesScanned: 0, suggestionsCreated: 0, suggestionsBumped: 0, errors: [], perTenant: [],
  };

  for (const tenantId of tenantIds) {
    out.tenants += 1;
    try {
      const r = await scanTenantForItemSuggestions({ tenantId, fetchImpl: opts.fetchImpl, log: opts.log });
      out.messagesScanned += r.messagesScanned;
      out.suggestionsCreated += r.suggestionsCreated;
      out.suggestionsBumped += r.suggestionsBumped;
      out.perTenant.push(r);
    } catch (err) {
      out.errors.push({ tenantId, error: (err as Error).message });
    }
  }

  return out;
}
