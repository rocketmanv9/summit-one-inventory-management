import { describe, it, expect } from 'vitest';
import { extractQuoteFromText } from '@/lib/price-wars-extract';

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
