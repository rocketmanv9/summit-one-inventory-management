import { getAdminClient } from '@/utils/supabase/admin';
import { recordCount, toggleAsset, submitCount, lookupBarcode } from './actions';
import type { CSSProperties } from 'react';

export const dynamic = 'force-dynamic';

// ── Styles (inline for Vercel deployment protection bypass) ──

const colors = {
  bg: '#f3f4f6', white: '#ffffff', green50: '#f0fdf4', green100: '#dcfce7',
  green300: '#86efac', green500: '#22c55e', green600: '#16a34a', green700: '#15803d',
  blue500: '#3b82f6', blue600: '#2563eb', blue700: '#1d4ed8',
  gray50: '#f9fafb', gray100: '#f3f4f6', gray200: '#e5e7eb', gray300: '#d1d5db',
  gray400: '#9ca3af', gray500: '#6b7280', gray600: '#4b5563', gray700: '#374151',
  gray900: '#111827', red100: '#fee2e2', red600: '#dc2626', red700: '#b91c1c',
  yellow100: '#fef3c2', yellow700: '#a16207',
};

// ── Data Fetching ──

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

  // Update last_used_at fire-and-forget
  inv.from('mobile_count_sessions')
    .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', session.id).then(() => {}).catch(() => {});

  const [ccResult, linesResult, assetLinesResult] = await Promise.all([
    inv.from('cycle_counts').select('id, count_number, status, location_id, count_type, is_blind').eq('id', session.cycle_count_id).single(),
    inv.from('cycle_count_lines').select('id, catalog_item_id, location_id, qty_expected, qty_counted, variance, line_number').eq('cycle_count_id', session.cycle_count_id).eq('tenant_id', session.tenant_id).limit(500),
    inv.from('cycle_count_asset_lines').select('id, line_number, asset_id, counted_present').eq('cycle_count_id', session.cycle_count_id).eq('tenant_id', session.tenant_id).limit(500),
  ]);

  const cc = ccResult.data;
  const rawLines = linesResult.data || [];
  const countedAssets = assetLinesResult.data || [];

  if (!cc) return { error: 'Cycle count not found.' };

  const itemIds = [...new Set(rawLines.map((l: any) => l.catalog_item_id))];
  const [locationResult, itemsResult] = await Promise.all([
    cc.location_id ? inv.from('locations').select('id, name').eq('id', cc.location_id).single() : Promise.resolve({ data: null }),
    itemIds.length > 0 ? inv.from('catalog_items').select('id, name, sku, barcode, tracking_mode, unit_of_measure').in('id', itemIds) : Promise.resolve({ data: [] }),
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

  const itemMap = new Map(items.map((i: any) => [i.id, i]));
  const enrichedLines = rawLines.map((line: any) => {
    const item = itemMap.get(line.catalog_item_id);
    const lineAssets = assetDetails.filter((a: any) => a.catalog_item_id === line.catalog_item_id);
    const lineCounted = countedAssets.filter((ca: any) => ca.line_number === line.line_number && ca.counted_present);
    return {
      ...line,
      catalog_item: item || null,
      expected_assets: item?.tracking_mode === 'serialized' ? lineAssets : [],
      counted_assets: lineCounted,
    };
  });

  // Compute expiry
  const diffMs = new Date(session.expires_at).getTime() - Date.now();
  let timeLeftText: string;
  let isUrgent = false;
  if (diffMs <= 0) { timeLeftText = 'Expired'; isUrgent = true; }
  else {
    const h = Math.floor(diffMs / 3600000);
    const m = Math.floor((diffMs % 3600000) / 60000);
    timeLeftText = h > 0 ? `${h}h ${m}m left` : `${m}m left`;
    isUrgent = diffMs < 300000;
  }

  return {
    session,
    cycleCount: cc,
    location,
    lines: enrichedLines,
    timeLeftText,
    isUrgent,
    isSubmitted: cc.status !== 'in_progress',
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
  const highlightId = sp.highlight as string | undefined;
  const submitted = sp.submitted === '1';
  const errorMsg = sp.error as string | undefined;
  const searchQuery = ((sp.q as string) || '').toLowerCase();

  const result = await loadCountData(token);

  if ('error' in result) {
    return <ErrorPage message={result.error as string} />;
  }

  const { cycleCount, location, lines, timeLeftText, isUrgent, isSubmitted } = result;

  // Filter lines by search
  const filtered = searchQuery
    ? lines.filter((l: any) =>
        l.catalog_item?.name?.toLowerCase().includes(searchQuery) ||
        l.catalog_item?.sku?.toLowerCase().includes(searchQuery) ||
        l.catalog_item?.barcode?.toLowerCase().includes(searchQuery)
      )
    : lines;

  const itemsCounted = lines.filter((l: any) => l.qty_counted !== null).length;
  const progress = lines.length > 0 ? (itemsCounted / lines.length) * 100 : 0;
  const allDone = itemsCounted === lines.length && lines.length > 0;

  return (
    <div style={{ minHeight: '100dvh', background: colors.bg, display: 'flex', flexDirection: 'column' }}>
      {/* ── Header ── */}
      <div style={{
        background: colors.white, boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        position: 'sticky', top: 0, zIndex: 10, paddingTop: 'env(safe-area-inset-top, 0px)',
      }}>
        <div style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h1 style={{ fontSize: '18px', fontWeight: 700, color: colors.gray900, margin: 0 }}>
                {cycleCount.count_number}
              </h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                <svg width="14" height="14" fill="none" stroke={colors.gray400} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span style={{ fontSize: '14px', color: colors.gray500 }}>{location?.name || 'Unknown'}</span>
              </div>
            </div>
            <div style={{
              fontSize: '13px', fontFamily: 'ui-monospace, monospace', fontWeight: 600,
              padding: '6px 12px', borderRadius: '9999px',
              background: isUrgent ? colors.red100 : colors.gray100,
              color: isUrgent ? colors.red700 : colors.gray600,
            }}>
              {timeLeftText}
            </div>
          </div>
          {/* Progress */}
          <div style={{ marginTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '12px', fontWeight: 500, color: colors.gray700 }}>
                {itemsCounted} of {lines.length} counted
              </span>
              <span style={{ fontSize: '12px', fontWeight: 600, color: allDone ? colors.green600 : colors.blue600 }}>
                {Math.round(progress)}%
              </span>
            </div>
            <div style={{ width: '100%', background: colors.gray200, borderRadius: '9999px', height: '10px', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: '9999px', background: allDone ? colors.green500 : colors.blue600, width: `${progress}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Error/Success banners ── */}
      {errorMsg && (
        <div style={{ margin: '12px 16px 0', padding: '12px 16px', background: colors.red100, borderRadius: '12px', fontSize: '14px', color: colors.red700, fontWeight: 500 }}>
          {errorMsg}
        </div>
      )}
      {submitted && (
        <div style={{ margin: '12px 16px 0', padding: '12px 16px', background: colors.green100, borderRadius: '12px', fontSize: '14px', color: colors.green700, fontWeight: 500, textAlign: 'center' }}>
          Count submitted for review!
        </div>
      )}

      {/* ── Search bar ── */}
      <div style={{
        padding: '12px 20px', background: 'rgba(255,255,255,0.95)',
        position: 'sticky', top: 0, zIndex: 5, borderBottom: `1px solid ${colors.gray200}`,
      }}>
        <form method="GET" action={`/m/count/${token}`} style={{ display: 'flex', gap: '8px' }}>
          <input type="hidden" name="x-vercel-protection-bypass" value={bypass} />
          <input
            type="search"
            name="q"
            defaultValue={searchQuery}
            placeholder="Search items..."
            style={{
              flex: 1, padding: '10px 14px', background: colors.gray100, borderRadius: '10px',
              fontSize: '14px', border: 'none', WebkitAppearance: 'none',
            }}
          />
          <button type="submit" style={{
            padding: '10px 16px', background: colors.blue600, color: colors.white,
            borderRadius: '10px', fontWeight: 600, fontSize: '13px', border: 'none', cursor: 'pointer',
          }}>
            Search
          </button>
        </form>
      </div>

      {/* ── Item List ── */}
      <div style={{ flex: 1, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {filtered.map((line: any) => {
          const isSerialized = line.catalog_item?.tracking_mode === 'serialized';
          const isHighlighted = highlightId === line.catalog_item_id;
          const wrapperStyle: CSSProperties = isHighlighted
            ? { boxShadow: `0 0 0 3px ${colors.blue500}`, borderRadius: '16px' }
            : {};

          return (
            <div key={line.id} style={wrapperStyle}>
              {isSerialized ? (
                <AssetCard line={line} token={token} bypass={bypass} isSubmitted={isSubmitted} />
              ) : (
                <ItemCard line={line} token={token} bypass={bypass} isBlind={cycleCount.is_blind} isSubmitted={isSubmitted} />
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: colors.gray400 }}>
            <p style={{ fontSize: '14px', fontWeight: 500 }}>{searchQuery ? 'No matching items' : 'No items to count'}</p>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{
        position: 'sticky', bottom: 0, background: 'rgba(255,255,255,0.95)',
        borderTop: `1px solid ${colors.gray200}`, padding: '12px 20px',
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)',
        display: 'flex', flexDirection: 'column', gap: '10px',
      }}>
        {/* Lookup form */}
        <form action={lookupBarcode} style={{ display: 'flex', gap: '8px' }}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="_bypass" value={bypass} />
          <input
            type="text"
            name="code"
            placeholder="Type barcode or SKU..."
            style={{
              flex: 1, padding: '12px 14px', fontSize: '15px', borderRadius: '12px',
              border: `1.5px solid ${colors.gray300}`, background: colors.white,
            }}
          />
          <button type="submit" style={{
            padding: '12px 18px', background: colors.blue600, color: colors.white,
            borderRadius: '12px', fontWeight: 600, fontSize: '14px', border: 'none',
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            Look Up
          </button>
        </form>

        {/* Submit */}
        {isSubmitted ? (
          <div style={{
            padding: '14px', borderRadius: '14px', background: colors.green50,
            border: `1px solid ${colors.green300}`, textAlign: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <svg width="18" height="18" fill="none" stroke={colors.green600} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span style={{ fontWeight: 600, fontSize: '15px', color: colors.green700 }}>Submitted for Review</span>
            </div>
            <p style={{ fontSize: '12px', color: colors.gray500, margin: '4px 0 0' }}>Review and approval happens on desktop.</p>
          </div>
        ) : (
          <form action={submitCount}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="_bypass" value={bypass} />
            <button type="submit" style={{
              width: '100%', padding: '16px', background: colors.green600, color: colors.white,
              borderRadius: '14px', fontWeight: 600, fontSize: '16px', border: 'none',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              boxShadow: '0 4px 14px rgba(22,163,74,0.25)',
            }}>
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Submit for Review
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Sub-components (server components, no 'use client') ──

function ItemCard({ line, token, bypass, isBlind, isSubmitted }: {
  line: any; token: string; bypass: string; isBlind: boolean; isSubmitted: boolean;
}) {
  const isCounted = line.qty_counted !== null;

  return (
    <div style={{
      borderRadius: '16px', border: `1px solid ${isCounted ? colors.green300 : colors.gray200}`,
      background: isCounted ? colors.green50 : colors.white, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      <div style={{ padding: '14px 16px' }}>
        {/* Item name */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '15px', color: colors.gray900, lineHeight: '1.3' }}>
              {line.catalog_item?.name || 'Unknown Item'}
            </div>
            {line.catalog_item?.sku && (
              <div style={{ fontSize: '12px', color: colors.gray500, marginTop: '2px', fontFamily: 'ui-monospace, monospace' }}>
                {line.catalog_item.sku}
              </div>
            )}
          </div>
          {isCounted && (
            <div style={{
              width: '24px', height: '24px', background: colors.green500, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: '12px', flexShrink: 0,
            }}>
              <svg width="14" height="14" fill="none" stroke="#fff" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </div>

        {/* Count form */}
        <form action={recordCount} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="_bypass" value={bypass} />
          <input type="hidden" name="catalog_item_id" value={line.catalog_item_id} />

          {!isBlind && (
            <div style={{
              fontSize: '12px', color: colors.gray500, background: colors.gray100,
              padding: '6px 10px', borderRadius: '8px', whiteSpace: 'nowrap',
            }}>
              Exp: <span style={{ fontWeight: 600, color: colors.gray700 }}>{line.qty_expected}</span>
              {line.catalog_item?.unit_of_measure ? ` ${line.catalog_item.unit_of_measure}` : ''}
            </div>
          )}

          <input
            type="number"
            name="qty"
            defaultValue={line.qty_counted ?? ''}
            placeholder="0"
            step="0.01"
            min="0"
            inputMode="decimal"
            readOnly={isSubmitted}
            style={{
              flex: 1, padding: '12px 14px', fontSize: '18px', fontWeight: 700, textAlign: 'center',
              borderRadius: '12px', border: `2px solid ${isCounted ? colors.green300 : colors.gray300}`,
              background: colors.white, color: isCounted ? colors.green700 : colors.gray900,
              WebkitAppearance: 'none', MozAppearance: 'textfield' as any,
            }}
          />

          {!isSubmitted && (
            <button type="submit" style={{
              padding: '12px 16px', background: colors.blue600, color: colors.white,
              borderRadius: '12px', fontWeight: 600, fontSize: '14px', border: 'none',
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
              Save
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

function AssetCard({ line, token, bypass, isSubmitted }: {
  line: any; token: string; bypass: string; isSubmitted: boolean;
}) {
  const assets = line.expected_assets || [];
  const countedSet = new Set((line.counted_assets || []).map((ca: any) => ca.asset_id));
  const foundCount = countedSet.size;
  const allFound = foundCount === assets.length && assets.length > 0;

  return (
    <div style={{
      borderRadius: '16px', border: `1px solid ${allFound ? colors.green300 : colors.gray200}`,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', background: allFound ? colors.green50 : colors.white }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '15px', color: colors.gray900, lineHeight: '1.3' }}>
              {line.catalog_item?.name || 'Unknown Item'}
            </div>
            {line.catalog_item?.sku && (
              <div style={{ fontSize: '12px', color: colors.gray500, marginTop: '2px', fontFamily: 'ui-monospace, monospace' }}>
                {line.catalog_item.sku}
              </div>
            )}
          </div>
          <div style={{
            fontSize: '12px', fontWeight: 600, padding: '4px 10px', borderRadius: '9999px',
            marginLeft: '12px', whiteSpace: 'nowrap',
            background: allFound ? colors.green100 : colors.gray100,
            color: allFound ? colors.green700 : colors.gray600,
          }}>
            {foundCount}/{assets.length}
          </div>
        </div>
      </div>

      {/* Assets */}
      <div style={{ padding: '4px 12px 12px', background: colors.gray50, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {assets.map((asset: any) => {
          const isChecked = countedSet.has(asset.id);
          return (
            <form key={asset.id} action={toggleAsset} style={{ margin: 0 }}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="_bypass" value={bypass} />
              <input type="hidden" name="asset_id" value={asset.id} />
              <input type="hidden" name="line_id" value={line.id} />
              <input type="hidden" name="currently_checked" value={String(isChecked)} />
              <button
                type="submit"
                disabled={isSubmitted}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '14px', borderRadius: '12px', textAlign: 'left',
                  border: `1px solid ${isChecked ? colors.green300 : colors.gray200}`,
                  background: isChecked ? colors.green50 : colors.white,
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)', cursor: isSubmitted ? 'default' : 'pointer',
                  fontSize: '14px',
                }}
              >
                <div style={{
                  width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0,
                  border: `2px solid ${isChecked ? colors.green500 : colors.gray300}`,
                  background: isChecked ? colors.green500 : colors.white,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isChecked && (
                    <svg width="16" height="16" fill="none" stroke="#fff" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: colors.gray900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {asset.asset_tag || asset.serial_number || 'Unnamed Asset'}
                  </div>
                  <div style={{ fontSize: '12px', color: colors.gray500, textTransform: 'capitalize', marginTop: '1px' }}>
                    {asset.status}
                  </div>
                </div>
              </button>
            </form>
          );
        })}

        {assets.length === 0 && (
          <div style={{ fontSize: '12px', color: colors.gray400, textAlign: 'center', padding: '16px 0' }}>
            No assets expected at this location
          </div>
        )}
      </div>
    </div>
  );
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: colors.gray50, padding: '24px',
    }}>
      <div style={{ maxWidth: '384px', width: '100%', textAlign: 'center' }}>
        <div style={{
          width: '64px', height: '64px', margin: '0 auto', background: colors.red100,
          borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="32" height="32" fill="none" stroke={colors.red600} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h1 style={{ fontSize: '20px', fontWeight: 600, color: colors.gray900, marginTop: '16px' }}>Session Error</h1>
        <p style={{ color: colors.gray600, fontSize: '14px', lineHeight: 1.5 }}>{message}</p>
        <p style={{ fontSize: '12px', color: colors.gray500, marginTop: '16px' }}>Scan a new QR code from the desktop to start a new session.</p>
      </div>
    </div>
  );
}
