/**
 * POST /api/inventory/price-wars/requests/:id/draft-rfq
 *   { instructions? }
 *
 * Drafts ONE invitation email per vendor for a multi-product request: it lists
 * every product in the request with the quantity we're pricing and each vendor's
 * own current price, and asks for their best per-line number — competing against
 * the others, who stay anonymous. The draft is saved onto that vendor's bid in
 * each product's round (so the arena and the per-item counter flow keep working),
 * and the combined RFQ is returned per vendor for Copy / mailto.
 *
 * NOTHING IS SENT. Same hard rule as draft-message — there is no transport here.
 * A human copies the text. Auto-send is parked for Grant's green light.
 *
 * TRUTHFULNESS: every number in the prompt is a real row — each vendor's baseline
 * price on each product, the target quantity per product. The system prompt
 * forbids inventing prices, quantities, deadlines or competitor names. Rivals are
 * never named; we do not manufacture a competing offer.
 *
 * No OPENAI_API_KEY → 200 { configured: false } plus a deterministic fallback
 * draft built from the same real numbers, so the feature still works.
 */

import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import OpenAI from 'openai';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';
const MODEL = 'gpt-4o';

function extractRequestId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('requests') + 1];
  if (!id) throw AppError.badRequest('Missing request id');
  return z.string().uuid().parse(id);
}

const RequestSchema = z.object({
  instructions: z.string().max(1000).nullable().optional(),
});

const SYSTEM_PROMPT = [
  'You write short, professional purchasing emails for a construction/industrial company.',
  'You are drafting an RFQ to ONE supplier who is competing with others to win our business.',
  '',
  'Return ONLY a valid JSON object (no markdown fences):',
  '  subject — a short email subject line',
  '  body    — the email body as plain text, with line breaks. List the products',
  '            and quantities clearly (a simple bulleted list is fine). Ask for',
  '            their best per-unit price on each line. Sign off as the buyer whose',
  '            name is given in the context; if none is given, use "Purchasing".',
  '',
  'ABSOLUTE RULES:',
  '- Use ONLY the facts and numbers given to you in the context block. Never invent',
  '  a price, a quantity, a lead time, a discount percentage, a deadline date, or a',
  '  competitor name. If a number is not in the context, do not mention it.',
  '- NEVER name a competing supplier and NEVER invent a competing price. You may say',
  '  we are pricing this across several suppliers; do not claim a specific rival number.',
  '- Never promise volume, exclusivity, or payment terms that are not in the context.',
  '- Be direct and warm, not aggressive. 160 words or fewer. No emoji, no markdown.',
  '- Do not include any instruction about how the email will be sent.',
].join('\n');

function money(n: number | null | undefined): string | null {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return null;
  return `$${Number(n).toFixed(2)}`;
}

interface LineFact {
  itemName: string;
  sku: string | null;
  qty: number;
  baseline: number | null;
}

/** Deterministic per-vendor RFQ used when AI is unavailable. */
function fallbackRfq(ctx: { vendorName: string; buyerName: string | null; lines: LineFact[] }): { subject: string; body: string } {
  const sig = ctx.buyerName ?? 'Purchasing';
  const bullets = ctx.lines.map((l) => {
    const price = l.baseline !== null ? ` (our current price with you: ${money(l.baseline)}/unit)` : '';
    return `  • ${l.itemName}${l.sku ? ` (SKU ${l.sku})` : ''} — about ${l.qty} units${price}`;
  });
  const subject = ctx.lines.length === 1
    ? `Quote request — ${ctx.lines[0].itemName}`
    : `Quote request — ${ctx.lines.length} items`;
  return {
    subject,
    body: [
      `Hi ${ctx.vendorName} team,`,
      '',
      `We're re-pricing the following across our suppliers and would like your best per-unit quote on each:`,
      '',
      ...bullets,
      '',
      'Please send your unit price, minimum order quantity and lead time for each line. Thanks for taking a look.',
      '',
      'Thanks,',
      sig,
    ].join('\n'),
  };
}

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const requestId = extractRequestId(req);
  const body = RequestSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;
  const sc = (supabase as any).schema('supply_chain');

  const { data: request, error: rqErr } = await sc
    .from('quote_requests').select('*').eq('id', requestId).eq('tenant_id', tenantId).maybeSingle();
  if (rqErr) throw AppError.internal(rqErr.message);
  if (!request) throw AppError.notFound('Price war request not found');

  // All rounds under this request, plus their bids.
  const { data: rounds, error: roErr } = await sc
    .from('quote_rounds').select('*').eq('request_id', requestId).eq('tenant_id', tenantId).limit(50);
  if (roErr) throw AppError.internal(roErr.message);
  if (!rounds || rounds.length === 0) throw AppError.badRequest('This request has no products to draft for.');

  const roundIds = rounds.map((r: any) => r.id);
  const { data: bids, error: bErr } = await sc
    .from('quote_round_bids').select('*').in('round_id', roundIds).eq('tenant_id', tenantId).limit(1000);
  if (bErr) throw AppError.internal(bErr.message);

  const itemIds = Array.from(new Set(rounds.map((r: any) => r.catalog_item_id).filter(Boolean)));
  const { data: items } = itemIds.length > 0
    ? await (supabase as any).schema('inventory').from('catalog_items').select('id, name, sku').in('id', itemIds).limit(200)
    : { data: [] };
  const itemMap = new Map<string, any>((items ?? []).map((i: any) => [i.id, i]));

  const vendorIds: string[] = Array.isArray(request.vendor_ids) && request.vendor_ids.length > 0
    ? request.vendor_ids
    : Array.from(new Set((bids ?? []).map((b: any) => b.vendor_id)));
  const { data: vendors } = await sc
    .from('vendors').select('id, name, contact_name').in('id', vendorIds).limit(100);
  const vendorMap = new Map<string, any>((vendors ?? []).map((v: any) => [v.id, v]));

  const { data: buyer } = await (supabase as any)
    .from('local_users').select('name, email').eq('user_id', ctx.userId!).eq('tenant_id', tenantId).maybeSingle();

  const roundById = new Map<string, any>((rounds ?? []).map((r: any) => [r.id, r]));
  const now = new Date().toISOString();

  const apiKey = process.env.OPENAI_API_KEY;
  const openai = apiKey ? new OpenAI({ apiKey }) : null;

  const results: Array<{ vendor_id: string; vendor_name: string; subject: string; body: string; contact_email: string | null; ai: boolean }> = [];
  let anyMessage: string | undefined;

  // One RFQ per vendor across every product's round they're in.
  for (const vendorId of vendorIds) {
    const vendorName = vendorMap.get(vendorId)?.name ?? 'Vendor';
    const vendorBids = (bids ?? []).filter((b: any) => b.vendor_id === vendorId);
    if (vendorBids.length === 0) continue;

    const lineFacts: LineFact[] = vendorBids.map((b: any) => {
      const round = roundById.get(b.round_id);
      const item = round ? itemMap.get(round.catalog_item_id) : null;
      return {
        itemName: item?.name ?? round?.item_label ?? 'the item',
        sku: item?.sku ?? null,
        qty: Number(round?.target_qty) || 1,
        baseline: b.baseline_unit_cost !== null ? Number(b.baseline_unit_cost) : null,
      };
    });

    const fallback = fallbackRfq({ vendorName, buyerName: buyer?.name ?? null, lines: lineFacts });
    let draft = fallback;
    let ai = false;

    if (openai) {
      const factBlock = [
        `Supplier being written to: ${vendorName}`,
        vendorMap.get(vendorId)?.contact_name ? `Their contact: ${vendorMap.get(vendorId).contact_name}` : null,
        'Products we are pricing (list ALL of these in the email):',
        ...lineFacts.map((l) =>
          `  - ${l.itemName}${l.sku ? ` (SKU ${l.sku})` : ''}: quantity ${l.qty} units` +
          (l.baseline !== null ? `, their current price with us ${money(l.baseline)}/unit` : ', no price on file with this supplier'),
        ),
        buyer?.name ? `Buyer signing the email: ${buyer.name}` : null,
        body.instructions ? `Buyer's steer: ${body.instructions}` : null,
        '',
        'Write the OPENING request asking for their best per-unit quote on every line above.',
      ].filter(Boolean).join('\n');

      try {
        const completion = await openai.chat.completions.create({
          model: MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: factBlock },
          ],
          temperature: 0.4,
          max_tokens: 700,
        });
        const content = completion.choices?.[0]?.message?.content?.trim();
        if (content) {
          let jsonStr = content;
          const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (fence) jsonStr = fence[1].trim();
          const parsed = JSON.parse(jsonStr);
          const subject = typeof parsed?.subject === 'string' ? parsed.subject.trim().slice(0, 200) : null;
          const bodyText = typeof parsed?.body === 'string' ? parsed.body.trim().slice(0, 6000) : null;
          if (subject && bodyText) { draft = { subject, body: bodyText }; ai = true; }
          else anyMessage = 'AI returned an unusable draft for at least one vendor — used a plain version there.';
        } else {
          anyMessage = 'AI returned an empty draft for at least one vendor — used a plain version there.';
        }
      } catch (err: any) {
        log.error('price_wars.request_draft_failed', { error: err?.message, vendor_id: vendorId });
        anyMessage = `AI drafting failed for at least one vendor (${err?.message ?? 'unknown error'}) — used plain drafts there.`;
      }
    } else {
      anyMessage = 'AI drafting unavailable (OPENAI_API_KEY not configured) — these are plain drafts built from the recorded prices. Edit before you send.';
    }

    // Persist the combined RFQ onto EACH of this vendor's bids in the request, so
    // the arena's per-product view shows the draft and the mailto has an address.
    const historyEntry = {
      kind: 'rfq' as const,
      scope: 'request',
      request_id: requestId,
      subject: draft.subject,
      body: draft.body,
      ai,
      created_at: now,
      created_by_user_id: ctx.userId ?? null,
    };
    const contactEmail = vendorBids.find((b: any) => b.contact_email)?.contact_email ?? null;
    for (const b of vendorBids) {
      const { error: upErr } = await sc
        .from('quote_round_bids')
        .update({
          draft_message: `${draft.subject}\n\n${draft.body}`,
          message_history: [...(Array.isArray(b.message_history) ? b.message_history : []), historyEntry],
          updated_at: now,
          last_event_id: crypto.randomUUID(),
        })
        .eq('id', b.id)
        .eq('tenant_id', tenantId);
      if (upErr) { log.error('price_wars.request_draft_persist_failed', { error: upErr.message }); throw AppError.internal(upErr.message); }
    }

    results.push({ vendor_id: vendorId, vendor_name: vendorName, subject: draft.subject, body: draft.body, contact_email: contactEmail, ai });
  }

  return {
    data: {
      request_id: requestId,
      configured: !!openai,
      delivery: 'manual',
      drafts: results,
      message: anyMessage,
    },
    status: 200,
    events: [{
      event_name: 'quote_request.rfqs_drafted',
      payload: { request_id: requestId, vendor_count: results.length, product_count: rounds.length, ai: !!openai },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/price-wars/requests/[id]/draft-rfq' });
