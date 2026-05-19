/**
 * Printify Products List API
 * GET — pass-through to Printify products API for mapping UI
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { getAdminClient } from '@/utils/supabase/admin';
import { resolvePrintifyConfig, listPrintifyProducts } from '@/lib/integrations/printify';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ session, log }) => {
  const adminClient = getAdminClient();
  const config = await resolvePrintifyConfig(adminClient, session.tenantId!);
  const result = await listPrintifyProducts(config);

  return Response.json({
    data: (result.data || []).map((p) => ({
      id: p.id,
      title: p.title,
      variants: (p.variants || [])
        .filter((v) => v.is_enabled)
        .map((v) => ({
          id: v.id,
          title: v.title,
          sku: v.sku,
          price: v.price,
        })),
      image: p.images?.[0]?.src || null,
    })),
    total: result.total,
  });
}, { serviceName: SERVICE_NAME });
