/**
 * Amazon Business Product Search API
 * GET — search Amazon catalog for supplier SKU mapping
 *
 * Stubbed: the SP-API product search proxy has been removed. Product lookup
 * for ASIN mapping will use Amazon Business's Punchout catalog or manual entry.
 * This route remains as a placeholder for future catalog search integration.
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req }) => {
  const url = new URL(req.url);
  const query = url.searchParams.get('q') || '';

  if (!query.trim()) {
    return Response.json({ data: [], total: 0 });
  }

  return Response.json({
    data: [],
    total: 0,
    message: 'Product search is not yet available via cXML integration. Use Amazon Business Punchout or enter ASINs manually when creating mappings.',
  });
}, { serviceName: SERVICE_NAME });
