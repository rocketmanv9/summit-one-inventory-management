import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

interface BlockedRequest {
  id: string;
  employee_id: string;
  employee_name: string | null;
  status: string;
  blocking_reasons: Array<{ type: string; lineId?: string; catalogItemId?: string; needed?: string }>;
  created_at: string;
  trigger_event: string | null;
}

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });
  const prov = (supabase as any).schema('provisioning');

  // Fetch all blocked + failed requests
  const { data: requests, error } = await prov
    .from('provisioning_requests')
    .select('id, employee_id, employee_name, status, blocking_reasons, created_at, trigger_event, shipping_address')
    .eq('tenant_id', session.tenantId!)
    .in('status', ['needs_mapping', 'needs_address', 'needs_sizing', 'failed'])
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    log.error('failure-queue.fetch_error', { error: error.message });
    return Response.json({ data: [], categories: {} });
  }

  const items = (requests ?? []) as BlockedRequest[];

  // Categorize
  const categories: Record<string, BlockedRequest[]> = {
    needs_mapping: [],
    needs_address: [],
    needs_sizing: [],
    failed: [],
  };

  for (const req of items) {
    const category = categories[req.status];
    if (category) {
      category.push(req);
    }
  }

  // Fetch failed line details for failed requests
  const failedRequestIds = categories.failed.map((r) => r.id);
  let failedLines: any[] = [];
  if (failedRequestIds.length > 0) {
    const { data: lines } = await prov
      .from('provisioning_lines')
      .select('id, request_id, catalog_item_id, status, external_order_id, substitution_reason')
      .in('request_id', failedRequestIds)
      .eq('status', 'failed')
      .limit(200);
    failedLines = lines ?? [];
  }

  return Response.json({
    data: items,
    categories: {
      needs_mapping: {
        count: categories.needs_mapping.length,
        requests: categories.needs_mapping,
      },
      needs_address: {
        count: categories.needs_address.length,
        requests: categories.needs_address,
      },
      needs_sizing: {
        count: categories.needs_sizing.length,
        requests: categories.needs_sizing,
      },
      failed: {
        count: categories.failed.length,
        requests: categories.failed,
        failed_lines: failedLines,
      },
    },
    total_count: items.length,
  });
}, { serviceName: SERVICE_NAME });
