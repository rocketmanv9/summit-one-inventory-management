import { createWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { mintMobileJwt } from '@/lib/mobile-auth';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function getToken(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const idx = segments.indexOf('sessions');
  const token = idx >= 0 ? segments[idx + 1] : undefined;
  if (!token) throw AppError.badRequest('Missing token');
  return token;
}

export const POST = createWriteRoute(async ({ req, log, idempotencyKey }) => {
  const token = getToken(req);
  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  // Look up session
  const { data: session, error } = await inv
    .from('mobile_count_sessions')
    .select('id, tenant_id, cycle_count_id, created_by_user_id, expires_at, revoked_at, ttl_minutes')
    .eq('token', token)
    .single();

  if (error || !session) throw AppError.notFound('Invalid session token');
  if (session.revoked_at) throw AppError.unauthorized('Session has been revoked');
  if (new Date(session.expires_at) < new Date()) throw AppError.unauthorized('Session has expired');

  // Fire-and-forget: update last_used_at (don't block the response)
  inv
    .from('mobile_count_sessions')
    .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', session.id)
    .then(() => {})
    .catch(() => {});

  // Mint JWT + fetch cycle count metadata + lines + counted assets in parallel
  const [jwt, ccResult, linesResult, assetLinesResult] = await Promise.all([
    mintMobileJwt({
      sessionId: session.id,
      tenantId: session.tenant_id,
      cycleCountId: session.cycle_count_id,
      userId: session.created_by_user_id,
    }),
    inv
      .from('cycle_counts')
      .select('id, count_number, status, location_id, count_type, is_blind, snapshot_at')
      .eq('id', session.cycle_count_id)
      .single(),
    inv
      .from('cycle_count_lines')
      .select('id, catalog_item_id, location_id, qty_expected, qty_counted, variance')
      .eq('cycle_count_id', session.cycle_count_id)
      .eq('tenant_id', session.tenant_id)
      .limit(500),
    inv
      .from('cycle_count_asset_lines')
      .select('id, line_number, asset_id, counted_present')
      .eq('cycle_count_id', session.cycle_count_id)
      .eq('tenant_id', session.tenant_id)
      .limit(500),
  ]);

  const cc = ccResult.data;
  const lines = linesResult.data || [];
  const countedAssets = assetLinesResult.data || [];

  // Fetch location + catalog items in parallel (both depend on first batch)
  const itemIds = [...new Set(lines.map((l: any) => l.catalog_item_id))];
  const [locationResult, itemsResult] = await Promise.all([
    cc?.location_id
      ? inv.from('locations').select('id, name').eq('id', cc.location_id).single()
      : Promise.resolve({ data: null }),
    itemIds.length > 0
      ? inv.from('catalog_items').select('id, name, sku, barcode, tracking_mode, unit_of_measure, parent_item_id, variant_attributes').in('id', itemIds)
      : Promise.resolve({ data: [] }),
  ]);

  const location = locationResult.data;
  const items: any[] = itemsResult.data || [];

  // Fetch asset details for serialized items (depends on items)
  const serializedItemIds = items.filter(i => i.tracking_mode === 'serialized').map(i => i.id);
  let assetDetails: any[] = [];
  if (serializedItemIds.length > 0) {
    const { data: snapshots } = await inv
      .from('cycle_count_snapshot_assets')
      .select('id, asset_id, expected_location_id, expected_status')
      .eq('cycle_count_id', session.cycle_count_id)
      .eq('tenant_id', session.tenant_id)
      .limit(500);

    if (snapshots && snapshots.length > 0) {
      const assetIds = snapshots.map((s: any) => s.asset_id);
      const { data: assets } = await inv
        .from('assets')
        .select('id, asset_tag, serial_number, status, catalog_item_id')
        .in('id', assetIds);
      assetDetails = assets || [];
    }
  }

  // Fetch parent item names for variants
  const parentIds = [...new Set(items.filter((i: any) => i.parent_item_id).map((i: any) => i.parent_item_id))];
  let parentNameMap = new Map<string, string>();
  if (parentIds.length > 0) {
    const { data: parents } = await inv.from('catalog_items').select('id, name').in('id', parentIds);
    parentNameMap = new Map((parents || []).map((p: any) => [p.id, p.name]));
  }

  // Merge items into lines
  const itemMap = new Map(items.map((i: any) => [i.id, i]));
  const enrichedLines = lines.map((line: any) => {
    const item = itemMap.get(line.catalog_item_id);
    const parentName = item?.parent_item_id ? parentNameMap.get(item.parent_item_id) || null : null;
    const lineAssets = assetDetails
      .filter((a: any) => a.catalog_item_id === line.catalog_item_id);
    const lineCounted = countedAssets
      .filter((ca: any) => ca.line_number === line.line_number && ca.counted_present);
    return {
      ...line,
      catalog_item: item ? { ...item, parent_name: parentName } : null,
      expected_assets: item?.tracking_mode === 'serialized' ? lineAssets : [],
      counted_assets: lineCounted.map((ca: any) => ({ asset_id: ca.asset_id })),
    };
  });

  log.info('mobile_count_session.validated', { sessionId: session.id });

  return {
    data: {
      jwt,
      expires_at: session.expires_at,
      cycle_count: {
        id: cc?.id,
        count_number: cc?.count_number,
        status: cc?.status,
        count_type: cc?.count_type,
        is_blind: cc?.is_blind,
        location: location || null,
      },
      lines: enrichedLines,
    },
    status: 200,
    // No events — validate is a read-heavy operation; the chassis emitOutbox
    // fails with "system" tenant_id on unauthenticated write routes (UUID column).
    events: [],
  };
}, {
  serviceName: SERVICE_NAME,
  scope: 'POST /api/m/count/sessions/:token/validate',
  authenticate: async () => {
    const supabase = getAdminClient();
    return { tenantId: '00000000-0000-0000-0000-000000000000', userId: '00000000-0000-0000-0000-000000000000', supabase };
  },
});
