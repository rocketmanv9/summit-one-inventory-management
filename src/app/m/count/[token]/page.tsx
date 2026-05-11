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

function getBypassSecret(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('x-vercel-protection-bypass');
}

function getBypassHeaders(): Record<string, string> {
  const bypass = getBypassSecret();
  return bypass ? { 'x-vercel-protection-bypass': bypass } : {};
}

/** Append bypass query param to API URLs so Vercel lets them through on mobile */
function withBypass(url: string): string {
  const bypass = getBypassSecret();
  if (!bypass) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}x-vercel-protection-bypass=${encodeURIComponent(bypass)}`;
}

export default function MobileCountPage() {
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
    try {
      setState('loading');
      const res = await fetch(withBypass(`/api/m/count/sessions/${token}/validate`), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
          ...getBypassHeaders(),
        },
      });

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
      setErrorMessage(err.message || 'Failed to validate session');
      setState('error');
    }
  };

  const refreshJwt = async () => {
    try {
      const res = await fetch(withBypass(`/api/m/count/sessions/${token}/refresh`), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
          ...getBypassHeaders(),
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
    ...getBypassHeaders(),
  }), [jwt]);

  const handleRecordCount = useCallback(async (catalogItemId: string, qty: number) => {
    try {
      const res = await fetch(withBypass('/api/m/count/record'), {
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
  }, [mobileHeaders]);

  const handleRecordAssets = useCallback(async (lineId: string, assetIds: string[]) => {
    try {
      const res = await fetch(withBypass('/api/m/count/record-asset'), {
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
  }, [mobileHeaders]);

  const handleBarcodeScan = useCallback(async (decodedText: string) => {
    setScannerOpen(false);

    try {
      const params = new URLSearchParams();
      // Try as barcode first, then as SKU, then as asset tag
      params.set('barcode', decodedText);

      const res = await fetch(withBypass(`/api/m/count/lookup?${params}`), {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${jwt}`,
          ...getBypassHeaders(),
        },
      });

      if (!res.ok) {
        // Try as SKU
        const skuRes = await fetch(withBypass(`/api/m/count/lookup?sku=${encodeURIComponent(decodedText)}`), {
          credentials: 'include',
          headers: { 'Authorization': `Bearer ${jwt}`, ...getBypassHeaders() },
        });

        if (!skuRes.ok) {
          // Try as asset tag
          const tagRes = await fetch(withBypass(`/api/m/count/lookup?asset_tag=${encodeURIComponent(decodedText)}`), {
            credentials: 'include',
            headers: { 'Authorization': `Bearer ${jwt}`, ...getBypassHeaders() },
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
  }, [jwt]);

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
