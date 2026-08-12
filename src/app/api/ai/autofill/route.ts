/**
 * AI Autofill Suggestions
 * GET /api/ai/autofill?fields=name:cement,location:portland
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { suggestAutofill } from '@/lib/ai/ux/autofill';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session }) => {
  const url = new URL(req.url);
  const fieldsParam = url.searchParams.get('fields') || '';
  const partialData: Record<string, string> = {};
  for (const pair of fieldsParam.split(',')) {
    const [k, v] = pair.split(':');
    if (k && v) partialData[k.trim()] = v.trim();
  }

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId,
  });

  const suggestions = await suggestAutofill(supabase, session.tenantId, session.userId, partialData);
  return Response.json({ data: suggestions });
}, { serviceName: SERVICE_NAME });
