/**
 * POST /api/inventory/price-wars/ingest-replies
 *   { round_id?, lookback_days?, message?: { from, subject, body, message_id?, thread_id?, received_at? } }
 *
 * The inbox monitor. Once RFQs are out (send-invites), this reads the vendor
 * replies sitting in the tenant's monitored mailbox, matches each back to an
 * open round's bid by the correlation token stamped in the RFQ subject/body
 * (falling back to the vendor's contact_email against open-round bids), runs the
 * reply through the SAME extractor the buyer-paste path uses, and records the
 * quoted price on the bid — flipping it invited → quoted. A reply with no
 * parseable price is flagged "reply received, price unclear" for a human glance;
 * a number is never guessed.
 *
 * IDEMPOTENT. Every message we look at is written once into
 * supply_chain.quote_round_reply_events keyed on (tenant, provider_message_id),
 * so a re-poll never double-posts a price.
 *
 * Two ways in:
 *   - live: scan Gmail (`lookback_days`, default 14) across the tenant's
 *     connections — the real monitor.
 *   - crafted: pass a `message` payload directly — lets a verifier prove the
 *     ingest→extract→rank→recommend path without live mail (same honest bar as
 *     item 03's send proof), and lets a webhook push a single reply in.
 *
 * Requires `purchase_orders.manage`.
 */

import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';
import { getAdminClient } from '@/utils/supabase/admin';
import {
  getSharedMailboxes,
  getUserConnection,
  getAccessTokenForConnection,
  type GoogleConnectionRow,
} from '@/lib/integrations/google-connections';
import { listGmailMessages, getGmailMessage, parseEmailAddress } from '@/lib/integrations/gmail';
import { extractQuoteFromText } from '@/lib/price-wars-extract';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const BodySchema = z.object({
  /** Narrow the scan/match to one open round. Omitted = every open round. */
  round_id: z.string().uuid().optional(),
  /** How many days of inbound mail to scan. Default 14. */
  lookback_days: z.number().int().min(1).max(90).optional(),
  /** A crafted inbound reply, for webhook push or verification without live mail. */
  message: z.object({
    from: z.string().max(320).nullable().optional(),
    subject: z.string().max(2000).nullable().optional(),
    body: z.string().min(1).max(50000),
    message_id: z.string().max(500).optional(),
    thread_id: z.string().max(500).nullable().optional(),
    received_at: z.string().max(64).nullable().optional(),
  }).optional(),
});

/** A vendor reply reduced to what matching + extraction need. */
interface InboundReply {
  provider: 'gmail' | 'manual';
  messageId: string;
  threadId: string | null;
  fromEmail: string | null;
  subject: string | null;
  bodyText: string | null;
  snippet: string | null;
  receivedAt: string | null;
}

/** Pull `[pw:<round_id>:<bid_id>]` out of a subject/body, if present. */
function parseToken(text: string | null): { roundId: string; bidId: string } | null {
  if (!text) return null;
  const m = text.match(/\[pw:([0-9a-fA-F-]{36}):([0-9a-fA-F-]{36})\]/);
  if (!m) return null;
  return { roundId: m[1].toLowerCase(), bidId: m[2].toLowerCase() };
}

interface OpenBid {
  id: string;
  round_id: string;
  vendor_id: string;
  tenant_id: string;
  status: string;
  contact_email: string | null;
  correlation_token: string | null;
  baseline_unit_cost: number | null;
  current_quote: number | null;
  quote_history: any;
  round_target_qty: number | null;
  round_catalog_item_id: string;
  vendor_name: string;
  vendor_contact_email: string | null;
  item_name: string | null;
}

type IngestOutcome =
  | 'recorded'
  | 'price_unclear'
  | 'declined'
  | 'unmatched'
  | 'duplicate_bid'
  | 'already_seen';

interface ReplyResult {
  message_id: string;
  from: string | null;
  matched_by: 'token' | 'email' | null;
  round_id: string | null;
  bid_id: string | null;
  vendor_name: string | null;
  outcome: IngestOutcome;
  unit_cost: number | null;
  confidence: number | null;
}

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, fetch, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const body = BodySchema.parse(await req.json().catch(() => ({})));
  const tenantId = ctx.tenantId!;
  const userId = ctx.userId!;
  const sc = (supabase as any).schema('supply_chain');
  const admin = getAdminClient();

  // ── Load open bids in scope (the match targets) ────────────────────────────
  let roundQuery = sc
    .from('quote_rounds')
    .select('id, target_qty, catalog_item_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
    .limit(500);
  if (body.round_id) roundQuery = roundQuery.eq('id', body.round_id);
  const { data: openRounds, error: rErr } = await roundQuery;
  if (rErr) throw AppError.internal(rErr.message);

  if (!openRounds || openRounds.length === 0) {
    return {
      data: { scanned: 0, matched: 0, recorded: 0, unclear: 0, unmatched: 0, results: [] as ReplyResult[],
        message: body.round_id ? 'That round is not open — nothing to ingest.' : 'No open price wars to match replies against.' },
      status: 200,
      events: [],
    };
  }

  const roundIds = openRounds.map((r: any) => r.id);
  const roundById = new Map<string, any>(openRounds.map((r: any) => [r.id, r]));

  const { data: bidRows, error: bErr } = await sc
    .from('quote_round_bids')
    .select('id, round_id, vendor_id, tenant_id, status, contact_email, correlation_token, baseline_unit_cost, current_quote, quote_history')
    .in('round_id', roundIds)
    .limit(5000);
  if (bErr) throw AppError.internal(bErr.message);

  // Enrich with vendor + item names (extractor context, honest results).
  const vendorIds = [...new Set((bidRows ?? []).map((b: any) => b.vendor_id))];
  const itemIds = [...new Set(openRounds.map((r: any) => r.catalog_item_id))];
  const [{ data: vendors }, { data: items }] = await Promise.all([
    vendorIds.length
      ? sc.from('vendors').select('id, name, contact_email, po_email').in('id', vendorIds).limit(5000)
      : Promise.resolve({ data: [] }),
    itemIds.length
      ? supabase.schema('inventory').from('catalog_items').select('id, name').in('id', itemIds).limit(5000)
      : Promise.resolve({ data: [] }),
  ]);
  const vendorMap = new Map<string, any>((vendors ?? []).map((v: any) => [v.id, v]));
  const itemMap = new Map<string, any>((items ?? []).map((i: any) => [i.id, i]));

  const bids: OpenBid[] = (bidRows ?? []).map((b: any) => {
    const round = roundById.get(b.round_id);
    const v = vendorMap.get(b.vendor_id);
    return {
      ...b,
      round_target_qty: round?.target_qty ?? null,
      round_catalog_item_id: round?.catalog_item_id,
      vendor_name: v?.name ?? 'Vendor',
      vendor_contact_email: (v?.contact_email ?? v?.po_email ?? null),
      item_name: itemMap.get(round?.catalog_item_id)?.name ?? null,
    };
  });

  const bidById = new Map<string, OpenBid>(bids.map((b) => [b.id, b]));
  const bidByToken = new Map<string, OpenBid>();
  for (const b of bids) if (b.correlation_token) bidByToken.set(b.correlation_token.toLowerCase(), b);
  // Email → the invited bids that vendor could be replying to (open rounds only).
  const bidsByEmail = new Map<string, OpenBid[]>();
  for (const b of bids) {
    const email = (b.contact_email ?? b.vendor_contact_email ?? '').trim().toLowerCase();
    if (!email) continue;
    if (!bidsByEmail.has(email)) bidsByEmail.set(email, []);
    bidsByEmail.get(email)!.push(b);
  }

  // ── Gather inbound replies (crafted payload, or live Gmail scan) ───────────
  const replies: InboundReply[] = [];
  if (body.message) {
    const m = body.message;
    replies.push({
      provider: 'manual',
      messageId: m.message_id ?? `manual-${idempotencyKey}`,
      threadId: m.thread_id ?? null,
      fromEmail: parseEmailAddress(m.from ?? null),
      subject: m.subject ?? null,
      bodyText: m.body,
      snippet: m.body.slice(0, 200),
      receivedAt: m.received_at ?? new Date().toISOString(),
    });
  } else {
    const lookback = body.lookback_days ?? 14;
    const connections: GoogleConnectionRow[] = [];
    const personal = await getUserConnection(admin, tenantId, userId);
    if (personal) connections.push(personal);
    connections.push(...(await getSharedMailboxes(admin, tenantId)));
    for (const conn of connections) {
      let accessToken: string;
      try {
        accessToken = await getAccessTokenForConnection(admin, conn, fetch);
      } catch {
        continue;
      }
      let refs;
      try {
        refs = await listGmailMessages(fetch, accessToken, `newer_than:${lookback}d -in:sent -in:drafts`, 50);
      } catch (e: any) {
        log.error('price_wars.ingest_list_failed', { error: e?.message });
        continue;
      }
      for (const ref of refs) {
        let msg;
        try {
          msg = await getGmailMessage(fetch, accessToken, ref.id);
        } catch {
          continue;
        }
        const fromAddr = parseEmailAddress(msg.from);
        if (!fromAddr || fromAddr === conn.google_email.toLowerCase()) continue; // skip our own sends
        replies.push({
          provider: 'gmail',
          messageId: msg.id,
          threadId: msg.threadId,
          fromEmail: fromAddr,
          subject: msg.subject,
          bodyText: msg.bodyText,
          snippet: msg.snippet,
          receivedAt: msg.receivedAt,
        });
      }
    }
  }

  // ── Match + extract + record, one reply at a time ──────────────────────────
  const now = new Date().toISOString();
  const results: ReplyResult[] = [];
  const events: any[] = [];
  let recorded = 0;
  let unclear = 0;
  let unmatched = 0;
  let matched = 0;

  for (const reply of replies) {
    // Dedupe: claim the message id first. ignoreDuplicates → a row comes back
    // only when this message is genuinely new to price-wars ingest.
    const { data: claimed } = await sc
      .from('quote_round_reply_events')
      .upsert(
        {
          tenant_id: tenantId,
          provider: reply.provider === 'manual' ? 'manual' : 'gmail',
          provider_message_id: reply.messageId,
          provider_thread_id: reply.threadId,
          from_email: reply.fromEmail,
          subject: reply.subject,
          snippet: reply.snippet,
          received_at: reply.receivedAt,
          outcome: 'pending',
          last_event_id: `${idempotencyKey}:${reply.messageId}`,
        },
        { onConflict: 'tenant_id,provider_message_id', ignoreDuplicates: true },
      )
      .select('id');
    const eventRow = claimed?.[0];
    if (!eventRow) {
      // Already ingested on an earlier poll — don't touch the bid again.
      results.push({ message_id: reply.messageId, from: reply.fromEmail, matched_by: null, round_id: null, bid_id: null, vendor_name: null, outcome: 'already_seen', unit_cost: null, confidence: null });
      continue;
    }

    // 1) Match: token first (subject or body), then vendor email.
    let matchedBy: 'token' | 'email' | null = null;
    let bid: OpenBid | null = null;
    const token = parseToken(reply.subject) ?? parseToken(reply.bodyText);
    if (token) {
      // Match the exact bid; prefer the token's bid id, but verify it's in scope.
      const byId = bidById.get(token.bidId);
      const byTok = bidByToken.get(token.bidId) ?? bidByToken.get(token.roundId);
      const candidate = byId ?? byTok ?? null;
      if (candidate && (!body.round_id || candidate.round_id === body.round_id)) {
        bid = candidate;
        matchedBy = 'token';
      }
    }
    if (!bid && reply.fromEmail) {
      const candidates = bidsByEmail.get(reply.fromEmail) ?? [];
      // Only auto-match on email when it's unambiguous (one open bid for that
      // address). Multiple → leave for a human rather than guess the round.
      if (candidates.length === 1) {
        bid = candidates[0];
        matchedBy = 'email';
      } else if (candidates.length > 1) {
        results.push({ message_id: reply.messageId, from: reply.fromEmail, matched_by: null, round_id: null, bid_id: null, vendor_name: null, outcome: 'duplicate_bid', unit_cost: null, confidence: null });
        await sc.from('quote_round_reply_events').update({ matched_by: 'email', outcome: 'duplicate_bid', updated_at: now }).eq('id', eventRow.id).eq('tenant_id', tenantId);
        continue;
      }
    }

    if (!bid) {
      unmatched += 1;
      results.push({ message_id: reply.messageId, from: reply.fromEmail, matched_by: null, round_id: null, bid_id: null, vendor_name: null, outcome: 'unmatched', unit_cost: null, confidence: null });
      await sc.from('quote_round_reply_events').update({ matched_by: null, outcome: 'unmatched', updated_at: now }).eq('id', eventRow.id).eq('tenant_id', tenantId);
      continue;
    }
    matched += 1;

    // 2) Extract the quote from the reply (never invents a number).
    const extracted = await extractQuoteFromText({
      text: reply.bodyText ?? reply.snippet ?? '',
      item_name: bid.item_name,
      vendor_name: bid.vendor_name,
    });

    let outcome: IngestOutcome;
    if (extracted.declined) {
      // Vendor explicitly bowed out.
      await sc.from('quote_round_bids')
        .update({ status: 'declined', updated_at: now, last_event_id: `${idempotencyKey}:${bid.id}:decl` })
        .eq('id', bid.id).eq('tenant_id', tenantId);
      outcome = 'declined';
      events.push({ event_name: 'quote_round.reply_declined', payload: { round_id: bid.round_id, vendor_id: bid.vendor_id }, last_event_id: `${idempotencyKey}:${bid.id}:decl` });
    } else if (extracted.unit_cost !== null) {
      // Record the price exactly as the human-paste path does.
      const entry = {
        unit_cost: extracted.unit_cost,
        recorded_at: now,
        source: 'inbound_email',
        moq: extracted.moq ?? null,
        lead_time_days: extracted.lead_time_days ?? null,
        confidence: extracted.confidence ?? null,
        raw: (reply.bodyText ?? reply.snippet ?? '').slice(0, 4000),
        message_id: reply.messageId,
      };
      const history = Array.isArray(bid.quote_history) ? bid.quote_history : [];
      const { error: upErr } = await sc.from('quote_round_bids')
        .update({
          status: 'quoted',
          current_quote: extracted.unit_cost,
          quote_history: [...history, entry],
          updated_at: now,
          last_event_id: `${idempotencyKey}:${bid.id}:q`,
        })
        .eq('id', bid.id).eq('tenant_id', tenantId);
      if (upErr) { log.error('price_wars.ingest_bid_write_failed', { bidId: bid.id, error: upErr.message }); throw AppError.internal(upErr.message); }
      // Keep the in-memory bid current so a later reply in the same run stacks history.
      bid.status = 'quoted';
      bid.current_quote = extracted.unit_cost;
      bid.quote_history = [...history, entry];
      recorded += 1;
      outcome = 'recorded';
      events.push({ event_name: 'quote_round.quote_recorded', payload: { round_id: bid.round_id, vendor_id: bid.vendor_id, unit_cost: extracted.unit_cost, source: 'inbound_email' }, last_event_id: `${idempotencyKey}:${bid.id}:q` });
    } else {
      // Reply received, but no firm price — flag for a human, never guess.
      unclear += 1;
      outcome = 'price_unclear';
    }

    await sc.from('quote_round_reply_events')
      .update({
        round_id: bid.round_id,
        bid_id: bid.id,
        vendor_id: bid.vendor_id,
        matched_by: matchedBy,
        outcome,
        extracted_unit_cost: extracted.unit_cost,
        extraction_confidence: extracted.confidence,
        updated_at: now,
      })
      .eq('id', eventRow.id).eq('tenant_id', tenantId);

    results.push({
      message_id: reply.messageId,
      from: reply.fromEmail,
      matched_by: matchedBy,
      round_id: bid.round_id,
      bid_id: bid.id,
      vendor_name: bid.vendor_name,
      outcome,
      unit_cost: extracted.unit_cost,
      confidence: extracted.confidence,
    });
  }

  const message =
    replies.length === 0
      ? 'No new vendor replies found.'
      : `${recorded} price${recorded === 1 ? '' : 's'} recorded` +
        (unclear ? `, ${unclear} reply${unclear === 1 ? '' : 'ies'} received but price unclear` : '') +
        (unmatched ? `, ${unmatched} couldn't be matched to an open round` : '') +
        '.';

  return {
    data: { scanned: replies.length, matched, recorded, unclear, unmatched, results, message },
    status: 200,
    events,
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/price-wars/ingest-replies' });
