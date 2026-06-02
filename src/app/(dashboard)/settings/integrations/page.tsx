'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { SettingsNav } from '@/components/settings/SettingsNav';
import { getStoredAccessToken, parseJwtPayload } from '@/lib/auth-token';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { CheckCircle2, XCircle, Loader2, ExternalLink, Wifi, WifiOff, Unplug, Plus, Trash2, Link, Search, ShoppingCart, Sparkles, Wand2 } from 'lucide-react';

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
  configured: boolean;
  provider_id?: string;
  integration_mode?: string;
  sandbox?: boolean;
  po_request_url_set?: boolean;
  punchout_urls?: string[];
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

interface AmazonItemMapping {
  id: string;
  catalog_item_id: string;
  item_name: string | null;
  item_sku: string | null;
  supplier_sku: string;
  pack_quantity: number;
  unit_cost: number | null;
  last_known_price: number | null;
  price_checked_at: string | null;
  is_preferred: boolean;
  active: boolean;
}

interface ResolvedAsin {
  asin: string;
  title: string | null;
  image_url: string | null;
  price: number | null;
  product_url: string;
}

type ConnectionStatus = 'disconnected' | 'loading' | 'connected' | 'error';

export default function IntegrationsPage() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'amazon' | 'printify'>('amazon');

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
  const [amazonForm, setAmazonForm] = useState({ from_identity: '', shared_secret: '', po_request_url: '', punchout_urls: '', sandbox: true });
  const [amazonSaving, setAmazonSaving] = useState(false);
  const [amazonError, setAmazonError] = useState('');
  const [amazonSuccess, setAmazonSuccess] = useState('');

  // Amazon item mappings (vendor_items-backed)
  const [amazonMappings, setAmazonMappings] = useState<AmazonItemMapping[]>([]);
  const [amazonMappingsLoading, setAmazonMappingsLoading] = useState(false);
  const [showAmazonAddMapping, setShowAmazonAddMapping] = useState(false);
  const [amazonMappingSaving, setAmazonMappingSaving] = useState(false);
  const [amazonMappingError, setAmazonMappingError] = useState('');

  // ASIN resolve flow
  const [asinInput, setAsinInput] = useState('');
  const [asinResolving, setAsinResolving] = useState(false);
  const [resolvedAsin, setResolvedAsin] = useState<ResolvedAsin | null>(null);
  const [newMappingForm, setNewMappingForm] = useState({ catalog_item_id: '', pack_quantity: '1', is_preferred: false });

  // Punchout orders
  const [punchoutOrders, setPunchoutOrders] = useState<any[]>([]);
  const [punchoutOrdersLoading, setPunchoutOrdersLoading] = useState(false);
  const [punchoutReviewId, setPunchoutReviewId] = useState<string | null>(null);
  const [punchoutReviewOrder, setPunchoutReviewOrder] = useState<any>(null);
  const [punchoutSubmitting, setPunchoutSubmitting] = useState(false);

  // Shared catalog items + categories
  const [catalogItems, setCatalogItems] = useState<Array<{ id: string; label: string }>>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string; sku_prefix: string | null }>>([]);

  // AI "paste link → draft item + map" flow
  type AiDraft = {
    name: string;
    description: string;
    category_id: string | null;        // use this existing category
    new_category_name: string | null;  // …or create this one
    category_sku_prefix: string;
    uom_term_id: string | null;
    uom_label: string;
    tracking_mode: string;
    reorder_point: number | null;
    duplicates: Array<{ entityId: string; name: string; score: number }>;
  };
  const [mappingMode, setMappingMode] = useState<'ai' | 'existing'>('ai');
  const [aiDrafting, setAiDrafting] = useState(false);
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const [asinAlreadyMapped, setAsinAlreadyMapped] = useState<string | null>(null);
  const [manualName, setManualName] = useState('');

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

  const loadCategories = useCallback(async () => {
    try {
      const rows = await InventoryRPC.getItemCategories();
      setCategories(rows.map((c) => ({ id: c.id, name: c.name, sku_prefix: c.sku_prefix ?? null })));
    } catch {
      // Silently fail — AI draft falls back to creating a new category by name.
    }
  }, []);

  useEffect(() => {
    if (connectionStatus === 'connected' || amazonStatus === 'connected') {
      loadCatalogItems();
    }
    if (amazonStatus === 'connected') {
      loadCategories();
    }
  }, [connectionStatus, amazonStatus, loadCatalogItems, loadCategories]);

  useEffect(() => {
    if (connectionStatus === 'connected') loadMappings();
  }, [connectionStatus, loadMappings]);

  // ── Amazon: load item mappings ──────────────────────────────────────

  const loadAmazonMappings = useCallback(async () => {
    setAmazonMappingsLoading(true);
    try {
      const res = await fetch(`${AMAZON_API}/item-mappings`);
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

  // Poll for punchout cart return (user is shopping on Amazon in another tab)
  useEffect(() => {
    const hasActiveSession = punchoutOrders.some((o: any) => o.status === 'punchout_started');
    if (!hasActiveSession) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${AMAZON_API}/punchout/orders`);
        if (!res.ok) return;
        const json = await res.json();
        const orders = json?.data || [];
        setPunchoutOrders(orders);

        const returned = orders.find((o: any) => o.status === 'cart_returned' && !punchoutReviewOrder);
        if (returned) {
          const detail = await fetch(`${AMAZON_API}/punchout/orders?id=${returned.id}`);
          const detailJson = await detail.json();
          if (detailJson?.data) {
            setPunchoutReviewOrder(detailJson.data);
            setPunchoutReviewId(returned.id);
          }
        }
      } catch {
        // Silently fail
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [punchoutOrders, punchoutReviewOrder]);

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
      const punchoutUrls = amazonForm.punchout_urls
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean);

      const res = await fetch(AMAZON_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          from_identity: amazonForm.from_identity,
          shared_secret: amazonForm.shared_secret,
          po_request_url: amazonForm.po_request_url,
          punchout_urls: punchoutUrls,
          sandbox: amazonForm.sandbox,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error?.message || 'Failed to connect');
      }

      setAmazonForm({ from_identity: '', shared_secret: '', po_request_url: '', punchout_urls: '', sandbox: true });
      if (json?.data?.configured) {
        setAmazonSuccess('cXML credentials saved and validated. Integration is in test mode.');
        setAmazonStatus('connected');
      } else {
        setAmazonSuccess('Credentials saved. Some configuration may be incomplete — check PO Request URL.');
        setAmazonStatus('connected');
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

  const handleAmazonModeToggle = async (sandbox: boolean) => {
    if (!isAdmin) return;
    setAmazonSaving(true);
    setAmazonError('');
    setAmazonSuccess('');
    try {
      const res = await fetch(AMAZON_API, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ sandbox }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg = typeof j.error === 'string' ? j.error : j.error?.message || 'Failed to switch mode';
        throw new Error(msg);
      }
      setAmazonSuccess(sandbox ? 'Switched to Test (sandbox) mode.' : 'Switched to Live mode — real orders will be placed.');
      await loadAmazonStatus();
    } catch (err: unknown) {
      setAmazonError(err instanceof Error ? err.message : 'Failed to switch mode');
    } finally {
      setAmazonSaving(false);
    }
  };

  const handleResolveAsin = async () => {
    if (!asinInput.trim()) return;
    setAsinResolving(true);
    setResolvedAsin(null);
    setAiDraft(null);
    setAsinAlreadyMapped(null);
    setManualName('');
    setMappingMode('ai');
    setNewMappingForm({ catalog_item_id: '', pack_quantity: '1', is_preferred: false });
    setAmazonMappingError('');

    try {
      const res = await fetch(`${AMAZON_API}/item-mappings/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: asinInput }),
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error?.message || 'Could not resolve ASIN');
      }

      const resolved: ResolvedAsin = json.data;
      setResolvedAsin(resolved);

      // ASIN-level dedup: this exact product may already be mapped.
      const existing = amazonMappings.find((m) => m.supplier_sku === resolved.asin);
      if (existing) {
        setAsinAlreadyMapped(existing.item_name || resolved.asin);
        return;
      }

      // Kick off the AI draft from the product title (one-tap review fills it in).
      if (resolved.title) {
        void buildAiDraft(resolved.title);
      }
    } catch (err: unknown) {
      setAmazonMappingError(err instanceof Error ? err.message : 'Could not resolve ASIN');
    } finally {
      setAsinResolving(false);
    }
  };

  // Ask the AI to draft catalog fields from the product title, and check whether
  // we already stock a matching item (so the user can map to it instead).
  const buildAiDraft = async (title: string) => {
    setAiDrafting(true);
    try {
      const [suggestRes, dupRes] = await Promise.all([
        fetch('/api/ai/item-suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: title,
            existing_categories: categories.map((c) => ({ id: c.id, name: c.name, sku_prefix: c.sku_prefix })),
          }),
        }),
        fetch(`/api/ai/duplicates?entity_type=item&name=${encodeURIComponent(title)}`),
      ]);

      const suggestJson = await suggestRes.json().catch(() => ({}));
      const dupJson = await dupRes.json().catch(() => ({}));

      const duplicates = (dupJson?.data || []).map((d: any) => ({
        entityId: d.entityId,
        name: d.name,
        score: d.score ?? 0,
      }));

      if (suggestRes.ok && suggestJson?.suggestion) {
        const s = suggestJson.suggestion;
        setAiDraft({
          name: title,
          description: s.description || '',
          category_id: s.category_id ?? null,
          new_category_name: s.category_id ? null : (s.new_category_name || s.category_display || null),
          category_sku_prefix: s.sku_prefix || '',
          uom_term_id: s.uom_term_id ?? null,
          uom_label: s.uom || 'Each',
          tracking_mode: s.tracking_mode || 'stock',
          reorder_point: typeof s.reorder_point === 'number' ? s.reorder_point : null,
          duplicates,
        });
      } else {
        // AI unavailable — still let the user create with the raw title, or map manually.
        setAiDraft({
          name: title, description: '', category_id: null, new_category_name: null,
          category_sku_prefix: '', uom_term_id: null, uom_label: 'Each',
          tracking_mode: 'stock', reorder_point: null, duplicates,
        });
      }
    } catch {
      // Non-fatal — the user can still pick "Map to existing item".
    } finally {
      setAiDrafting(false);
    }
  };

  const postAmazonMapping = async (catalogItemId: string) => {
    const res = await fetch(`${AMAZON_API}/item-mappings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({
        catalog_item_id: catalogItemId,
        asin: resolvedAsin!.asin,
        pack_quantity: Number(newMappingForm.pack_quantity) || 1,
        last_known_price: resolvedAsin!.price ?? undefined,
        is_preferred: newMappingForm.is_preferred,
        notes: resolvedAsin!.title ?? undefined,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message || 'Failed to save mapping');
  };

  const resetAmazonAddMapping = () => {
    setNewMappingForm({ catalog_item_id: '', pack_quantity: '1', is_preferred: false });
    setResolvedAsin(null);
    setAiDraft(null);
    setAsinAlreadyMapped(null);
    setManualName('');
    setAsinInput('');
    setShowAmazonAddMapping(false);
  };

  const handleAmazonAddMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !resolvedAsin) return;
    setAmazonMappingError('');
    setAmazonMappingSaving(true);

    try {
      let catalogItemId = newMappingForm.catalog_item_id;

      if (mappingMode === 'ai') {
        if (!aiDraft || !aiDraft.name.trim()) {
          throw new Error('Item name is required.');
        }

        // Create the category first if the AI proposed a brand-new one.
        let categoryId = aiDraft.category_id;
        if (!categoryId && aiDraft.new_category_name?.trim()) {
          const cat = await InventoryRPC.createItemCategory({
            name: aiDraft.new_category_name.trim(),
            sku_prefix: aiDraft.category_sku_prefix || undefined,
          } as any);
          categoryId = cat.id;
        }

        // Create the catalog item (SKU auto-generated by the RPC).
        const item = await InventoryRPC.createCatalogItem({
          name: aiDraft.name.trim(),
          description: aiDraft.description || undefined,
          category_id: categoryId || undefined,
          uom_term_id: aiDraft.uom_term_id || undefined,
          tracking_mode: aiDraft.tracking_mode || undefined,
          reorder_point: aiDraft.reorder_point ?? undefined,
        } as any);
        catalogItemId = item.id;
      }

      if (!catalogItemId) throw new Error('Select an inventory item to map.');

      await postAmazonMapping(catalogItemId);

      resetAmazonAddMapping();
      await Promise.all([loadAmazonMappings(), loadCatalogItems(), loadCategories()]);
    } catch (err: unknown) {
      setAmazonMappingError(err instanceof Error ? err.message : 'Failed to save mapping');
    } finally {
      setAmazonMappingSaving(false);
    }
  };

  const handleAmazonDeleteMapping = async (mappingId: string) => {
    if (!isAdmin) return;
    try {
      const res = await fetch(`${AMAZON_API}/item-mappings`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ mapping_id: mappingId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setAmazonMappingError(json.error?.message || json.error || 'Failed to delete mapping');
        return;
      }
      await loadAmazonMappings();
    } catch {
      setAmazonMappingError('Failed to delete mapping. Please try again.');
    }
  };

  // ── Punchout order handlers ─────────────────────────────────────────

  const loadPunchoutOrders = useCallback(async () => {
    setPunchoutOrdersLoading(true);
    try {
      const res = await fetch(`${AMAZON_API}/punchout/orders`);
      if (res.ok) {
        const json = await res.json();
        setPunchoutOrders(json?.data || []);
      }
    } catch {
      // Silently fail
    } finally {
      setPunchoutOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (amazonStatus === 'connected') loadPunchoutOrders();
  }, [amazonStatus, loadPunchoutOrders]);

  // Check for punchout query params (set after POOM return redirect)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reviewId = params.get('punchout_review');
    const punchoutError = params.get('punchout_error');
    if (reviewId) {
      setPunchoutReviewId(reviewId);
      window.history.replaceState({}, '', window.location.pathname);
      fetch(`${AMAZON_API}/punchout/orders?id=${reviewId}`)
        .then((r) => r.json())
        .then((json) => setPunchoutReviewOrder(json?.data || null))
        .catch(() => {});
    }
    if (punchoutError) {
      setAmazonError(decodeURIComponent(punchoutError));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handlePunchoutSubmit = async (orderId: string, locationId: string) => {
    setPunchoutSubmitting(true);
    try {
      const res = await fetch(`${AMAZON_API}/punchout/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ punchout_order_id: orderId, location_id: locationId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || 'Submission failed');
      setAmazonSuccess(`Order submitted successfully (PO: ${json?.data?.po_number || 'pending'})`);
      setPunchoutReviewId(null);
      setPunchoutReviewOrder(null);
      await loadPunchoutOrders();
    } catch (err: unknown) {
      setAmazonError(err instanceof Error ? err.message : 'Failed to submit order');
    } finally {
      setPunchoutSubmitting(false);
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
      />

      <SettingsNav />

      {!isAdmin && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-800 font-medium">Admin Access Required</p>
          <p className="text-yellow-700 text-sm mt-1">Only administrators can manage integrations.</p>
        </div>
      )}

      {/* ── Integration Tabs ── */}
      <div className="border-b mb-6">
        <nav className="-mb-px flex gap-6">
          <button
            onClick={() => setActiveTab('amazon')}
            className={`flex items-center gap-2 pb-3 px-1 border-b-2 text-sm font-medium transition-colors ${
              activeTab === 'amazon'
                ? 'border-orange-500 text-orange-600'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-gray-300'
            }`}
          >
            <ShoppingCart className="h-4 w-4" />
            Amazon Business
            {amazonStatus === 'connected' && <span className="h-1.5 w-1.5 rounded-full bg-green-500" />}
          </button>
          <button
            onClick={() => setActiveTab('printify')}
            className={`flex items-center gap-2 pb-3 px-1 border-b-2 text-sm font-medium transition-colors ${
              activeTab === 'printify'
                ? 'border-green-500 text-green-600'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-gray-300'
            }`}
          >
            <span className="text-sm font-bold">P</span>
            Printify
            {connectionStatus === 'connected' && <span className="h-1.5 w-1.5 rounded-full bg-green-500" />}
          </button>
        </nav>
      </div>

      <div className="max-w-2xl space-y-6">
        {/* ═══ Printify Tab ═══ */}
        {activeTab === 'printify' && (<>
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
        </>)}

        {/* ═══ Amazon Business Tab ═══ */}
        {activeTab === 'amazon' && (<>
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
                  <span>Connected via cXML{amazon.po_request_url_set ? ' — PO Request URL configured' : ''}</span>
                  <span className={`ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${amazon.integration_mode === 'active' ? 'bg-green-100 text-green-800 border-green-300' : 'bg-yellow-100 text-yellow-800 border-yellow-300'}`}>
                    {amazon.integration_mode === 'active' ? 'Live' : 'Test Mode'}
                  </span>
                </div>

                {/* Mode switch: sandbox=true sends cXML deploymentMode="test" (Amazon
                    shows a test-environment banner); false = production / real orders. */}
                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <div className="text-sm font-medium">Environment</div>
                    <div className="text-xs text-muted-foreground">
                      {amazon.sandbox === false
                        ? 'Live — orders submitted to Amazon are real and will be charged.'
                        : 'Test (sandbox) — Amazon shows a test-environment banner; no real orders.'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleAmazonModeToggle(true)}
                      disabled={!isAdmin || amazonSaving || amazon.sandbox !== false}
                      className={`px-3 py-1.5 rounded-md text-sm border ${amazon.sandbox !== false ? 'bg-yellow-100 text-yellow-800 border-yellow-300 font-medium' : 'hover:bg-muted'} disabled:opacity-60`}
                    >
                      Test
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAmazonModeToggle(false)}
                      disabled={!isAdmin || amazonSaving || amazon.sandbox === false}
                      className={`px-3 py-1.5 rounded-md text-sm border ${amazon.sandbox === false ? 'bg-green-100 text-green-800 border-green-300 font-medium' : 'hover:bg-muted'} disabled:opacity-60`}
                    >
                      Live
                    </button>
                  </div>
                </div>

                <details className="group">
                  <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">Update cXML credentials</summary>
                  <form onSubmit={handleAmazonConnect} className="mt-3 space-y-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">From Identity</label>
                      <input type="text" value={amazonForm.from_identity}
                        onChange={(e) => setAmazonForm({ ...amazonForm, from_identity: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                        required disabled={!isAdmin} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Shared Secret</label>
                      <input type="password" value={amazonForm.shared_secret}
                        onChange={(e) => setAmazonForm({ ...amazonForm, shared_secret: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                        required disabled={!isAdmin} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">PO Request URL</label>
                      <input type="url" value={amazonForm.po_request_url}
                        onChange={(e) => setAmazonForm({ ...amazonForm, po_request_url: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                        required disabled={!isAdmin} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Punchout URLs</label>
                      <input type="text" value={amazonForm.punchout_urls}
                        onChange={(e) => setAmazonForm({ ...amazonForm, punchout_urls: e.target.value })}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                        placeholder="Comma-separated URLs" disabled={!isAdmin} />
                    </div>
                    <button type="submit" disabled={!isAdmin || amazonSaving || !amazonForm.from_identity || !amazonForm.shared_secret || !amazonForm.po_request_url}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm">
                      {amazonSaving ? 'Saving...' : 'Update Credentials'}
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
            ) : (
              <form onSubmit={handleAmazonConnect} className="space-y-4">
                <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm space-y-2">
                  <p className="font-medium text-orange-900">cXML Purchasing System Setup</p>
                  <ol className="list-decimal list-inside text-orange-800 space-y-1 text-xs">
                    <li>Log in to your Amazon Business account and navigate to <strong>Business Settings &gt; Purchasing System</strong></li>
                    <li>Configure a cXML Punchout connection and note your <strong>From Identity</strong> and <strong>Shared Secret</strong></li>
                    <li>Copy the <strong>PO Request URL</strong> (where OrderRequest documents are POSTed)</li>
                    <li>Optionally, note any <strong>Punchout URLs</strong> for catalog browsing</li>
                    <li>Enter the credentials below to connect</li>
                  </ol>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">From Identity</label>
                  <input type="text" value={amazonForm.from_identity}
                    onChange={(e) => setAmazonForm({ ...amazonForm, from_identity: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                    placeholder="Your cXML From Identity" required disabled={!isAdmin} />
                  <p className="text-xs text-muted-foreground mt-1">Identifies your organization in cXML headers.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Shared Secret</label>
                  <input type="password" value={amazonForm.shared_secret}
                    onChange={(e) => setAmazonForm({ ...amazonForm, shared_secret: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                    required disabled={!isAdmin} />
                  <p className="text-xs text-muted-foreground mt-1">Encrypted and stored securely in Vault. Used to authenticate cXML requests.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">PO Request URL</label>
                  <input type="url" value={amazonForm.po_request_url}
                    onChange={(e) => setAmazonForm({ ...amazonForm, po_request_url: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                    placeholder="https://..." required disabled={!isAdmin} />
                  <p className="text-xs text-muted-foreground mt-1">The endpoint where cXML OrderRequest documents will be POSTed.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Punchout URLs <span className="text-muted-foreground font-normal">(optional)</span></label>
                  <input type="text" value={amazonForm.punchout_urls}
                    onChange={(e) => setAmazonForm({ ...amazonForm, punchout_urls: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
                    placeholder="https://..., https://..." disabled={!isAdmin} />
                  <p className="text-xs text-muted-foreground mt-1">Comma-separated. Used for catalog browsing sessions.</p>
                </div>
                <button type="submit" disabled={!isAdmin || amazonSaving || !amazonForm.from_identity || !amazonForm.shared_secret || !amazonForm.po_request_url}
                  className="w-full px-4 py-2.5 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50 font-medium flex items-center justify-center gap-2">
                  {amazonSaving ? (<><Loader2 className="h-4 w-4 animate-spin" />Saving...</>) : 'Save cXML Credentials'}
                </button>
                <p className="text-xs text-center text-muted-foreground">Integration starts in test mode. Switching to active requires manual configuration.</p>
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

        {/* Amazon Business Item Mappings */}
        {amazonStatus === 'connected' && (
          <div className="bg-white rounded-lg border">
            <div className="flex items-center justify-between p-6 border-b">
              <div className="flex items-center gap-3">
                <Link className="h-5 w-5 text-muted-foreground" />
                <div>
                  <h3 className="text-lg font-semibold">Amazon Product Mappings</h3>
                  <p className="text-sm text-muted-foreground">Map inventory items to Amazon products (ASINs) for ordering</p>
                </div>
              </div>
              {isAdmin && (
                <button onClick={() => { setShowAmazonAddMapping(!showAmazonAddMapping); setResolvedAsin(null); setAiDraft(null); setAsinAlreadyMapped(null); setMappingMode('ai'); setAsinInput(''); setAmazonMappingError(''); }}
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> Add Mapping
                </button>
              )}
            </div>
            <div className="p-6">
              {showAmazonAddMapping && (
                <form onSubmit={handleAmazonAddMapping} className="mb-6 p-4 bg-gray-50 border rounded-lg space-y-4">
                  {/* Step 1: Paste URL or ASIN */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Amazon Product URL or ASIN</label>
                    <div className="flex gap-2">
                      <input type="text" value={asinInput}
                        onChange={(e) => { setAsinInput(e.target.value); setResolvedAsin(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleResolveAsin(); } }}
                        className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                        placeholder="Paste amazon.com/dp/B07XYZ1234 or just B07XYZ1234" disabled={!isAdmin} />
                      <button type="button" onClick={handleResolveAsin} disabled={asinResolving || !asinInput.trim()}
                        className="px-3 py-2 border rounded-md hover:bg-gray-50 disabled:opacity-50 text-sm flex items-center gap-1.5">
                        {asinResolving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                        Resolve
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Paste a full Amazon product URL or a 10-character ASIN. We&apos;ll extract and verify it.</p>
                  </div>

                  {/* Step 2: Confirmation preview */}
                  {resolvedAsin && (
                    <div className="p-3 border rounded-lg bg-white space-y-3">
                      <div className="flex items-start gap-3">
                        {resolvedAsin.image_url && (
                          <img src={resolvedAsin.image_url} alt="" className="w-16 h-16 object-contain rounded border bg-white flex-shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm">{resolvedAsin.title || 'Product details not available'}</div>
                          <div className="text-xs text-muted-foreground font-mono mt-1">ASIN: {resolvedAsin.asin}</div>
                          {resolvedAsin.price && (
                            <div className="text-sm font-medium text-green-700 mt-1">${resolvedAsin.price.toFixed(2)}</div>
                          )}
                          <a href={resolvedAsin.product_url} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline inline-flex items-center gap-1 mt-1">
                            View on Amazon <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
                      </div>

                      {asinAlreadyMapped ? (
                        <div className="border-t pt-3">
                          <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                            This product is already mapped to <strong>{asinAlreadyMapped}</strong>. Nothing to do.
                          </div>
                        </div>
                      ) : (
                      <div className="border-t pt-3 space-y-3">
                        {/* Mode toggle: AI-create vs map to existing */}
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setMappingMode('ai')}
                            className={`flex-1 px-3 py-2 rounded-md text-sm flex items-center justify-center gap-1.5 border ${mappingMode === 'ai' ? 'bg-primary/10 border-primary text-primary font-medium' : 'hover:bg-gray-50'}`}>
                            <Sparkles className="h-3.5 w-3.5" /> Create new item (AI)
                          </button>
                          <button type="button" onClick={() => setMappingMode('existing')}
                            className={`flex-1 px-3 py-2 rounded-md text-sm border ${mappingMode === 'existing' ? 'bg-primary/10 border-primary text-primary font-medium' : 'hover:bg-gray-50'}`}>
                            Map to existing item
                          </button>
                        </div>

                        {mappingMode === 'ai' ? (
                          aiDrafting ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                              <Loader2 className="h-4 w-4 animate-spin" /> AI is drafting the item from the product…
                            </div>
                          ) : aiDraft ? (
                            <div className="space-y-3">
                              {aiDraft.duplicates.length > 0 && (
                                <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs space-y-1">
                                  <div className="font-medium text-amber-800">You may already stock this — map to it instead?</div>
                                  {aiDraft.duplicates.slice(0, 3).map((d) => (
                                    <div key={d.entityId} className="flex items-center justify-between gap-2">
                                      <span className="truncate">{d.name}</span>
                                      <button type="button"
                                        onClick={() => { setMappingMode('existing'); setNewMappingForm((f) => ({ ...f, catalog_item_id: d.entityId })); }}
                                        className="text-primary hover:underline flex-shrink-0">Map to this</button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div>
                                <label className="block text-sm font-medium mb-1">Item Name <span className="text-xs font-normal text-muted-foreground">(AI-drafted — edit if needed)</span></label>
                                <input type="text" value={aiDraft.name}
                                  onChange={(e) => setAiDraft({ ...aiDraft, name: e.target.value })}
                                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm" disabled={!isAdmin} />
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-sm font-medium mb-1">Category</label>
                                  <select
                                    value={aiDraft.category_id ?? (aiDraft.new_category_name ? '__new__' : '')}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      if (v === '__new__') setAiDraft({ ...aiDraft, category_id: null, new_category_name: aiDraft.new_category_name || aiDraft.name });
                                      else if (v === '') setAiDraft({ ...aiDraft, category_id: null, new_category_name: null });
                                      else setAiDraft({ ...aiDraft, category_id: v, new_category_name: null });
                                    }}
                                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm bg-white" disabled={!isAdmin}>
                                    <option value="">No category</option>
                                    {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
                                    <option value="__new__">+ Create new category…</option>
                                  </select>
                                  {!aiDraft.category_id && aiDraft.new_category_name != null && (
                                    <div className="flex items-center gap-2 mt-1.5">
                                      <input type="text" value={aiDraft.new_category_name}
                                        onChange={(e) => setAiDraft({ ...aiDraft, new_category_name: e.target.value })}
                                        className="flex-1 px-3 py-1.5 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm" disabled={!isAdmin} />
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-700">NEW</span>
                                    </div>
                                  )}
                                </div>
                                <div>
                                  <label className="block text-sm font-medium mb-1">Unit / Tracking</label>
                                  <div className="px-3 py-2 border rounded-md text-sm bg-gray-50 text-muted-foreground">
                                    {aiDraft.uom_label} · {aiDraft.tracking_mode}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-2 py-1">
                              <p className="text-sm text-muted-foreground">
                                Couldn&apos;t auto-read this product&apos;s name. Type it and we&apos;ll draft the rest:
                              </p>
                              <div className="flex gap-2">
                                <input type="text" value={manualName}
                                  onChange={(e) => setManualName(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter' && manualName.trim()) { e.preventDefault(); void buildAiDraft(manualName.trim()); } }}
                                  placeholder="e.g. Eagle 5 Gallon Type I Red Safety Gas Can"
                                  className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm" disabled={!isAdmin} />
                                <button type="button" onClick={() => { if (manualName.trim()) void buildAiDraft(manualName.trim()); }}
                                  disabled={!manualName.trim()}
                                  className="px-3 py-2 border rounded-md hover:bg-gray-50 disabled:opacity-50 text-sm flex items-center gap-1.5">
                                  <Sparkles className="h-3.5 w-3.5" /> Draft
                                </button>
                              </div>
                              <p className="text-xs text-muted-foreground">Or switch to &quot;Map to existing item&quot; above.</p>
                            </div>
                          )
                        ) : (
                          <div>
                            <label className="block text-sm font-medium mb-1">Inventory Item</label>
                            <select value={newMappingForm.catalog_item_id}
                              onChange={(e) => setNewMappingForm({ ...newMappingForm, catalog_item_id: e.target.value })}
                              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm bg-white"
                              disabled={!isAdmin}>
                              <option value="">Select an inventory item...</option>
                              {catalogItems.map((item) => (
                                <option key={item.id} value={item.id}>{item.label}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* Shared: pack qty + preferred (apply to the mapping either way) */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-medium mb-1">Pack Quantity <span className="text-red-500">*</span></label>
                            <input type="number" min="1" value={newMappingForm.pack_quantity}
                              onChange={(e) => setNewMappingForm({ ...newMappingForm, pack_quantity: e.target.value })}
                              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                              required disabled={!isAdmin} />
                            <p className="text-xs text-muted-foreground mt-1">How many of your inventory units are in one Amazon unit? Amazon often sells in case packs (e.g., 12-pack = 12).</p>
                          </div>
                          <div className="flex items-end pb-8">
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                              <input type="checkbox" checked={newMappingForm.is_preferred}
                                onChange={(e) => setNewMappingForm({ ...newMappingForm, is_preferred: e.target.checked })}
                                className="rounded border-gray-300 text-primary focus:ring-primary" disabled={!isAdmin} />
                              Preferred supplier
                            </label>
                          </div>
                        </div>
                      </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <button type="submit"
                      disabled={amazonMappingSaving || !resolvedAsin || !!asinAlreadyMapped || (mappingMode === 'ai' ? (aiDrafting || !aiDraft || !aiDraft.name.trim()) : !newMappingForm.catalog_item_id)}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm flex items-center gap-1.5">
                      {mappingMode === 'ai' && !amazonMappingSaving && <Wand2 className="h-3.5 w-3.5" />}
                      {amazonMappingSaving
                        ? (mappingMode === 'ai' ? 'Creating…' : 'Saving…')
                        : (mappingMode === 'ai' ? 'Create item & map' : 'Save mapping')}
                    </button>
                    <button type="button" onClick={() => { resetAmazonAddMapping(); setAmazonMappingError(''); }}
                      className="px-4 py-2 border rounded-md hover:bg-gray-50 text-sm">Cancel</button>
                  </div>
                  {amazonMappingError && (
                    <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-800 flex items-start gap-2">
                      <XCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />{amazonMappingError}
                    </div>
                  )}
                </form>
              )}

              {/* Mappings Table */}
              {amazonMappingsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : amazonMappings.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Link className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No product mappings yet.</p>
                  <p className="text-xs mt-1">Map your inventory items to Amazon products to enable procurement ordering.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium text-muted-foreground">Inventory Item</th>
                        <th className="pb-2 font-medium text-muted-foreground">ASIN</th>
                        <th className="pb-2 font-medium text-muted-foreground">Pack Qty</th>
                        <th className="pb-2 font-medium text-muted-foreground">Price</th>
                        <th className="pb-2 font-medium text-muted-foreground w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {amazonMappings.map((m) => (
                        <tr key={m.id} className={`border-b last:border-0 ${!m.active ? 'opacity-50' : ''}`}>
                          <td className="py-2.5">
                            <div>{m.item_name || m.catalog_item_id}</div>
                            {m.item_sku && <div className="text-xs text-muted-foreground font-mono">{m.item_sku}</div>}
                            {m.is_preferred && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 mt-0.5">Preferred</span>}
                          </td>
                          <td className="py-2.5">
                            <a href={`https://www.amazon.com/dp/${m.supplier_sku}`} target="_blank" rel="noopener noreferrer"
                              className="font-mono text-xs text-primary hover:underline inline-flex items-center gap-1">
                              {m.supplier_sku} <ExternalLink className="h-3 w-3" />
                            </a>
                          </td>
                          <td className="py-2.5 text-xs">{m.pack_quantity}</td>
                          <td className="py-2.5 text-xs">
                            {m.last_known_price != null ? (
                              <div>
                                <span className="font-medium">${Number(m.last_known_price).toFixed(2)}</span>
                                {m.price_checked_at && (
                                  <div className="text-[10px] text-muted-foreground">
                                    {new Date(m.price_checked_at).toLocaleDateString()}
                                  </div>
                                )}
                              </div>
                            ) : '—'}
                          </td>
                          <td className="py-2.5">
                            {isAdmin && (
                              <button onClick={() => handleAmazonDeleteMapping(m.id)}
                                className="p-1 text-muted-foreground hover:text-red-600" title="Remove mapping">
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

        {/* Amazon Business Punchout Orders */}
        {amazonStatus === 'connected' && (
          <div className="bg-white rounded-lg border">
            <div className="flex items-center justify-between p-6 border-b">
              <div className="flex items-center gap-3">
                <ShoppingCart className="h-5 w-5 text-muted-foreground" />
                <div>
                  <h3 className="text-lg font-semibold">Punchout Orders</h3>
                  <p className="text-sm text-muted-foreground">Amazon Business cXML punchout order sessions</p>
                </div>
              </div>
              <button onClick={loadPunchoutOrders} disabled={punchoutOrdersLoading}
                className="px-3 py-1.5 border rounded-md hover:bg-gray-50 disabled:opacity-50 text-sm">
                {punchoutOrdersLoading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
            <div className="p-6">
              {/* Cart Review Modal (shown after POOM return) */}
              {punchoutReviewOrder && (
                <div className="mb-6 p-4 bg-orange-50 border border-orange-200 rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-orange-900">Amazon Cart Ready for Submission</h4>
                    <PunchoutStatusBadge status={punchoutReviewOrder.status} />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="pb-2 font-medium text-orange-800">ASIN</th>
                          <th className="pb-2 font-medium text-orange-800">Description</th>
                          <th className="pb-2 font-medium text-orange-800">Qty</th>
                          <th className="pb-2 font-medium text-orange-800">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(punchoutReviewOrder.poom_items || []).map((item: any, idx: number) => (
                          <tr key={idx} className="border-b last:border-0">
                            <td className="py-2 font-mono text-xs">{item.supplier_sku}</td>
                            <td className="py-2 text-xs truncate max-w-48">{item.description || '—'}</td>
                            <td className="py-2 text-xs">{item.quantity}</td>
                            <td className="py-2 text-xs font-medium">${Number(item.unit_price).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {punchoutReviewOrder.poom_total && (
                    <div className="text-right font-semibold text-orange-900">
                      Total: ${Number(punchoutReviewOrder.poom_total).toFixed(2)}
                    </div>
                  )}
                  {punchoutReviewOrder.status === 'cart_returned' && (
                    <div className="space-y-3 pt-2 border-t border-orange-200">
                      {punchoutReviewOrder.shipping_address && (
                        <div className="text-xs text-orange-800">
                          <span className="font-medium">Ship to:</span>{' '}
                          {punchoutReviewOrder.shipping_address.name}, {punchoutReviewOrder.shipping_address.address_line_1}, {punchoutReviewOrder.shipping_address.city}, {punchoutReviewOrder.shipping_address.state} {punchoutReviewOrder.shipping_address.postal_code}
                        </div>
                      )}
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            const locationId = punchoutReviewOrder.metadata?.location_id;
                            if (!locationId) { setAmazonError('No delivery location set for this order. Please start a new punchout session.'); return; }
                            handlePunchoutSubmit(punchoutReviewOrder.id, locationId);
                          }}
                          disabled={punchoutSubmitting}
                          className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50 text-sm font-medium">
                          {punchoutSubmitting ? 'Submitting...' : 'Submit Order to Amazon'}
                        </button>
                        <button onClick={() => { setPunchoutReviewId(null); setPunchoutReviewOrder(null); }}
                          className="px-4 py-2 border rounded-md hover:bg-gray-50 text-sm">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Orders Table */}
              {punchoutOrdersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : punchoutOrders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ShoppingCart className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No punchout orders yet.</p>
                  <p className="text-xs mt-1">Punchout orders are created when you approve a replenishment suggestion for an Amazon-sourced item.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium text-muted-foreground">Date</th>
                        <th className="pb-2 font-medium text-muted-foreground">Status</th>
                        <th className="pb-2 font-medium text-muted-foreground">Items</th>
                        <th className="pb-2 font-medium text-muted-foreground">Total</th>
                        <th className="pb-2 font-medium text-muted-foreground w-20"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {punchoutOrders.map((o: any) => (
                        <tr key={o.id} className="border-b last:border-0">
                          <td className="py-2.5 text-xs">{new Date(o.created_at).toLocaleDateString()}</td>
                          <td className="py-2.5"><PunchoutStatusBadge status={o.status} /></td>
                          <td className="py-2.5 text-xs">{(o.items || []).length} items</td>
                          <td className="py-2.5 text-xs font-medium">
                            {o.total_cost != null ? `$${Number(o.total_cost).toFixed(2)}` : o.poom_total != null ? `$${Number(o.poom_total).toFixed(2)}` : '—'}
                          </td>
                          <td className="py-2.5">
                            {o.status === 'cart_returned' && (
                              <button
                                onClick={async () => {
                                  const res = await fetch(`${AMAZON_API}/punchout/orders?id=${o.id}`);
                                  const json = await res.json();
                                  if (json?.data) {
                                    setPunchoutReviewOrder(json.data);
                                    setPunchoutReviewId(o.id);
                                  }
                                }}
                                className="px-2 py-1 text-xs bg-orange-600 text-white rounded hover:bg-orange-700">
                                Review
                              </button>
                            )}
                            {o.error_message && (
                              <span className="text-xs text-red-600" title={o.error_message}>Error</span>
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
        </>)}
      </div>
    </AppShell>
  );
}

function PunchoutStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-700',
    punchout_started: 'bg-blue-100 text-blue-700',
    cart_returned: 'bg-orange-100 text-orange-700',
    submitted: 'bg-green-100 text-green-700',
    confirmed: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    failed: 'bg-red-100 text-red-700',
  };
  const labels: Record<string, string> = {
    pending: 'Pending',
    punchout_started: 'Shopping',
    cart_returned: 'Cart Ready',
    submitted: 'Submitted',
    confirmed: 'Confirmed',
    rejected: 'Rejected',
    failed: 'Failed',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${styles[status] || 'bg-gray-100 text-gray-700'}`}>
      {labels[status] || status}
    </span>
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
