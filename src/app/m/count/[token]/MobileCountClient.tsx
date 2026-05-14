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
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const lookupBarcode = useCallback(
    async (decodedText: string): Promise<string | null> => {
      const authHeaders = {
        Authorization: `Bearer ${jwt}`,
        ...bypassHeaders(bypassSecret),
      };

      // Try barcode → SKU → asset_tag in order
      for (const param of ['barcode', 'sku', 'asset_tag']) {
        const res = await fetch(
          withBypass(`/api/m/count/lookup?${param}=${encodeURIComponent(decodedText)}`, bypassSecret),
          { credentials: 'include', headers: authHeaders }
        );
        if (res.ok) {
          const { data } = await res.json();
          return data.catalog_item?.id || null;
        }
      }
      return null;
    },
    [jwt, bypassSecret]
  );

  const handleBarcodeScan = useCallback(
    async (decodedText: string) => {
      try {
        const catalogItemId = await lookupBarcode(decodedText);

        if (!catalogItemId) {
          setScanFeedback(`Not found: ${decodedText}`);
          setTimeout(() => setScanFeedback(null), 2000);
          return;
        }

        const line = lines.find((l) => l.catalog_item_id === catalogItemId);
        if (!line) {
          setScanFeedback(`Not in count list: ${decodedText}`);
          setTimeout(() => setScanFeedback(null), 2000);
          return;
        }

        const newQty = (line.qty_counted ?? 0) + 1;
        await handleRecordCount(catalogItemId, newQty);

        const itemName = line.catalog_item?.name || line.catalog_item?.sku || decodedText;
        setScanFeedback(`${itemName} → ${newQty}`);
        setTimeout(() => setScanFeedback(null), 2000);

        setHighlightItemId(catalogItemId);
        setTimeout(() => setHighlightItemId(null), 3000);
      } catch (err) {
        console.error('Barcode lookup error:', err);
        setScanFeedback('Scan error — try again');
        setTimeout(() => setScanFeedback(null), 2000);
      }
    },
    [lookupBarcode, lines, handleRecordCount]
  );

  const handleSubmit = useCallback(async () => {
    if (isSubmitting || isSubmitted) return;

    const uncountedCount = lines.filter((l) => l.qty_counted === null).length;
    if (uncountedCount > 0) {
      const proceed = confirm(
        `${uncountedCount} item(s) haven't been counted yet. Submit anyway?`
      );
      if (!proceed) return;
    } else {
      const proceed = confirm('Submit this count for review?');
      if (!proceed) return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(withBypass('/api/m/count/submit', bypassSecret), {
        method: 'POST',
        headers: mobileHeaders(),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setState('error');
          setErrorMessage('Session expired');
          return;
        }
        alert(data.error || 'Failed to submit count');
        return;
      }

      setIsSubmitted(true);
    } catch (err: any) {
      console.error('Submit error:', err);
      alert('Failed to submit. Check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, isSubmitted, lines, bypassSecret, mobileHeaders]);

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
        isSubmitted={isSubmitted}
        isSubmitting={isSubmitting}
        onScanClick={() => setScannerOpen(true)}
        onSubmitClick={handleSubmit}
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
        onClose={() => { setScannerOpen(false); setScanFeedback(null); }}
        onScan={handleBarcodeScan}
        continuous
        scanFeedback={scanFeedback}
      />
    </>
  );
}
