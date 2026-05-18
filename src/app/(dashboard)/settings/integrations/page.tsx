'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProvisioningRPC } from '@/lib/rpc/provisioning';
import { getStoredAccessToken, parseJwtPayload } from '@/lib/auth-token';
import { CheckCircle2, XCircle, Loader2, ExternalLink, Wifi, WifiOff, Unplug } from 'lucide-react';

interface PrintifyProvider {
  id: string;
  provider_key: string;
  display_name: string;
  provider_type: string;
  config: Record<string, unknown>;
  is_active: boolean;
  webhook_status?: string;
  last_event_id: string;
}

type ConnectionStatus = 'disconnected' | 'loading' | 'connected' | 'error';

export default function IntegrationsPage() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // Printify state
  const [printifyProvider, setPrintifyProvider] = useState<PrintifyProvider | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [apiToken, setApiToken] = useState('');
  const [shopId, setShopId] = useState('');
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    checkAdminStatus();
    loadPrintifyProvider();
  }, []);

  const checkAdminStatus = () => {
    const token = getStoredAccessToken();
    const payload = token ? parseJwtPayload(token) : null;
    setIsAdmin(payload?.app_metadata?.role === 'admin');
  };

  const loadPrintifyProvider = async () => {
    setLoading(true);
    try {
      const res = await ProvisioningRPC.getProviders();
      const providers = res?.data || res || [];
      const printify = providers.find(
        (p: any) => p.provider_type === 'print_on_demand' && p.provider_key?.startsWith('printify')
      );
      if (printify) {
        setPrintifyProvider(printify);
        setShopId((printify.config?.shop_id as string) || '');
        setConnectionStatus(printify.is_active ? 'connected' : 'disconnected');
      }
    } catch {
      // No providers yet — that's fine
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
      if (printifyProvider) {
        // Update existing provider
        await ProvisioningRPC.updateProvider(printifyProvider.id, {
          config: {
            api_token_ref: apiToken || '********',
            shop_id: shopId,
          },
          is_active: true,
          last_event_id: printifyProvider.last_event_id,
        });
      } else {
        // Create new provider
        await ProvisioningRPC.createProvider({
          provider_key: 'printify-main',
          display_name: 'Printify',
          provider_type: 'print_on_demand',
          config: {
            api_token_ref: apiToken,
            shop_id: shopId,
          },
          capabilities: ['apparel', 'print_on_demand'],
          priority: 100,
          is_active: true,
        });
      }

      setApiToken('');
      setSuccess('Printify credentials saved. Validating connection...');

      // Reload provider to get the ID for validation
      await loadPrintifyProvider();

      // Auto-validate after save
      await handleValidate();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save Printify configuration');
      setConnectionStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    setError('');

    try {
      // Re-fetch to get latest provider ID
      const res = await ProvisioningRPC.getProviders();
      const providers = res?.data || res || [];
      const printify = providers.find(
        (p: any) => p.provider_type === 'print_on_demand' && p.provider_key?.startsWith('printify')
      );

      if (!printify) {
        setError('No Printify provider found. Please save your credentials first.');
        setConnectionStatus('error');
        return;
      }

      const result = await ProvisioningRPC.validateProvider(printify.id);
      const validation = result?.data || result;

      if (validation?.valid) {
        setConnectionStatus('connected');
        setSuccess('Connected to Printify. Webhooks registered.');
        setPrintifyProvider(printify);
        // Reload to pick up webhook status changes
        await loadPrintifyProvider();
      } else {
        setConnectionStatus('error');
        setError(validation?.errors?.join(', ') || 'Failed to validate Printify credentials. Check your API token and Shop ID.');
      }
    } catch (err: unknown) {
      setConnectionStatus('error');
      setError(err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setValidating(false);
    }
  };

  const handleDisconnect = async () => {
    if (!printifyProvider || !isAdmin) return;

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await ProvisioningRPC.updateProvider(printifyProvider.id, {
        is_active: false,
        last_event_id: printifyProvider.last_event_id,
      });
      setConnectionStatus('disconnected');
      setSuccess('Printify disconnected.');
      await loadPrintifyProvider();
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
          <p className="text-yellow-700 text-sm mt-1">
            Only administrators can manage integrations.
          </p>
        </div>
      )}

      <div className="max-w-2xl space-y-6">
        {/* Printify Card */}
        <div className="bg-white rounded-lg border">
          {/* Card Header */}
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

          {/* Card Body */}
          <div className="p-6">
            {connectionStatus === 'connected' && printifyProvider ? (
              <div className="space-y-4">
                {/* Connected state */}
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  <span>Connected to Printify shop <span className="font-mono font-medium">{printifyProvider.config?.shop_id as string || 'unknown'}</span></span>
                </div>

                {/* Webhook status */}
                <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                  printifyProvider.webhook_status === 'registered'
                    ? 'bg-green-50 border border-green-200 text-green-700'
                    : printifyProvider.webhook_status === 'failed'
                      ? 'bg-red-50 border border-red-200 text-red-700'
                      : 'bg-gray-50 border border-gray-200 text-gray-600'
                }`}>
                  {printifyProvider.webhook_status === 'registered' ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                  Webhooks: {printifyProvider.webhook_status === 'registered' ? 'Active' : printifyProvider.webhook_status === 'failed' ? 'Failed' : 'Not registered'}
                </div>

                {/* Update credentials form */}
                <details className="group">
                  <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                    Update credentials
                  </summary>
                  <form onSubmit={handleConnect} className="mt-3 space-y-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">New API Token</label>
                      <input
                        type="password"
                        value={apiToken}
                        onChange={(e) => setApiToken(e.target.value)}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                        placeholder="Leave blank to keep current token"
                        disabled={!isAdmin}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Shop ID</label>
                      <input
                        type="text"
                        value={shopId}
                        onChange={(e) => setShopId(e.target.value)}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                        disabled={!isAdmin}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!isAdmin || saving || (!apiToken && !shopId)}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm"
                    >
                      {saving ? 'Saving...' : 'Update Credentials'}
                    </button>
                  </form>
                </details>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-2 border-t">
                  <button
                    onClick={handleValidate}
                    disabled={validating || !isAdmin}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 text-sm flex items-center gap-2"
                  >
                    {validating ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                    {validating ? 'Testing...' : 'Test Connection'}
                  </button>
                  <button
                    onClick={handleDisconnect}
                    disabled={saving || !isAdmin}
                    className="px-4 py-2 border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50 text-sm flex items-center gap-2"
                  >
                    <Unplug className="h-3 w-3" />
                    Disconnect
                  </button>
                  <a
                    href={`/provisioning/providers/${printifyProvider.id}`}
                    className="ml-auto px-4 py-2 text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    Advanced <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            ) : (
              /* Disconnected / Setup state */
              <form onSubmit={handleConnect} className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Enter your Printify API token and Shop ID to connect. You can find these in your{' '}
                  <a
                    href="https://printify.com/app/account/api"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                  >
                    Printify account settings <ExternalLink className="h-3 w-3" />
                  </a>
                </p>

                <div>
                  <label className="block text-sm font-medium mb-1">API Token</label>
                  <input
                    type="password"
                    value={apiToken}
                    onChange={(e) => setApiToken(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                    placeholder="eyJ0eXAiOiJKV1QiLCJhbGciOi..."
                    required
                    disabled={!isAdmin}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Your token is encrypted and stored securely in Vault.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Shop ID</label>
                  <input
                    type="text"
                    value={shopId}
                    onChange={(e) => setShopId(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                    placeholder="e.g., 12345678"
                    required
                    disabled={!isAdmin}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Found in your Printify shop URL or account settings.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={!isAdmin || saving || !apiToken || !shopId}
                  className="w-full px-4 py-2.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 font-medium flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    'Connect Printify'
                  )}
                </button>
              </form>
            )}

            {/* Error/Success Messages */}
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
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          Connected
        </span>
      );
    case 'loading':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
          <Loader2 className="h-3 w-3 animate-spin" />
          Checking...
        </span>
      );
    case 'error':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
          Error
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
          <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
          Not Connected
        </span>
      );
  }
}
