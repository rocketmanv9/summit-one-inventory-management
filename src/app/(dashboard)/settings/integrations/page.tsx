'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { getStoredAccessToken, parseJwtPayload } from '@/lib/auth-token';
import { CheckCircle2, XCircle, Loader2, ExternalLink, Wifi, WifiOff, Unplug, Plus, Trash2, Link, Search, ShoppingCart } from 'lucide-react';

const API = '/api/settings/integrations/printify';
const AMAZON_API = '/api/settings/integrations/amazon-business';

interface PrintifyStatus {
  connected: boolean;
  provider_id?: string;
  shop_id?: string | null;
  webhook_status?: string;
}

interface AmazonStatus {
  connected: boolean;
  provider_id?: string;
  application_id?: string | null;
  sandbox?: boolean;
  needs_authorization?: boolean;
}

interface Mapping {
  id: string;
  catalog_item_id: string;
  catalog_item_label: string;
  external_product_id: string;
  external_variant_id: string;
  unit_cost?: number;
  pack_size?: number | null;
  order_unit?: string | null;
  inventory_unit?: string | null;
}

interface AmazonProduct {
  asin: string;
  title: string;
  price?: { amount: number; currency: string };
  availability?: string;
  imageUrl?: string;
}

type ConnectionStatus = 'disconnected' | 'loading' | 'connected' | 'error';

export default function IntegrationsPage() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // ── Printify state ──────────────────────────────────────────────────
  const [printify, setPrintify] = useState<PrintifyStatus | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [apiToken, setApiToken] = useState('');
  const [shopId, setShopId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Printify mappings
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [showAddMapping, setShowAddMapping] = useState(false);
  const [newMapping, setNewMapping] = useState({ catalog_item_id: '', printify_product_id: '', printify_variant_id: '' });
  const [mappingSaving, setMappingSaving] = useState(false);
  const [mappingError, setMappingError] = useState('');

  // ── Amazon Business state ───────────────────────────────────────────
  const [amazon, setAmazon] = useState<AmazonStatus | null>(null);
  const [amazonStatus, setAmazonStatus] = useState<ConnectionStatus>('disconnected');
  const [amazonForm, setAmazonForm] = useState({ application_id: '', client_id: '', client_secret: '', refresh_token: '', sandbox: false });
  const [amazonSaving, setAmazonSaving] = useState(false);
  const [amazonError, setAmazonError] = useState('');
  const [amazonSuccess, setAmazonSuccess] = useState('');

  // Amazon mappings
  const [amazonMappings, setAmazonMappings] = useState<Mapping[]>([]);
  const [amazonMappingsLoading, setAmazonMappingsLoading] = useState(false);
  const [showAmazonAddMapping, setShowAmazonAddMapping] = useState(false);
  const [newAmazonMapping, setNewAmazonMapping] = useState({ catalog_item_id: '', asin: '', pack_size: '', order_unit: '', inventory_unit: '' });
  const [amazonMappingSaving, setAmazonMappingSaving] = useState(false);
  const [amazonMappingError, setAmazonMappingError] = useState('');

  // Amazon product search
  const [amazonSearchQuery, setAmazonSearchQuery] = useState('');
  const [amazonSearchResults, setAmazonSearchResults] = useState<AmazonProduct[]>([]);
  const [amazonSearching, setAmazonSearching] = useState(false);

  // Handle OAuth callback query params (amazon_success / amazon_error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthSuccess = params.get('amazon_success');
    const oauthError = params.get('amazon_error');
    if (oauthSuccess) {
      setAmazonSuccess(oauthSuccess);
      setAmazonStatus('connected');
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    } else if (oauthError) {
      setAmazonError(oauthError);
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Shared catalog items
  const [catalogItems, setCatalogItems] = useState<Array<{ id: string; label: string }>>([]);

  useEffect(() => {
    const token = getStoredAccessToken();
    const payload = token ? parseJwtPayload(token) : null;
    setIsAdmin(payload?.app_metadata?.role === 'admin');
    loadAllStatuses();
  }, []);

  // ── Load statuses ───────────────────────────────────────────────────

  const loadAllStatuses = async () => {
    setLoading(true);
    await Promise.all([loadPrintifyStatus(), loadAmazonStatus()]);
    setLoading(false);
  };

  const loadPrintifyStatus = async () => {
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
    }
  };

  const loadAmazonStatus = async () => {
    try {
      const res = await fetch(AMAZON_API);
      const json = await res.json();
      const data = json?.data;
      if (data) {
        setAmazon(data);
        setAmazonStatus(data.connected ? 'connected' : 'disconnected');
      }
    } catch {
      // Not connected yet
    }
  };

  // ── Shared: load catalog items ──────────────────────────────────────

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

  // ── Printify: load mappings ─────────────────────────────────────────

  const loadMappings = useCallback(async () => {
    setMappingsLoading(true);
    try {
      const res = await fetch(`${API}/mappings`);
      if (res.ok) {
        const json = await res.json();
        setMappings(json?.data || []);
      }
    } catch {
      // Silently fail
    } finally {
      setMappingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (connectionStatus === 'connected' || amazonStatus === 'connected') {
      loadCatalogItems();
    }
  }, [connectionStatus, amazonStatus, loadCatalogItems]);

  useEffect(() => {
    if (connectionStatus === 'connected') loadMappings();
  }, [connectionStatus, loadMappings]);

  // ── Amazon: load mappings ───────────────────────────────────────────

  const loadAmazonMappings = useCallback(async () => {
    setAmazonMappingsLoading(true);
    try {
      const res = await fetch(`${AMAZON_API}/mappings`);
      if (res.ok) {
        const json = await res.json();
        setAmazonMappings(json?.data || []);
      }
    } catch {
      // Silently fail
    } finally {
      setAmazonMappingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (amazonStatus === 'connected') loadAmazonMappings();
  }, [amazonStatus, loadAmazonMappings]);

  // ── Printify handlers ───────────────────────────────────────────────

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
      await loadPrintifyStatus();
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
      await loadPrintifyStatus();
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

  // ── Amazon handlers ─────────────────────────────────────────────────

  const handleAmazonConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setAmazonError('');
    setAmazonSuccess('');
    setAmazonSaving(true);

    try {
      const res = await fetch(AMAZON_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(amazonForm),
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error?.message || 'Failed to connect');
      }

      // If no refresh_token was provided, credentials are saved — redirect to Amazon OAuth
      if (json?.data?.needs_authorization) {
        setAmazonSuccess('Credentials saved. Redirecting to Amazon for authorization...');
        await loadAmazonStatus();
        // Redirect to our auth route which redirects to Amazon
        window.location.href = '/api/settings/integrations/amazon-business/auth';
        return;
      }

      setAmazonForm({ application_id: '', client_id: '', client_secret: '', refresh_token: '', sandbox: false });
      const valid = json?.data?.valid;
      if (valid) {
        setAmazonSuccess('Connected to Amazon Business successfully.');
        setAmazonStatus('connected');
      } else {
        setAmazonSuccess('Credentials saved but could not verify connection. Check your credentials.');
        setAmazonStatus('error');
      }
      await loadAmazonStatus();
    } catch (err: unknown) {
      setAmazonError(err instanceof Error ? err.message : 'Failed to connect');
      setAmazonStatus('error');
    } finally {
      setAmazonSaving(false);
    }
  };

  const handleAmazonDisconnect = async () => {
    if (!isAdmin) return;
    setAmazonSaving(true);
    setAmazonError('');
    setAmazonSuccess('');

    try {
      await fetch(AMAZON_API, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({}),
      });
      setAmazonStatus('disconnected');
      setAmazonMappings([]);
      setAmazonSuccess('Amazon Business disconnected.');
      await loadAmazonStatus();
    } catch (err: unknown) {
      setAmazonError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setAmazonSaving(false);
    }
  };

  const handleAmazonProductSearch = async () => {
    if (!amazonSearchQuery.trim()) return;
    setAmazonSearching(true);
    try {
      const res = await fetch(`${AMAZON_API}/products?q=${encodeURIComponent(amazonSearchQuery)}&limit=10`);
      if (res.ok) {
        const json = await res.json();
        setAmazonSearchResults(json?.data || []);
      }
    } catch {
      // Silently fail
    } finally {
      setAmazonSearching(false);
    }
  };

  const handleAmazonAddMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setAmazonMappingError('');
    setAmazonMappingSaving(true);

    try {
      const res = await fetch(`${AMAZON_API}/mappings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          catalog_item_id: newAmazonMapping.catalog_item_id,
          asin: newAmazonMapping.asin,
          ...(newAmazonMapping.pack_size ? { pack_size: Number(newAmazonMapping.pack_size) } : {}),
          ...(newAmazonMapping.order_unit ? { order_unit: newAmazonMapping.order_unit } : {}),
          ...(newAmazonMapping.inventory_unit ? { inventory_unit: newAmazonMapping.inventory_unit } : {}),
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error?.message || 'Failed to save mapping');
      }

      setNewAmazonMapping({ catalog_item_id: '', asin: '', pack_size: '', order_unit: '', inventory_unit: '' });
      setShowAmazonAddMapping(false);
      setAmazonSearchResults([]);
      setAmazonSearchQuery('');
      await loadAmazonMappings();
    } catch (err: unknown) {
      setAmazonMappingError(err instanceof Error ? err.message : 'Failed to save mapping');
    } finally {
      setAmazonMappingSaving(false);
    }
  };

  const handleAmazonDeleteMapping = async (mappingId: string) => {
    if (!isAdmin) return;
    try {
      await fetch(`${AMAZON_API}/mappings`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ mapping_id: mappingId }),
      });
      await loadAmazonMappings();
    } catch {
      // Silently fail
    }
  };

  // ── Render ──────────────────────────────────────────────────────────

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
        {/* ═══ Printify Connection Card ═══ */}
        <div className="bg-white rounded-lg border">
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

        {/* Printify Product Mappings */}
        {connectionStatus === 'connected' && (
          <div className="bg-white rounded-lg border">
            <div className="flex items-center justify-between p-6 border-b">
              <div className="flex items-center gap-3">
                <Link className="h-5 w-5 text-muted-foreground" />
                <div>
                  <h3 className="text-lg font-semibold">Printify Mappings</h3>
                  <p className="text-sm text-muted-foreground">Link catalog items to Printify products for automatic reordering</p>
                </div>
              </div>
              {isAdmin && (
                <button onClick={() => setShowAddMapping(!showAddMapping)}
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> Add Mapping
                </button>
              )}
            </div>
            <div className="p-6">
              {showAddMapping && (
                <form onSubmit={handleAddMapping} className="mb-6 p-4 bg-gray-50 border rounded-lg space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Catalog Item</label>
                    <select value={newMapping.catalog_item_id}
                      onChange={(e) => setNewMapping({ ...newMapping, catalog_item_id: e.target.value })}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm bg-white"
                      required disabled={!isAdmin}>
                      <option value="">Select a catalog item...</option>
                      {catalogItems.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Printify Product ID</label>
                      <input type="text" value={newMapping.printify_product_id}
                        onChange={(e) => setNewMapping({ ...newMapping, printify_product_id: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                        placeholder="e.g., 6543abc..." required disabled={!isAdmin} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Printify Variant ID</label>
                      <input type="text" value={newMapping.printify_variant_id}
                        onChange={(e) => setNewMapping({ ...newMapping, printify_variant_id: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                        placeholder="e.g., 12345" required disabled={!isAdmin} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="submit" disabled={mappingSaving}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm">
                      {mappingSaving ? 'Saving...' : 'Save Mapping'}
                    </button>
                    <button type="button" onClick={() => { setShowAddMapping(false); setMappingError(''); }}
                      className="px-4 py-2 border rounded-md hover:bg-gray-50 text-sm">Cancel</button>
                  </div>
                  {mappingError && (
                    <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-800 flex items-start gap-2">
                      <XCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />{mappingError}
                    </div>
                  )}
                </form>
              )}
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
                            <button onClick={() => {
                              setNewMapping({ catalog_item_id: m.catalog_item_id, printify_product_id: m.external_product_id, printify_variant_id: m.external_variant_id });
                              setShowAddMapping(true);
                            }} className="p-1 text-muted-foreground hover:text-foreground" title="Edit mapping">
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

        {/* ═══ Amazon Business Connection Card ═══ */}
        <div className="bg-white rounded-lg border">
          <div className="flex items-center justify-between p-6 border-b">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-orange-50 border border-orange-200">
                <ShoppingCart className="h-6 w-6 text-orange-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Amazon Business</h3>
                <p className="text-sm text-muted-foreground">Procurement marketplace for supplies, materials, and equipment</p>
              </div>
            </div>
            <StatusBadge status={amazonStatus} />
          </div>

          <div className="p-6">
            {amazonStatus === 'connected' && amazon ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  <span>Connected to Amazon Business{amazon.application_id ? <> (App ID: <span className="font-mono font-medium">{amazon.application_id}</span>)</> : ''}</span>
                  {amazon.sandbox ? (
                    <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 border border-yellow-300">Sandbox</span>
                  ) : (
                    <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-300">Production</span>
                  )}
                </div>

                <details className="group">
                  <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">Update credentials</summary>
                  <form onSubmit={handleAmazonConnect} className="mt-3 space-y-3">
                    <div className="flex items-center justify-between p-3 bg-gray-50 border rounded-md">
                      <div>
                        <label className="text-sm font-medium">Sandbox Mode</label>
                        <p className="text-xs text-muted-foreground mt-0.5">Uses Amazon&apos;s test environment with mock data</p>
                      </div>
                      <button type="button" role="switch" aria-checked={amazonForm.sandbox}
                        onClick={() => setAmazonForm({ ...amazonForm, sandbox: !amazonForm.sandbox })}
                        disabled={!isAdmin}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 ${amazonForm.sandbox ? 'bg-yellow-500' : 'bg-gray-200'}`}>
                        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${amazonForm.sandbox ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Application ID</label>
                      <input type="text" value={amazonForm.application_id}
                        onChange={(e) => setAmazonForm({ ...amazonForm, application_id: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                        placeholder="amzn1.application..." disabled={!isAdmin} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Client ID</label>
                      <input type="password" value={amazonForm.client_id}
                        onChange={(e) => setAmazonForm({ ...amazonForm, client_id: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                        required disabled={!isAdmin} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Client Secret</label>
                      <input type="password" value={amazonForm.client_secret}
                        onChange={(e) => setAmazonForm({ ...amazonForm, client_secret: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                        required disabled={!isAdmin} />
                    </div>
                    <button type="submit" disabled={!isAdmin || amazonSaving || !amazonForm.client_id || !amazonForm.client_secret}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm">
                      {amazonSaving ? 'Saving...' : 'Update & Re-authorize'}
                    </button>
                  </form>
                </details>

                <div className="flex items-center gap-3 pt-2 border-t">
                  <button onClick={handleAmazonDisconnect} disabled={amazonSaving || !isAdmin}
                    className="px-4 py-2 border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50 text-sm flex items-center gap-2">
                    <Unplug className="h-3 w-3" /> Disconnect
                  </button>
                </div>
              </div>
            ) : amazon?.needs_authorization ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                  <Loader2 className="h-4 w-4 flex-shrink-0" />
                  <span>Credentials saved — authorization with Amazon required</span>
                </div>
                <a href="/api/settings/integrations/amazon-business/auth"
                  className="w-full px-4 py-2.5 bg-orange-600 text-white rounded-md hover:bg-orange-700 font-medium flex items-center justify-center gap-2 text-sm">
                  <ExternalLink className="h-4 w-4" /> Authorize with Amazon
                </a>
                <div className="flex items-center gap-3 pt-2 border-t">
                  <button onClick={handleAmazonDisconnect} disabled={amazonSaving || !isAdmin}
                    className="px-4 py-2 border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50 text-sm flex items-center gap-2">
                    <Unplug className="h-3 w-3" /> Remove Credentials
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleAmazonConnect} className="space-y-4">
                <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm space-y-2">
                  <p className="font-medium text-orange-900">Setup Instructions</p>
                  <ol className="list-decimal list-inside text-orange-800 space-y-1 text-xs">
                    <li>Go to the{' '}
                      <a href="https://sellercentral.amazon.com/sellingpartner/developerconsole" target="_blank" rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1">
                        Amazon Solution Provider Portal <ExternalLink className="h-3 w-3" />
                      </a>
                    </li>
                    <li>Create a new app — choose <strong>Sandbox</strong> or <strong>Production</strong> as the App Type</li>
                    <li>Set <strong>OAuth Login URI</strong> and <strong>OAuth Redirect URI</strong> to this app&apos;s domain (see below)</li>
                    <li>Under Business entities, select <strong>Vendors</strong></li>
                    <li>Under Roles, select <strong>Inventory and Order Tracking</strong></li>
                    <li>After creating the app, copy the <strong>Client ID</strong> and <strong>Client Secret</strong> from the LWA credentials section</li>
                    <li>Enter the credentials below, then click <strong>Save &amp; Authorize</strong></li>
                  </ol>
                  <div className="mt-2 p-2 bg-white border border-orange-200 rounded text-xs font-mono text-orange-900">
                    <div><span className="text-orange-600">OAuth Login URI:</span> {typeof window !== 'undefined' ? `${window.location.origin}/api/settings/integrations/amazon-business/auth` : ''}</div>
                    <div><span className="text-orange-600">Redirect URI:</span> {typeof window !== 'undefined' ? `${window.location.origin}/api/settings/integrations/amazon-business/callback` : ''}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 border rounded-md">
                  <div>
                    <label className="text-sm font-medium">Sandbox Mode</label>
                    <p className="text-xs text-muted-foreground mt-0.5">Uses Amazon&apos;s test environment with mock data</p>
                  </div>
                  <button type="button" role="switch" aria-checked={amazonForm.sandbox}
                    onClick={() => setAmazonForm({ ...amazonForm, sandbox: !amazonForm.sandbox })}
                    disabled={!isAdmin}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 ${amazonForm.sandbox ? 'bg-yellow-500' : 'bg-gray-200'}`}>
                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${amazonForm.sandbox ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Application ID</label>
                  <input type="text" value={amazonForm.application_id}
                    onChange={(e) => setAmazonForm({ ...amazonForm, application_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                    placeholder="amzn1.application..." disabled={!isAdmin} />
                  <p className="text-xs text-muted-foreground mt-1">Found in your app listing after creation. Used for SP-API authorization.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Client ID</label>
                  <input type="password" value={amazonForm.client_id}
                    onChange={(e) => setAmazonForm({ ...amazonForm, client_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                    placeholder="amzn1.application-oa2-client..." required disabled={!isAdmin} />
                  <p className="text-xs text-muted-foreground mt-1">All credentials are encrypted and stored securely in Vault.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Client Secret</label>
                  <input type="password" value={amazonForm.client_secret}
                    onChange={(e) => setAmazonForm({ ...amazonForm, client_secret: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                    required disabled={!isAdmin} />
                </div>
                <button type="submit" disabled={!isAdmin || amazonSaving || !amazonForm.client_id || !amazonForm.client_secret}
                  className="w-full px-4 py-2.5 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50 font-medium flex items-center justify-center gap-2">
                  {amazonSaving ? (<><Loader2 className="h-4 w-4 animate-spin" />Saving...</>) : (<><ExternalLink className="h-4 w-4" /> Save &amp; Authorize with Amazon</>)}
                </button>
              </form>
            )}

            {amazonError && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start gap-2">
                <XCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-800">{amazonError}</p>
              </div>
            )}
            {amazonSuccess && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-green-800">{amazonSuccess}</p>
              </div>
            )}
          </div>
        </div>

        {/* Amazon Business ASIN Mappings */}
        {amazonStatus === 'connected' && (
          <div className="bg-white rounded-lg border">
            <div className="flex items-center justify-between p-6 border-b">
              <div className="flex items-center gap-3">
                <Link className="h-5 w-5 text-muted-foreground" />
                <div>
                  <h3 className="text-lg font-semibold">Amazon ASIN Mappings</h3>
                  <p className="text-sm text-muted-foreground">Link catalog items to Amazon products (ASINs) for ordering</p>
                </div>
              </div>
              {isAdmin && (
                <button onClick={() => setShowAmazonAddMapping(!showAmazonAddMapping)}
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> Add Mapping
                </button>
              )}
            </div>
            <div className="p-6">
              {showAmazonAddMapping && (
                <form onSubmit={handleAmazonAddMapping} className="mb-6 p-4 bg-gray-50 border rounded-lg space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Catalog Item</label>
                    <select value={newAmazonMapping.catalog_item_id}
                      onChange={(e) => setNewAmazonMapping({ ...newAmazonMapping, catalog_item_id: e.target.value })}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm bg-white"
                      required disabled={!isAdmin}>
                      <option value="">Select a catalog item...</option>
                      {catalogItems.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Amazon Product Search */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Search Amazon Products</label>
                    <div className="flex gap-2">
                      <input type="text" value={amazonSearchQuery}
                        onChange={(e) => setAmazonSearchQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAmazonProductSearch(); } }}
                        className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                        placeholder="Search by keyword..." disabled={!isAdmin} />
                      <button type="button" onClick={handleAmazonProductSearch} disabled={amazonSearching || !amazonSearchQuery.trim()}
                        className="px-3 py-2 border rounded-md hover:bg-gray-50 disabled:opacity-50 text-sm flex items-center gap-1.5">
                        {amazonSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                        Search
                      </button>
                    </div>
                  </div>

                  {/* Search Results */}
                  {amazonSearchResults.length > 0 && (
                    <div className="max-h-48 overflow-y-auto border rounded-md bg-white divide-y">
                      {amazonSearchResults.map((p) => (
                        <button key={p.asin} type="button"
                          onClick={() => setNewAmazonMapping({ ...newAmazonMapping, asin: p.asin })}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between ${
                            newAmazonMapping.asin === p.asin ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
                          }`}>
                          <div className="min-w-0 flex-1">
                            <div className="font-medium truncate">{p.title}</div>
                            <div className="text-xs text-muted-foreground font-mono">ASIN: {p.asin}</div>
                          </div>
                          {p.price && (
                            <span className="ml-2 text-xs font-medium text-green-700 whitespace-nowrap">
                              ${p.price.amount.toFixed(2)}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium mb-1">ASIN</label>
                    <input type="text" value={newAmazonMapping.asin}
                      onChange={(e) => setNewAmazonMapping({ ...newAmazonMapping, asin: e.target.value })}
                      className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                      placeholder="e.g., B07XYZ1234" required disabled={!isAdmin} />
                    <p className="text-xs text-muted-foreground mt-1">Select from search results above or enter an ASIN directly.</p>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Pack Size</label>
                      <input type="number" min="1" value={newAmazonMapping.pack_size}
                        onChange={(e) => setNewAmazonMapping({ ...newAmazonMapping, pack_size: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                        placeholder="e.g., 12" disabled={!isAdmin} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Order Unit</label>
                      <input type="text" value={newAmazonMapping.order_unit}
                        onChange={(e) => setNewAmazonMapping({ ...newAmazonMapping, order_unit: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                        placeholder="e.g., case" disabled={!isAdmin} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Inventory Unit</label>
                      <input type="text" value={newAmazonMapping.inventory_unit}
                        onChange={(e) => setNewAmazonMapping({ ...newAmazonMapping, inventory_unit: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                        placeholder="e.g., each" disabled={!isAdmin} />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">Pack size and unit conversions help calculate correct order quantities (e.g., 1 case = 12 each).</p>

                  <div className="flex items-center gap-2">
                    <button type="submit" disabled={amazonMappingSaving}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm">
                      {amazonMappingSaving ? 'Saving...' : 'Save Mapping'}
                    </button>
                    <button type="button" onClick={() => { setShowAmazonAddMapping(false); setAmazonMappingError(''); setAmazonSearchResults([]); setAmazonSearchQuery(''); }}
                      className="px-4 py-2 border rounded-md hover:bg-gray-50 text-sm">Cancel</button>
                  </div>
                  {amazonMappingError && (
                    <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-800 flex items-start gap-2">
                      <XCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />{amazonMappingError}
                    </div>
                  )}
                </form>
              )}

              {/* Amazon Mappings Table */}
              {amazonMappingsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : amazonMappings.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Link className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No ASIN mappings yet.</p>
                  <p className="text-xs mt-1">Add mappings to link catalog items to Amazon products for procurement ordering.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium text-muted-foreground">Catalog Item</th>
                        <th className="pb-2 font-medium text-muted-foreground">ASIN</th>
                        <th className="pb-2 font-medium text-muted-foreground">Pack</th>
                        <th className="pb-2 font-medium text-muted-foreground w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {amazonMappings.map((m) => (
                        <tr key={m.id} className="border-b last:border-0">
                          <td className="py-2.5">{m.catalog_item_label}</td>
                          <td className="py-2.5 font-mono text-xs">{m.external_product_id}</td>
                          <td className="py-2.5 text-xs text-muted-foreground">
                            {m.pack_size ? `${m.pack_size} ${m.inventory_unit || 'ea'}/${m.order_unit || 'pack'}` : '—'}
                          </td>
                          <td className="py-2.5">
                            {isAdmin && (
                              <button onClick={() => handleAmazonDeleteMapping(m.id)}
                                className="p-1 text-muted-foreground hover:text-red-600" title="Delete mapping">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
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
