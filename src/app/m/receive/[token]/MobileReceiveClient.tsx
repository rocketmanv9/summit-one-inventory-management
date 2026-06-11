'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { MobileSessionExpired } from '@/components/mobile/MobileSessionExpired';
import { apiErrorMessage } from '@/lib/api-error';

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

  const jwtRef = useRef(jwt);
  jwtRef.current = jwt;

  const selectedPo = selectedPoId ? pos.find((p) => p.id === selectedPoId) || null : null;

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
    setQtyByLine(init);
    // A new PO selection is a new submit attempt set.
    submitKeyRef.current = null;
    setActionError(null);
  };

  const backToList = async (refresh: boolean) => {
    setSelectedPoId(null);
    setSuccess(null);
    setActionError(null);
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
    setQtyByLine(next);
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
        return;
      }

      const { data } = await res.json();
      submitKeyRef.current = null;
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
          </div>

          {/* Lines */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 12px 120px', WebkitOverflowScrolling: 'touch' as any }}>
            {selectedPo.lines.map((l) => {
              const blocked = isOverBlocked(l);
              const overOk = isOverAllowed(l);
              return (
                <div key={l.id} style={{
                  background: '#fff', borderRadius: '12px', padding: '14px',
                  marginBottom: '8px',
                  border: blocked ? '1.5px solid #fca5a5' : '1px solid #e5e7eb',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
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
                    <input
                      className="m-input-qty"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={qtyByLine[l.id] ?? ''}
                      onChange={(e) => setQtyByLine((prev) => ({ ...prev, [l.id]: e.target.value }))}
                      onFocus={(e) => e.target.select()}
                      style={{
                        width: '88px', flexShrink: 0, padding: '14px 10px',
                        borderRadius: '10px', textAlign: 'right',
                        fontSize: '18px', fontWeight: 700,
                        border: blocked ? '2px solid #ef4444' : '2px solid #d1d5db',
                        background: blocked ? '#fef2f2' : '#fff',
                      }}
                    />
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
