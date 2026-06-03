'use client';

/**
 * Settings → Integrations → Gmail
 *
 * Self-contained card: connect a personal Gmail account or a shared company
 * mailbox (purchasing@company.com), see connection status, disconnect, and
 * pull vendor replies. All token handling happens server-side; this component
 * only ever sees connection metadata.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Mail,
  Unplug,
  Users,
  User as UserIcon,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import type { GoogleStatusResponse, GoogleConnectionPublic } from '@/types/integrations';

const API = '/api/integrations/google';

const ERROR_MESSAGES: Record<string, string> = {
  session_mismatch: 'The sign-in session changed during connection. Please try again.',
  no_refresh_token:
    'Google did not return offline access. Remove this app at myaccount.google.com/permissions, then reconnect.',
  no_email: 'Could not read the Google account email. Please try again.',
  access_denied: 'Connection was cancelled.',
  connection_failed: 'Something went wrong connecting to Google. Please try again.',
  missing_code_or_state: 'The Google callback was incomplete. Please try again.',
};

export function GmailIntegration({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<GoogleStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showSharedForm, setShowSharedForm] = useState(false);
  const [sharedLabel, setSharedLabel] = useState('');
  const [syncResult, setSyncResult] = useState<string>('');

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API}/status`);
      const json = await res.json();
      if (res.ok) setStatus(json.data);
    } catch {
      // not connected yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    // Surface ?gmail=connected / ?gmail_error=… set by the OAuth callback redirect.
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('gmail');
    const errCode = params.get('gmail_error');
    if (connected === 'connected') {
      const email = params.get('email');
      setSuccess(`Connected ${email || 'your Google account'} successfully.`);
    }
    if (errCode) {
      setError(ERROR_MESSAGES[errCode] || `Connection failed (${errCode}).`);
    }
    if (connected || errCode) {
      window.history.replaceState({}, '', window.location.pathname + '?tab=gmail');
    }
  }, [loadStatus]);

  const startConnect = async (connectionType: 'user' | 'shared_mailbox', displayName?: string) => {
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      const qs = new URLSearchParams({ connection_type: connectionType });
      if (displayName) qs.set('display_name', displayName);
      const res = await fetch(`${API}/auth?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || 'Could not start Google connection');
      window.location.href = json.data.url; // full-page redirect to Google consent
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start Google connection');
      setBusy(false);
    }
  };

  const disconnect = async (connectionId: string) => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`${API}/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ connection_id: connectionId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || 'Failed to disconnect');
      setSuccess('Disconnected.');
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect');
    } finally {
      setBusy(false);
    }
  };

  const syncReplies = async () => {
    setBusy(true);
    setSyncResult('');
    setError('');
    try {
      const res = await fetch(`${API}/sync-replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || 'Sync failed');
      setSyncResult(
        `Scanned ${json.data.scannedConnections} mailbox(es) — ${json.data.newReplies} new repl${json.data.newReplies === 1 ? 'y' : 'ies'}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const personal = status?.personal ?? null;
  const shared = status?.shared_mailboxes ?? [];
  const notConfigured = status && !status.configured;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border">
        <div className="flex items-center justify-between p-6 border-b">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-red-50 border border-red-200">
              <Mail className="h-6 w-6 text-red-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Gmail</h3>
              <p className="text-sm text-muted-foreground">
                Send purchase orders from your Google account and read vendor replies
              </p>
            </div>
          </div>
          <StatusPill active={!!(personal || shared.length)} />
        </div>

        <div className="p-6 space-y-5">
          {notConfigured && (
            <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
              <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>
                Google OAuth isn’t configured on the server yet. Add <code>GOOGLE_CLIENT_ID</code> and{' '}
                <code>GOOGLE_CLIENT_SECRET</code> to the environment.
              </span>
            </div>
          )}

          {/* ── Personal account ── */}
          <div>
            <div className="flex items-center gap-2 mb-2 text-sm font-medium">
              <UserIcon className="h-4 w-4 text-muted-foreground" /> Your Gmail account
            </div>
            {personal ? (
              <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2 text-sm text-green-800">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  <span className="font-medium">{personal.google_email}</span>
                </div>
                <button
                  onClick={() => disconnect(personal.id)}
                  disabled={busy}
                  className="px-3 py-1.5 border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50 text-xs flex items-center gap-1.5"
                >
                  <Unplug className="h-3 w-3" /> Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={() => startConnect('user')}
                disabled={busy || !!notConfigured}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm flex items-center gap-2"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Connect my Gmail
              </button>
            )}
          </div>

          {/* ── Shared mailboxes ── */}
          <div className="pt-4 border-t">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4 text-muted-foreground" /> Shared company mailboxes
              </div>
              {isAdmin && !showSharedForm && (
                <button
                  onClick={() => setShowSharedForm(true)}
                  className="text-xs text-primary hover:underline"
                >
                  + Add shared mailbox
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Send every PO from a single address like <code>purchasing@company.com</code> instead of
              individual employees’ personal email.
            </p>

            {shared.length > 0 && (
              <div className="space-y-2 mb-3">
                {shared.map((c) => (
                  <SharedRow key={c.id} conn={c} onDisconnect={disconnect} disabled={busy} isAdmin={isAdmin} />
                ))}
              </div>
            )}

            {isAdmin && showSharedForm && (
              <div className="p-3 bg-gray-50 border rounded-lg space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Label (optional)</label>
                  <input
                    type="text"
                    value={sharedLabel}
                    onChange={(e) => setSharedLabel(e.target.value)}
                    placeholder="e.g. Purchasing"
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    You’ll sign in to the shared Google account on the next screen. That account must
                    grant Gmail access.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => startConnect('shared_mailbox', sharedLabel.trim() || undefined)}
                    disabled={busy || !!notConfigured}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm flex items-center gap-2"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                    Connect shared mailbox
                  </button>
                  <button
                    onClick={() => {
                      setShowSharedForm(false);
                      setSharedLabel('');
                    }}
                    className="px-4 py-2 border rounded-md hover:bg-gray-50 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {shared.length === 0 && !showSharedForm && (
              <p className="text-xs text-muted-foreground italic">No shared mailboxes connected.</p>
            )}
          </div>

          {/* ── Reply sync ── */}
          {(personal || shared.length > 0) && (
            <div className="pt-4 border-t flex items-center justify-between">
              <div className="text-sm">
                <div className="font-medium">Vendor replies</div>
                <div className="text-xs text-muted-foreground">
                  Pull recent replies and link them to their purchase orders.
                </div>
                {syncResult && <div className="text-xs text-green-700 mt-1">{syncResult}</div>}
              </div>
              <button
                onClick={syncReplies}
                disabled={busy}
                className="px-3 py-1.5 border rounded-md hover:bg-gray-50 disabled:opacity-50 text-sm flex items-center gap-1.5"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /> Sync replies
              </button>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
              <XCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
          {success && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-md flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-green-800">{success}</p>
            </div>
          )}

          <p className="text-xs text-muted-foreground flex items-center gap-1 pt-1">
            <ExternalLink className="h-3 w-3" />
            Scopes requested: send email + read replies. Tokens are encrypted at rest and never shown
            to the browser.
          </p>
        </div>
      </div>
    </div>
  );
}

function SharedRow({
  conn,
  onDisconnect,
  disabled,
  isAdmin,
}: {
  conn: GoogleConnectionPublic;
  onDisconnect: (id: string) => void;
  disabled: boolean;
  isAdmin: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
      <div className="flex items-center gap-2 text-sm text-green-800">
        <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
        <span className="font-medium">{conn.google_email}</span>
        {conn.display_name && <span className="text-xs text-green-700">({conn.display_name})</span>}
      </div>
      {isAdmin && (
        <button
          onClick={() => onDisconnect(conn.id)}
          disabled={disabled}
          className="px-3 py-1.5 border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50 text-xs flex items-center gap-1.5"
        >
          <Unplug className="h-3 w-3" /> Disconnect
        </button>
      )}
    </div>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
        active ? 'bg-green-100 text-green-800 border-green-300' : 'bg-gray-100 text-gray-600 border-gray-300'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-green-500' : 'bg-gray-400'}`} />
      {active ? 'Connected' : 'Not connected'}
    </span>
  );
}
