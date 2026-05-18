'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { StatusChip } from '@/components/ui/StatusChip';
import { ProvisioningRPC } from '@/lib/rpc/provisioning';
import { Save, ShieldCheck, Plus, Wifi, WifiOff } from 'lucide-react';

interface Mapping {
  id: string;
  catalog_item_id: string;
  catalog_item_name?: string;
  external_product_id: string | null;
  external_variant_id: string | null;
  notes: string | null;
  created_at: string;
}

interface Provider {
  id: string;
  name: string;
  key: string;
  type: string | null;
  priority: number;
  is_active: boolean;
  config: Record<string, unknown> | null;
  webhook_status?: string;
  created_at: string;
}

interface PrintifyProduct {
  id: string;
  title: string;
  variants: Array<{ id: number; title: string }>;
}

export default function ProviderDetailPage() {
  const params = useParams();
  const providerId = params.id as string;
  const [provider, setProvider] = useState<Provider | null>(null);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [configText, setConfigText] = useState('{}');
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ valid?: boolean; error?: string } | null>(null);
  const [showAddMapping, setShowAddMapping] = useState(false);
  const [newMapping, setNewMapping] = useState({ catalog_item_id: '', external_product_id: '', external_variant_id: '', notes: '' });
  const [mappingSaving, setMappingSaving] = useState(false);
  const [products, setProducts] = useState<PrintifyProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<string>('unknown');
  const [selectedProduct, setSelectedProduct] = useState<string>('');

  const isPrintOnDemand = provider?.type === 'print_on_demand';

  useEffect(() => {
    fetchProvider();
    fetchMappings();
  }, [providerId]);

  const fetchProvider = async () => {
    setLoading(true);
    try {
      const data = await ProvisioningRPC.getProvider(providerId);
      const p = data?.data || data;
      setProvider(p);
      setConfigText(JSON.stringify(p.config || {}, null, 2));
      setWebhookStatus(p.webhook_status || 'unknown');
    } catch (error) {
      console.error('Error fetching provider:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchMappings = async () => {
    try {
      const data = await ProvisioningRPC.getProviderMappings(providerId);
      setMappings(data?.data || data || []);
    } catch (error) {
      console.error('Error fetching mappings:', error);
    }
  };

  const fetchProducts = async () => {
    if (!isPrintOnDemand) return;
    setProductsLoading(true);
    try {
      const data = await ProvisioningRPC.getProviderProducts(providerId);
      setProducts(data?.data || data || []);
    } catch (error) {
      console.error('Error fetching products:', error);
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let config: Record<string, unknown>;
      try { config = JSON.parse(configText); } catch { alert('Invalid JSON in config'); setSaving(false); return; }
      await ProvisioningRPC.updateProvider(providerId, { config });
      alert('Provider config saved');
      fetchProvider();
    } catch (error) {
      console.error('Error saving provider:', error);
      alert('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    setValidationResult(null);
    try {
      const result = await ProvisioningRPC.validateProvider(providerId);
      setValidationResult(result?.data || result);
      // Refresh provider to pick up webhook_status changes
      fetchProvider();
    } catch (err: unknown) {
      setValidationResult({ valid: false, error: err instanceof Error ? err.message : 'Validation failed' });
    } finally {
      setValidating(false);
    }
  };

  const openAddMapping = () => {
    setShowAddMapping(true);
    setSelectedProduct('');
    setNewMapping({ catalog_item_id: '', external_product_id: '', external_variant_id: '', notes: '' });
    if (isPrintOnDemand && products.length === 0) {
      fetchProducts();
    }
  };

  const handleProductSelect = (productId: string) => {
    setSelectedProduct(productId);
    setNewMapping((prev) => ({
      ...prev,
      external_product_id: productId,
      external_variant_id: '',
    }));
  };

  const handleVariantSelect = (variantId: string) => {
    setNewMapping((prev) => ({ ...prev, external_variant_id: variantId }));
  };

  const selectedProductObj = products.find((p) => p.id === selectedProduct);

  const handleAddMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    setMappingSaving(true);
    try {
      await ProvisioningRPC.createProviderMapping(providerId, {
        catalog_item_id: newMapping.catalog_item_id,
        external_product_id: newMapping.external_product_id || null,
        external_variant_id: newMapping.external_variant_id || null,
        notes: newMapping.notes || null,
      });
      setShowAddMapping(false);
      setNewMapping({ catalog_item_id: '', external_product_id: '', external_variant_id: '', notes: '' });
      fetchMappings();
    } catch (error) {
      console.error('Error creating mapping:', error);
      alert('Failed to create mapping');
    } finally {
      setMappingSaving(false);
    }
  };

  const mappingColumns = [
    {
      key: 'catalog_item',
      header: 'Catalog Item',
      render: (row: Mapping) => <span className="font-medium">{row.catalog_item_name || row.catalog_item_id}</span>,
    },
    {
      key: 'external_product_id',
      header: 'External Product',
      render: (row: Mapping) => <span className="font-mono text-sm">{row.external_product_id || '-'}</span>,
    },
    {
      key: 'external_variant_id',
      header: 'External Variant',
      render: (row: Mapping) => <span className="font-mono text-sm">{row.external_variant_id || '-'}</span>,
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (row: Mapping) => <span className="text-sm text-muted-foreground">{row.notes || '-'}</span>,
    },
    {
      key: 'created_at',
      header: 'Created',
      render: (row: Mapping) => new Date(row.created_at).toLocaleDateString(),
    },
  ];

  if (loading) {
    return (
      <AppShell>
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-gray-200 rounded w-1/3" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </AppShell>
    );
  }

  if (!provider) {
    return <AppShell><div className="text-center py-12"><p className="text-muted-foreground">Provider not found</p></div></AppShell>;
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={provider.name}
          description={`Key: ${provider.key} | Type: ${provider.type || 'manual'} | Priority: ${provider.priority}`}
          backHref="/provisioning/providers"
          actions={
            <div className="flex items-center gap-2">
              <StatusChip status={provider.is_active ? 'active' : 'inactive'} size="md" />
            </div>
          }
        />

        {/* Config editor */}
        <div className="rounded-lg border bg-card p-4 space-y-4">
          <h3 className="text-lg font-semibold">Provider Configuration</h3>
          <textarea
            value={configText}
            onChange={(e) => setConfigText(e.target.value)}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm"
            rows={10}
          />
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 flex items-center gap-2 disabled:opacity-50">
              <Save className="h-4 w-4" />{saving ? 'Saving...' : 'Save Config'}
            </button>
            <button onClick={handleValidate} disabled={validating} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50">
              <ShieldCheck className="h-4 w-4" />{validating ? 'Validating...' : 'Validate'}
            </button>
          </div>
          {validationResult && (
            <div className={`p-3 rounded text-sm ${validationResult.valid ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
              {validationResult.valid ? 'Configuration is valid' : `Validation failed: ${validationResult.error || 'Unknown error'}`}
            </div>
          )}
          {/* Webhook status indicator */}
          {isPrintOnDemand && (
            <div className={`flex items-center gap-2 p-3 rounded text-sm ${
              webhookStatus === 'registered'
                ? 'bg-green-50 border border-green-200 text-green-700'
                : webhookStatus === 'failed'
                  ? 'bg-red-50 border border-red-200 text-red-700'
                  : 'bg-gray-50 border border-gray-200 text-gray-600'
            }`}>
              {webhookStatus === 'registered' ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
              Webhooks: {webhookStatus === 'registered' ? 'Registered' : webhookStatus === 'failed' ? 'Registration failed' : 'Not registered'}
            </div>
          )}
        </div>

        {/* Item mappings */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">Item Mappings</h3>
            <button onClick={openAddMapping} className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 flex items-center gap-1">
              <Plus className="h-3 w-3" />Add Mapping
            </button>
          </div>
          <DataTable data={mappings} columns={mappingColumns} emptyMessage="No item mappings configured" rowKey={(row) => row.id} />
        </div>

        {showAddMapping && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h2 className="text-xl font-semibold mb-4">Add Item Mapping</h2>
              <form onSubmit={handleAddMapping} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Catalog Item ID *</label>
                  <input type="text" value={newMapping.catalog_item_id} onChange={(e) => setNewMapping({ ...newMapping, catalog_item_id: e.target.value })} className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary" required />
                </div>

                {isPrintOnDemand ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium mb-1">Printify Product</label>
                      {productsLoading ? (
                        <div className="text-sm text-muted-foreground py-2">Loading products...</div>
                      ) : (
                        <select
                          value={selectedProduct}
                          onChange={(e) => handleProductSelect(e.target.value)}
                          className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          <option value="">Select a product...</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>{p.title}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Printify Variant</label>
                      <select
                        value={newMapping.external_variant_id}
                        onChange={(e) => handleVariantSelect(e.target.value)}
                        disabled={!selectedProduct}
                        className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
                      >
                        <option value="">{selectedProduct ? 'Select a variant...' : 'Select a product first'}</option>
                        {selectedProductObj?.variants.map((v) => (
                          <option key={v.id} value={String(v.id)}>{v.title}</option>
                        ))}
                      </select>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-medium mb-1">External Product ID</label>
                      <input type="text" value={newMapping.external_product_id} onChange={(e) => setNewMapping({ ...newMapping, external_product_id: e.target.value })} className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">External Variant ID</label>
                      <input type="text" value={newMapping.external_variant_id} onChange={(e) => setNewMapping({ ...newMapping, external_variant_id: e.target.value })} className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono" />
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-sm font-medium mb-1">Notes</label>
                  <input type="text" value={newMapping.notes} onChange={(e) => setNewMapping({ ...newMapping, notes: e.target.value })} className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary" />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowAddMapping(false)} className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50">Cancel</button>
                  <button type="submit" disabled={mappingSaving} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">{mappingSaving ? 'Adding...' : 'Add Mapping'}</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
