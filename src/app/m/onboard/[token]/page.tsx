import { getAdminClient } from '@/utils/supabase/admin';
import {
  setQuantity,
  incrementQty,
  decrementQty,
  addItemToSession,
  quickCreateItem,
  removeItem,
  submitOnboarding,
} from './actions';

export const dynamic = 'force-dynamic';

// ── Styles (inline for Vercel deployment protection bypass) ──

const colors = {
  bg: '#f3f4f6', white: '#ffffff', green50: '#f0fdf4', green100: '#dcfce7',
  green300: '#86efac', green500: '#22c55e', green600: '#16a34a', green700: '#15803d',
  blue500: '#3b82f6', blue600: '#2563eb', blue700: '#1d4ed8',
  gray50: '#f9fafb', gray100: '#f3f4f6', gray200: '#e5e7eb', gray300: '#d1d5db',
  gray400: '#9ca3af', gray500: '#6b7280', gray600: '#4b5563', gray700: '#374151',
  gray900: '#111827', red100: '#fee2e2', red600: '#dc2626', red700: '#b91c1c',
  yellow100: '#fef3c2', yellow700: '#a16207', orange500: '#f97316',
};

// ── Data Fetching ──

async function loadOnboardingData(token: string) {
  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  const { data: session, error: sessionError } = await inv
    .from('mobile_onboarding_sessions')
    .select('id, tenant_id, location_id, created_by_user_id, status, expires_at, revoked_at')
    .eq('token', token)
    .single();

  if (sessionError || !session) return { error: 'Invalid session link. Please generate a new QR code.' };
  if (session.revoked_at) return { error: 'This session has been revoked.' };
  if (new Date(session.expires_at) < new Date()) return { error: 'This session has expired. Please generate a new one.' };
  if (session.status === 'cancelled') return { error: 'This session has been cancelled.' };

  // Update last access fire-and-forget
  inv.from('mobile_onboarding_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', session.id).then(() => {}).catch(() => {});

  // Fetch location + onboarding lines
  const [locResult, linesResult] = await Promise.all([
    inv.from('locations').select('id, name').eq('id', session.location_id).single(),
    inv.from('mobile_onboarding_lines')
      .select('id, catalog_item_id, target_qty, existing_qty')
      .eq('onboarding_session_id', session.id)
      .eq('tenant_id', session.tenant_id)
      .order('created_at', { ascending: true })
      .limit(500),
  ]);

  const location = locResult.data;
  const rawLines = linesResult.data || [];

  // Fetch catalog item details
  const itemIds = [...new Set(rawLines.map((l: any) => l.catalog_item_id))];
  let items: any[] = [];
  if (itemIds.length > 0) {
    const { data: itemData } = await inv
      .from('catalog_items')
      .select('id, name, sku, barcode')
      .in('id', itemIds);
    items = itemData || [];
  }

  const itemMap = new Map(items.map((i: any) => [i.id, i]));

  const enrichedLines = rawLines.map((line: any) => ({
    ...line,
    catalog_item: itemMap.get(line.catalog_item_id) || null,
  }));

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
    location,
    lines: enrichedLines,
    timeLeftText,
    isUrgent,
    isSubmitted: session.status === 'submitted',
  };
}

// ── Page ──

export default async function MobileOnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const bypass = (sp['x-vercel-protection-bypass'] as string) || process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
  const submitted = sp.submitted === '1';
  const errorMsg = sp.error as string | undefined;
  const searchQuery = ((sp.q as string) || '').toLowerCase();

  const result = await loadOnboardingData(token);

  if ('error' in result) {
    return <ErrorPage message={result.error as string} />;
  }

  const { session, location, lines, timeLeftText, isUrgent, isSubmitted } = result;

  // Search catalog items if query provided
  let searchResults: any[] = [];
  const addedItemIds = new Set(lines.map((l: any) => l.catalog_item_id));

  if (searchQuery && !isSubmitted) {
    const admin = getAdminClient();
    const inv = (admin as any).schema('inventory');
    const { data: found } = await inv
      .from('catalog_items')
      .select('id, name, sku, barcode')
      .eq('tenant_id', session.tenant_id)
      .eq('is_active', true)
      .or(`name.ilike.%${searchQuery}%,sku.ilike.%${searchQuery}%,barcode.ilike.%${searchQuery}%`)
      .limit(20);
    searchResults = found || [];
  }

  return (
    <div style={{ minHeight: '100dvh', background: colors.bg, display: 'flex', flexDirection: 'column' }}>
      {bypass && (
        <script dangerouslySetInnerHTML={{ __html: `document.cookie="x-vercel-protection-bypass=${bypass};path=/;secure;samesite=lax;max-age=86400";` }} />
      )}

      {/* ── Header ── */}
      <div style={{
        background: colors.white, boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        position: 'sticky', top: 0, zIndex: 10, paddingTop: 'env(safe-area-inset-top, 0px)',
      }}>
        <div style={{ padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h1 style={{ fontSize: '18px', fontWeight: 700, color: colors.gray900, margin: 0 }}>
                Inventory Onboarding
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
          <div style={{ marginTop: '12px' }}>
            <span style={{ fontSize: '13px', fontWeight: 500, color: colors.gray700 }}>
              {lines.length} item{lines.length !== 1 ? 's' : ''} added
            </span>
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
          Onboarding submitted! Stock has been updated.
        </div>
      )}

      {/* ── Search bar ── */}
      {!isSubmitted && (
        <div style={{
          padding: '12px 20px', background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
          borderBottom: `1px solid ${colors.gray200}`,
        }}>
          <form method="GET" action={`/m/onboard/${token}`} style={{ display: 'flex', gap: '8px' }}>
            <input type="hidden" name="x-vercel-protection-bypass" value={bypass} />
            <input
              type="search"
              name="q"
              defaultValue={searchQuery}
              placeholder="Search items by name, SKU, barcode..."
              style={{
                flex: 1, padding: '10px 14px', background: colors.gray100, borderRadius: '10px',
                fontSize: '16px', border: '1.5px solid transparent',
              }}
            />
            <button type="submit" style={{
              padding: '10px 20px', background: colors.blue600, color: colors.white,
              borderRadius: '10px', fontWeight: 600, fontSize: '14px', border: 'none', cursor: 'pointer',
            }}>
              Search
            </button>
          </form>
        </div>
      )}

      {/* ── Search Results ── */}
      {searchQuery && searchResults.length > 0 && !isSubmitted && (
        <div style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: colors.gray600, marginBottom: '8px' }}>
            Search Results
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {searchResults.map((item: any) => {
              const alreadyAdded = addedItemIds.has(item.id);
              return (
                <div key={item.id} style={{
                  padding: '12px 16px', background: colors.white, borderRadius: '12px',
                  border: `1px solid ${colors.gray200}`, display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '14px', color: colors.gray900 }}>{item.name}</div>
                    {item.sku && (
                      <div style={{ fontSize: '12px', color: colors.gray500, fontFamily: 'ui-monospace, monospace' }}>
                        {item.sku}
                      </div>
                    )}
                  </div>
                  {alreadyAdded ? (
                    <span style={{
                      fontSize: '12px', fontWeight: 600, color: colors.green700,
                      background: colors.green100, padding: '4px 10px', borderRadius: '9999px',
                    }}>
                      Added
                    </span>
                  ) : (
                    <form action={addItemToSession}>
                      <input type="hidden" name="token" value={token} />
                      <input type="hidden" name="_bypass" value={bypass} />
                      <input type="hidden" name="catalog_item_id" value={item.id} />
                      <button type="submit" style={{
                        padding: '6px 16px', background: colors.blue600, color: colors.white,
                        borderRadius: '8px', fontWeight: 600, fontSize: '13px', border: 'none',
                        cursor: 'pointer',
                      }}>
                        Add
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {searchQuery && searchResults.length === 0 && !isSubmitted && (
        <div style={{ padding: '16px', textAlign: 'center', color: colors.gray400, fontSize: '14px' }}>
          No items found for &quot;{searchQuery}&quot;
        </div>
      )}

      {/* ── Onboarding Items List ── */}
      <div style={{ flex: 1, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {lines.length > 0 && (
          <div style={{ fontSize: '13px', fontWeight: 600, color: colors.gray600 }}>
            Onboarding Items
          </div>
        )}
        {lines.map((line: any) => (
          <OnboardingItemCard
            key={line.id}
            line={line}
            token={token}
            bypass={bypass}
            isSubmitted={isSubmitted}
          />
        ))}

        {lines.length === 0 && !searchQuery && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: colors.gray400 }}>
            <svg width="48" height="48" fill="none" stroke={colors.gray300} viewBox="0 0 24 24" style={{ margin: '0 auto 12px' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <p style={{ fontSize: '15px', fontWeight: 500 }}>No items added yet</p>
            <p style={{ fontSize: '13px', marginTop: '4px' }}>Search for items above or create a new one below</p>
          </div>
        )}
      </div>

      {/* ── Quick Create + Footer ── */}
      <div style={{
        position: 'sticky', bottom: 0, background: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        borderTop: `1px solid ${colors.gray200}`, padding: '14px 20px',
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 14px)',
        display: 'flex', flexDirection: 'column', gap: '10px',
      }}>
        {/* Quick Create */}
        {!isSubmitted && (
          <form action={quickCreateItem} style={{ display: 'flex', gap: '8px' }}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="_bypass" value={bypass} />
            <input
              type="text"
              name="name"
              placeholder="New item name..."
              style={{
                flex: 1, padding: '12px 14px', fontSize: '16px', borderRadius: '12px',
                border: `1.5px solid ${colors.gray300}`, background: colors.white,
              }}
            />
            <button type="submit" style={{
              padding: '12px 20px', background: colors.orange500, color: colors.white,
              borderRadius: '12px', fontWeight: 700, fontSize: '15px', border: 'none',
              cursor: 'pointer', whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(249,115,22,0.2)',
            }}>
              Create Item
            </button>
          </form>
        )}

        {/* Submit */}
        {isSubmitted ? (
          <div style={{
            padding: '16px', borderRadius: '14px', background: colors.green50,
            border: `1.5px solid ${colors.green300}`, textAlign: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <svg width="20" height="20" fill="none" stroke={colors.green600} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              <span style={{ fontWeight: 700, fontSize: '16px', color: colors.green700 }}>Onboarding Complete</span>
            </div>
            <p style={{ fontSize: '13px', color: colors.gray500, margin: '6px 0 0' }}>Stock balances have been updated.</p>
          </div>
        ) : (
          <form action={submitOnboarding}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="_bypass" value={bypass} />
            <button
              type="submit"
              disabled={lines.length === 0}
              style={{
                width: '100%', padding: '16px 20px',
                background: lines.length === 0 ? colors.gray300 : colors.green600,
                color: colors.white,
                borderRadius: '14px', fontWeight: 700, fontSize: '16px', border: 'none',
                cursor: lines.length === 0 ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                boxShadow: lines.length === 0 ? 'none' : '0 4px 14px rgba(22,163,74,0.3)',
                letterSpacing: '-0.01em',
                opacity: lines.length === 0 ? 0.6 : 1,
              }}
            >
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              Submit Onboarding
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Sub-components (server components, no 'use client') ──

function OnboardingItemCard({ line, token, bypass, isSubmitted }: {
  line: any; token: string; bypass: string; isSubmitted: boolean;
}) {
  const hasChanged = line.target_qty !== line.existing_qty;

  return (
    <div style={{
      borderRadius: '16px', border: `1px solid ${hasChanged ? colors.green300 : colors.gray200}`,
      background: hasChanged ? colors.green50 : colors.white, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    }}>
      <div style={{ padding: '14px 16px' }}>
        {/* Item header with remove button */}
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
            <div style={{ fontSize: '12px', color: colors.gray500, marginTop: '4px' }}>
              Current stock: <span style={{ fontWeight: 600, color: colors.gray700 }}>{line.existing_qty}</span>
            </div>
          </div>
          {!isSubmitted && (
            <form action={removeItem} style={{ marginLeft: '8px' }}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="_bypass" value={bypass} />
              <input type="hidden" name="line_id" value={line.id} />
              <button type="submit" style={{
                width: '28px', height: '28px', borderRadius: '8px',
                border: `1px solid ${colors.gray200}`, background: colors.white,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: colors.red600, fontSize: '16px',
              }}>
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </form>
          )}
          {hasChanged && (
            <div style={{
              width: '24px', height: '24px', background: colors.green500, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: '8px', flexShrink: 0,
            }}>
              <svg width="14" height="14" fill="none" stroke="#fff" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          )}
        </div>

        {/* Quantity controls */}
        {!isSubmitted ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Decrement */}
            <form action={decrementQty}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="_bypass" value={bypass} />
              <input type="hidden" name="line_id" value={line.id} />
              <input type="hidden" name="current_qty" value={line.target_qty} />
              <button type="submit" style={{
                width: '48px', height: '48px', borderRadius: '12px',
                border: `2px solid ${colors.gray300}`, background: colors.white,
                fontSize: '24px', fontWeight: 700, color: colors.gray700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
              }}>
                -
              </button>
            </form>

            {/* Quantity input + Save */}
            <form action={setQuantity} style={{ flex: 1, display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="_bypass" value={bypass} />
              <input type="hidden" name="line_id" value={line.id} />
              <input
                type="number"
                name="qty"
                defaultValue={line.target_qty}
                min="0"
                step="0.01"
                inputMode="decimal"
                style={{
                  flex: 1, minWidth: 0, padding: '12px 8px', fontSize: '20px', fontWeight: 700,
                  textAlign: 'center', borderRadius: '12px',
                  border: `2px solid ${hasChanged ? colors.green300 : colors.gray300}`,
                  background: hasChanged ? '#f7fef9' : colors.white,
                  color: hasChanged ? colors.green700 : colors.gray900,
                }}
              />
              <button type="submit" style={{
                padding: '12px 18px', background: colors.blue600, color: colors.white,
                borderRadius: '12px', fontWeight: 700, fontSize: '15px', border: 'none',
                cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                boxShadow: '0 2px 8px rgba(37,99,235,0.2)',
              }}>
                Save
              </button>
            </form>

            {/* Increment */}
            <form action={incrementQty}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="_bypass" value={bypass} />
              <input type="hidden" name="line_id" value={line.id} />
              <input type="hidden" name="current_qty" value={line.target_qty} />
              <button type="submit" style={{
                width: '48px', height: '48px', borderRadius: '12px',
                border: `2px solid ${colors.gray300}`, background: colors.white,
                fontSize: '24px', fontWeight: 700, color: colors.gray700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
              }}>
                +
              </button>
            </form>
          </div>
        ) : (
          <div style={{
            padding: '10px', background: colors.gray50, borderRadius: '10px',
            textAlign: 'center', fontSize: '18px', fontWeight: 700,
            color: hasChanged ? colors.green700 : colors.gray600,
          }}>
            {line.target_qty}
            {hasChanged && (
              <span style={{ fontSize: '13px', fontWeight: 500, color: colors.gray500, marginLeft: '8px' }}>
                (was {line.existing_qty})
              </span>
            )}
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
