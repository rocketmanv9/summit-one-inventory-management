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

type PageState = 'loading' | 'error' | 'counting';

function bypassHeaders(secret: string): Record<string, string> {
  return secret ? { 'x-vercel-protection-bypass': secret } : {};
}

function withBypass(url: string, secret: string): string {
  if (!secret) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}x-vercel-protection-bypass=${encodeURIComponent(secret)}`;
}

export function MobileCountClient({ bypassSecret }: { bypassSecret: string }) {
  const params = useParams();
  const token = params.token as string;

  const [state, setState] = useState<PageState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [jwt, setJwt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [cycleCount, setCycleCount] = useState<CycleCountMeta | null>(null);
  const [lines, setLines] = useState<CountLine[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [highlightItemId, setHighlightItemId] = useState<string | null>(null);

  const refreshTimerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Validate token on mount
  useEffect(() => {
    validateToken();
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
          'Idempotency-Key': crypto.randomUUID(),
          ...bypassHeaders(bypassSecret),
        },
      });

      clearTimeout(timeout);

      // Vercel protection may return HTML instead of JSON — detect that
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
      const message = err.name === 'AbortError'
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
          'Idempotency-Key': crypto.randomUUID(),
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

  const mobileHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${jwt}`,
    'Idempotency-Key': crypto.randomUUID(),
    ...bypassHeaders(bypassSecret),
  }), [jwt, bypassSecret]);

  const handleRecordCount = useCallback(async (catalogItemId: string, qty: number) => {
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

      // Update local state
      setLines((prev) =>
        prev.map((line) =>
          line.catalog_item_id === catalogItemId
            ? { ...line, qty_counted: qty }
            : line
        )
      );
    } catch (err: any) {
      console.error('Record count error:', err);
    }
  }, [mobileHeaders, bypassSecret]);

  const handleRecordAssets = useCallback(async (lineId: string, assetIds: string[]) => {
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

      // Update local state
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
  }, [mobileHeaders, bypassSecret]);

  const handleBarcodeScan = useCallback(async (decodedText: string) => {
    setScannerOpen(false);

    try {
      const searchParams = new URLSearchParams();
      searchParams.set('barcode', decodedText);

      const res = await fetch(withBypass(`/api/m/count/lookup?${searchParams}`, bypassSecret), {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${jwt}`,
          ...bypassHeaders(bypassSecret),
        },
      });

      if (!res.ok) {
        // Try as SKU
        const skuRes = await fetch(withBypass(`/api/m/count/lookup?sku=${encodeURIComponent(decodedText)}`, bypassSecret), {
          credentials: 'include',
          headers: { 'Authorization': `Bearer ${jwt}`, ...bypassHeaders(bypassSecret) },
        });

        if (!skuRes.ok) {
          // Try as asset tag
          const tagRes = await fetch(withBypass(`/api/m/count/lookup?asset_tag=${encodeURIComponent(decodedText)}`, bypassSecret), {
            credentials: 'include',
            headers: { 'Authorization': `Bearer ${jwt}`, ...bypassHeaders(bypassSecret) },
          });

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
  }, [jwt, bypassSecret]);

  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-600">Validating session...</p>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    const isRetryable = errorMessage.includes('timed out') ||
      errorMessage.includes('deployment protection') ||
      errorMessage.includes('Failed to fetch') ||
      errorMessage.includes('NetworkError') ||
      errorMessage.includes('network');

    if (isRetryable) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
          <div className="max-w-sm w-full text-center space-y-4">
            <div className="w-16 h-16 mx-auto bg-yellow-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-gray-900">Connection Issue</h1>
            <p className="text-gray-600 text-sm">{errorMessage}</p>
            <button
              onClick={() => validateToken()}
              className="mt-4 px-6 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm"
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
