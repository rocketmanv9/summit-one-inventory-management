import { getAdminClient } from '@/utils/supabase/admin';
import { mintMobileJwt } from '@/lib/mobile-auth';
import { MobileCountClient } from './MobileCountClient';

export const dynamic = 'force-dynamic';

// ── Server-side data loader (validates session + fetches everything MobileCountClient needs) ──

async function loadCountData(token: string) {
  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  const { data: session, error: sessionError } = await inv
    .from('mobile_count_sessions')
    .select('id, tenant_id, cycle_count_id, created_by_user_id, expires_at, revoked_at')
    .eq('token', token)
    .single();

  if (sessionError || !session) return { error: 'Invalid session link. Please generate a new QR code.' };
  if (session.revoked_at) return { error: 'This session has been revoked.' };
  if (new Date(session.expires_at) < new Date()) return { error: 'This session has expired. Please generate a new one.' };

  // Fire-and-forget: update last_used_at
  inv.from('mobile_count_sessions')
    .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', session.id).then(() => {}).catch(() => {});

  // Mint JWT + fetch cycle count + lines + asset lines in parallel
  const [jwt, ccResult, linesResult, assetLinesResult] = await Promise.all([
    mintMobileJwt({
      sessionId: session.id,
      tenantId: session.tenant_id,
      cycleCountId: session.cycle_count_id,
      userId: session.created_by_user_id,
    }),
    inv.from('cycle_counts').select('id, count_number, status, location_id, count_type, is_blind').eq('id', session.cycle_count_id).single(),
    inv.from('cycle_count_lines').select('id, catalog_item_id, location_id, qty_expected, qty_counted, variance, line_number').eq('cycle_count_id', session.cycle_count_id).eq('tenant_id', session.tenant_id).limit(500),
    inv.from('cycle_count_asset_lines').select('id, line_number, asset_id, counted_present').eq('cycle_count_id', session.cycle_count_id).eq('tenant_id', session.tenant_id).limit(500),
  ]);

  const cc = ccResult.data;
  let rawLines = linesResult.data || [];
  const countedAssets = assetLinesResult.data || [];

  if (!cc) return { error: 'Cycle count not found.' };

  // Hydrate empty initial counts from stock_balances
  if (cc.count_type === 'initial' && rawLines.length === 0 && cc.status === 'in_progress') {
    await inv.rpc('rpc_inv_cycle_count_hydrate_initial', {
      p_cycle_count_id: session.cycle_count_id,
      p_tenant_id: session.tenant_id,
    });
    // Re-fetch lines after hydration
    const { data: hydratedLines } = await inv
      .from('cycle_count_lines')
      .select('id, catalog_item_id, location_id, qty_expected, qty_counted, variance, line_number')
      .eq('cycle_count_id', session.cycle_count_id)
      .eq('tenant_id', session.tenant_id)
      .limit(500);
    rawLines = hydratedLines || [];
  }

  // Fetch location + catalog items in parallel
  const itemIds = [...new Set(rawLines.map((l: any) => l.catalog_item_id))];
  const [locationResult, itemsResult] = await Promise.all([
    cc.location_id ? inv.from('locations').select('id, name').eq('id', cc.location_id).single() : Promise.resolve({ data: null }),
    itemIds.length > 0 ? inv.from('catalog_items').select('id, name, sku, barcode, tracking_mode, uom_term_id, parent_item_id, variant_attributes').in('id', itemIds) : Promise.resolve({ data: [] }),
  ]);

  const location = locationResult.data;
  const items: any[] = itemsResult.data || [];

  // Asset details for serialized items
  const serializedItemIds = items.filter((i: any) => i.tracking_mode === 'serialized').map((i: any) => i.id);
  let assetDetails: any[] = [];
  if (serializedItemIds.length > 0) {
    const { data: snapshots } = await inv
      .from('cycle_count_snapshot_assets')
      .select('id, asset_id, expected_location_id, expected_status')
      .eq('cycle_count_id', session.cycle_count_id).eq('tenant_id', session.tenant_id).limit(500);
    if (snapshots && snapshots.length > 0) {
      const assetIds = snapshots.map((s: any) => s.asset_id);
      const { data: assets } = await inv.from('assets').select('id, asset_tag, serial_number, status, catalog_item_id').in('id', assetIds);
      assetDetails = assets || [];
    }
  }

  // Parent item names for variants
  const parentIds = [...new Set(items.filter((i: any) => i.parent_item_id).map((i: any) => i.parent_item_id))];
  let parentNameMap = new Map<string, string>();
  if (parentIds.length > 0) {
    const { data: parents } = await inv.from('catalog_items').select('id, name').in('id', parentIds);
    parentNameMap = new Map((parents || []).map((p: any) => [p.id, p.name]));
  }

  // Enrich lines with catalog item data
  const itemMap = new Map(items.map((i: any) => [i.id, i]));
  const enrichedLines = rawLines.map((line: any) => {
    const item = itemMap.get(line.catalog_item_id);
    const parentName = item?.parent_item_id ? parentNameMap.get(item.parent_item_id) || null : null;
    const lineAssets = assetDetails.filter((a: any) => a.catalog_item_id === line.catalog_item_id);
    const lineCounted = countedAssets.filter((ca: any) => ca.line_number === line.line_number && ca.counted_present);
    return {
      ...line,
      catalog_item: item ? { ...item, parent_name: parentName } : null,
      expected_assets: item?.tracking_mode === 'serialized' ? lineAssets : [],
      counted_assets: lineCounted.map((ca: any) => ({ asset_id: ca.asset_id })),
    };
  });

  return {
    initialData: {
      jwt,
      expires_at: session.expires_at,
      cycle_count: {
        id: cc.id,
        count_number: cc.count_number,
        status: cc.status,
        count_type: cc.count_type,
        is_blind: cc.is_blind,
        location: location || null,
      },
      lines: enrichedLines,
    },
  };
}

// ── Page ──

export default async function MobileCountPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const bypass = (sp['x-vercel-protection-bypass'] as string) || process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';

  const result = await loadCountData(token);

  if ('error' in result) {
    return <ErrorPage message={result.error as string} />;
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#f3f4f6' }}>
      {/* Set bypass cookie so JS chunks load through deployment protection */}
      {bypass && (
        <script dangerouslySetInnerHTML={{ __html: `document.cookie="x-vercel-protection-bypass=${bypass};path=/;secure;samesite=lax;max-age=86400";` }} />
      )}
      <MobileCountClient bypassSecret={bypass} initialData={result.initialData} />
    </div>
  );
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f9fafb', padding: '24px',
    }}>
      <div style={{ maxWidth: '384px', width: '100%', textAlign: 'center' }}>
        <div style={{
          width: '64px', height: '64px', margin: '0 auto', background: '#fee2e2',
          borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="32" height="32" fill="none" stroke="#dc2626" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h1 style={{ fontSize: '20px', fontWeight: 600, color: '#111827', marginTop: '16px' }}>Session Error</h1>
        <p style={{ color: '#4b5563', fontSize: '14px', lineHeight: 1.5 }}>{message}</p>
        <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '16px' }}>Scan a new QR code from the desktop to start a new session.</p>
      </div>
    </div>
  );
}
