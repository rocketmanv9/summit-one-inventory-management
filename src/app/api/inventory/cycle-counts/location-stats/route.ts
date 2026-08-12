import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Per-location stats for the cycle-count create wizard's "Where" step: how many
// item lines and how many total on-hand units live at each yard, plus when it was
// last counted. One cheap aggregate so each yard card reads instantly — the user
// SEES what they're about to count instead of picking a name from a bare dropdown.
export const GET = createSessionReadRoute(async ({ session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const inv = (supabase as any).schema('inventory');

  // Balances → item-line count + total on-hand, grouped by location. Bounded
  // to the tenant's rows (RLS-scoped client) and capped so it stays cheap.
  const { data: balances, error: balError } = await inv
    .from('stock_balances')
    .select('location_id, catalog_item_id, qty_on_hand')
    .limit(20000);

  if (balError) {
    log.error('cycle_count_location_stats.balances_failed', { error: balError.message });
    throw AppError.internal(balError.message);
  }

  const byLocation = new Map<string, { itemLines: number; totalOnHand: number }>();
  for (const row of (balances || []) as Array<{ location_id: string; catalog_item_id: string; qty_on_hand: number | null }>) {
    if (!row.location_id) continue;
    const qty = Number(row.qty_on_hand) || 0;
    const entry = byLocation.get(row.location_id) || { itemLines: 0, totalOnHand: 0 };
    // Count only lines that actually hold stock — an empty yard shows 0 lines.
    if (qty > 0) entry.itemLines += 1;
    entry.totalOnHand += qty;
    byLocation.set(row.location_id, entry);
  }

  // Last-counted date per location: newest posted/closed/approved count.
  const { data: counts, error: countError } = await inv
    .from('cycle_counts')
    .select('location_id, posted_at, completed_at, status')
    .in('status', ['posted', 'closed', 'approved'])
    .limit(10000);

  if (countError) {
    log.error('cycle_count_location_stats.counts_failed', { error: countError.message });
    throw AppError.internal(countError.message);
  }

  const lastCounted = new Map<string, string>();
  for (const row of (counts || []) as Array<{ location_id: string; posted_at: string | null; completed_at: string | null }>) {
    if (!row.location_id) continue;
    const when = row.posted_at || row.completed_at;
    if (!when) continue;
    const prev = lastCounted.get(row.location_id);
    if (!prev || when > prev) lastCounted.set(row.location_id, when);
  }

  const stats: Record<string, { item_lines: number; total_on_hand: number; last_counted_at: string | null }> = {};
  const locationIds = new Set<string>([...byLocation.keys(), ...lastCounted.keys()]);
  for (const id of locationIds) {
    const bal = byLocation.get(id);
    stats[id] = {
      item_lines: bal?.itemLines ?? 0,
      // Round to avoid trailing float noise in the card copy.
      total_on_hand: bal ? Math.round(bal.totalOnHand * 100) / 100 : 0,
      last_counted_at: lastCounted.get(id) ?? null,
    };
  }

  return Response.json({ data: stats });
}, { serviceName: SERVICE_NAME });
