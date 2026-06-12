import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// XP: counting work earns points, accuracy earns bonus points.
const XP_PER_LINE = 10;
const XP_PER_ACCURATE_LINE = 5;
const XP_PER_COUNT = 50;

const LEVEL_TITLES = [
  'Rookie Counter',      // 1
  'Stock Scout',         // 2
  'Shelf Sheriff',       // 3
  'Bin Boss',            // 4
  'Variance Hunter',     // 5
  'Audit Ace',           // 6
  'Count Captain',       // 7
  'Inventory Inquisitor',// 8
  'Ledger Legend',       // 9
  'Grand Auditor',       // 10
];

// Cumulative XP needed to reach a level (level 1 = 0, 2 = 500, 3 = 1500, …)
const xpForLevel = (level: number) => 250 * level * (level - 1);

function levelFromXp(xp: number) {
  let level = 1;
  while (level < LEVEL_TITLES.length && xp >= xpForLevel(level + 1)) level++;
  const floor = xpForLevel(level);
  const ceil = level < LEVEL_TITLES.length ? xpForLevel(level + 1) : floor;
  return {
    level,
    title: LEVEL_TITLES[level - 1],
    xp,
    xp_into_level: xp - floor,
    xp_for_next: level < LEVEL_TITLES.length ? ceil - floor : null,
    progress: level < LEVEL_TITLES.length ? (xp - floor) / (ceil - floor) : 1,
  };
}

export const GET = createSessionReadRoute(async ({ session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv.rpc('rpc_inv_count_insights', {
    p_tenant_id: session.tenantId,
  });

  if (error) {
    log.error('count_insights.failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  // Resolve leaderboard names and compute XP/levels
  const rawUsers: any[] = data?.users || [];
  let leaderboard: any[] = [];
  if (rawUsers.length > 0) {
    const { data: users } = await (supabase as any)
      .from('local_users')
      .select('user_id, name, email')
      .in('user_id', rawUsers.map(u => u.user_id))
      .limit(100);
    const nameById = Object.fromEntries(
      (users || []).map((u: any) => [u.user_id, u.name || u.email || 'Unknown'])
    );

    leaderboard = rawUsers
      .map(u => {
        const lines = Number(u.lines_counted) || 0;
        const accurate = Number(u.accurate_lines) || 0;
        const counts = Number(u.counts_completed) || 0;
        const xp = lines * XP_PER_LINE + accurate * XP_PER_ACCURATE_LINE + counts * XP_PER_COUNT;
        return {
          user_id: u.user_id,
          name: nameById[u.user_id] || 'Unknown',
          lines_counted: lines,
          accurate_lines: accurate,
          counts_completed: counts,
          accuracy_pct: lines > 0 ? Math.round((accurate / lines) * 1000) / 10 : null,
          ...levelFromXp(xp),
        };
      })
      .sort((a, b) => b.xp - a.xp);
  }

  return Response.json({
    data: {
      heatmap: data?.heatmap || [],
      totals: data?.totals || {},
      adherence: data?.adherence || {},
      locations: data?.locations || [],
      leaderboard,
    },
  });
}, { serviceName: SERVICE_NAME });
