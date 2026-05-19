'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { getStoredAccessToken, parseJwtPayload } from '@/lib/auth-token';
import { CheckCircle2, XCircle, Loader2, ExternalLink, Wifi, WifiOff, Unplug, Plus, Trash2, Link, ShoppingBag } from 'lucide-react';

const API = '/api/settings/integrations/printify';
const PROCUREMENT_API = '/api/settings/integrations/procurement';

interface PrintifyStatus {
  connected: boolean;
  provider_id?: string;
  shop_id?: string | null;
  webhook_status?: string;
}

interface Mapping {
  id: string;
  catalog_item_id: string;
  catalog_item_label: string;
  external_product_id: string;
  external_variant_id: string;
  unit_cost?: number;
}

interface ProcurementAdapter {
  key: string;
  displayName: string;
  description: string;
  iconLetter: string;
  iconColor: string;
  connectionStatus: 'connected' | 'disconnected' | 'error';
  providerId: string | null;
  authMethod: string;
}

type ConnectionStatus = 'disconnected' | 'loading' | 'connected' | 'error';

export default function IntegrationsPage() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  // Procurement adapters state
  const [procurementAdapters, setProcurementAdapters] = useState<ProcurementAdapter[]>([]);
  const [procurementConnecting, setProcurementConnecting] = useState<string | null>(null);
  const [procurementError, setProcurementError] = useState('');
  const [procurementSuccess, setProcurementSuccess] = useState('');
  const [printify, setPrintify] = useState<PrintifyStatus | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [apiToken, setApiToken] = useState('');
  const [shopId, setShopId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Mappings state
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [showAddMapping, setShowAddMapping] = useState(false);
  const [newMapping, setNewMapping] = useState({ catalog_item_id: '', printify_product_id: '', printify_variant_id: '' });
  const [mappingSaving, setMappingSaving] = useState(false);
  const [mappingError, setMappingError] = useState('');

  // Catalog items for dropdown
  const [catalogItems, setCatalogItems] = useState<Array<{ id: string; label: string }>>([]);

  useEffect(() => {
    const token = getStoredAccessToken();
    const payload = token ? parseJwtPayload(token) : null;
    setIsAdmin(payload?.app_metadata?.role === 'admin');
    loadStatus();
    loadProcurementAdapters();
  }, []);

  const loadProcurementAdapters = async () => {
    try {
      const res = await fetch(PROCUREMENT_API);
      if (res.ok) {
        const json = await res.json();
        setProcurementAdapters(json?.data || []);
      }
    } catch {
      // Silently fail
    }
  };

  const handleProcurementConnect = async (adapterKey: string) => {
    if (!isAdmin) return;
    setProcurementConnecting(adapterKey);
    setProcurementError('');
    setProcurementSuccess('');
    try {
      const res = await fetch(`${PROCUREMENT_API}/${adapterKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ credentials: {}, settings: {} }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || 'Failed to connect');
      setProcurementSuccess(`${adapterKey} connected successfully.`);
      await loadProcurementAdapters();
    } catch (err: unknown) {
      setProcurementError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setProcurementConnecting(null);
    }
  };

  const handleProcurementDisconnect = async (adapterKey: string) => {
    if (!isAdmin) return;
    setProcurementConnecting(adapterKey);
    setProcurementError('');
    setProcurementSuccess('');
    try {
      await fetch(`${PROCUREMENT_API}/${adapterKey}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({}),
      });
      setProcurementSuccess(`${adapterKey} disconnected.`);
      await loadProcurementAdapters();
    } catch (err: unknown) {
      setProcurementError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setProcurementConnecting(null);
    }
  };

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

  const loadMappings = useCallback(async () => {
    setMappingsLoading(true);
    try {
      const res = await fetch(`${API}/mappings`);
      if (res.ok) {
        const json = await res.json();
        setMappings(json?.data || []);
      }
    } catch {
      // Silently fail — user can retry
    } finally {
      setMappingsLoading(false);
    }
  }, []);

  const loadCatalogItems = useCallback(async () => {
    try {
      const res = await fetch('/api/inventory/items?limit=200');
      if (res.ok) {
        const json = await res.json();
        const items = json?.data || [];
        setCatalogItems(items.map((i: any) => ({ id: i.id, label: `${i.name} (${i.sku})` })));
      }
    } catch {
      // Silently fail
    }
  }, []);

  // Load mappings and catalog items when connected
  useEffect(() => {
    if (connectionStatus === 'connected') {
      loadMappings();
      loadCatalogItems();
    }
  }, [connectionStatus, loadMappings, loadCatalogItems]);

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
      setMappings([]);
      setSuccess('Printify disconnected.');
      await loadStatus();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setSaving(false);
    }
  };

  const handleAddMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setMappingError('');
    setMappingSaving(true);

    try {
      const res = await fetch(`${API}/mappings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(newMapping),
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error?.message || 'Failed to save mapping');
      }

      setNewMapping({ catalog_item_id: '', printify_product_id: '', printify_variant_id: '' });
      setShowAddMapping(false);
      await loadMappings();
    } catch (err: unknown) {
      setMappingError(err instanceof Error ? err.message : 'Failed to save mapping');
    } finally {
      setMappingSaving(false);
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
        {/* Printify Connection Card */}
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

        {/* Product Mappings Card — only shown when connected */}
        {/* ── Procurement Integrations ──────────────────────────────── */}
        {procurementAdapters.length > 0 && (
          <div className="pt-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
              <ShoppingBag className="h-4 w-4" /> Procurement
            </h2>
            {procurementError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
                <XCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-800">{procurementError}</p>
              </div>
            )}
            {procurementSuccess && (
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-md flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-green-800">{procurementSuccess}</p>
              </div>
            )}
            {procurementAdapters.map((adapter) => {
              const colorMap: Record<string, { bg: string; border: string; text: string }> = {
                orange: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700' },
                blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' },
                green: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700' },
              };
              const colors = colorMap[adapter.iconColor] || colorMap.blue;
              const isConnecting = procurementConnecting === adapter.key;

              return (
                <div key={adapter.key} className="bg-white rounded-lg border mb-4">
                  <div className="flex items-center justify-between p-6 border-b">
                    <div className="flex items-center gap-4">
                      <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${colors.bg} ${colors.border} border`}>
                        <span className={`text-xl font-bold ${colors.text}`}>{adapter.iconLetter}</span>
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold">{adapter.displayName}</h3>
                        <p className="text-sm text-muted-foreground">{adapter.description}</p>
                      </div>
                    </div>
                    <StatusBadge status={adapter.connectionStatus === 'connected' ? 'connected' : adapter.connectionStatus === 'error' ? 'error' : 'disconnected'} />
                  </div>
                  <div className="p-6">
                    {adapter.connectionStatus === 'connected' ? (
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                          <span>Connected to {adapter.displayName} (stub mode)</span>
                        </div>
                        <div className="flex items-center gap-3 pt-2 border-t">
                          <button onClick={() => handleProcurementDisconnect(adapter.key)} disabled={isConnecting || !isAdmin}
                            className="px-4 py-2 border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50 text-sm flex items-center gap-2">
                            {isConnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unplug className="h-3 w-3" />} Disconnect
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                          Connect {adapter.displayName} to browse and order supplies directly from your dashboard.
                          {adapter.authMethod === 'oauth2' ? ' Uses OAuth for secure authentication.' : ' Requires an API key.'}
                        </p>
                        <button
                          onClick={() => handleProcurementConnect(adapter.key)}
                          disabled={isConnecting || !isAdmin}
                          className="w-full px-4 py-2.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 font-medium flex items-center justify-center gap-2"
                        >
                          {isConnecting ? (<><Loader2 className="h-4 w-4 animate-spin" />Connecting...</>) : `Connect ${adapter.displayName}`}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Product Mappings Card — only shown when Printify connected */}
        {connectionStatus === 'connected' && (
          <div className="bg-white rounded-lg border">
            <div className="flex items-center justify-between p-6 border-b">
              <div className="flex items-center gap-3">
                <Link className="h-5 w-5 text-muted-foreground" />
                <div>
                  <h3 className="text-lg font-semibold">Product Mappings</h3>
                  <p className="text-sm text-muted-foreground">Link your catalog items to Printify products for automatic reordering</p>
                </div>
              </div>
              {isAdmin && (
                <button
                  onClick={() => setShowAddMapping(!showAddMapping)}
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm flex items-center gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" /> Add Mapping
                </button>
              )}
            </div>

            <div className="p-6">
              {/* Add Mapping Form */}
              {showAddMapping && (
                <form onSubmit={handleAddMapping} className="mb-6 p-4 bg-gray-50 border rounded-lg space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Catalog Item</label>
                    <select
                      value={newMapping.catalog_item_id}
                      onChange={(e) => setNewMapping({ ...newMapping, catalog_item_id: e.target.value })}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm bg-white"
                      required
                      disabled={!isAdmin}
                    >
                      <option value="">Select a catalog item...</option>
                      {catalogItems.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Printify Product ID</label>
                      <input
                        type="text"
                        value={newMapping.printify_product_id}
                        onChange={(e) => setNewMapping({ ...newMapping, printify_product_id: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                        placeholder="e.g., 6543abc..."
                        required
                        disabled={!isAdmin}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Printify Variant ID</label>
                      <input
                        type="text"
                        value={newMapping.printify_variant_id}
                        onChange={(e) => setNewMapping({ ...newMapping, printify_variant_id: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                        placeholder="e.g., 12345"
                        required
                        disabled={!isAdmin}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="submit" disabled={mappingSaving}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm">
                      {mappingSaving ? 'Saving...' : 'Save Mapping'}
                    </button>
                    <button type="button" onClick={() => { setShowAddMapping(false); setMappingError(''); }}
                      className="px-4 py-2 border rounded-md hover:bg-gray-50 text-sm">
                      Cancel
                    </button>
                  </div>
                  {mappingError && (
                    <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-800 flex items-start gap-2">
                      <XCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                      {mappingError}
                    </div>
                  )}
                </form>
              )}

              {/* Mappings Table */}
              {mappingsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : mappings.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Link className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No product mappings yet.</p>
                  <p className="text-xs mt-1">Add mappings to link your catalog items to Printify products for automatic reordering.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium text-muted-foreground">Catalog Item</th>
                        <th className="pb-2 font-medium text-muted-foreground">Printify Product ID</th>
                        <th className="pb-2 font-medium text-muted-foreground">Variant ID</th>
                        <th className="pb-2 font-medium text-muted-foreground w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {mappings.map((m) => (
                        <tr key={m.id} className="border-b last:border-0">
                          <td className="py-2.5">{m.catalog_item_label}</td>
                          <td className="py-2.5 font-mono text-xs">{m.external_product_id}</td>
                          <td className="py-2.5 font-mono text-xs">{m.external_variant_id}</td>
                          <td className="py-2.5">
                            <button
                              onClick={() => {
                                setNewMapping({
                                  catalog_item_id: m.catalog_item_id,
                                  printify_product_id: m.external_product_id,
                                  printify_variant_id: m.external_variant_id,
                                });
                                setShowAddMapping(true);
                              }}
                              className="p-1 text-muted-foreground hover:text-foreground"
                              title="Edit mapping"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
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
