'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { getStoredAccessToken, parseJwtPayload } from '@/lib/auth-token';
import { CheckCircle2, XCircle, Loader2, ExternalLink, Wifi, WifiOff, Unplug } from 'lucide-react';

const API = '/api/settings/integrations/printify';

interface PrintifyStatus {
  connected: boolean;
  provider_id?: string;
  shop_id?: string | null;
  webhook_status?: string;
}

type ConnectionStatus = 'disconnected' | 'loading' | 'connected' | 'error';

export default function IntegrationsPage() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [printify, setPrintify] = useState<PrintifyStatus | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [apiToken, setApiToken] = useState('');
  const [shopId, setShopId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    const token = getStoredAccessToken();
    const payload = token ? parseJwtPayload(token) : null;
    setIsAdmin(payload?.app_metadata?.role === 'admin');
    loadStatus();
  }, []);

  const loadStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch(API);
      const json = await res.json();
      const data = json?.data;
      if (data) {
        setPrintify(data);
        setShopId(data.shop_id || '');
        setConnectionStatus(data.connected ? 'connected' : 'disconnected');
      }
    } catch {
      // Not connected yet
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const body: Record<string, string> = { shop_id: shopId };
      if (apiToken) body.api_token = apiToken;

      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error?.message || 'Failed to connect');
      }

      setApiToken('');
      const valid = json?.data?.valid;
      if (valid) {
        setSuccess('Connected to Printify successfully.');
        setConnectionStatus('connected');
      } else {
        setSuccess('Credentials saved but could not verify connection. Check your API token and Shop ID.');
        setConnectionStatus('error');
      }
      await loadStatus();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setConnectionStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!isAdmin) return;
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await fetch(API, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({}),
      });
      setConnectionStatus('disconnected');
      setSuccess('Printify disconnected.');
      await loadStatus();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Integrations"
        description="Connect third-party services to your organization"
        backHref="/settings"
      />

      {!isAdmin && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-800 font-medium">Admin Access Required</p>
          <p className="text-yellow-700 text-sm mt-1">Only administrators can manage integrations.</p>
        </div>
      )}

      <div className="max-w-2xl space-y-6">
        <div className="bg-white rounded-lg border">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-50 border border-green-200">
                <span className="text-xl font-bold text-green-700">P</span>
              </div>
              <div>
                <h3 className="text-lg font-semibold">Printify</h3>
                <p className="text-sm text-muted-foreground">Print-on-demand fulfillment for apparel and custom products</p>
              </div>
            </div>
            <StatusBadge status={connectionStatus} />
          </div>

          {/* Body */}
          <div className="p-6">
            {connectionStatus === 'connected' && printify ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  <span>Connected to Printify shop <span className="font-mono font-medium">{printify.shop_id || 'unknown'}</span></span>
                </div>

                {printify.webhook_status && (
                  <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                    printify.webhook_status === 'registered'
                      ? 'bg-green-50 border border-green-200 text-green-700'
                      : printify.webhook_status === 'failed'
                        ? 'bg-red-50 border border-red-200 text-red-700'
                        : 'bg-gray-50 border border-gray-200 text-gray-600'
                  }`}>
                    {printify.webhook_status === 'registered' ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                    Webhooks: {printify.webhook_status === 'registered' ? 'Active' : printify.webhook_status === 'failed' ? 'Failed' : 'Not registered'}
                  </div>
                )}

                <details className="group">
                  <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">Update credentials</summary>
                  <form onSubmit={handleConnect} className="mt-3 space-y-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">New API Token</label>
                      <input type="password" value={apiToken} onChange={(e) => setApiToken(e.target.value)}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                        placeholder="Leave blank to keep current token" disabled={!isAdmin} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Shop ID</label>
                      <input type="text" value={shopId} onChange={(e) => setShopId(e.target.value)}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm" disabled={!isAdmin} />
                    </div>
                    <button type="submit" disabled={!isAdmin || saving || (!apiToken && !shopId)}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm">
                      {saving ? 'Saving...' : 'Update Credentials'}
                    </button>
                  </form>
                </details>

                <div className="flex items-center gap-3 pt-2 border-t">
                  <button onClick={handleDisconnect} disabled={saving || !isAdmin}
                    className="px-4 py-2 border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50 text-sm flex items-center gap-2">
                    <Unplug className="h-3 w-3" /> Disconnect
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleConnect} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Enter your Printify API token and Shop ID to connect. You can find these in your{' '}
                  <a href="https://printify.com/app/account/api" target="_blank" rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1">
                    Printify account settings <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
                <div>
                  <label className="block text-sm font-medium mb-1">API Token</label>
                  <input type="password" value={apiToken} onChange={(e) => setApiToken(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                    placeholder="eyJ0eXAiOiJKV1QiLCJhbGciOi..." required disabled={!isAdmin} />
                  <p className="text-xs text-muted-foreground mt-1">Your token is encrypted and stored securely in Vault.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Shop ID</label>
                  <input type="text" value={shopId} onChange={(e) => setShopId(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                    placeholder="e.g., 12345678" required disabled={!isAdmin} />
                  <p className="text-xs text-muted-foreground mt-1">Found in your Printify shop URL or account settings.</p>
                </div>
                <button type="submit" disabled={!isAdmin || saving || !apiToken || !shopId}
                  className="w-full px-4 py-2.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 font-medium flex items-center justify-center gap-2">
                  {saving ? (<><Loader2 className="h-4 w-4 animate-spin" />Connecting...</>) : 'Connect Printify'}
                </button>
              </form>
            )}

            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
                <XCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}
            {success && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-green-800">{success}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StatusBadge({ status }: { status: ConnectionStatus }) {
  switch (status) {
    case 'connected':
      return (<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700"><span className="h-1.5 w-1.5 rounded-full bg-green-500" />Connected</span>);
    case 'loading':
      return (<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600"><Loader2 className="h-3 w-3 animate-spin" />Checking...</span>);
    case 'error':
      return (<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700"><span className="h-1.5 w-1.5 rounded-full bg-red-500" />Error</span>);
    default:
      return (<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600"><span className="h-1.5 w-1.5 rounded-full bg-gray-400" />Not Connected</span>);
  }
}
