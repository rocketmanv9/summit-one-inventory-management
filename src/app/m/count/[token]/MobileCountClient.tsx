'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { MobileCountShell } from '@/components/mobile/MobileCountShell';
import { MobileCountItemList } from '@/components/mobile/MobileCountItemList';
import { BarcodeScannerOverlay } from '@/components/mobile/BarcodeScannerOverlay';
import { MobileSessionExpired } from '@/components/mobile/MobileSessionExpired';

interface CycleCountMeta {
  id: string;
  count_number: string;
  status: string;
  count_type: string;
  is_blind: boolean;
  location: { id: string; name: string } | null;
}

interface CountLine {
  id: string;
  catalog_item_id: string;
  catalog_item?: {
    name: string;
    sku?: string;
    barcode?: string;
    tracking_mode?: string;
    unit_of_measure?: string;
  };
  qty_expected: number;
  qty_counted: number | null;
  expected_assets?: Array<{
    id: string;
    asset_tag?: string;
    serial_number?: string;
    status: string;
  }>;
  counted_assets?: Array<{ asset_id: string }>;
}

interface InitialData {
  jwt: string;
  expires_at: string;
  cycle_count: CycleCountMeta;
  lines: CountLine[];
}

function bypassHeaders(secret: string): Record<string, string> {
  return secret ? { 'x-vercel-protection-bypass': secret } : {};
}

function withBypass(url: string, secret: string): string {
  if (!secret) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}x-vercel-protection-bypass=${encodeURIComponent(secret)}`;
}

export function MobileCountClient({
  bypassSecret,
  initialData,
}: {
  bypassSecret: string;
  initialData?: InitialData;
}) {
  const params = useParams();
  const token = params.token as string;

  const [state, setState] = useState<'loading' | 'error' | 'counting'>(
    initialData ? 'counting' : 'loading'
  );
  const [errorMessage, setErrorMessage] = useState('');
  const [jwt, setJwt] = useState(initialData?.jwt || '');
  const [expiresAt, setExpiresAt] = useState(initialData?.expires_at || '');
  const [cycleCount, setCycleCount] = useState<CycleCountMeta | null>(
    initialData?.cycle_count || null
  );
  const [lines, setLines] = useState<CountLine[]>(initialData?.lines || []);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [highlightItemId, setHighlightItemId] = useState<string | null>(null);

  const refreshTimerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Only validate client-side if no server-provided data
  useEffect(() => {
    if (!initialData) {
      validateToken();
    }
  }, [token]);

  // Set up JWT refresh timer
  useEffect(() => {
    if (!jwt) return;

    // Refresh every 12 minutes (JWT expires at 15)
    refreshTimerRef.current = setInterval(() => {
      refreshJwt();
    }, 12 * 60 * 1000);

    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [jwt, token]);

  const validateToken = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      setState('loading');
      const res = await fetch(withBypass(`/api/m/count/sessions/${token}/validate`, bypassSecret), {
        method: 'POST',
        credentials: 'include',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
          ...bypassHeaders(bypassSecret),
        },
      });

      clearTimeout(timeout);

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        throw new Error(
          `Unexpected response (${res.status}). The request may be blocked by deployment protection.`
        );
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Session invalid (${res.status})`);
      }

      const { data } = await res.json();
      setJwt(data.jwt);
      setExpiresAt(data.expires_at);
      setCycleCount(data.cycle_count);
      setLines(data.lines || []);
      setState('counting');
    } catch (err: any) {
      clearTimeout(timeout);
      const message =
        err.name === 'AbortError'
          ? 'Request timed out — check your connection and try again'
          : err.message || 'Failed to validate session';
      setErrorMessage(message);
      setState('error');
    }
  };

  const refreshJwt = async () => {
    try {
      const res = await fetch(withBypass(`/api/m/count/sessions/${token}/refresh`, bypassSecret), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
          ...bypassHeaders(bypassSecret),
        },
      });

      if (!res.ok) {
        setState('error');
        setErrorMessage('Session expired');
        return;
      }

      const { data } = await res.json();
      setJwt(data.jwt);
    } catch {
      // Silent fail on refresh - will catch on next API call
    }
  };

  const mobileHeaders = useCallback(
    () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
      'X-Idempotency-Key': crypto.randomUUID(),
      ...bypassHeaders(bypassSecret),
    }),
    [jwt, bypassSecret]
  );

  const handleRecordCount = useCallback(
    async (catalogItemId: string, qty: number) => {
      try {
        const res = await fetch(withBypass('/api/m/count/record', bypassSecret), {
          method: 'POST',
          headers: mobileHeaders(),
          body: JSON.stringify({ catalog_item_id: catalogItemId, counted_qty: qty }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (res.status === 401) {
            setState('error');
            setErrorMessage('Session expired');
            return;
          }
          throw new Error(data.error || 'Failed to record count');
        }

        setLines((prev) =>
          prev.map((line) =>
            line.catalog_item_id === catalogItemId ? { ...line, qty_counted: qty } : line
          )
        );
      } catch (err: any) {
        console.error('Record count error:', err);
      }
    },
    [mobileHeaders, bypassSecret]
  );

  const handleRecordAssets = useCallback(
    async (lineId: string, assetIds: string[]) => {
      try {
        const res = await fetch(withBypass('/api/m/count/record-asset', bypassSecret), {
          method: 'POST',
          headers: mobileHeaders(),
          body: JSON.stringify({ line_id: lineId, asset_ids: assetIds }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (res.status === 401) {
            setState('error');
            setErrorMessage('Session expired');
            return;
          }
          throw new Error(data.error || 'Failed to record assets');
        }

        setLines((prev) =>
          prev.map((line) =>
            line.id === lineId
              ? {
                  ...line,
                  qty_counted: assetIds.length,
                  counted_assets: assetIds.map((id) => ({ asset_id: id })),
                }
              : line
          )
        );
      } catch (err: any) {
        console.error('Record asset error:', err);
      }
    },
    [mobileHeaders, bypassSecret]
  );

  const handleBarcodeScan = useCallback(
    async (decodedText: string) => {
      setScannerOpen(false);

      try {
        const searchParams = new URLSearchParams();
        searchParams.set('barcode', decodedText);

        const res = await fetch(withBypass(`/api/m/count/lookup?${searchParams}`, bypassSecret), {
          credentials: 'include',
          headers: {
            Authorization: `Bearer ${jwt}`,
            ...bypassHeaders(bypassSecret),
          },
        });

        if (!res.ok) {
          const skuRes = await fetch(
            withBypass(`/api/m/count/lookup?sku=${encodeURIComponent(decodedText)}`, bypassSecret),
            {
              credentials: 'include',
              headers: { Authorization: `Bearer ${jwt}`, ...bypassHeaders(bypassSecret) },
            }
          );

          if (!skuRes.ok) {
            const tagRes = await fetch(
              withBypass(
                `/api/m/count/lookup?asset_tag=${encodeURIComponent(decodedText)}`,
                bypassSecret
              ),
              {
                credentials: 'include',
                headers: { Authorization: `Bearer ${jwt}`, ...bypassHeaders(bypassSecret) },
              }
            );

            if (!tagRes.ok) {
              alert(`No item found for: ${decodedText}`);
              return;
            }

            const { data } = await tagRes.json();
            if (data.catalog_item) {
              setHighlightItemId(data.catalog_item.id);
              setTimeout(() => setHighlightItemId(null), 3000);
            }
            return;
          }

          const { data } = await skuRes.json();
          if (data.catalog_item) {
            setHighlightItemId(data.catalog_item.id);
            setTimeout(() => setHighlightItemId(null), 3000);
          }
          return;
        }

        const { data } = await res.json();
        if (data.catalog_item) {
          setHighlightItemId(data.catalog_item.id);
          setTimeout(() => setHighlightItemId(null), 3000);
        }
      } catch (err) {
        console.error('Barcode lookup error:', err);
      }
    },
    [jwt, bypassSecret]
  );

  if (state === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '32px', height: '32px',
            border: '4px solid #2563eb', borderTopColor: 'transparent',
            borderRadius: '50%', margin: '0 auto',
            animation: 'm-spin 1s linear infinite',
          }} />
          <p style={{ fontSize: '14px', color: '#4b5563', marginTop: '12px' }}>Validating session...</p>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    const isRetryable =
      errorMessage.includes('timed out') ||
      errorMessage.includes('deployment protection') ||
      errorMessage.includes('Failed to fetch') ||
      errorMessage.includes('NetworkError') ||
      errorMessage.includes('network');

    if (isRetryable) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', padding: '24px' }}>
          <div style={{ maxWidth: '384px', width: '100%', textAlign: 'center' }}>
            <div style={{ width: '64px', height: '64px', margin: '0 auto', background: '#fef9c3', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="32" height="32" fill="none" stroke="#ca8a04" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h1 style={{ fontSize: '20px', fontWeight: 600, color: '#111827', marginTop: '16px' }}>Connection Issue</h1>
            <p style={{ color: '#4b5563', fontSize: '14px', marginTop: '8px' }}>{errorMessage}</p>
            <button
              onClick={() => validateToken()}
              style={{
                marginTop: '16px', padding: '10px 24px',
                background: '#2563eb', color: '#fff', borderRadius: '8px',
                fontWeight: 500, fontSize: '14px', border: 'none', cursor: 'pointer',
              }}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return <MobileSessionExpired message={errorMessage} />;
  }

  const itemsCounted = lines.filter((l) => l.qty_counted !== null).length;

  return (
    <>
      <MobileCountShell
        countNumber={cycleCount?.count_number || ''}
        locationName={cycleCount?.location?.name || 'Unknown'}
        expiresAt={expiresAt}
        itemsCounted={itemsCounted}
        itemsTotal={lines.length}
        onScanClick={() => setScannerOpen(true)}
      >
        <MobileCountItemList
          lines={lines}
          isBlind={cycleCount?.is_blind || false}
          highlightItemId={highlightItemId}
          onRecordCount={handleRecordCount}
          onRecordAssets={handleRecordAssets}
        />
      </MobileCountShell>

      <BarcodeScannerOverlay
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleBarcodeScan}
      />
    </>
  );
}
