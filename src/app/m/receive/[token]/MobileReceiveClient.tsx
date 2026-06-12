'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { MobileSessionExpired } from '@/components/mobile/MobileSessionExpired';
import { BarcodeScannerOverlay } from '@/components/mobile/BarcodeScannerOverlay';
import { apiErrorMessage } from '@/lib/api-error';
import { scanFx } from '@/lib/mobile/scan-fx';

interface ReceiveLine {
  id: string;
  line_number: number | null;
  catalog_item_id: string | null;
  item_description: string | null;
  name: string;
  sku: string | null;
  uom: string;
  qty_ordered: number;
  qty_received: number;
  outstanding: number;
  allow_over_delivery: boolean;
}

interface ReceivePo {
  id: string;
  po_number: string;
  vendor_name: string | null;
  expected_delivery_date: string | null;
  delivery_location_id: string | null;
  status: string;
  outstanding_line_count: number;
  lines: ReceiveLine[];
}

interface SuccessInfo {
  po_number: string;
  receipt_number: string | null;
  lines_received: Array<{ po_line_id: string; name: string; qty: number }>;
  total_qty: number;
  warning: string | null;
}

interface InitialData {
  jwt: string;
  expires_at: string;
  pos: ReceivePo[];
}

const EXPIRED_MESSAGE =
  'This receiving session has expired. Generate a new receiving QR from Purchasing on desktop.';

// Postgres numerics arrive as strings via PostgREST. The server coerces them,
// but normalize again at EVERY state entry point so no string qty can ever
// survive into client state ("3" + 1 would become "31").
function normalizeLine(line: ReceiveLine): ReceiveLine {
  const ordered = line.qty_ordered == null ? 0 : Number(line.qty_ordered);
  const received = line.qty_received == null ? 0 : Number(line.qty_received);
  return {
    ...line,
    qty_ordered: ordered,
    qty_received: received,
    outstanding: Math.max(0, ordered - received),
    allow_over_delivery: line.allow_over_delivery === true,
  };
}

function normalizePo(po: ReceivePo): ReceivePo {
  const lines = (po.lines || []).map(normalizeLine);
  return {
    ...po,
    lines,
    outstanding_line_count: lines.filter((l) => l.outstanding > 0).length,
  };
}

function bypassHeaders(secret: string): Record<string, string> {
  return secret ? { 'x-vercel-protection-bypass': secret } : {};
}

function withBypass(url: string, secret: string): string {
  if (!secret) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}x-vercel-protection-bypass=${encodeURIComponent(secret)}`;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(dateString));
  } catch {
    return '';
  }
}

export function MobileReceiveClient({
  bypassSecret,
  initialData,
}: {
  bypassSecret: string;
  initialData?: InitialData;
}) {
  const params = useParams();
  const token = params.token as string;

  const [state, setState] = useState<'loading' | 'error' | 'ready'>(
    initialData ? 'ready' : 'loading'
  );
  const [errorMessage, setErrorMessage] = useState('');
  const [jwt, setJwt] = useState(initialData?.jwt || '');
  const [expiresAt, setExpiresAt] = useState(initialData?.expires_at || '');
  const [pos, setPos] = useState<ReceivePo[]>(() => (initialData?.pos || []).map(normalizePo));
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);
  const [qtyByLine, setQtyByLine] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshingPos, setIsRefreshingPos] = useState(false);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  // Non-blocking warning when a JWT refresh fails (receiving continues).
  const [connectionWarning, setConnectionWarning] = useState(false);
  // Visible feedback when a submit/list fetch fails.
  const [actionError, setActionError] = useState<string | null>(null);
  const actionErrorTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Idempotency key kept stable across retries of the same submit attempt so a
  // retry after a timeout/failure replays instead of double-receiving.
  const submitKeyRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Scanner state (PO detail screen): scan a SKU off the delivery label to
  // count units in. Matching is client-side against the open PO's lines —
  // there is no barcode lookup endpoint on the receiving session.
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const scanFeedbackTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [highlightLineId, setHighlightLineId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const highlightRef = useRef<HTMLDivElement>(null);
  // All / To check / Checked chips on the PO detail line list.
  const [lineFilter, setLineFilter] = useState<'all' | 'unchecked' | 'checked'>('all');

  const jwtRef = useRef(jwt);
  jwtRef.current = jwt;

  // Synchronous mirror of qtyByLine so back-to-back scans of the same line
  // read the qty the previous scan just wrote instead of a stale render
  // snapshot. Every qty mutation goes through applyQty to keep ref and state
  // in lockstep. (Unlike the count flow, scan increments here are pure client
  // state — the server write happens once at submit — so a per-line promise
  // chain isn't needed; the synchronous mirror alone makes scans lossless.)
  const qtyRef = useRef<Record<string, string>>({});
  const applyQty = useCallback(
    (updater: (prev: Record<string, string>) => Record<string, string>) => {
      qtyRef.current = updater(qtyRef.current);
      setQtyByLine(qtyRef.current);
    },
    []
  );

  // Lines the operator has explicitly verified this session (scanned, stepped,
  // or typed). Drives the All/To check/Checked chips, and lets the FIRST scan
  // of a line replace the outstanding prefill with a count-up from 1 instead
  // of incrementing past it. Ref + state kept in lockstep (scans read the ref
  // synchronously).
  const checkedRef = useRef<Set<string>>(new Set());
  const [checkedLines, setCheckedLines] = useState<Set<string>>(new Set());
  const markChecked = useCallback((lineId: string) => {
    if (checkedRef.current.has(lineId)) return;
    const next = new Set(checkedRef.current);
    next.add(lineId);
    checkedRef.current = next;
    setCheckedLines(next);
  }, []);
  const resetChecked = useCallback(() => {
    checkedRef.current = new Set();
    setCheckedLines(new Set());
  }, []);

  const selectedPo = selectedPoId ? pos.find((p) => p.id === selectedPoId) || null : null;

  // Scroll the scanned line into view so the highlight is visible when the
  // scanner overlay closes.
  useEffect(() => {
    if (highlightLineId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightLineId]);

  // Only validate client-side if no server-provided data.
  useEffect(() => {
    if (!initialData) {
      bootstrap();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // JWT refresh every 12 minutes (JWT expires at 15) — same cadence as counts.
  useEffect(() => {
    if (!jwt) return;
    refreshTimerRef.current = setInterval(() => {
      refreshJwt();
    }, 12 * 60 * 1000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jwt, token, bypassSecret]);

  const validateToken = useCallback(async (): Promise<string | null> => {
    const res = await fetch(withBypass('/api/m/receive/validate', bypassSecret), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
        ...bypassHeaders(bypassSecret),
      },
      body: JSON.stringify({ token }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(
        `Unexpected response (${res.status}). The request may be blocked by deployment protection.`
      );
    }
    if (res.status === 401 || res.status === 403) {
      const data = await res.json().catch(() => ({}));
      setErrorMessage(apiErrorMessage(data, EXPIRED_MESSAGE));
      setState('error');
      return null;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(apiErrorMessage(data, `Session invalid (${res.status})`));
    }

    const { data } = await res.json();
    setJwt(data.jwt);
    setExpiresAt(data.expires_at);
    return data.jwt as string;
  }, [token, bypassSecret]);

  const fetchPos = useCallback(
    async (useJwt?: string): Promise<boolean> => {
      const activeJwt = useJwt || jwtRef.current;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetch(withBypass('/api/m/receive/pos', bypassSecret), {
          credentials: 'include',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${activeJwt}`,
            ...bypassHeaders(bypassSecret),
          },
        });
        clearTimeout(timeout);
        if (res.status === 401 || res.status === 403) {
          setState('error');
          setErrorMessage(EXPIRED_MESSAGE);
          return false;
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(apiErrorMessage(data, `Couldn't load open POs (${res.status})`));
        }
        const { data } = await res.json();
        setPos((data || []).map(normalizePo));
        return true;
      } catch (err: any) {
        clearTimeout(timeout);
        showActionError(
          err?.name === 'AbortError'
            ? 'Loading deliveries timed out — check signal and pull again.'
            : err?.message || 'Couldn’t load open POs — check signal and try again.'
        );
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bypassSecret]
  );

  const bootstrap = async () => {
    try {
      setState('loading');
      const freshJwt = await validateToken();
      if (!freshJwt) return; // expired path already handled
      // List-fetch failures show as a banner (with retry via the refresh
      // button) rather than a dead-end error screen.
      await fetchPos(freshJwt);
      setState('ready');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to validate session');
      setState('error');
    }
  };

  const refreshJwt = async (isRetry = false) => {
    try {
      const fresh = await validateToken();
      if (fresh) setConnectionWarning(false);
    } catch {
      // Don't block receiving — show a warning banner and retry once shortly.
      setConnectionWarning(true);
      if (!isRetry) setTimeout(() => refreshJwt(true), 5000);
    }
  };

  const showActionError = useCallback((message: string) => {
    setActionError(message);
    if (actionErrorTimerRef.current) clearTimeout(actionErrorTimerRef.current);
    actionErrorTimerRef.current = setTimeout(() => setActionError(null), 8000);
  }, []);

  const openPo = (po: ReceivePo) => {
    setSuccess(null);
    setSelectedPoId(po.id);
    // Prefill every line with its full outstanding quantity.
    const init: Record<string, string> = {};
    for (const l of po.lines) init[l.id] = String(l.outstanding);
    applyQty(() => init);
    // A new PO selection is a new submit attempt set.
    submitKeyRef.current = null;
    setActionError(null);
    resetChecked();
    setLineFilter('all');
    setHighlightLineId(null);
  };

  const backToList = async (refresh: boolean) => {
    setSelectedPoId(null);
    setSuccess(null);
    setActionError(null);
    setScannerOpen(false);
    setScanFeedback(null);
    setHighlightLineId(null);
    if (refresh) {
      setIsRefreshingPos(true);
      await fetchPos();
      setIsRefreshingPos(false);
    }
  };

  const receiveAll = () => {
    if (!selectedPo) return;
    const next: Record<string, string> = {};
    for (const l of selectedPo.lines) next[l.id] = String(l.outstanding);
    applyQty(() => next);
  };

  const showScanFeedback = useCallback((message: string) => {
    setScanFeedback(message);
    if (scanFeedbackTimerRef.current) clearTimeout(scanFeedbackTimerRef.current);
    scanFeedbackTimerRef.current = setTimeout(() => setScanFeedback(null), 2000);
  }, []);

  // Big-thumb +/- buttons: adjust by whole units, clamped at 0. Pure client
  // state (server write happens at submit), so the update is immediate.
  const stepLine = (l: ReceiveLine, delta: number) => {
    try { navigator.vibrate?.(10); } catch { /* unsupported */ }
    markChecked(l.id);
    applyQty((prev) => {
      const current = parseFloat(prev[l.id] ?? '');
      const base = Number.isFinite(current) ? current : 0;
      const next = Math.max(0, Math.round((base + delta) * 100) / 100);
      return { ...prev, [l.id]: String(next) };
    });
  };

  // Scan a code off the delivery → match it to a PO line by SKU (exact name
  // as a fallback for hand-typed entries). The first scan of a line replaces
  // the outstanding prefill with 1 (count-up workflow); subsequent scans
  // increment. Reads go through qtyRef/checkedRef so rapid scans of the same
  // line never compute from a stale snapshot. Success feedback fires only
  // after the qty state actually changed.
  // Not memoized on purpose: BarcodeScannerOverlay keeps onScan in a ref, so
  // it always calls the latest closure (fresh selectedPo).
  const handleBarcodeScan = (decodedText: string) => {
    if (!selectedPo) return;
    const code = decodedText.trim().toLowerCase();
    if (!code) return;

    const line =
      selectedPo.lines.find((l) => l.sku && l.sku.trim().toLowerCase() === code) ||
      selectedPo.lines.find((l) => l.name.trim().toLowerCase() === code);

    if (!line) {
      scanFx(false);
      showScanFeedback(`Not on this PO: ${decodedText}`);
      return;
    }

    const wasChecked = checkedRef.current.has(line.id);
    const current = parseFloat(qtyRef.current[line.id] ?? '');
    const base = wasChecked && Number.isFinite(current) ? current : 0;
    const next = Math.round((base + 1) * 100) / 100;

    // Mirror the server's over-receipt rule client-side: don't let scanning
    // push a line into an un-submittable state.
    if (next > line.outstanding && !line.allow_over_delivery) {
      scanFx(false);
      showScanFeedback(`Not allowed: ${line.name} is already at outstanding (${line.outstanding})`);
      return;
    }

    markChecked(line.id);
    applyQty((prev) => ({ ...prev, [line.id]: String(next) }));
    scanFx(true);
    showScanFeedback(`${line.name} → ${next}`);
    setHighlightLineId(line.id);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightLineId(null), 3000);
  };

  const lineQty = (lineId: string): number => {
    const raw = qtyByLine[lineId];
    const n = parseFloat(raw ?? '');
    return Number.isFinite(n) ? n : 0;
  };

  // Over-receipt is blocked client-side unless the line allows over-delivery
  // (approximate orders — e.g. gravel by the truckload).
  const isOverBlocked = (l: ReceiveLine) => lineQty(l.id) > l.outstanding && !l.allow_over_delivery;
  const isOverAllowed = (l: ReceiveLine) => lineQty(l.id) > l.outstanding && l.allow_over_delivery;
  const hasBlockedOver = !!selectedPo && selectedPo.lines.some(isOverBlocked);
  const enteredTotal = selectedPo ? selectedPo.lines.reduce((s, l) => s + lineQty(l.id), 0) : 0;

  const handleSubmit = async () => {
    if (!selectedPo || isSubmitting) return;
    setActionError(null);

    if (hasBlockedOver) {
      showActionError('One or more lines exceed the outstanding quantity. Reduce them before confirming.');
      return;
    }
    const toReceive = selectedPo.lines
      .map((l) => ({ po_line_id: l.id, qty: lineQty(l.id) }))
      .filter((l) => l.qty > 0);
    if (toReceive.length === 0) {
      showActionError('Enter a quantity to receive on at least one line.');
      return;
    }
    if (
      selectedPo.lines.some((l) => l.catalog_item_id && lineQty(l.id) > 0) &&
      !selectedPo.delivery_location_id
    ) {
      showActionError(
        `PO ${selectedPo.po_number} has no delivery location — edit the PO on desktop to add one before receiving.`
      );
      return;
    }

    // Keep the idempotency key stable across retries of this submit attempt so
    // a retry after a timeout/failure replays instead of double-receiving.
    if (!submitKeyRef.current) submitKeyRef.current = crypto.randomUUID();

    setIsSubmitting(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(withBypass('/api/m/receive/submit', bypassSecret), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwtRef.current}`,
          'X-Idempotency-Key': submitKeyRef.current,
          ...bypassHeaders(bypassSecret),
        },
        body: JSON.stringify({ po_id: selectedPo.id, lines: toReceive }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setState('error');
          setErrorMessage(EXPIRED_MESSAGE);
          return;
        }
        const base = apiErrorMessage(data, `Failed to receive against ${selectedPo.po_number}`);
        showActionError(/OVER_RECEIPT/i.test(base) ? `Over-receipt blocked: ${base}` : base);
        // 4xx means the server rejected this payload — a retry needs a new key.
        if (res.status >= 400 && res.status < 500) submitKeyRef.current = null;
        scanFx(false);
        return;
      }

      const { data } = await res.json();
      submitKeyRef.current = null;
      // Success feedback only after the server confirmed the receipt posted.
      scanFx(true);
      setSuccess({
        po_number: data.po_number || selectedPo.po_number,
        receipt_number: data.receipt_number || null,
        lines_received: data.lines_received || [],
        total_qty: data.total_qty == null ? 0 : Number(data.total_qty),
        warning: data.warning || null,
      });
      setSelectedPoId(null);
      // Refresh the list in the background so fully-received POs drop off.
      fetchPos();
    } catch (err: any) {
      scanFx(false);
      showActionError(
        err?.name === 'AbortError'
          ? `Timed out receiving ${selectedPo.po_number} — check signal and tap Confirm again (it won't double-receive).`
          : `Failed to receive ${selectedPo.po_number}. Check your connection and try again.`
      );
    } finally {
      clearTimeout(timeout);
      setIsSubmitting(false);
    }
  };

  // ── Render ──

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
              onClick={() => bootstrap()}
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

  const banners = (
    <>
      {connectionWarning && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2000,
          padding: '10px 16px', background: '#fef3c7', borderBottom: '1px solid #fde68a',
          color: '#92400e', fontSize: '13px', fontWeight: 500, textAlign: 'center',
        }}>
          Connection problem — your session may expire. Will retry.
        </div>
      )}
      {actionError && (
        <div style={{
          position: 'fixed', top: connectionWarning ? '40px' : 0, left: 0, right: 0, zIndex: 2000,
          padding: '10px 16px', background: '#fee2e2', borderBottom: '1px solid #fecaca',
          color: '#b91c1c', fontSize: '13px', fontWeight: 500, textAlign: 'center',
        }}>
          {actionError}
        </div>
      )}
    </>
  );

  // ── Success screen ──
  if (success) {
    return (
      <>
        {banners}
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#f3f4f6' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 16px', WebkitOverflowScrolling: 'touch' as any }}>
            <div style={{ maxWidth: '420px', margin: '0 auto', textAlign: 'center' }}>
              <div style={{
                width: '64px', height: '64px', margin: '16px auto 0', background: '#dcfce7',
                borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="32" height="32" fill="none" stroke="#16a34a" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#111827', marginTop: '16px', marginBottom: '4px' }}>
                Received — {success.po_number}
              </h1>
              <p style={{ fontSize: '14px', color: '#4b5563', margin: 0 }}>
                {success.receipt_number
                  ? `Receipt ${success.receipt_number} posted to stock.`
                  : 'PO lines updated (no stock-tracked items).'}
              </p>

              {success.warning && (
                <div style={{
                  marginTop: '12px', padding: '10px 12px', background: '#fef3c7',
                  border: '1px solid #fde68a', borderRadius: '10px',
                  color: '#92400e', fontSize: '13px', textAlign: 'left',
                }}>
                  {success.warning}
                </div>
              )}

              <div style={{
                marginTop: '16px', background: '#fff', borderRadius: '12px',
                border: '1px solid #e5e7eb', textAlign: 'left', overflow: 'hidden',
              }}>
                {success.lines_received.map((l) => (
                  <div key={l.po_line_id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 14px', borderBottom: '1px solid #f3f4f6',
                  }}>
                    <span style={{ fontSize: '14px', color: '#111827', fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                    <span style={{ fontSize: '14px', color: '#16a34a', fontWeight: 700, marginLeft: '12px', fontFamily: 'ui-monospace, monospace' }}>+{Number(l.qty)}</span>
                  </div>
                ))}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', background: '#f9fafb',
                }}>
                  <span style={{ fontSize: '13px', color: '#6b7280', fontWeight: 600 }}>Total received</span>
                  <span style={{ fontSize: '14px', color: '#111827', fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>{success.total_qty}</span>
                </div>
              </div>

              <button
                className="m-btn"
                onClick={() => backToList(true)}
                style={{
                  marginTop: '20px', width: '100%', padding: '16px',
                  background: '#2563eb', color: '#fff', borderRadius: '12px',
                  fontWeight: 700, fontSize: '16px', cursor: 'pointer',
                }}
              >
                Back to Deliveries
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── Screen 2: PO detail ──
  if (selectedPo) {
    const checkedCount = selectedPo.lines.filter((l) => checkedLines.has(l.id)).length;
    const uncheckedCount = selectedPo.lines.length - checkedCount;
    const visibleLines = selectedPo.lines.filter((l) => {
      if (lineFilter === 'unchecked') return !checkedLines.has(l.id);
      if (lineFilter === 'checked') return checkedLines.has(l.id);
      return true;
    });

    return (
      <>
        {banners}
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#f3f4f6' }}>
          {/* Header */}
          <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                className="m-btn"
                onClick={() => backToList(false)}
                aria-label="Back to PO list"
                style={{
                  width: '40px', height: '40px', flexShrink: 0, borderRadius: '10px',
                  background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                }}
              >
                <svg width="20" height="20" fill="none" stroke="#374151" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#111827', fontFamily: 'ui-monospace, monospace' }}>
                  {selectedPo.po_number}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedPo.vendor_name || 'Unknown vendor'}
                </div>
              </div>
              <button
                className="m-btn"
                onClick={() => setScannerOpen(true)}
                aria-label="Scan item barcode"
                style={{
                  width: '40px', height: '40px', flexShrink: 0, borderRadius: '10px',
                  background: '#eff6ff', border: '1.5px solid #93c5fd',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                }}
              >
                <svg width="20" height="20" fill="none" stroke="#1d4ed8" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
              </button>
              <button
                className="m-btn"
                onClick={receiveAll}
                style={{
                  padding: '10px 14px', borderRadius: '10px', flexShrink: 0,
                  background: '#eff6ff', border: '1.5px solid #93c5fd',
                  color: '#1d4ed8', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                }}
              >
                Receive All
              </button>
            </div>

            {/* Quick filters — track which lines have been verified against the
                truck without scrolling a long list. */}
            {selectedPo.lines.length > 1 && (
              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                {([
                  ['all', `All (${selectedPo.lines.length})`],
                  ['unchecked', `To check (${uncheckedCount})`],
                  ['checked', `Checked (${checkedCount})`],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className="m-btn"
                    onClick={() => setLineFilter(key)}
                    style={{
                      flex: 1,
                      padding: '8px 4px',
                      borderRadius: '9999px',
                      fontSize: '12px',
                      fontWeight: 600,
                      border: lineFilter === key ? '1.5px solid #2563eb' : '1.5px solid #e5e7eb',
                      background: lineFilter === key ? '#eff6ff' : '#fff',
                      color: lineFilter === key ? '#1d4ed8' : '#6b7280',
                      cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Lines */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 120px', WebkitOverflowScrolling: 'touch' as any }}>
            {visibleLines.map((l) => {
              const blocked = isOverBlocked(l);
              const overOk = isOverAllowed(l);
              const isChecked = checkedLines.has(l.id);
              const isHighlighted = highlightLineId === l.id;
              const minusDisabled = lineQty(l.id) <= 0;
              return (
                <div
                  key={l.id}
                  ref={isHighlighted ? highlightRef : undefined}
                  style={{
                    background: '#fff', borderRadius: '12px', padding: '14px',
                    marginBottom: '8px',
                    border: blocked ? '1.5px solid #fca5a5' : '1px solid #e5e7eb',
                    boxShadow: isHighlighted ? '0 0 0 2px #3b82f6, 0 0 0 4px rgba(59,130,246,0.3)' : undefined,
                    transition: 'box-shadow 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: '#111827' }}>{l.name}</div>
                      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                        {l.sku ? `${l.sku} · ` : ''}
                        Ordered {l.qty_ordered}{l.uom ? ` ${l.uom}` : ''} · Received {l.qty_received}
                        {!l.catalog_item_id && <span style={{ color: '#d97706' }}> · not stock-tracked</span>}
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: l.outstanding > 0 ? '#1d4ed8' : '#6b7280', marginTop: '4px' }}>
                        {l.outstanding} outstanding
                      </div>
                    </div>
                    {isChecked && (
                      <div style={{
                        width: '24px', height: '24px', background: '#22c55e', borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                      }}>
                        <svg width="14" height="14" fill="none" stroke="#fff" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <button
                      type="button"
                      className="m-btn"
                      aria-label="Decrease quantity"
                      onClick={() => stepLine(l, -1)}
                      disabled={minusDisabled}
                      style={{
                        width: '48px', height: '52px', flexShrink: 0, borderRadius: '12px',
                        border: '2px solid #d1d5db',
                        background: minusDisabled ? '#f3f4f6' : '#fff',
                        color: minusDisabled ? '#d1d5db' : '#374151',
                        fontSize: '24px', fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: minusDisabled ? 'default' : 'pointer',
                        WebkitTapHighlightColor: 'transparent',
                        touchAction: 'manipulation',
                        userSelect: 'none' as const,
                      }}
                    >
                      −
                    </button>
                    <input
                      className="m-input-qty"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={qtyByLine[l.id] ?? ''}
                      onChange={(e) => {
                        markChecked(l.id);
                        const val = e.target.value;
                        applyQty((prev) => ({ ...prev, [l.id]: val }));
                      }}
                      onFocus={(e) => e.target.select()}
                      style={{
                        flex: 1, minWidth: 0, padding: '14px 10px',
                        borderRadius: '10px', textAlign: 'center',
                        fontSize: '18px', fontWeight: 700,
                        border: blocked ? '2px solid #ef4444' : '2px solid #d1d5db',
                        background: blocked ? '#fef2f2' : '#fff',
                      }}
                    />
                    <button
                      type="button"
                      className="m-btn"
                      aria-label="Increase quantity"
                      onClick={() => stepLine(l, 1)}
                      style={{
                        width: '48px', height: '52px', flexShrink: 0, borderRadius: '12px',
                        border: '2px solid #d1d5db', background: '#fff', color: '#374151',
                        fontSize: '24px', fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer',
                        WebkitTapHighlightColor: 'transparent',
                        touchAction: 'manipulation',
                        userSelect: 'none' as const,
                      }}
                    >
                      +
                    </button>
                  </div>
                  {blocked && (
                    <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#dc2626', textAlign: 'right', fontWeight: 600 }}>
                      Exceeds outstanding ({l.outstanding}) — reduce to continue
                    </p>
                  )}
                  {overOk && (
                    <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#d97706', textAlign: 'right', fontWeight: 500 }}>
                      Over outstanding ({l.outstanding}) — allowed for this line
                    </p>
                  )}
                </div>
              );
            })}

            {visibleLines.length === 0 && (
              <div style={{ textAlign: 'center', padding: '48px 24px', color: '#9ca3af' }}>
                <p style={{ fontSize: '14px', fontWeight: 500, margin: 0 }}>
                  {lineFilter === 'unchecked'
                    ? 'Every line has been checked — confirm below.'
                    : 'No lines checked yet — scan a label or adjust a quantity.'}
                </p>
              </div>
            )}
          </div>

          {/* Bottom action bar */}
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0,
            padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
            background: '#fff', borderTop: '1px solid #e5e7eb',
          }}>
            <button
              className="m-btn-submit"
              onClick={handleSubmit}
              disabled={isSubmitting || hasBlockedOver || enteredTotal <= 0}
              style={{
                width: '100%', padding: '16px', borderRadius: '12px',
                background: isSubmitting || hasBlockedOver || enteredTotal <= 0 ? '#9ca3af' : '#16a34a',
                color: '#fff', fontWeight: 700, fontSize: '16px',
                cursor: isSubmitting || hasBlockedOver || enteredTotal <= 0 ? 'default' : 'pointer',
              }}
            >
              {isSubmitting ? 'Receiving…' : `Confirm Receipt (${enteredTotal})`}
            </button>
          </div>
        </div>

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

  // ── Screen 1: open PO list ──
  return (
    <>
      {banners}
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#f3f4f6' }}>
        <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#111827', margin: 0 }}>Receive Delivery</h1>
              <p style={{ fontSize: '12px', color: '#6b7280', margin: '2px 0 0' }}>
                {pos.length} open PO{pos.length === 1 ? '' : 's'}
                {expiresAt ? ` · session until ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(expiresAt))}` : ''}
              </p>
            </div>
            <button
              className="m-btn"
              onClick={() => backToList(true)}
              disabled={isRefreshingPos}
              aria-label="Refresh PO list"
              style={{
                width: '44px', height: '44px', borderRadius: '10px',
                background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: isRefreshingPos ? 'default' : 'pointer',
              }}
            >
              <svg
                width="20" height="20" fill="none" stroke="#374151" viewBox="0 0 24 24"
                style={isRefreshingPos ? { animation: 'm-spin 1s linear infinite' } : undefined}
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px', WebkitOverflowScrolling: 'touch' as any }}>
          {pos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 24px' }}>
              <div style={{
                width: '56px', height: '56px', margin: '0 auto', background: '#e5e7eb',
                borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg width="28" height="28" fill="none" stroke="#6b7280" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
              </div>
              <p style={{ fontSize: '15px', fontWeight: 600, color: '#374151', marginTop: '14px', marginBottom: '4px' }}>
                Nothing to receive
              </p>
              <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>
                No open POs are awaiting delivery. Pull to refresh or tap the refresh button.
              </p>
            </div>
          ) : (
            pos.map((po) => {
              const expected = formatDate(po.expected_delivery_date);
              const isLate = !!po.expected_delivery_date && new Date(po.expected_delivery_date) < new Date();
              return (
                <button
                  key={po.id}
                  className="m-btn"
                  onClick={() => openPo(po)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    background: '#fff', borderRadius: '12px', padding: '16px',
                    marginBottom: '8px', border: '1px solid #e5e7eb', cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: '#111827', fontFamily: 'ui-monospace, monospace' }}>
                        {po.po_number}
                      </div>
                      <div style={{ fontSize: '13px', color: '#4b5563', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {po.vendor_name || 'Unknown vendor'}
                      </div>
                      <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>
                        <span style={{ fontWeight: 600, color: '#1d4ed8' }}>
                          {po.outstanding_line_count} line{po.outstanding_line_count === 1 ? '' : 's'} outstanding
                        </span>
                        {expected && (
                          <span style={{ marginLeft: '8px', color: isLate ? '#dc2626' : '#6b7280', fontWeight: isLate ? 600 : 400 }}>
                            · expected {expected}{isLate ? ' (late)' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <svg width="20" height="20" fill="none" stroke="#9ca3af" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
