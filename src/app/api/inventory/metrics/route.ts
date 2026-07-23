/**
 * GET /api/inventory/metrics
 *
 * Time-series metrics for a hand-picked set of catalog items, powering the
 * Metrics page (/inventory/metrics). Reads the nightly
 * inventory.daily_item_activity rollup (see fn_rollup_daily_item_activity) and
 * reconstructs a stock-on-hand series by walking today's balance backwards
 * through each day's net_change.
 *
 * Query params:
 *   items  — comma-separated catalog_item_ids (required, max 8)
 *   days   — trailing window: 30 | 90 | 180 | 365 (default 90)
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const MAX_ITEMS = 8;
const ALLOWED_DAYS = new Set([30, 90, 180, 365]);

interface DayPoint {
  date: string;
  received: number;
  issued: number;
  net: number;
  spend: number;
  on_hand: number;
}

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const itemsParam = (url.searchParams.get('items') || '').trim();
  const days = Number(url.searchParams.get('days') || 90);

  if (!itemsParam) throw AppError.badRequest('items query param is required');
  if (!ALLOWED_DAYS.has(days)) throw AppError.badRequest('days must be one of 30, 90, 180, 365');

  const itemIds = [...new Set(itemsParam.split(',').map((s) => s.trim()).filter(Boolean))];
  if (itemIds.length === 0) throw AppError.badRequest('items query param is required');
  if (itemIds.length > MAX_ITEMS) throw AppError.badRequest(`Pick at most ${MAX_ITEMS} items`);

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });
  const inv = (supabase as any).schema('inventory');

  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - days);
  const startIso = startDate.toISOString().slice(0, 10);

  const [itemsRes, activityRes, balancesRes, velocityRes] = await Promise.all([
    inv.from('catalog_items')
      .select('id, name, sku, reorder_point')
      .in('id', itemIds)
      .limit(MAX_ITEMS),
    inv.from('daily_item_activity')
      .select('catalog_item_id, activity_date, qty_received, qty_issued, net_change, spend')
      .in('catalog_item_id', itemIds)
      .gte('activity_date', startIso)
      .order('activity_date', { ascending: true })
      .limit(20000),
    inv.from('stock_balances')
      .select('catalog_item_id, qty_on_hand')
      .in('catalog_item_id', itemIds)
      .limit(2000),
    inv.from('mv_item_velocity')
      .select('catalog_item_id, usage_30d, days_of_stock')
      .in('catalog_item_id', itemIds)
      .limit(2000),
  ]);

  for (const r of [itemsRes, activityRes, balancesRes, velocityRes]) {
    if (r.error) {
      log.error('metrics.query_failed', { error: r.error.message });
      throw AppError.internal(r.error.message);
    }
  }

  // Current on-hand per item (summed across locations).
  const onHandNow = new Map<string, number>();
  for (const b of balancesRes.data ?? []) {
    onHandNow.set(b.catalog_item_id, (onHandNow.get(b.catalog_item_id) ?? 0) + Number(b.qty_on_hand ?? 0));
  }

  // 30d usage / days-of-stock per item (worst location's days_of_stock).
  const usage30 = new Map<string, number>();
  const daysOfStock = new Map<string, number | null>();
  for (const v of velocityRes.data ?? []) {
    usage30.set(v.catalog_item_id, (usage30.get(v.catalog_item_id) ?? 0) + Number(v.usage_30d ?? 0));
    const d = v.days_of_stock == null ? null : Number(v.days_of_stock);
    const prev = daysOfStock.get(v.catalog_item_id);
    if (prev === undefined || (d != null && (prev == null || d < prev))) {
      daysOfStock.set(v.catalog_item_id, d);
    }
  }

  // Daily activity per item, aggregated across locations.
  const byItemDay = new Map<string, Map<string, { received: number; issued: number; net: number; spend: number }>>();
  for (const a of activityRes.data ?? []) {
    let days_ = byItemDay.get(a.catalog_item_id);
    if (!days_) byItemDay.set(a.catalog_item_id, (days_ = new Map()));
    const key = a.activity_date;
    const agg = days_.get(key) ?? { received: 0, issued: 0, net: 0, spend: 0 };
    agg.received += Number(a.qty_received ?? 0);
    agg.issued += Number(a.qty_issued ?? 0);
    agg.net += Number(a.net_change ?? 0);
    agg.spend += Number(a.spend ?? 0);
    days_.set(key, agg);
  }

  // Continuous day axis from start to today.
  const dates: string[] = [];
  const cursor = new Date(startIso + 'T00:00:00Z');
  const today = new Date().toISOString().slice(0, 10);
  while (cursor.toISOString().slice(0, 10) <= today) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const items = (itemsRes.data ?? []).map((item: any) => {
    const dayMap = byItemDay.get(item.id) ?? new Map();
    const current = onHandNow.get(item.id) ?? 0;

    // Walk backwards: on_hand at end of day D = on_hand(D+1) - net(D+1).
    const series: DayPoint[] = new Array(dates.length);
    let running = current;
    for (let i = dates.length - 1; i >= 0; i--) {
      const d = dates[i];
      const agg = dayMap.get(d) ?? { received: 0, issued: 0, net: 0, spend: 0 };
      series[i] = { date: d, received: agg.received, issued: agg.issued, net: agg.net, spend: agg.spend, on_hand: running };
      running -= agg.net;
    }

    let totalReceived = 0, totalIssued = 0, totalSpend = 0;
    for (const p of series) { totalReceived += p.received; totalIssued += p.issued; totalSpend += p.spend; }

    return {
      id: item.id,
      name: item.name,
      sku: item.sku,
      reorder_point: item.reorder_point != null ? Number(item.reorder_point) : null,
      current_on_hand: current,
      usage_30d: usage30.get(item.id) ?? 0,
      days_of_stock: daysOfStock.get(item.id) ?? null,
      total_received: totalReceived,
      total_issued: totalIssued,
      total_spend: totalSpend,
      series,
    };
  });

  return Response.json({ data: { start_date: startIso, end_date: today, days, items } });
}, { serviceName: SERVICE_NAME });
