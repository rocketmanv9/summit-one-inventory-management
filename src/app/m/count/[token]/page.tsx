import { getAdminClient } from '@/utils/supabase/admin';
import { mintMobileJwt } from '@/lib/mobile-auth';
import { MobileCountClient } from './MobileCountClient';
import { MobileSessionExpired } from '@/components/mobile/MobileSessionExpired';

export const dynamic = 'force-dynamic';

interface InitialData {
  jwt: string;
  expires_at: string;
  cycle_count: {
    id: string;
    count_number: string;
    status: string;
    count_type: string;
    is_blind: boolean;
    location: { id: string; name: string } | null;
  };
  lines: any[];
}

export default async function MobileCountPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';

  // ── Validate session server-side (no client fetch needed) ──
  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  const { data: session, error: sessionError } = await inv
    .from('mobile_count_sessions')
    .select('id, tenant_id, cycle_count_id, created_by_user_id, expires_at, revoked_at, ttl_minutes')
    .eq('token', token)
    .single();

  if (sessionError || !session) {
    return <MobileSessionExpired message="Invalid session link. Please generate a new QR code from your desktop." />;
  }
  if (session.revoked_at) {
    return <MobileSessionExpired message="This session has been revoked." />;
  }
  if (new Date(session.expires_at) < new Date()) {
    return <MobileSessionExpired message="This session has expired. Please generate a new one." />;
  }

  // Fire-and-forget: update last_used_at
  inv
    .from('mobile_count_sessions')
    .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', session.id)
    .then(() => {})
    .catch(() => {});

  // ── Fetch all count data server-side ──
  let initialData: InitialData;
  try {
    const [jwt, ccResult, linesResult, assetLinesResult] = await Promise.all([
      mintMobileJwt({
        sessionId: session.id,
        tenantId: session.tenant_id,
        cycleCountId: session.cycle_count_id,
        userId: session.created_by_user_id,
      }),
      inv
        .from('cycle_counts')
        .select('id, count_number, status, location_id, count_type, is_blind')
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

    // Fetch location + catalog items in parallel
    const itemIds = [...new Set(lines.map((l: any) => l.catalog_item_id))];
    const [locationResult, itemsResult] = await Promise.all([
      cc?.location_id
        ? inv.from('locations').select('id, name').eq('id', cc.location_id).single()
        : Promise.resolve({ data: null }),
      itemIds.length > 0
        ? inv.from('catalog_items').select('id, name, sku, barcode, tracking_mode, unit_of_measure').in('id', itemIds)
        : Promise.resolve({ data: [] }),
    ]);

    const location = locationResult.data;
    const items: any[] = itemsResult.data || [];

    // Fetch asset details for serialized items
    const serializedItemIds = items
      .filter((i: any) => i.tracking_mode === 'serialized')
      .map((i: any) => i.id);
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

    // Enrich lines with catalog items + counted asset data
    const itemMap = new Map(items.map((i: any) => [i.id, i]));
    const enrichedLines = lines.map((line: any) => {
      const item = itemMap.get(line.catalog_item_id);
      const lineAssets = assetDetails.filter(
        (a: any) => a.catalog_item_id === line.catalog_item_id
      );
      const lineCounted = countedAssets.filter(
        (ca: any) => ca.line_number === line.line_number && ca.counted_present
      );
      return {
        ...line,
        catalog_item: item || null,
        expected_assets: item?.tracking_mode === 'serialized' ? lineAssets : [],
        counted_assets: lineCounted.map((ca: any) => ({ asset_id: ca.asset_id })),
      };
    });

    initialData = {
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
    };
  } catch {
    return <MobileSessionExpired message="Failed to load count data. Please try scanning again." />;
  }

  return <MobileCountClient bypassSecret={bypassSecret} initialData={initialData} />;
}
