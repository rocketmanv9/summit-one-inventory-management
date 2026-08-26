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
import { extractQuoteFromText, extractQuoteLinesFromText } from '@/lib/price-wars-extract';

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
  round_catalog_item_id: string | null;
  /** Parent multi-item request, when this round belongs to one (null = standalone round). */
  round_request_id: string | null;
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

/** Per-line detail when one reply covers several of a request's items. */
interface ReplyLineResult {
  round_id: string;
  bid_id: string;
  item: string | null;
  outcome: 'recorded' | 'not_quoted' | 'declined';
  unit_cost: number | null;
  confidence: number | null;
}

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
  /** Present when the reply was matched against a multi-item request. */
  lines?: ReplyLineResult[];
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
    .select('id, target_qty, catalog_item_id, request_id, item_label')
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
  const itemIds = [...new Set(openRounds.map((r: any) => r.catalog_item_id).filter(Boolean))];
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
      round_catalog_item_id: round?.catalog_item_id ?? null,
      round_request_id: round?.request_id ?? null,
      vendor_name: v?.name ?? 'Vendor',
      vendor_contact_email: (v?.contact_email ?? v?.po_email ?? null),
      // Catalog name when the round is a real item; the free-text label on an ad-hoc line.
      item_name: itemMap.get(round?.catalog_item_id)?.name ?? round?.item_label ?? null,
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
    let ledgerId: string | null = claimed?.[0]?.id ?? null;
    if (!ledgerId) {
      // Seen before. A row still 'pending' means an earlier run claimed this
      // message but died before finishing (crash / released retry) — reclaim it
      // and finish the job; the per-bid history guard in recordQuote makes
      // re-applying safe. Any other outcome = completed ingest → strict no-op.
      const { data: prior } = await sc
        .from('quote_round_reply_events')
        .select('id, outcome')
        .eq('tenant_id', tenantId)
        .eq('provider_message_id', reply.messageId)
        .limit(1);
      if (prior?.[0]?.outcome === 'pending') {
        ledgerId = prior[0].id;
      } else {
        // Already ingested on an earlier poll — don't touch the bids again.
        results.push({ message_id: reply.messageId, from: reply.fromEmail, matched_by: null, round_id: null, bid_id: null, vendor_name: null, outcome: 'already_seen', unit_cost: null, confidence: null });
        continue;
      }
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
      // One open bid for that address → unambiguous, match it. Several open bids
      // that are all the SAME vendor's lines under the SAME multi-item request →
      // that's just the combined RFQ we sent them; match the request (the
      // per-line extractor sorts out which line is which). Anything else stays
      // ambiguous → leave for a human rather than guess the round.
      if (candidates.length === 1) {
        bid = candidates[0];
        matchedBy = 'email';
      } else if (candidates.length > 1) {
        const sameVendor = new Set(candidates.map((c) => c.vendor_id)).size === 1;
        const requestIds = new Set(candidates.map((c) => c.round_request_id ?? `standalone:${c.round_id}`));
        if (sameVendor && requestIds.size === 1 && candidates[0].round_request_id) {
          bid = candidates[0];
          matchedBy = 'email';
        } else {
          results.push({ message_id: reply.messageId, from: reply.fromEmail, matched_by: null, round_id: null, bid_id: null, vendor_name: null, outcome: 'duplicate_bid', unit_cost: null, confidence: null });
          await sc.from('quote_round_reply_events').update({ matched_by: 'email', outcome: 'duplicate_bid', updated_at: now }).eq('id', ledgerId).eq('tenant_id', tenantId);
          continue;
        }
      }
    }

    if (!bid) {
      unmatched += 1;
      results.push({ message_id: reply.messageId, from: reply.fromEmail, matched_by: null, round_id: null, bid_id: null, vendor_name: null, outcome: 'unmatched', unit_cost: null, confidence: null });
      await sc.from('quote_round_reply_events').update({ matched_by: null, outcome: 'unmatched', updated_at: now }).eq('id', ledgerId).eq('tenant_id', tenantId);
      continue;
    }
    matched += 1;

    // 2) Reply scope. The combined RFQ (send-invites) covers EVERY line this
    // vendor holds under the matched bid's request, so one reply may quote
    // several of them. Standalone rounds (no parent request) keep the
    // single-bid scope — the path that always existed.
    let scopeBids: OpenBid[] = [bid];
    if (bid.round_request_id) {
      const siblings = bids.filter(
        (b) => b.vendor_id === bid!.vendor_id && b.round_request_id === bid!.round_request_id && b.status !== 'declined',
      );
      if (siblings.length > 0) scopeBids = siblings;
      if (!scopeBids.some((b) => b.id === bid!.id)) scopeBids = [bid, ...scopeBids];
    }

    // Record a price on a bid — shared by the single- and multi-line paths;
    // writes exactly what the human-paste path writes.
    const replyRaw = (reply.bodyText ?? reply.snippet ?? '').slice(0, 4000);
    const recordQuote = async (
      target: OpenBid,
      q: { unit_cost: number; moq: number | null; lead_time_days: number | null; confidence: number | null },
    ) => {
      const entry = {
        unit_cost: q.unit_cost,
        recorded_at: now,
        source: 'inbound_email',
        moq: q.moq ?? null,
        lead_time_days: q.lead_time_days ?? null,
        confidence: q.confidence ?? null,
        raw: replyRaw,
        message_id: reply.messageId,
      };
      const history = Array.isArray(target.quote_history) ? target.quote_history : [];
      if (history.some((e: any) => e?.message_id === reply.messageId && e?.source === 'inbound_email')) {
        // This exact message already put its price on this bid — a reclaimed
        // 'pending' retry landing again. Never stack a duplicate history entry.
        return;
      }
      const { error: upErr } = await sc.from('quote_round_bids')
        .update({
          status: 'quoted',
          current_quote: q.unit_cost,
          quote_history: [...history, entry],
          updated_at: now,
          last_event_id: `${idempotencyKey}:${target.id}:q`,
        })
        .eq('id', target.id).eq('tenant_id', tenantId);
      if (upErr) { log.error('price_wars.ingest_bid_write_failed', { bidId: target.id, error: upErr.message }); throw AppError.internal(upErr.message); }
      // Keep the in-memory bid current so a later reply in the same run stacks history.
      target.status = 'quoted';
      target.current_quote = q.unit_cost;
      target.quote_history = [...history, entry];
      recorded += 1;
      events.push({ event_name: 'quote_round.quote_recorded', payload: { round_id: target.round_id, vendor_id: target.vendor_id, unit_cost: q.unit_cost, source: 'inbound_email' }, last_event_id: `${idempotencyKey}:${target.id}:q` });
    };

    const declineBid = async (target: OpenBid) => {
      await sc.from('quote_round_bids')
        .update({ status: 'declined', updated_at: now, last_event_id: `${idempotencyKey}:${target.id}:decl` })
        .eq('id', target.id).eq('tenant_id', tenantId);
      target.status = 'declined';
      events.push({ event_name: 'quote_round.reply_declined', payload: { round_id: target.round_id, vendor_id: target.vendor_id }, last_event_id: `${idempotencyKey}:${target.id}:decl` });
    };

    let outcome: IngestOutcome;
    let unitCost: number | null = null;
    let confidence: number | null = null;
    let lineResults: ReplyLineResult[] | undefined;

    if (scopeBids.length <= 1) {
      // 3a) Single-line scope — extract ONE price, the original path unchanged.
      const extracted = await extractQuoteFromText({
        text: reply.bodyText ?? reply.snippet ?? '',
        item_name: bid.item_name,
        vendor_name: bid.vendor_name,
      });
      unitCost = extracted.unit_cost;
      confidence = extracted.confidence;

      if (extracted.declined) {
        // Vendor explicitly bowed out.
        await declineBid(bid);
        outcome = 'declined';
      } else if (extracted.unit_cost !== null) {
        await recordQuote(bid, {
          unit_cost: extracted.unit_cost,
          moq: extracted.moq,
          lead_time_days: extracted.lead_time_days,
          confidence: extracted.confidence,
        });
        outcome = 'recorded';
      } else {
        // Reply received, but no firm price — flag for a human, never guess.
        unclear += 1;
        outcome = 'price_unclear';
      }
    } else {
      // 3b) Multi-line scope — extract per-line prices against the vendor's own
      // open lines. The model may only pick from these candidates; items the
      // vendor didn't quote stay untouched.
      const candidates = scopeBids.map((b, i) => ({
        ref: `L${i + 1}`,
        item_name: b.item_name ?? 'Line item',
        qty: b.round_target_qty,
      }));
      const bidByRef = new Map<string, OpenBid>(scopeBids.map((b, i) => [`L${i + 1}`, b]));
      const extracted = await extractQuoteLinesFromText({
        text: reply.bodyText ?? reply.snippet ?? '',
        vendor_name: bid.vendor_name,
        candidates,
      });

      const recordedByBidId = new Map<string, { unit_cost: number; confidence: number | null }>();
      if (extracted.declined && extracted.lines.length === 0) {
        // Vendor bowed out of the whole request — the lines still awaiting an
        // answer decline. A bid that already carries a recorded quote keeps it:
        // a model misread must never erase a real price (withdrawing a recorded
        // quote is a human decision, not an extractor's).
        for (const b of scopeBids) {
          if (b.status !== 'quoted') await declineBid(b);
        }
        outcome = 'declined';
      } else if (extracted.lines.length > 0) {
        for (const line of extracted.lines) {
          const target = bidByRef.get(line.ref);
          if (!target) continue; // validation upstream makes this unreachable, but never guess
          await recordQuote(target, line);
          recordedByBidId.set(target.id, { unit_cost: line.unit_cost, confidence: line.confidence });
        }
        outcome = 'recorded';
      } else {
        // Reply received, but no line carried a firm price — human review, never guess.
        unclear += 1;
        outcome = 'price_unclear';
      }

      lineResults = scopeBids.map((b): ReplyLineResult => {
        const rec = recordedByBidId.get(b.id);
        return {
          round_id: b.round_id,
          bid_id: b.id,
          item: b.item_name,
          outcome: rec ? 'recorded' : b.status === 'declined' && outcome === 'declined' ? 'declined' : 'not_quoted',
          unit_cost: rec?.unit_cost ?? null,
          confidence: rec?.confidence ?? null,
        };
      });
      // Headline number = the matched bid's own line when it got one, else the
      // first line that recorded (granularity lives in `lines`).
      const primary = recordedByBidId.get(bid.id) ?? [...recordedByBidId.values()][0] ?? null;
      unitCost = primary?.unit_cost ?? null;
      confidence = primary?.confidence ?? null;
    }

    await sc.from('quote_round_reply_events')
      .update({
        round_id: bid.round_id,
        bid_id: bid.id,
        vendor_id: bid.vendor_id,
        request_id: bid.round_request_id,
        matched_by: matchedBy,
        outcome,
        extracted_unit_cost: unitCost,
        extraction_confidence: confidence,
        line_outcomes: lineResults ?? null,
        updated_at: now,
      })
      .eq('id', ledgerId).eq('tenant_id', tenantId);

    results.push({
      message_id: reply.messageId,
      from: reply.fromEmail,
      matched_by: matchedBy,
      round_id: bid.round_id,
      bid_id: bid.id,
      vendor_name: bid.vendor_name,
      outcome,
      unit_cost: unitCost,
      confidence,
      ...(lineResults ? { lines: lineResults } : {}),
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
