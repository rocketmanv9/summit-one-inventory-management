/**
 * Amazon Business Product Search API
 * GET — proxy to Amazon Product Search API for mapping UI
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { getAdminClient } from '@/utils/supabase/admin';
import { resolveAmazonBusinessConfig, searchProducts } from '@/lib/integrations/amazon-business';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ session, req }) => {
  const url = new URL(req.url);
  const query = url.searchParams.get('q') || '';
  const limit = Math.min(Number(url.searchParams.get('limit') || '20'), 50);

  if (!query.trim()) {
    return Response.json({ data: [], total: 0 });
  }

  const adminClient = getAdminClient();
  const config = await resolveAmazonBusinessConfig(adminClient, session.tenantId!);
  const products = await searchProducts(config, query, limit);

  return Response.json({
    data: products.map((p) => ({
      asin: p.asin,
      title: p.title,
      price: p.price,
      availability: p.availability,
      imageUrl: p.imageUrl,
    })),
    total: products.length,
  });
}, { serviceName: SERVICE_NAME });
