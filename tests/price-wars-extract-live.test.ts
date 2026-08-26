import { describe, it, expect } from 'vitest';
import { extractQuoteFromText, extractQuoteLinesFromText } from '@/lib/price-wars-extract';

// Live OpenAI check of the REAL extractor on the exact vendor-reply shapes the
// inbox monitor will see. Skipped automatically when no key is configured.
const hasKey = !!process.env.OPENAI_API_KEY;
const maybe = hasKey ? describe : describe.skip;

maybe('extractQuoteFromText (live)', () => {
  it('reads a per-unit price from a tiered "each" reply', async () => {
    const r = await extractQuoteFromText({
      text: 'Hi — thanks for the RFQ. We can do these traffic cones at $38.50 each on your quantity of 8, 5 business day lead. Ref: [pw:round:bid]',
      item_name: 'Traffic Cone 28in',
      vendor_name: 'Traffic Safety Supply',
    });
    expect(r.unit_cost).toBe(38.5);
    expect(r.confidence).toBeGreaterThan(50);
  }, 30000);

  it('reads a plain "per unit" price', async () => {
    const r = await extractQuoteFromText({
      text: 'Our best price is $44.00 per unit.',
      item_name: 'Traffic Cone 28in',
      vendor_name: 'Amazon Business',
    });
    expect(r.unit_cost).toBe(44);
  }, 30000);

  it('returns null (never guesses) when no price is stated', async () => {
    const r = await extractQuoteFromText({
      text: 'Thanks for reaching out, we will get back to you next week with pricing.',
      item_name: 'Traffic Cone 28in',
      vendor_name: 'Vendor',
    });
    expect(r.unit_cost).toBeNull();
    expect(r.confidence).toBe(0);
  }, 30000);
});

// Per-line extraction: one combined RFQ per vendor means one reply can quote
// several items. Each line must land on ITS item; unquoted items must not appear.
maybe('extractQuoteLinesFromText (live)', () => {
  const candidates = [
    { ref: 'L1', item_name: 'Traffic Cone 28in', qty: 8 },
    { ref: 'L2', item_name: 'Marking Paint White (case)', qty: 12 },
    { ref: 'L3', item_name: 'Crack Sealant 30lb Box', qty: 40 },
  ];

  it('reads every quoted line of a multi-item reply and omits the unquoted one', async () => {
    const r = await extractQuoteLinesFromText({
      text: [
        'Hi — thanks for the RFQ. Pricing below:',
        '- 28" traffic cones: $38.50 each on your qty of 8',
        '- Crack sealant 30lb boxes: $41.00/ea, 5 day lead',
        "We don't carry the marking paint right now, sorry.",
        'Ref: [pw:round:bid]',
      ].join('\n'),
      vendor_name: 'Traffic Safety Supply',
      candidates,
    });
    expect(r.declined).toBe(false);
    expect(r.lines).toHaveLength(2);
    const byRef = new Map(r.lines.map((l) => [l.ref, l]));
    expect(byRef.get('L1')?.unit_cost).toBe(38.5);
    expect(byRef.get('L3')?.unit_cost).toBe(41);
    expect(byRef.has('L2')).toBe(false); // not quoted → untouched, never guessed
  }, 45000);

  it('still reads a single-item reply through the multi extractor', async () => {
    const r = await extractQuoteLinesFromText({
      text: 'We can do the cones at $44.00 per unit.',
      vendor_name: 'Amazon Business',
      candidates,
    });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].ref).toBe('L1');
    expect(r.lines[0].unit_cost).toBe(44);
  }, 45000);

  it('returns zero lines (never guesses) on a garbled multi-item reply', async () => {
    const r = await extractQuoteLinesFromText({
      text: 'Thanks for the list — our team is reviewing all three items and will send numbers over next week.',
      vendor_name: 'Vendor',
      candidates,
    });
    expect(r.lines).toHaveLength(0);
    expect(r.declined).toBe(false);
  }, 45000);

  it('flags an explicit full refusal as declined (and only that)', async () => {
    const r = await extractQuoteLinesFromText({
      text: 'Thanks, but we do not carry any of these items and will not be quoting this request.',
      vendor_name: 'Vendor',
      candidates,
    });
    expect(r.declined).toBe(true);
    expect(r.lines).toHaveLength(0);
  }, 45000);

  it('drops prices for items we never asked about (model may not invent an item)', async () => {
    const r = await extractQuoteLinesFromText({
      text: 'Cones are $38.50 each. We can also do safety vests at $12.00 each if you want them.',
      vendor_name: 'Vendor',
      candidates,
    });
    // Only listed refs can survive: the vest price must not attach to anything.
    expect(r.lines.every((l) => ['L1', 'L2', 'L3'].includes(l.ref))).toBe(true);
    const cone = r.lines.find((l) => l.ref === 'L1');
    expect(cone?.unit_cost).toBe(38.5);
    expect(r.lines.find((l) => l.unit_cost === 12)).toBeUndefined();
  }, 45000);
});
