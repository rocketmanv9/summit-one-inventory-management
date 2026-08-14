/**
 * Amazon paste-a-link resolver — URL-shape parsing (sprint 2026-08-14 item 05).
 *
 * These cover the deterministic half only: ASIN extraction from the URL and the
 * offline (`skipFetch`) resolution path. The page-fetch half is deliberately
 * untested here — it depends on whether Amazon feels like answering a datacenter
 * IP today, and the whole design is that it degrades instead of failing.
 */

import { describe, it, expect } from 'vitest';

import { parseAsinFromUrl, isAmazonUrl, canonicalAmazonUrl, resolveAmazonLink } from '@/lib/amazon-link';

const ASIN = 'B08N5WRWNW';

describe('parseAsinFromUrl', () => {
  it('reads /dp/<ASIN>', () => {
    expect(parseAsinFromUrl(`https://www.amazon.com/dp/${ASIN}`)).toBe(ASIN);
  });

  it('reads /dp/<ASIN> buried under a slug and a ref= tail', () => {
    expect(
      parseAsinFromUrl(`https://www.amazon.com/Echo-Dot-4th-Gen/dp/${ASIN}/ref=sr_1_3?keywords=echo&qid=1`),
    ).toBe(ASIN);
  });

  it('reads /gp/product/<ASIN> and the mobile /gp/aw/d/<ASIN>', () => {
    expect(parseAsinFromUrl(`https://www.amazon.com/gp/product/${ASIN}`)).toBe(ASIN);
    expect(parseAsinFromUrl(`https://www.amazon.com/gp/aw/d/${ASIN}?x=1`)).toBe(ASIN);
  });

  it('reads an ?asin= query param', () => {
    expect(parseAsinFromUrl(`https://www.amazon.com/gp/aws/cart/add.html?asin=${ASIN}`)).toBe(ASIN);
  });

  it('works on non-.com marketplaces and on a bare host with no scheme', () => {
    expect(parseAsinFromUrl(`https://www.amazon.co.uk/dp/${ASIN}`)).toBe(ASIN);
    expect(parseAsinFromUrl(`amazon.com/dp/${ASIN}`)).toBe(ASIN);
  });

  it('lower-cases in the URL still resolve to an upper-case ASIN', () => {
    expect(parseAsinFromUrl(`https://www.amazon.com/dp/${ASIN.toLowerCase()}`)).toBe(ASIN);
  });

  it('returns null for a short link (it genuinely carries no ASIN)', () => {
    expect(parseAsinFromUrl('https://a.co/d/abcdefg')).toBeNull();
  });

  it('never invents an ASIN from a non-Amazon URL', () => {
    expect(parseAsinFromUrl(`https://www.grainger.com/dp/${ASIN}`)).toBeNull();
    expect(parseAsinFromUrl('https://example.com/products/1234567890')).toBeNull();
  });

  it('returns null for junk', () => {
    expect(parseAsinFromUrl('')).toBeNull();
    expect(parseAsinFromUrl('not a url at all')).toBeNull();
    expect(parseAsinFromUrl('https://www.amazon.com/')).toBeNull();
  });

  it('ignores a pure-letter path segment that merely happens to be 10 chars', () => {
    expect(parseAsinFromUrl('https://www.amazon.com/Sunglasses/s?k=shades')).toBeNull();
  });
});

describe('isAmazonUrl', () => {
  it('accepts amazon marketplaces and short-link hosts', () => {
    expect(isAmazonUrl('https://www.amazon.com/dp/X')).toBe(true);
    expect(isAmazonUrl('https://smile.amazon.com/dp/X')).toBe(true);
    expect(isAmazonUrl('https://www.amazon.co.uk/dp/X')).toBe(true);
    expect(isAmazonUrl('https://a.co/d/xyz')).toBe(true);
    expect(isAmazonUrl('https://amzn.to/xyz')).toBe(true);
  });

  it('rejects everything else, including look-alikes', () => {
    expect(isAmazonUrl('https://www.grainger.com/x')).toBe(false);
    expect(isAmazonUrl('https://notamazon.com.evil.io/dp/X')).toBe(false);
    expect(isAmazonUrl('gibberish')).toBe(false);
  });
});

describe('canonicalAmazonUrl', () => {
  it('is the tracking-free product URL', () => {
    expect(canonicalAmazonUrl(ASIN)).toBe(`https://www.amazon.com/dp/${ASIN}`);
  });
});

describe('resolveAmazonLink (offline)', () => {
  it('resolves from the URL shape alone and reports source "parsed"', async () => {
    const r = await resolveAmazonLink(`https://www.amazon.com/dp/${ASIN}/ref=nosim`, { skipFetch: true });
    expect(r.ok).toBe(true);
    expect(r.asin).toBe(ASIN);
    expect(r.source).toBe('parsed');
    expect(r.source_url).toBe(canonicalAmazonUrl(ASIN));
    expect(r.message).toContain(ASIN);
  });

  it('degrades politely on a garbage URL instead of throwing', async () => {
    const r = await resolveAmazonLink('lol not a link', { skipFetch: true });
    expect(r.ok).toBe(false);
    expect(r.asin).toBeNull();
    expect(r.source).toBe('degraded');
    expect(r.message.length).toBeGreaterThan(10);
  });

  it('degrades with a host-specific hint when the link is not Amazon', async () => {
    const r = await resolveAmazonLink('https://www.grainger.com/product/123', { skipFetch: true });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('grainger.com');
  });

  it('degrades on an Amazon URL with no ASIN in it', async () => {
    const r = await resolveAmazonLink('https://www.amazon.com/gp/help/customer/display.html', { skipFetch: true });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('/dp/');
  });

  // Regression: a search page's HTML is full of data-asin cards. Resolving one
  // used to return whatever product was listed first — a silently wrong mapping.
  it('refuses a search/browse page instead of grabbing the first result', async () => {
    for (const u of [
      'https://www.amazon.com/s?k=masking+tape',
      'https://www.amazon.com/b?node=16310091',
      'https://www.amazon.com/stores/3M/page/ABC',
    ]) {
      const r = await resolveAmazonLink(u, { skipFetch: true });
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/search\/browse page/i);
    }
  });

  it('still resolves a product URL whose ref= tail carries search keywords', async () => {
    const r = await resolveAmazonLink(
      `https://www.amazon.com/Some-Product/dp/${ASIN}/ref=sr_1_5?keywords=masking+tape&qid=1&sr=8-5`,
      { skipFetch: true },
    );
    expect(r.ok).toBe(true);
    expect(r.asin).toBe(ASIN);
  });

  it('degrades on an empty paste', async () => {
    const r = await resolveAmazonLink('   ', { skipFetch: true });
    expect(r.ok).toBe(false);
    expect(r.source).toBe('degraded');
  });
});
