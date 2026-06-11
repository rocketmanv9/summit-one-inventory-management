'use client';

/**
 * Desktop QR dialog for mobile receiving sessions — mirrors
 * src/components/cycle-counts/MobileSessionQRDialog.tsx, but a receiving
 * session is tenant-wide (not tied to one PO): the yard phone receives
 * whichever truck shows up.
 */

import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { apiWrite, authenticatedFetch } from '@/lib/api-client';
import { apiErrorMessage } from '@/lib/api-error';

interface ReceivingSession {
  id: string;
  session_id: string;
  token: string;
  expires_at: string;
  created_at: string;
  last_used_at?: string;
}

interface ReceiveMobileQRDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const TTL_OPTIONS = [
  { value: 60, label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
  { value: 480, label: '8 hours' },
  { value: 720, label: '12 hours' },
  { value: 1440, label: '24 hours' },
];

export function ReceiveMobileQRDialog({ isOpen, onClose }: ReceiveMobileQRDialogProps) {
  // Default 12h — a receiving session typically covers a working day of deliveries.
  const [ttl, setTtl] = useState(720);
  const [generating, setGenerating] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [sessionUrl, setSessionUrl] = useState('');
  const [sessionData, setSessionData] = useState<ReceivingSession | null>(null);
  const [activeSessions, setActiveSessions] = useState<ReceivingSession[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetchActiveSessions();
      setQrDataUrl('');
      setSessionUrl('');
      setSessionData(null);
      setError('');
    }
  }, [isOpen]);

  const fetchActiveSessions = async () => {
    try {
      const res = await authenticatedFetch('/api/inventory/receiving/mobile-session');
      const { data } = await res.json();
      setActiveSessions(data || []);
    } catch {
      // Silently fail - non-critical
    }
  };

  const generateSession = async () => {
    setGenerating(true);
    setError('');

    try {
      const res = await apiWrite('/api/inventory/receiving/mobile-session', {
        method: 'POST',
        body: { ttl_minutes: ttl },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, 'Failed to generate session'));
      }

      const { data } = await res.json();
      const fullUrl = `${window.location.origin}${data.url}`;
      setSessionUrl(fullUrl);
      setSessionData(data);

      // Generate QR code
      const QRCode = (await import('qrcode')).default;
      const dataUrl = await QRCode.toDataURL(fullUrl, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
      setQrDataUrl(dataUrl);

      // Refresh active sessions list
      fetchActiveSessions();
    } catch (err: any) {
      setError(err.message || 'Failed to generate receiving session');
    } finally {
      setGenerating(false);
    }
  };

  const revokeSession = async (sessionId: string) => {
    try {
      const res = await apiWrite(
        `/api/inventory/receiving/mobile-session?session_id=${sessionId}`,
        { method: 'DELETE' }
      );

      if (!res.ok) {
        throw new Error('Failed to revoke session');
      }

      // If we revoked the one we just generated, clear the QR
      if (sessionData?.session_id === sessionId) {
        setQrDataUrl('');
        setSessionUrl('');
        setSessionData(null);
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

  const formatTime = (dateString: string) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(dateString));
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto z-50 p-6">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold">
              Receive on Phone
            </Dialog.Title>
            <Dialog.Close className="text-gray-400 hover:text-gray-600 text-xl">
              &#x2715;
            </Dialog.Close>
          </div>

          <Dialog.Description className="text-sm text-gray-600 mb-6">
            Generate a QR code so the yard phone can receive deliveries against any open PO — no login required. The link covers all open POs, not just one.
          </Dialog.Description>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">
              {error}
            </div>
          )}

          {!qrDataUrl ? (
            /* Generation form */
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Session Duration</label>
                <select
                  value={ttl}
                  onChange={(e) => setTtl(Number(e.target.value))}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {TTL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  The mobile link will expire after this period. You can revoke it early.
                </p>
              </div>

              <button
                onClick={generateSession}
                disabled={generating}
                className="w-full py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {generating ? 'Generating...' : 'Generate Receiving Link'}
              </button>
            </div>
          ) : (
            /* QR code display */
            <div className="space-y-4">
              <div className="flex justify-center">
                <img
                  src={qrDataUrl}
                  alt="Mobile receiving QR code"
                  className="w-64 h-64 border rounded-lg"
                />
              </div>

              <div className="text-center text-sm text-gray-600">
                Scan this QR code with the receiving phone
              </div>

              {/* Copyable URL */}
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

              {/* Expiry info */}
              {sessionData && (
                <div className="text-center text-xs text-gray-500">
                  Expires: {formatTime(sessionData.expires_at)}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setQrDataUrl('');
                    setSessionUrl('');
                    setSessionData(null);
                  }}
                  className="flex-1 py-2 border border-gray-300 rounded-md text-sm font-medium hover:bg-gray-50"
                >
                  Generate New
                </button>
                {sessionData && (
                  <button
                    onClick={() => revokeSession(sessionData.session_id)}
                    className="flex-1 py-2 bg-red-50 border border-red-200 text-red-700 rounded-md text-sm font-medium hover:bg-red-100"
                  >
                    Revoke
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Active sessions list */}
          {activeSessions.length > 0 && (
            <div className="mt-6 pt-4 border-t">
              <div className="text-sm font-medium mb-2">Active Sessions</div>
              <div className="space-y-2">
                {activeSessions.map((s) => (
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
