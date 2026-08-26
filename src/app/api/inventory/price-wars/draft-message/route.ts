/**
 * POST /api/inventory/price-wars/draft-message
 *   { round_id, bid_id, kind: 'rfq' | 'counter', instructions? }
 *
 * Drafts the message a buyer will send a vendor — the opening RFQ, or the next
 * volley once a rival has come in lower. The draft is saved on the bid so it
 * survives a reload, and returned so the page can show Copy / mailto.
 *
 * NOTHING IS SENT. There is no transport in this file, no queue, no email
 * client. A human copies the text. Auto-send is parked for Grant's green light.
 *
 * TRUTHFULNESS: every number in the prompt comes from a row in this database —
 * the vendor's own baseline price, quotes humans recorded in this round, the
 * target quantity. The system prompt forbids inventing prices, quantities,
 * deadlines or competitor names, and the counter draft is only allowed to cite
 * the rival low as an ANONYMOUS number ("we have a written quote at $41.00"),
 * never "Acme quoted $41" — naming competitors' prices is how you lose vendors.
 *
 * No OPENAI_API_KEY → 200 { configured: false } plus a deterministic fallback
 * draft built from the same real numbers, so the feature still works.
 */

import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import OpenAI from 'openai';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';
import { currentLow } from '@/lib/price-wars';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';
const MODEL = 'gpt-4o';

const RequestSchema = z.object({
  round_id: z.string().uuid(),
  bid_id: z.string().uuid(),
  kind: z.enum(['rfq', 'counter']),
  /** Optional human steer, e.g. "we can commit to a standing monthly order". */
  instructions: z.string().max(1000).nullable().optional(),
});

const SYSTEM_PROMPT = [
  'You write short, professional purchasing emails for a construction/industrial company.',
  'You are drafting a message to ONE supplier during a competitive quoting round.',
  '',
  'Return ONLY a valid JSON object (no markdown fences):',
  '  subject — a short email subject line',
  '  body    — the email body as plain text, with line breaks. Sign off as the',
  '            buyer whose name is given in the context; if none is given, use',
  '            "Purchasing" as the signature.',
  '',
  'ABSOLUTE RULES:',
  '- Use ONLY the facts and numbers given to you in the context block. Never invent',
  '  a price, a quantity, a lead time, a discount percentage, a deadline date, or a',
  '  competitor name. If a number is not in the context, do not mention it.',
  '- NEVER name a competing supplier. If a rival low price is provided you may cite',
  '  the NUMBER as "a written quote we have on file", nothing more.',
  '- Never promise volume, exclusivity, or payment terms that are not in the context.',
  '- Do not fabricate an order deadline. If a target quantity is given you may say',
  '  what quantity we are pricing.',
  '- Be direct and warm, not aggressive. 120 words or fewer. No emoji, no markdown.',
  '- Do not include any instruction about how the email will be sent.',
].join('\n');

function money(n: number | null | undefined): string | null {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return null;
  return `$${Number(n).toFixed(2)}`;
}

/** Deterministic draft used when AI is unavailable — same real numbers, no model. */
function fallbackDraft(kind: 'rfq' | 'counter', ctx: {
  itemName: string;
  vendorName: string;
  baseline: number | null;
  targetQty: number;
  rivalLow: number | null;
  buyerName: string | null;
}): { subject: string; body: string } {
  const sig = ctx.buyerName ?? 'Purchasing';
  if (kind === 'counter' && ctx.rivalLow !== null) {
    return {
      subject: `Re: pricing on ${ctx.itemName}`,
      body: [
        `Hi ${ctx.vendorName} team,`,
        '',
        `We're finalising our supplier for ${ctx.itemName} at about ${ctx.targetQty} units.`,
        `We currently have a written quote on file at ${money(ctx.rivalLow)} per unit.`,
        ctx.baseline !== null ? `Your price with us is ${money(ctx.baseline)} per unit.` : '',
        '',
        'If you can improve on that, we would rather keep the business with you. Can you let us know your best number?',
        '',
        'Thanks,',
        sig,
      ].filter(Boolean).join('\n'),
    };
  }
  return {
    subject: `Quote request — ${ctx.itemName}`,
    body: [
      `Hi ${ctx.vendorName} team,`,
      '',
      `We're re-pricing ${ctx.itemName} across our suppliers and would like your best quote for roughly ${ctx.targetQty} units.`,
      ctx.baseline !== null ? `Our current price with you is ${money(ctx.baseline)} per unit.` : '',
      '',
      'Please send your unit price, minimum order quantity and lead time. Thanks for taking a look.',
      '',
      'Thanks,',
      sig,
    ].filter(Boolean).join('\n'),
  };
}

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'purchase_orders.manage');
  const body = RequestSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;
  const sc = (supabase as any).schema('supply_chain');

  const { data: round, error: rErr } = await sc
    .from('quote_rounds').select('*').eq('id', body.round_id).eq('tenant_id', tenantId).maybeSingle();
  if (rErr) throw AppError.internal(rErr.message);
  if (!round) throw AppError.notFound('Price war not found');

  const { data: bids, error: bErr } = await sc
    .from('quote_round_bids').select('*').eq('round_id', body.round_id).limit(100);
  if (bErr) throw AppError.internal(bErr.message);

  const target = (bids ?? []).find((b: any) => b.id === body.bid_id);
  if (!target) throw AppError.notFound('That vendor is not in this round');

  const vendorIds = (bids ?? []).map((b: any) => b.vendor_id);
  const { data: vendors } = await sc
    .from('vendors').select('id, name, contact_name').in('id', vendorIds).limit(100);
  const vendorMap = new Map<string, any>((vendors ?? []).map((v: any) => [v.id, v]));

  // Ad-hoc rounds carry no catalog item — their name lives in round.item_label,
  // so only hit the catalog when there is a real item to look up.
  const { data: item } = round.catalog_item_id
    ? await (supabase as any)
        .schema('inventory').from('catalog_items').select('name, sku').eq('id', round.catalog_item_id).maybeSingle()
    : { data: null };

  // The rival low is the lowest RECORDED quote from anyone who is NOT this
  // vendor. If nobody else has quoted, there is no number to cite and the
  // "counter" degrades into a plain nudge — we do not manufacture leverage.
  const others = (bids ?? [])
    .filter((b: any) => b.id !== body.bid_id)
    .map((b: any) => ({ ...b, vendor_name: vendorMap.get(b.vendor_id)?.name ?? 'Vendor' }));
  const rival = currentLow(others);

  const { data: buyer } = await (supabase as any)
    .from('local_users').select('name, email').eq('user_id', ctx.userId!).eq('tenant_id', tenantId).maybeSingle();

  const vendorName = vendorMap.get(target.vendor_id)?.name ?? 'Vendor';
  const itemName = item?.name ?? round.item_label ?? 'the item';
  const targetQty = Number(round.target_qty) || 1;
  const baseline = target.baseline_unit_cost !== null ? Number(target.baseline_unit_cost) : null;
  const theirQuote = target.current_quote !== null ? Number(target.current_quote) : null;

  const factBlock = [
    `Item: ${itemName}${item?.sku ? ` (SKU ${item.sku})` : ''}`,
    `Supplier being written to: ${vendorName}`,
    vendorMap.get(target.vendor_id)?.contact_name ? `Their contact: ${vendorMap.get(target.vendor_id).contact_name}` : null,
    `Quantity we are pricing: ${targetQty} units`,
    baseline !== null ? `Their current price with us: ${money(baseline)} per unit` : 'We have no price on file with this supplier.',
    theirQuote !== null ? `Their latest quote in this round: ${money(theirQuote)} per unit` : null,
    rival ? `Lowest written quote we hold from another supplier: ${money(rival.unit_cost)} per unit (DO NOT NAME THE SUPPLIER)` : 'We hold no other written quote yet — do not imply one exists.',
    buyer?.name ? `Buyer signing the email: ${buyer.name}` : null,
    body.instructions ? `Buyer's steer: ${body.instructions}` : null,
    '',
    body.kind === 'rfq'
      ? 'Write the OPENING request for their best quote.'
      : 'Write a FOLLOW-UP asking them to beat the quote we hold. If no rival quote is listed above, just ask them to sharpen their number without implying a competing offer.',
  ].filter(Boolean).join('\n');

  const fallback = fallbackDraft(body.kind, { itemName, vendorName, baseline, targetQty, rivalLow: rival?.unit_cost ?? null, buyerName: buyer?.name ?? null });

  let draft = fallback;
  let configured = false;
  let message: string | undefined;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    message = 'AI drafting unavailable (OPENAI_API_KEY not configured) — here is a plain draft built from the recorded prices. Edit it before you send.';
  } else {
    configured = true;
    try {
      const openai = new OpenAI({ apiKey });
      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: factBlock },
        ],
        temperature: 0.4,
        max_tokens: 500,
      });
      const content = completion.choices?.[0]?.message?.content?.trim();
      if (content) {
        let jsonStr = content;
        const fence = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fence) jsonStr = fence[1].trim();
        const parsed = JSON.parse(jsonStr);
        const subject = typeof parsed?.subject === 'string' ? parsed.subject.trim().slice(0, 200) : null;
        const bodyText = typeof parsed?.body === 'string' ? parsed.body.trim().slice(0, 4000) : null;
        if (subject && bodyText) draft = { subject, body: bodyText };
        else message = 'AI returned an unusable draft — falling back to the plain version.';
      } else {
        message = 'AI returned an empty draft — falling back to the plain version.';
      }
    } catch (err: any) {
      log.error('price_wars.draft_failed', { error: err?.message });
      message = `AI drafting failed (${err?.message ?? 'unknown error'}) — here is a plain draft from the recorded prices.`;
    }
  }

  const historyEntry = {
    kind: body.kind,
    subject: draft.subject,
    body: draft.body,
    cited_low: rival?.unit_cost ?? null,
    ai: configured && !message,
    created_at: new Date().toISOString(),
    created_by_user_id: ctx.userId ?? null,
  };

  const { error: upErr } = await sc
    .from('quote_round_bids')
    .update({
      draft_message: `${draft.subject}\n\n${draft.body}`,
      message_history: [...(Array.isArray(target.message_history) ? target.message_history : []), historyEntry],
      updated_at: new Date().toISOString(),
      last_event_id: idempotencyKey,
    })
    .eq('id', body.bid_id)
    .eq('tenant_id', tenantId);
  if (upErr) { log.error('price_wars.draft_persist_failed', { error: upErr.message }); throw AppError.internal(upErr.message); }

  return {
    data: {
      configured,
      kind: body.kind,
      subject: draft.subject,
      body: draft.body,
      cited_low: rival?.unit_cost ?? null,
      contact_email: target.contact_email ?? null,
      // Said out loud in the payload as well as the UI: this is copy-and-send.
      delivery: 'manual',
      message,
    },
    status: 200,
    events: [{
      event_name: 'quote_round.message_drafted',
      payload: { round_id: body.round_id, vendor_id: target.vendor_id, kind: body.kind, ai: configured },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/price-wars/draft-message' });
