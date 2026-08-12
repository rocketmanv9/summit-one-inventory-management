'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { apiWrite, authenticatedFetch } from '@/lib/api-client';

interface MobileSession {
  id: string;
  session_id: string;
  token: string;
  expires_at: string;
  created_at: string;
  last_used_at?: string;
}

interface MobileSessionQRDialogProps {
  isOpen: boolean;
  onClose: () => void;
  cycleCountId: string;
  cycleCountNumber: string;
}

const TTL_OPTIONS = [
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
  { value: 480, label: '8 hours' },
  { value: 720, label: '12 hours' },
  { value: 1440, label: '24 hours' },
];

function formatTime(dateString: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(dateString));
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Expired';
  const totalMins = Math.floor(ms / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * QR handoff for a mobile count session, styled after the fleet app's
 * PhoneHandoffQR: the QR appears as soon as the dialog opens, changing the
 * duration regenerates it immediately (revoking the one it replaces), and a
 * live countdown swaps to a regenerate button when the session expires.
 * The link itself stays multi-hour and shareable — counts are handed to a
 * counter, not scanned at the desk — so Copy Link remains first-class.
 */
export function MobileSessionQRDialog({
  isOpen,
  onClose,
  cycleCountId,
  cycleCountNumber,
}: MobileSessionQRDialogProps) {
  const [ttl, setTtl] = useState(240);
  const [generating, setGenerating] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [sessionUrl, setSessionUrl] = useState('');
  const [sessionData, setSessionData] = useState<MobileSession | null>(null);
  const [activeSessions, setActiveSessions] = useState<MobileSession[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [msLeft, setMsLeft] = useState<number | null>(null);
  // Session this dialog instance created — replaced (and revoked) when the
  // duration changes so duration-shopping doesn't litter active sessions.
  const ownSessionIdRef = useRef<string | null>(null);

  const fetchActiveSessions = useCallback(async () => {
    try {
      const res = await authenticatedFetch(
        `/api/inventory/cycle-counts/${cycleCountId}/mobile-session`
      );
      const { data } = await res.json();
      setActiveSessions(data || []);
    } catch {
      // Silently fail - non-critical
    }
  }, [cycleCountId]);

  const generateSession = useCallback(async (ttlMinutes: number) => {
    setGenerating(true);
    setError('');
    try {
      // Replace rather than stack: revoke the session this dialog just made.
      if (ownSessionIdRef.current) {
        await apiWrite(
          `/api/inventory/cycle-counts/${cycleCountId}/mobile-session/${ownSessionIdRef.current}`,
          { method: 'DELETE' }
        ).catch(() => {});
        ownSessionIdRef.current = null;
      }

      const res = await apiWrite(
        `/api/inventory/cycle-counts/${cycleCountId}/mobile-session`,
        { method: 'POST', body: { ttl_minutes: ttlMinutes } }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = typeof data?.error === 'string' ? data.error : data?.error?.message;
        throw new Error(msg || 'Failed to generate session');
      }

      const { data } = await res.json();
      const fullUrl = `${window.location.origin}${data.url}`;
      setSessionUrl(fullUrl);
      setSessionData(data);
      ownSessionIdRef.current = data.session_id;
      setMsLeft(new Date(data.expires_at).getTime() - Date.now());

      const QRCode = (await import('qrcode')).default;
      const dataUrl = await QRCode.toDataURL(fullUrl, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
      setQrDataUrl(dataUrl);

      fetchActiveSessions();
    } catch (err: any) {
      setError(err.message || 'Failed to generate mobile session');
    } finally {
      setGenerating(false);
    }
  }, [cycleCountId, fetchActiveSessions]);

  // The QR is the whole point of the dialog — mint it the moment it opens.
  useEffect(() => {
    if (isOpen) {
      setQrDataUrl('');
      setSessionUrl('');
      setSessionData(null);
      setError('');
      setMsLeft(null);
      ownSessionIdRef.current = null;
      fetchActiveSessions();
      generateSession(ttl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, cycleCountId]);

  // Tick the countdown while a session is showing.
  useEffect(() => {
    if (!sessionData) return;
    const expires = new Date(sessionData.expires_at).getTime();
    const id = setInterval(() => setMsLeft(expires - Date.now()), 1000);
    return () => clearInterval(id);
  }, [sessionData]);

  const expired = msLeft !== null && msLeft <= 0;

  const handleTtlChange = (value: number) => {
    setTtl(value);
    generateSession(value);
  };

  const revokeSession = async (sessionId: string) => {
    try {
      const res = await apiWrite(
        `/api/inventory/cycle-counts/${cycleCountId}/mobile-session/${sessionId}`,
        { method: 'DELETE' }
      );

      if (!res.ok) {
        throw new Error('Failed to revoke session');
      }

      if (sessionData?.session_id === sessionId) {
        setQrDataUrl('');
        setSessionUrl('');
        setSessionData(null);
        setMsLeft(null);
        ownSessionIdRef.current = null;
      }

      fetchActiveSessions();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(sessionUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const input = document.createElement('input');
      input.value = sessionUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const otherSessions = activeSessions.filter((s) => s.id !== ownSessionIdRef.current);

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto z-50 p-6">
          <div className="flex items-center justify-between mb-2">
            <Dialog.Title className="text-lg font-semibold">
              Mobile Count - {cycleCountNumber}
            </Dialog.Title>
            <Dialog.Close className="text-gray-400 hover:text-gray-600 text-xl">
              &#x2715;
            </Dialog.Close>
          </div>

          <Dialog.Description className="text-sm text-gray-600 mb-4">
            Scan with a phone to start counting — no login needed.
          </Dialog.Description>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">
              {error}
            </div>
          )}

          <div className="space-y-4">
            {/* Duration — changing it swaps the QR immediately */}
            <div className="flex items-center justify-center gap-2 text-sm">
              <label className="text-gray-600">Phone can count for</label>
              <select
                value={ttl}
                onChange={(e) => handleTtlChange(Number(e.target.value))}
                disabled={generating}
                className="px-2 py-1 border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {TTL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* QR */}
            {qrDataUrl && !expired ? (
              <div className="flex justify-center">
                <img
                  src={qrDataUrl}
                  alt="Mobile count QR code"
                  className="w-64 h-64 border rounded-lg"
                />
              </div>
            ) : (
              <div className="mx-auto flex h-64 w-64 items-center justify-center rounded-lg border bg-gray-50">
                {generating ? (
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
                ) : expired ? (
                  <button
                    onClick={() => generateSession(ttl)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
                  >
                    Session expired — make a new one
                  </button>
                ) : null}
              </div>
            )}

            {/* Countdown + regenerate */}
            {sessionData && !expired && msLeft !== null && (
              <p className="text-center text-xs text-gray-500">
                Session valid for {formatRemaining(msLeft)} (until {formatTime(sessionData.expires_at)}) ·{' '}
                <button
                  onClick={() => generateSession(ttl)}
                  disabled={generating}
                  className="text-blue-600 hover:underline"
                >
                  regenerate
                </button>
              </p>
            )}

            {/* Copyable URL — for texting the link to the counter instead */}
            {sessionUrl && !expired && (
              <div className="flex items-center gap-2 bg-gray-50 border rounded-lg p-2">
                <code className="flex-1 text-xs text-gray-700 truncate">
                  {sessionUrl}
                </code>
                <button
                  onClick={copyUrl}
                  className="px-3 py-1 text-xs bg-white border rounded hover:bg-gray-50 font-medium flex-shrink-0"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            )}

            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              Anyone with this link or QR can record counts on {cycleCountNumber} until it
              expires — only share it with the person doing the counting.
            </p>
          </div>

          {/* Other active sessions */}
          {otherSessions.length > 0 && (
            <div className="mt-6 pt-4 border-t">
              <div className="text-sm font-medium mb-2">Other Active Sessions</div>
              <div className="space-y-2">
                {otherSessions
                  .map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between p-2 bg-gray-50 rounded-lg text-xs"
                    >
                      <div>
                        <div className="font-medium">
                          Created {formatTime(s.created_at)}
                        </div>
                        <div className="text-gray-500">
                          Expires {formatTime(s.expires_at)}
                          {s.last_used_at && ` | Last used ${formatTime(s.last_used_at)}`}
                        </div>
                      </div>
                      <button
                        onClick={() => revokeSession(s.id)}
                        className="px-2 py-1 text-red-600 hover:bg-red-50 rounded text-xs font-medium"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
