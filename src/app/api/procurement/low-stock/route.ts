/**
 * Low Stock Items
 * GET — list inventory items below their reorder point
 *
 * Joins reorder_rules with stock balance data to identify items needing replenishment.
 * Since stock balances live in the public schema and reorder rules in procurement schema,
 * we query both and join in-application.
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session }) => {
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
  const offset = (page - 1) * limit;

  const adminClient = getAdminClient();
  const proc = (adminClient as any).schema('procurement');

  // Get all active reorder rules for the tenant
  const { data: rules, error: rulesError } = await proc
    .from('reorder_rules')
    .select('*')
    .eq('tenant_id', session.tenantId!)
    .eq('is_active', true)
    .order('item_name', { ascending: true })
    .range(offset, offset + limit - 1);

  if (rulesError) throw AppError.internal(rulesError.message);
  if (!rules || rules.length === 0) {
    return Response.json({ data: [], meta: { total: 0, page, pageSize: limit } });
  }

  // Get stock balances for the catalog items with rules
  const catalogItemIds = rules.map((r: any) => r.catalog_item_id);

  const { data: stockRows } = await adminClient
    .from('stock_balances')
    .select('catalog_item_id, qty_on_hand')
    .eq('tenant_id', session.tenantId!)
    .in('catalog_item_id', catalogItemIds)
    .limit(catalogItemIds.length);

  // Build a map of catalog_item_id -> qty_on_hand
  const stockMap = new Map<string, number>();
  for (const row of (stockRows || [])) {
    const existing = stockMap.get(row.catalog_item_id) || 0;
    stockMap.set(row.catalog_item_id, existing + (row.qty_on_hand || 0));
  }

  // Combine rules with stock data and filter to low-stock items
  const lowStockItems = rules
    .map((rule: any) => {
      const currentStock = stockMap.get(rule.catalog_item_id) || 0;
      const gap = rule.reorder_point - currentStock;
      return {
        ...rule,
        current_stock: currentStock,
        gap: Math.max(0, gap),
        is_low: currentStock <= rule.reorder_point,
      };
    })
    .filter((item: any) => item.is_low);

  return Response.json({
    data: lowStockItems,
    meta: {
      total: lowStockItems.length,
      page,
      pageSize: limit,
      total_rules: rules.length,
    },
  });
}, { serviceName: SERVICE_NAME });
