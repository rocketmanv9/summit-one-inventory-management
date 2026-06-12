'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'next/navigation';
import { MobileCountShell } from '@/components/mobile/MobileCountShell';
import { MobileCountItemList } from '@/components/mobile/MobileCountItemList';
import { BarcodeScannerOverlay } from '@/components/mobile/BarcodeScannerOverlay';
import { MobileSessionExpired } from '@/components/mobile/MobileSessionExpired';
import { MobileAddItemSheet } from '@/components/mobile/MobileAddItemSheet';
import { MobileCatalogBrowser } from '@/components/mobile/MobileCatalogBrowser';
import { MobileAddCategoryModal } from '@/components/mobile/MobileAddCategoryModal';
import { apiErrorMessage } from '@/lib/api-error';
import { scanFx } from '@/lib/mobile/scan-fx';

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
    uom_term_id?: string;
    parent_item_id?: string | null;
    parent_name?: string | null;
    variant_attributes?: Record<string, string> | null;
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

interface CategoryItem {
  id: string;
  name: string;
  sku_prefix?: string;
}

interface InitialData {
  jwt: string;
  expires_at: string;
  cycle_count: CycleCountMeta;
  lines: CountLine[];
  categories?: CategoryItem[];
}

const EXPIRED_MESSAGE =
  'This count session has expired. Generate a new mobile session QR from the cycle count on desktop.';

// Postgres numerics arrive as strings via PostgREST. Normalize every line's
// numeric fields at the moment data enters client state so no string qty
// survives into state ("3" + 1 would become "31").
function normalizeLine(line: CountLine): CountLine {
  return {
    ...line,
    qty_expected: line.qty_expected == null ? 0 : Number(line.qty_expected),
    qty_counted: line.qty_counted == null ? null : Number(line.qty_counted),
  };
}

function bypassHeaders(secret: string): Record<string, string> {
  return secret ? { 'x-vercel-protection-bypass': secret } : {};
}

// add-item returns `data.lines` (one per variant for a parent, else one line).
// Map them all to CountLine so every variant lands in the list.
function linesFromAddResponse(data: any): CountLine[] {
  const raw = Array.isArray(data?.lines) && data.lines.length > 0 ? data.lines : [data];
  return raw
    .filter((l: any) => l && l.id)
    .map((l: any) => normalizeLine({
      id: l.id,
      catalog_item_id: l.catalog_item_id,
      catalog_item: l.catalog_item,
      qty_expected: Number(l.qty_expected ?? 0),
      qty_counted: null,
    }));
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
  const [lines, setLines] = useState<CountLine[]>(() =>
    (initialData?.lines || []).map(normalizeLine)
  );
  const [scannerOpen, setScannerOpen] = useState(false);
  // When set, the scanner is targeting a serialized line: the next scan records a
  // serial against that line instead of the normal barcode→item flow.
  const serialScanLineRef = useRef<string | null>(null);
  const [highlightItemId, setHighlightItemId] = useState<string | null>(null);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Non-blocking warning when a JWT refresh fails (counting continues).
  const [connectionWarning, setConnectionWarning] = useState(false);
  // Visible feedback when a count save fails (the line is NOT marked counted).
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveErrorTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Idempotency key kept stable across retries of the same submit attempt set.
  const submitKeyRef = useRef<string | null>(null);

  // Catalog management overlays (initial counts only)
  const [showAddItem, setShowAddItem] = useState(false);
  const [showCatalogBrowser, setShowCatalogBrowser] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [categories, setCategories] = useState<CategoryItem[]>(initialData?.categories || []);
  const [mounted, setMounted] = useState(false);

  // Initial count search state
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogResults, setCatalogResults] = useState<Array<{ id: string; name: string; sku?: string; barcode?: string; tracking_mode?: string; uom_term_id?: string }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [addingItemId, setAddingItemId] = useState<string | null>(null);
  const catalogSearchRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const refreshTimerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const isInitial = cycleCount?.count_type === 'initial';

  // Synchronous mirror of `lines` so back-to-back scans of the same item read
  // the qty the previous scan just wrote instead of a stale render snapshot.
  // Every mutation goes through applyLines to keep ref and state in lockstep.
  const linesRef = useRef<CountLine[]>(initialData?.lines?.map(normalizeLine) || []);
  const applyLines = useCallback((updater: (prev: CountLine[]) => CountLine[]) => {
    linesRef.current = updater(linesRef.current);
    setLines(linesRef.current);
  }, []);
  // Per-item promise chains serialize scan increments so they can't interleave.
  const scanChainRef = useRef<Map<string, Promise<void>>>(new Map());

  useEffect(() => setMounted(true), []);

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
  }, [jwt, token, bypassSecret]);

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
        throw new Error(apiErrorMessage(data, `Session invalid (${res.status})`));
      }

      const { data } = await res.json();
      setJwt(data.jwt);
      setExpiresAt(data.expires_at);
      setCycleCount(data.cycle_count);
      applyLines(() => (data.lines || []).map(normalizeLine));
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

  const refreshJwt = async (isRetry = false) => {
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

      if (res.status === 401 || res.status === 403) {
        setState('error');
        setErrorMessage(EXPIRED_MESSAGE);
        return;
      }

      if (!res.ok) throw new Error(`Refresh failed (${res.status})`);

      const { data } = await res.json();
      setJwt(data.jwt);
      setConnectionWarning(false);
    } catch {
      // Don't block counting — show a warning banner and retry once shortly.
      setConnectionWarning(true);
      if (!isRetry) {
        setTimeout(() => refreshJwt(true), 5000);
      }
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

  const showSaveError = useCallback((message: string) => {
    setSaveError(message);
    if (saveErrorTimerRef.current) clearTimeout(saveErrorTimerRef.current);
    saveErrorTimerRef.current = setTimeout(() => setSaveError(null), 6000);
  }, []);

  // Returns true only when the server confirmed the save — callers must not
  // show success feedback otherwise.
  const handleRecordCount = useCallback(
    async (catalogItemId: string, qty: number): Promise<boolean> => {
      const itemName =
        linesRef.current.find((l) => l.catalog_item_id === catalogItemId)?.catalog_item?.name || 'item';
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
            setErrorMessage(EXPIRED_MESSAGE);
            return false;
          }
          throw new Error(apiErrorMessage(data, 'Failed to record count'));
        }

        // Local state only updates after the server confirms the save.
        applyLines((prev) =>
          prev.map((line) =>
            line.catalog_item_id === catalogItemId ? { ...line, qty_counted: qty } : line
          )
        );
        return true;
      } catch (err: any) {
        console.error('Record count error:', err);
        showSaveError(`Couldn't save count for "${itemName}" — check signal and re-enter the quantity.`);
        setScanFeedback(`Save failed: ${itemName}`);
        setTimeout(() => setScanFeedback(null), 2000);
        return false;
      }
    },
    [mobileHeaders, bypassSecret, applyLines, showSaveError]
  );

  const handleRecordAssets = useCallback(
    async (lineId: string, assetIds: string[]) => {
      const itemName =
        lines.find((l) => l.id === lineId)?.catalog_item?.name || 'item';
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
            setErrorMessage(EXPIRED_MESSAGE);
            return;
          }
          throw new Error(apiErrorMessage(data, 'Failed to record assets'));
        }

        applyLines((prev) =>
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
        showSaveError(`Couldn't save assets for "${itemName}" — check signal and try again.`);
      }
    },
    [mobileHeaders, bypassSecret, lines, applyLines, showSaveError]
  );

  // Scan/enter a serial for a serialized line → creates the asset (if new) and
  // marks it present. Used by the manual input and the per-line scanner.
  // placeholder=true marks one present with no serial (untagged, taggable later).
  const handleAddSerial = useCallback(
    async (lineId: string, serial: string, placeholder = false) => {
      const s = serial.trim();
      if (!s && !placeholder) return;
      try {
        const res = await fetch(withBypass('/api/m/count/record-serial', bypassSecret), {
          method: 'POST',
          headers: mobileHeaders(),
          body: JSON.stringify(placeholder ? { line_id: lineId, placeholder: true } : { line_id: lineId, serial: s }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (res.status === 401) { setState('error'); setErrorMessage(EXPIRED_MESSAGE); return; }
          throw new Error(apiErrorMessage(data, 'Failed to record serial'));
        }
        const { data } = await res.json();
        const asset = data.asset;
        applyLines((prev) =>
          prev.map((l) => {
            if (l.id !== lineId) return l;
            const expected = l.expected_assets || [];
            const counted = l.counted_assets || [];
            return {
              ...l,
              expected_assets: expected.some((a) => a.id === asset.id)
                ? expected
                : [...expected, { id: asset.id, asset_tag: asset.asset_tag, serial_number: asset.serial_number, status: asset.status }],
              counted_assets: counted.some((c) => c.asset_id === asset.id)
                ? counted
                : [...counted, { asset_id: asset.id }],
              qty_counted: data.qty_counted != null ? Number(data.qty_counted) : (l.qty_counted ?? 0) + 1,
            };
          })
        );
        scanFx(true);
        setScanFeedback(placeholder ? 'Marked 1 present (no serial)' : `Added ${asset.asset_tag || s}`);
        setTimeout(() => setScanFeedback(null), 2000);
      } catch (err: any) {
        scanFx(false);
        alert(err.message || 'Failed to record serial');
      }
    },
    [mobileHeaders, bypassSecret, applyLines]
  );

  // Search catalog items for initial counts
  const handleCatalogSearch = useCallback(
    async (query: string) => {
      setCatalogSearch(query);
      if (catalogSearchRef.current) clearTimeout(catalogSearchRef.current);

      if (!query.trim()) {
        setCatalogResults([]);
        setIsSearching(false);
        setSearchError(null);
        return;
      }

      catalogSearchRef.current = setTimeout(async () => {
        setIsSearching(true);
        setSearchError(null);
        try {
          const res = await fetch(
            withBypass(`/api/m/count/search?q=${encodeURIComponent(query.trim())}`, bypassSecret),
            {
              headers: {
                Authorization: `Bearer ${jwt}`,
                ...bypassHeaders(bypassSecret),
              },
            }
          );

          if (!res.ok) {
            setCatalogResults([]);
            setSearchError(
              res.status === 401
                ? 'Session expired — reopen the link from desktop.'
                : 'Search failed — check signal and try again.'
            );
            return;
          }

          const { data } = await res.json();
          // Filter out items already in the count
          const existingIds = new Set(lines.map((l) => l.catalog_item_id));
          setCatalogResults((data || []).filter((item: any) => !existingIds.has(item.id)));
        } catch (err) {
          console.error('Catalog search error:', err);
          setCatalogResults([]);
          setSearchError('Search failed — check signal and try again.');
        } finally {
          setIsSearching(false);
        }
      }, 300);
    },
    [jwt, bypassSecret, lines]
  );

  // Add item to initial count
  const handleAddItem = useCallback(
    async (catalogItemId: string) => {
      if (addingItemId) return;
      setAddingItemId(catalogItemId);
      try {
        const res = await fetch(withBypass('/api/m/count/add-item', bypassSecret), {
          method: 'POST',
          headers: mobileHeaders(),
          body: JSON.stringify({ catalog_item_id: catalogItemId }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (res.status === 401) {
            setState('error');
            setErrorMessage(EXPIRED_MESSAGE);
            return;
          }
          throw new Error(apiErrorMessage(data, 'Failed to add item'));
        }

        const { data } = await res.json();
        // Append every returned line (one per variant for a parent item).
        const newLines = linesFromAddResponse(data);
        const existing = new Set(linesRef.current.map((l) => l.catalog_item_id));
        const toAdd = newLines.filter((l) => !existing.has(l.catalog_item_id));
        applyLines((prev) => [...prev, ...toAdd]);

        // Remove from search results
        setCatalogResults((prev) => prev.filter((item) => item.id !== catalogItemId));

        const highlightId = toAdd[0]?.catalog_item_id || catalogItemId;
        setHighlightItemId(highlightId);
        setTimeout(() => setHighlightItemId(null), 3000);
      } catch (err: any) {
        console.error('Add item error:', err);
        alert(err.message || 'Failed to add item');
      } finally {
        setAddingItemId(null);
      }
    },
    [addingItemId, mobileHeaders, bypassSecret, applyLines]
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

  // Record one scanned unit. Increments are serialized per item through a
  // promise chain and read the live linesRef, so two quick scans of the same
  // barcode become +1 then +1 — never the same qty written twice. Success
  // feedback (toast/beep/highlight) only fires after the server confirms.
  const queueScanIncrement = useCallback(
    (catalogItemId: string, fallbackLabel: string) => {
      const prev = scanChainRef.current.get(catalogItemId) || Promise.resolve();
      const next = prev.then(async () => {
        const line = linesRef.current.find((l) => l.catalog_item_id === catalogItemId);
        if (!line) return;
        const newQty = (line.qty_counted ?? 0) + 1;
        const saved = await handleRecordCount(catalogItemId, newQty);
        if (saved) {
          scanFx(true);
          const itemName = line.catalog_item?.name || line.catalog_item?.sku || fallbackLabel;
          setScanFeedback(`${itemName} → ${newQty}`);
          setTimeout(() => setScanFeedback(null), 2000);
          setHighlightItemId(catalogItemId);
          setTimeout(() => setHighlightItemId(null), 3000);
        } else {
          scanFx(false);
        }
      });
      scanChainRef.current.set(catalogItemId, next.catch(() => {}));
      return next;
    },
    [handleRecordCount]
  );

  const handleBarcodeScan = useCallback(
    async (decodedText: string) => {
      // Targeted serial scan from a serialized line → record the serial there.
      if (serialScanLineRef.current) {
        const targetLine = serialScanLineRef.current;
        serialScanLineRef.current = null;
        await handleAddSerial(targetLine, decodedText);
        return;
      }
      try {
        const catalogItemId = await lookupBarcode(decodedText);

        if (!catalogItemId) {
          scanFx(false);
          setScanFeedback(`Not found: ${decodedText}`);
          setTimeout(() => setScanFeedback(null), 2000);
          return;
        }

        let line = linesRef.current.find((l) => l.catalog_item_id === catalogItemId);

        // Item isn't on the count list but it's physically here — add it as a
        // discovered line (expected qty comes from the location's stock
        // balance, so the scan shows up as a normal variance for review).
        if (!line) {
          setScanFeedback('Adding to count...');
          try {
            const res = await fetch(withBypass('/api/m/count/add-item', bypassSecret), {
              method: 'POST',
              headers: mobileHeaders(),
              body: JSON.stringify({ catalog_item_id: catalogItemId }),
            });

            if (!res.ok) {
              scanFx(false);
              setScanFeedback('Failed to add item');
              setTimeout(() => setScanFeedback(null), 2000);
              return;
            }

            const { data } = await res.json();
            const newLines = linesFromAddResponse(data);
            const existing = new Set(linesRef.current.map((l) => l.catalog_item_id));
            const toAdd = newLines.filter((l) => !existing.has(l.catalog_item_id));
            applyLines((prev) => [...prev, ...toAdd]);
            // Scanning a parent expands to several variant lines — there's no
            // single quantity to bump, so surface them and let the counter
            // pick the right variant rather than guessing.
            if (toAdd.length !== 1 || toAdd[0].catalog_item_id !== catalogItemId) {
              scanFx(true);
              setScanFeedback(`Added ${toAdd.length} variant${toAdd.length === 1 ? '' : 's'} — enter each below`);
              setTimeout(() => setScanFeedback(null), 2500);
              setHighlightItemId(toAdd[0]?.catalog_item_id || null);
              setTimeout(() => setHighlightItemId(null), 3000);
              return;
            }
            line = toAdd[0];
          } catch {
            scanFx(false);
            setScanFeedback('Failed to add item');
            setTimeout(() => setScanFeedback(null), 2000);
            return;
          }
        }

        if (!line) {
          scanFx(false);
          setScanFeedback(`Not in count list: ${decodedText}`);
          setTimeout(() => setScanFeedback(null), 2000);
          return;
        }

        await queueScanIncrement(catalogItemId, decodedText);
      } catch (err) {
        console.error('Barcode lookup error:', err);
        scanFx(false);
        setScanFeedback('Scan error — try again');
        setTimeout(() => setScanFeedback(null), 2000);
      }
    },
    [lookupBarcode, queueScanIncrement, handleAddSerial, bypassSecret, mobileHeaders, applyLines]
  );

  // Open the camera scanner aimed at a specific serialized line.
  const handleScanSerial = useCallback((lineId: string) => {
    serialScanLineRef.current = lineId;
    setScannerOpen(true);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (isSubmitting || isSubmitted) return;

    const uncountedCount = lines.filter((l) => l.qty_counted === null).length;
    // Surface variances at submit time so fat-fingered quantities get a second
    // look before review (expected quantities are meaningless on initial/blind).
    const varianceCount = !isInitial && !cycleCount?.is_blind
      ? lines.filter((l) => l.qty_counted !== null && l.qty_counted !== l.qty_expected).length
      : 0;
    const varianceNote = varianceCount > 0
      ? `\n${varianceCount} item(s) differ from the expected quantity — double-check before submitting.`
      : '';
    if (uncountedCount > 0) {
      const proceed = confirm(
        `${uncountedCount} item(s) haven't been counted yet.${varianceNote}\nSubmit anyway?`
      );
      if (!proceed) return;
    } else {
      const proceed = confirm(`Submit this count for review?${varianceNote}`);
      if (!proceed) return;
    }

    // Keep the idempotency key stable across retries of this submit attempt so
    // a retry after a timeout/failure replays instead of double-submitting.
    if (!submitKeyRef.current) submitKeyRef.current = crypto.randomUUID();

    setIsSubmitting(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(withBypass('/api/m/count/submit', bypassSecret), {
        method: 'POST',
        headers: { ...mobileHeaders(), 'X-Idempotency-Key': submitKeyRef.current },
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setState('error');
          setErrorMessage(EXPIRED_MESSAGE);
          return;
        }
        alert(apiErrorMessage(data, 'Failed to submit count'));
        return;
      }

      setIsSubmitted(true);
      submitKeyRef.current = null;
    } catch (err: any) {
      console.error('Submit error:', err);
      alert(
        err?.name === 'AbortError'
          ? 'Network timeout — check signal and try again.'
          : 'Failed to submit. Check your connection and try again.'
      );
    } finally {
      clearTimeout(timeout);
      setIsSubmitting(false);
    }
  }, [isSubmitting, isSubmitted, lines, isInitial, cycleCount, bypassSecret, mobileHeaders]);

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
      {connectionWarning && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2000,
          padding: '10px 16px', background: '#fef3c7', borderBottom: '1px solid #fde68a',
          color: '#92400e', fontSize: '13px', fontWeight: 500, textAlign: 'center',
        }}>
          Connection problem — your session may expire. Counts will retry.
        </div>
      )}
      {saveError && (
        <div style={{
          position: 'fixed', top: connectionWarning ? '40px' : 0, left: 0, right: 0, zIndex: 2000,
          padding: '10px 16px', background: '#fee2e2', borderBottom: '1px solid #fecaca',
          color: '#b91c1c', fontSize: '13px', fontWeight: 500, textAlign: 'center',
        }}>
          {saveError}
        </div>
      )}
      <MobileCountShell
        countNumber={cycleCount?.count_number || ''}
        locationName={cycleCount?.location?.name || 'Unknown'}
        expiresAt={expiresAt}
        itemsCounted={itemsCounted}
        itemsTotal={lines.length}
        isSubmitted={isSubmitted}
        isSubmitting={isSubmitting}
        countType={cycleCount?.count_type}
        onScanClick={() => setScannerOpen(true)}
        onSubmitClick={handleSubmit}
        toolbar={isInitial && !isSubmitted ? (
          <div style={{
            padding: '12px 16px',
            background: '#fff',
            borderBottom: '1px solid #e5e7eb',
          }}>
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                <svg width="16" height="16" fill="none" stroke="#9ca3af" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="search"
                placeholder="Search catalog to add items..."
                value={catalogSearch}
                onChange={(e) => handleCatalogSearch(e.target.value)}
                style={{
                  width: '100%',
                  paddingLeft: '40px',
                  paddingRight: '16px',
                  paddingTop: '12px',
                  paddingBottom: '12px',
                  background: '#f0f9ff',
                  borderRadius: '12px',
                  fontSize: '14px',
                  border: '2px solid #bfdbfe',
                  WebkitAppearance: 'none',
                  appearance: 'none' as any,
                }}
              />
            </div>

            {/* Search results */}
            {(isSearching || catalogResults.length > 0 || searchError) && (
              <div style={{ marginTop: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                {isSearching && catalogResults.length === 0 && (
                  <div style={{ padding: '12px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>
                    Searching...
                  </div>
                )}
                {!isSearching && searchError && (
                  <div style={{ padding: '12px', textAlign: 'center', color: '#dc2626', fontSize: '13px', fontWeight: 500 }}>
                    {searchError}
                  </div>
                )}
                {catalogResults.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background: '#f9fafb',
                      marginBottom: '4px',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 500, color: '#111827' }}>{item.name}</div>
                      {item.sku && (
                        <div style={{ fontSize: '11px', color: '#6b7280', fontFamily: 'ui-monospace, monospace' }}>{item.sku}</div>
                      )}
                    </div>
                    <button
                      onClick={() => handleAddItem(item.id)}
                      disabled={addingItemId === item.id}
                      style={{
                        marginLeft: '8px',
                        padding: '6px 14px',
                        background: addingItemId === item.id ? '#9ca3af' : '#2563eb',
                        color: '#fff',
                        borderRadius: '8px',
                        fontWeight: 600,
                        fontSize: '13px',
                        border: 'none',
                        cursor: addingItemId === item.id ? 'default' : 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {addingItemId === item.id ? 'Adding...' : '+ Add'}
                    </button>
                  </div>
                ))}
                {!isSearching && !searchError && catalogSearch.trim() && catalogResults.length === 0 && (
                  <div style={{ padding: '12px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>
                    No items found
                  </div>
                )}
              </div>
            )}

            {/* Action toolbar */}
            <div style={{
              display: 'flex',
              gap: '8px',
              marginTop: '10px',
            }}>
              <button
                type="button"
                className="m-btn"
                onClick={() => setShowAddItem(true)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '10px 8px',
                  background: showAddItem ? '#dcfce7' : '#f0fdf4',
                  border: '1.5px solid #86efac',
                  borderRadius: '10px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#15803d',
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                New Item
              </button>
              <button
                type="button"
                className="m-btn"
                onClick={() => setShowCatalogBrowser(true)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '10px 8px',
                  background: showCatalogBrowser ? '#dbeafe' : '#eff6ff',
                  border: '1.5px solid #93c5fd',
                  borderRadius: '10px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#1d4ed8',
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                Browse
              </button>
              <button
                type="button"
                className="m-btn"
                onClick={() => setShowAddCategory(true)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '10px 8px',
                  background: showAddCategory ? '#fef9c3' : '#fefce8',
                  border: '1.5px solid #fde047',
                  borderRadius: '10px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#a16207',
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                </svg>
                Category
              </button>
            </div>
          </div>
        ) : undefined}
      >
        <MobileCountItemList
          lines={lines}
          isBlind={cycleCount?.is_blind || false}
          isInitial={isInitial}
          highlightItemId={highlightItemId}
          onRecordCount={handleRecordCount}
          onRecordAssets={handleRecordAssets}
          onAddSerial={handleAddSerial}
          onScanSerial={handleScanSerial}
          onMarkPresent={(lineId) => handleAddSerial(lineId, '', true)}
        />
      </MobileCountShell>

      <BarcodeScannerOverlay
        isOpen={scannerOpen}
        onClose={() => { setScannerOpen(false); setScanFeedback(null); serialScanLineRef.current = null; }}
        onScan={handleBarcodeScan}
        continuous
        scanFeedback={scanFeedback}
      />

      {/* Catalog management overlays — portaled to body to avoid mobile stacking context issues */}
      {isInitial && mounted && createPortal(
        <>
          <MobileAddItemSheet
            isOpen={showAddItem}
            onClose={() => setShowAddItem(false)}
            onItemCreated={(countLine, newCategory) => {
              if (countLine) {
                applyLines((prev) => [...prev, normalizeLine(countLine)]);
                setHighlightItemId(countLine.catalog_item_id);
                setTimeout(() => setHighlightItemId(null), 3000);
              }
              if (newCategory) {
                setCategories((prev) =>
                  prev.some((c) => c.id === newCategory.id) ? prev : [...prev, newCategory].sort((a, b) => a.name.localeCompare(b.name))
                );
              }
            }}
            jwt={jwt}
            bypassSecret={bypassSecret}
            categories={categories}
          />

          <MobileCatalogBrowser
            isOpen={showCatalogBrowser}
            onClose={() => setShowCatalogBrowser(false)}
            onItemAdded={(newLine) => {
              applyLines((prev) => [...prev, normalizeLine(newLine)]);
              setHighlightItemId(newLine.catalog_item_id);
              setTimeout(() => setHighlightItemId(null), 3000);
            }}
            jwt={jwt}
            bypassSecret={bypassSecret}
            existingItemIds={new Set(lines.map((l) => l.catalog_item_id))}
            categories={categories}
          />

          <MobileAddCategoryModal
            isOpen={showAddCategory}
            onClose={() => setShowAddCategory(false)}
            onCategoryCreated={(cat) => {
              setCategories((prev) =>
                [...prev, cat].sort((a, b) => a.name.localeCompare(b.name))
              );
            }}
            jwt={jwt}
            bypassSecret={bypassSecret}
          />
        </>,
        document.body,
      )}
    </>
  );
}
