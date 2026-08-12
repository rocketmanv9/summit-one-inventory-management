/**
 * AI Duplicate Detection
 * GET /api/ai/duplicates?entity_type=item&name=cement
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { checkForDuplicates } from '@/lib/ai/ux/duplicate-detector';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session }) => {
  const url = new URL(req.url);
  const entityType = url.searchParams.get('entity_type') || 'item';
  const name = url.searchParams.get('name') || '';

  if (!name) return Response.json({ data: [] });

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId,
  });

  const candidates = await checkForDuplicates(supabase, session.tenantId, entityType, name);
  return Response.json({ data: candidates });
}, { serviceName: SERVICE_NAME });
