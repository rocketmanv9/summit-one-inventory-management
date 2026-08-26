import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Kit coverage + engine health (item 07, 2026-08-26 wrap-up sprint).
//
// The provisioning engine sat dormant for two weeks and nothing surfaced it —
// every stage person is `skipped_backfill` and no hire has ever matched a kit.
// This endpoint makes that impossible to miss: which positions have kits
// (headcount-weighted), what the provision ledger actually contains, and when
// the engine last genuinely fired.
//
//   GET /api/inventory/position-kits/coverage
//     → 200 { data: {
//         totals: { positions_active, positions_with_kit, people_active, people_covered },
//         positions: [{ hr_position_id, title, people, has_kit }],   // sorted: uncovered-by-headcount first
//         ledger: { total, last_fired_at, by_status: [{ status, count, last_at }] },
//         recent: [{ id, person_name, position_title, status, source, error, at }],
//       } }
export const GET = createSessionReadRoute(async ({ session, log }) => {
  const tenantId = session.tenantId!;
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  const sc = (supabase as any).schema('supply_chain');

  const [positionsRes, peopleRes, kitsRes, ledgerRes] = await Promise.all([
    (supabase as any)
      .from('positions')
      .select('hr_position_id, title, is_active')
      .eq('tenant_id', tenantId)
      .limit(1000),
    (supabase as any)
      .from('hr_people')
      .select('hr_person_id, hr_position_id')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .limit(10000),
    sc
      .from('position_kits')
      .select('id, hr_position_id, active')
      .eq('tenant_id', tenantId)
      .limit(1000),
    sc
      .from('position_kit_provisions')
      .select('id, person_name, position_title, status, source, error, created_at, updated_at, processed_at')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(5000),
  ]);
  for (const [label, res] of [
    ['positions', positionsRes],
    ['people', peopleRes],
    ['kits', kitsRes],
    ['ledger', ledgerRes],
  ] as const) {
    if (res.error) {
      log.error('position_kits.coverage_failed', { step: label, error: res.error.message });
      throw AppError.internal(`${label} lookup failed: ${res.error.message}`);
    }
  }

  // Headcount per position (active people only — coverage is about who works
  // here today, not historical seats).
  const headcount = new Map<string, number>();
  for (const p of peopleRes.data ?? []) {
    if (!p.hr_position_id) continue;
    headcount.set(p.hr_position_id, (headcount.get(p.hr_position_id) ?? 0) + 1);
  }

  const kittedPositions = new Set<string>(
    (kitsRes.data ?? []).filter((k: any) => k.active).map((k: any) => k.hr_position_id),
  );

  // A position matters here if it's active in HR or someone still holds it.
  const positions = (positionsRes.data ?? [])
    .filter((p: any) => p.hr_position_id && (p.is_active !== false || headcount.has(p.hr_position_id)))
    .map((p: any) => ({
      hr_position_id: p.hr_position_id,
      title: p.title ?? '(untitled position)',
      people: headcount.get(p.hr_position_id) ?? 0,
      has_kit: kittedPositions.has(p.hr_position_id),
    }))
    // Uncovered, biggest headcount first — that's the to-do list.
    .sort((a: any, b: any) =>
      a.has_kit === b.has_kit ? b.people - a.people : a.has_kit ? 1 : -1,
    );

  const peopleActive = (peopleRes.data ?? []).length;
  const peopleCovered = positions
    .filter((p: any) => p.has_kit)
    .reduce((s: number, p: any) => s + p.people, 0);

  // Ledger rollup. `provisioned` rows are real fires; everything else is the
  // dormancy story (backfill skips, no-kit skips, errors, stuck claims).
  const byStatus = new Map<string, { count: number; last_at: string | null }>();
  let lastFiredAt: string | null = null;
  for (const r of ledgerRes.data ?? []) {
    const at = r.processed_at ?? r.updated_at ?? r.created_at ?? null;
    const cur = byStatus.get(r.status) ?? { count: 0, last_at: null };
    cur.count += 1;
    if (at && (!cur.last_at || at > cur.last_at)) cur.last_at = at;
    byStatus.set(r.status, cur);
    if (r.status === 'provisioned' && at && (!lastFiredAt || at > lastFiredAt)) lastFiredAt = at;
  }

  const recent = (ledgerRes.data ?? []).slice(0, 8).map((r: any) => ({
    id: r.id,
    person_name: r.person_name,
    position_title: r.position_title,
    status: r.status,
    source: r.source,
    error: r.error,
    at: r.processed_at ?? r.updated_at ?? r.created_at ?? null,
  }));

  return Response.json({
    data: {
      totals: {
        positions_active: positions.length,
        positions_with_kit: positions.filter((p: any) => p.has_kit).length,
        people_active: peopleActive,
        people_covered: peopleCovered,
      },
      positions,
      ledger: {
        total: (ledgerRes.data ?? []).length,
        last_fired_at: lastFiredAt,
        by_status: Array.from(byStatus.entries())
          .map(([status, v]) => ({ status, count: v.count, last_at: v.last_at }))
          .sort((a, b) => b.count - a.count),
      },
      recent,
    },
  });
}, { serviceName: SERVICE_NAME });
