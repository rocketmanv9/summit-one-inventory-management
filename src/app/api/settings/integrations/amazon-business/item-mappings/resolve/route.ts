/**
 * ASIN Resolution API
 * POST — extract ASIN from Amazon URL or bare ASIN, fetch product metadata
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getSearchProvider } from '@/lib/ai/search-provider';

/** Strip common marketplace noise from a search-result title. */
function cleanProductTitle(raw: string): string {
  return raw
    .replace(/^Amazon\.com\s*:?\s*/i, '')
    .replace(/\s*[-:|]\s*Amazon\.com.*$/i, '')
    .replace(/\s*:\s*(Industrial|Tools|Patio|Health|Office).*$/i, '')
    .trim();
}

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;
const URL_ASIN_PATTERN = /\/(?:dp|gp\/product|ASIN)\/([A-Z0-9]{10})(?:[/?#]|$)/i;

function extractAsin(input: string): string | null {
  const trimmed = input.trim();

  if (ASIN_PATTERN.test(trimmed.toUpperCase())) {
    return trimmed.toUpperCase();
  }

  const match = trimmed.match(URL_ASIN_PATTERN);
  if (match) {
    return match[1].toUpperCase();
  }

  return null;
}

const ResolveSchema = z.object({
  input: z.string().min(1),
});

export const POST = createSessionReadRoute(async ({ req }) => {
  const body = ResolveSchema.parse(await req.json());
  const asin = extractAsin(body.input);

  if (!asin) {
    throw AppError.badRequest(
      'Could not extract a valid ASIN. Paste an Amazon product URL (e.g., amazon.com/dp/B07XYZ1234) or a 10-character ASIN.'
    );
  }

  // Best-effort metadata fetch via Amazon product page OG tags
  let title: string | null = null;
  let imageUrl: string | null = null;
  let price: number | null = null;

  try {
    const productUrl = `https://www.amazon.com/dp/${asin}`;
    const res = await fetch(productUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SummitInventory/1.0)',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const html = await res.text();

      const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i)
        || html.match(/<meta\s+content="([^"]+)"\s+property="og:title"/i);
      if (titleMatch) title = titleMatch[1];

      const imageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
        || html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/i);
      if (imageMatch) imageUrl = imageMatch[1];

      const priceMatch = html.match(/"priceAmount"\s*:\s*"?([\d.]+)"?/i)
        || html.match(/class="a-price-whole"[^>]*>([\d,]+)</)
        || html.match(/<span[^>]*class="[^"]*priceToPay[^"]*"[^>]*>[^$]*\$([\d,.]+)/);
      if (priceMatch) {
        const parsed = parseFloat(priceMatch[1].replace(/,/g, ''));
        if (!isNaN(parsed) && parsed > 0) price = parsed;
      }
    }
  } catch {
    // Metadata fetch is best-effort; ASIN extraction is what matters
  }

  // Amazon frequently blocks server-side scrapes (CAPTCHA / no OG tags). When we
  // couldn't get a title, fall back to a web-search provider (Brave if configured,
  // else OpenAI web search) so the AI draft still has something to work from.
  if (!title) {
    try {
      const provider = getSearchProvider();
      if (provider) {
        const results = await provider.search(`${asin} amazon product`, { maxResults: 5 });
        const hit =
          results.find((r) => r.url?.includes(asin)) ||
          results.find((r) => /amazon\./i.test(r.url || '')) ||
          results[0];
        if (hit?.title) {
          title = cleanProductTitle(hit.title);
          if (!imageUrl && hit.imageUrl) imageUrl = hit.imageUrl;
        }
      }
    } catch {
      // Search fallback is best-effort too — the user can still type a name manually.
    }
  }

  return Response.json({
    data: {
      asin,
      title,
      image_url: imageUrl,
      price,
      product_url: `https://www.amazon.com/dp/${asin}`,
    },
  });
}, { serviceName: SERVICE_NAME });
