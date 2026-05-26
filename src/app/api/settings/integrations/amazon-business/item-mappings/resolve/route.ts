/**
 * ASIN Resolution API
 * POST — extract ASIN from Amazon URL or bare ASIN, fetch product metadata
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

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
