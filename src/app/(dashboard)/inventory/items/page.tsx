'use client';

import { AppError } from '@rocketmanv9/chassis/errors';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { CategoryModal } from '@/components/modals/CategoryModal';
import { BarcodeLabelDialog } from '@/components/modals/BarcodeLabelDialog';
import { BarcodeScannerOverlay } from '@/components/mobile/BarcodeScannerOverlay';
import { ReferenceLinksEditor } from '@/components/items/ReferenceLinksEditor';
import { cleanReferenceLinks, type ReferenceLink } from '@/lib/items/reference-links';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { useUOMTerms, useUOMLabelMap, useGVTerms } from '@/hooks/useGVTerms';
import { useEntityImages } from '@/hooks/useEntityImages';
import { EntityImageThumbnail } from '@/components/ui/EntityImageThumbnail';
import { EntityImageUpload } from '@/components/ui/EntityImageUpload';
import type { Database } from 'types/supabase';

type CatalogItemRow = Database['inventory']['Tables']['catalog_items']['Row'];
type ItemCategoryRow = Database['inventory']['Tables']['item_categories']['Row'];
type InventoryLevelRow = Database['inventory']['Tables']['inventory_levels']['Row'];
type LocationRow = Database['inventory']['Tables']['locations']['Row'];
type SkuSettingsRow = Database['inventory']['Tables']['sku_settings']['Row'];

type CatalogItem = {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  category_id: string | null;
  uom_term_id: string | null;
  tracking_mode: TrackingMode;
  reorder_point: number | null;
  min_stock_level: number | null;
  max_stock_level: number | null;
  active: boolean | null;
  base_sku: string | null;
  last_event_id: string | null;
  item_categories?: Pick<ItemCategoryRow, 'name'> | null;
};
type Category = ItemCategoryRow;
type Location = Omit<LocationRow, 'location_type'> & {
  location_type?: { name?: string } | string | null;
};
type InventoryLevel = Omit<Pick<InventoryLevelRow, 'id' | 'location_id' | 'current_stock' | 'reorder_point' | 'target_stock'>, 'id'> & {
  id?: string;
};
type TrackingMode = CatalogItemRow['tracking_mode'];
type SkuSettings = Pick<SkuSettingsRow, 'separator' | 'next_sequence'>;

export default function ItemsPage() {
  const router = useRouter();
  const uomLabels = useUOMLabelMap();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItem | undefined>();
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [pendingCategoryId, setPendingCategoryId] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const [imageRefreshKey, setImageRefreshKey] = useState(0);
  const itemIds = items.map(i => i.id);
  const { imageMap } = useEntityImages('catalog_item', itemIds, imageRefreshKey);

  useEffect(() => {
    fetchItems();
  }, [filters]);

  const fetchItems = async () => {
    setLoading(true);
    try {
      const data = await InventoryRPC.getCatalogItems({
        active: filters.active_only === 'true' ? true : undefined,
        tracking_mode: filters.tracking_mode || undefined,
        search: filters.search || undefined,
      });
      setItems(data);
    } catch (error) {
      console.error('Error fetching items:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleManageCategories = () => {
    window.location.href = '/inventory/categories';
  };

  const handleDelete = async (itemId: string, itemName: string, lastEventId: string | null) => {
    if (!confirm(`Are you sure you want to delete "${itemName}"?`)) {
      return;
    }

    try {
      if (!lastEventId) {
        throw AppError.badRequest('Missing last_event_id for this item. Please refresh and try again.');
      }

      await InventoryRPC.deleteCatalogItem(itemId, lastEventId);

      fetchItems(); // Refresh the list
    } catch (error: any) {
      // Items with transaction history can't be hard-deleted (the ledger FKs are
      // ON DELETE RESTRICT). Offer to deactivate instead so the user isn't stuck.
      const msg: string = error?.message || '';
      if (msg.includes("can't be permanently deleted") && lastEventId) {
        if (
          confirm(
            `"${itemName}" has transaction history and can't be permanently deleted.\n\nDeactivate it instead? It will be marked inactive and hidden from active use, but its history is preserved.`,
          )
        ) {
          try {
            await InventoryRPC.updateCatalogItem(itemId, { active: false } as any, lastEventId);
            fetchItems();
          } catch (deactErr: any) {
            alert(`Error deactivating: ${deactErr.message}`);
          }
        }
        return;
      }
      alert(`Error: ${error.message}`);
    }
  };

  const handleScanResult = (decodedText: string) => {
    // QR codes encode URLs like /m/scan?code=SKU — extract the code param if present
    let code = decodedText;
    try {
      const url = new URL(decodedText);
      const codeParam = url.searchParams.get('code');
      if (codeParam) code = codeParam;
    } catch {
      // Not a URL, use as-is
    }

    const match = items.find(
      (item) => item.sku.toLowerCase() === code.toLowerCase()
    );
    if (match) {
      setScannerOpen(false);
      router.push(`/inventory/items/${match.id}`);
    } else {
      alert(`No item found matching: ${code}`);
    }
  };

  const columns = [
    {
      key: 'photo',
      header: '',
      className: 'w-10',
      render: (row: CatalogItem) => (
        <EntityImageThumbnail url={imageMap[row.id]} alt={row.name} />
      ),
    },
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row: CatalogItem) => (
        <div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push(`/inventory/items/${row.id}`)}
              className="font-medium text-foreground hover:text-primary hover:underline text-left"
            >
              {row.name}
            </button>
            {(row as any).is_parent && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700">
                Variants
              </span>
            )}
          </div>
          {row.description && (
            <div className="text-xs text-muted-foreground truncate max-w-xs">
              {row.description}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'sku',
      header: 'SKU',
      sortable: true,
      render: (row: CatalogItem) => (
        <span className="font-mono text-sm">{row.sku}</span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      sortable: true,
      render: (row: CatalogItem) => row.item_categories?.name || '-',
    },
    {
      key: 'uom_term_id',
      header: 'UOM',
      sortable: true,
      render: (row: CatalogItem) => uomLabels[(row as any).uom_term_id] || (row as any).uom_term_id || '-',
    },
    {
      key: 'tracking_mode',
      header: 'Tracking',
      render: (row: CatalogItem) => (
        <StatusChip status={row.tracking_mode} />
      ),
    },
    {
      key: 'reorder_point',
      header: 'Reorder Point',
      className: 'text-right font-mono',
      render: (row: CatalogItem) => row.reorder_point?.toLocaleString() ?? '-',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: CatalogItem) => (
        <StatusChip status={row.active ? 'active' : 'inactive'} />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      className: 'text-right',
      render: (row: CatalogItem) => (
        <div className="flex gap-1 justify-end items-center">
          <button
            onClick={() => {
              setEditingItem(row);
              setShowCreateModal(true);
            }}
            className="text-slate-600 hover:text-slate-900 px-2 py-1 text-sm font-medium"
          >
            Edit
          </button>
          <button
            onClick={() => handleDelete(row.id, row.name, row.last_event_id ?? null)}
            className="text-red-600 hover:text-red-800 px-2 py-1 text-sm font-medium"
          >
            Delete
          </button>
          <QuickActionsMenu itemId={row.id} itemName={row.name} itemSku={row.sku} />
        </div>
      ),
    },
  ];

  const filterConfig = [
    {
      key: 'search',
      label: 'Search',
      type: 'search' as const,
      placeholder: 'Name or SKU...',
    },
    {
      key: 'tracking_mode',
      label: 'Tracking',
      type: 'select' as const,
      options: [
        { value: 'stock', label: 'Stock' },
        { value: 'serialized', label: 'Serialized' },
        { value: 'both', label: 'Both' },
      ],
    },
  ];

  const filteredItems = items.filter((item) => {
    if (filters.search) {
      const search = filters.search.toLowerCase();
      if (!item.name.toLowerCase().includes(search) && !item.sku.toLowerCase().includes(search)) {
        return false;
      }
    }
    if (filters.tracking_mode && item.tracking_mode !== filters.tracking_mode) {
      return false;
    }
    return true;
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Catalog Items"
          description="Manage your inventory catalog. Example: Define items like 'Hot Mix Asphalt (HMA)', 'Ready-Mix Concrete 3000 PSI', 'Rebar #4', 'Aggregate Base', or 'Diesel Fuel' - each with SKUs, units (tons, yards, gallons), and categories."
          actions={
            <div className="flex gap-3">
              <button
                onClick={() => setScannerOpen(true)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-2"
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
                Scan
              </button>
              <button
                onClick={handleManageCategories}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
              >
                Manage Categories
              </button>
              <button
                onClick={() => router.push('/inventory/items/new')}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                + New Item
              </button>
            </div>
          }
        />

        <FilterBar
          filters={filterConfig}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClear={() => setFilters({})}
        />

        <DataTable
          data={filteredItems}
          columns={columns}
          loading={loading}
          emptyMessage="No items found"
          rowKey={(row) => row.id}
        />

        {showCreateModal && (
          <CreateItemModal
            item={editingItem}
            onClose={() => {
              setShowCreateModal(false);
              setEditingItem(undefined);
            }}
            onCreated={() => {
              setShowCreateModal(false);
              setEditingItem(undefined);
              fetchItems();
              // Force the list thumbnails to re-fetch: editing an existing item
              // doesn't change the set of IDs, so useEntityImages won't otherwise
              // pick up an image that was added/replaced in the modal.
              setImageRefreshKey((k) => k + 1);
            }}
            onAddCategory={() => setShowCategoryModal(true)}
            newCategoryId={pendingCategoryId}
          />
        )}

        <BarcodeScannerOverlay
          isOpen={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onScan={handleScanResult}
        />

        <CategoryModal
          open={showCategoryModal}
          onClose={() => setShowCategoryModal(false)}
          onSuccess={async (_name: string) => {
            setShowCategoryModal(false);
            // Fetch latest categories to get the new one's ID
            try {
              const cats = await InventoryRPC.getItemCategories();
              const newest = cats.sort((a, b) =>
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
              )[0];
              if (newest) {
                setPendingCategoryId(newest.id);
              }
            } catch {
              // Category was created but we couldn't auto-select it — the modal will refresh its list
            }
          }}
        />
      </div>
    </AppShell>
  );
}

function QuickActionsMenu({ itemId, itemName, itemSku }: { itemId: string; itemName: string; itemSku: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showLabelDialog, setShowLabelDialog] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const navActions = [
    { label: 'Adjust Stock', href: `/inventory/stock?item_id=${itemId}` },
    { label: 'Create PO', href: `/inventory/purchasing/create?item_id=${itemId}` },
    { label: 'Transfer', href: `/inventory/transfers?item_id=${itemId}` },
    { label: 'Reserve', href: `/inventory/reservations?item_id=${itemId}` },
  ];

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen(!open)}
          className="text-gray-400 hover:text-gray-600 px-2 py-1 text-lg font-bold leading-none"
          title={`Quick actions for ${itemName}`}
        >
          &#x22EF;
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-md border bg-white shadow-lg py-1">
            <button
              onClick={() => {
                setOpen(false);
                setShowLabelDialog(true);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
            >
              Print Label
            </button>
            {navActions.map((action) => (
              <button
                key={action.label}
                onClick={() => {
                  setOpen(false);
                  router.push(action.href);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {showLabelDialog && (
        <BarcodeLabelDialog
          items={[{ code: itemSku, label: itemName }]}
          entityType="item"
          onClose={() => setShowLabelDialog(false)}
        />
      )}
    </>
  );
}

function CreateItemModal({
  onClose,
  onCreated,
  onAddCategory,
  newCategoryId,
  item
}: {
  onClose: () => void;
  onCreated: () => void;
  onAddCategory: () => void;
  newCategoryId?: string | null;
  item?: CatalogItem;
}) {
  const isEditing = !!item;
  const { terms: uomTerms, loading: uomLoading } = useUOMTerms();
  const { terms: materialTerms, loading: materialLoading } = useGVTerms('materials');
  const { terms: productTerms, loading: productLoading } = useGVTerms('material_product');
  const { terms: tierTerms, loading: tierLoading } = useGVTerms('quality_tier');
  const [form, setForm] = useState<{
    name: string;
    sku: string;
    base_sku: string;
    description: string;
    category_id: string;
    uom_term_id: string;
    tracking_mode: TrackingMode;
    reorder_point: string;
    material_term_id: string;
    product_term_id: string;
    quality_tier_term_id: string;
  }>({
    name: item?.name || '',
    sku: item?.sku || '',
    base_sku: item?.base_sku || '',
    description: item?.description || '',
    category_id: item?.category_id || '',
    uom_term_id: (item as any)?.uom_term_id || '',
    tracking_mode: item?.tracking_mode || 'stock',
    reorder_point: item?.reorder_point?.toString() || '',
    material_term_id: (item as any)?.material_term_id || '',
    product_term_id: (item as any)?.product_term_id || '',
    quality_tier_term_id: (item as any)?.quality_tier_term_id || '',
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [skuSettings, setSkuSettings] = useState<SkuSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [levels, setLevels] = useState<InventoryLevel[]>([]);
  const [levelsSaving, setLevelsSaving] = useState(false);
  const [locationSearch, setLocationSearch] = useState('');
  const [showAllLocations, setShowAllLocations] = useState(false);

  // Reference links (plain URLs — distinct from the Amazon vendor mapping below)
  const [links, setLinks] = useState<ReferenceLink[]>([]);

  // Amazon Business mapping state (edit mode only)
  const [amazonConnected, setAmazonConnected] = useState(false);
  const [amazonMapping, setAmazonMapping] = useState<{
    id: string;
    vendor_sku: string;
    pack_size: number;
    unit_cost: number | null;
    last_known_price: number | null;
    is_preferred: boolean;
    notes: string | null;
  } | null>(null);
  const [amazonLoading, setAmazonLoading] = useState(false);
  const [asinInput, setAsinInput] = useState('');
  const [asinResolving, setAsinResolving] = useState(false);
  const [resolvedAsin, setResolvedAsin] = useState<{
    asin: string;
    title: string | null;
    image_url: string | null;
    price: number | null;
    product_url: string;
  } | null>(null);
  const [amazonPackQty, setAmazonPackQty] = useState('1');
  const [amazonPreferred, setAmazonPreferred] = useState(false);
  const [amazonSaving, setAmazonSaving] = useState(false);
  const [amazonError, setAmazonError] = useState('');

  // Initial stock state (for new items only)
  const [initialStockLocation, setInitialStockLocation] = useState('');
  const [initialStockQty, setInitialStockQty] = useState('');

  const formatLocationType = (value: Location['location_type']) => {
    if (!value) return '';
    const raw = typeof value === 'string' ? value : value.name;
    if (!raw) return '';
    return raw.replace(/_/g, ' ');
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  // When a new category is created via the inline modal, refresh and auto-select it
  useEffect(() => {
    if (!newCategoryId) return;
    fetchCategories().then(() => {
      setForm((prev) => ({ ...prev, category_id: newCategoryId }));
    });
  }, [newCategoryId]);

  useEffect(() => {
    if (!form.category_id) {
      setSkuSettings(null);
      return;
    }

    async function loadSkuSettings() {
      try {
        const data = await InventoryRPC.getSkuSettings(form.category_id);
        if (data) {
          setSkuSettings({
            separator: data.separator || '-',
            next_sequence: data.next_sequence ?? 1,
          });
          return;
        }

        setSkuSettings({ separator: '-', next_sequence: 1 });
      } catch (err) {
        console.error('Error loading SKU settings:', err);
      }
    }

    loadSkuSettings();
  }, [form.category_id]);

  useEffect(() => {
    async function loadLocations() {
      try {
        const locsResult = await InventoryRPC.getLocations();
        setLocations((locsResult || []) as Location[]);
      } catch (err) {
        console.error('Error loading locations:', err);
      }
    }

    loadLocations();
  }, []);

  useEffect(() => {
    if (!isEditing || !item?.id) return;
    const itemId = item.id;

    async function loadLevels() {
      try {
        const levelsResult = await InventoryRPC.getInventoryLevelsForItem(itemId);
        const rows = (levelsResult || []).map((row) => ({
          id: row.id,
          location_id: row.location_id,
          current_stock: Number(row.current_stock ?? 0),
          reorder_point: row.reorder_point === null ? null : Number(row.reorder_point),
          target_stock: row.target_stock === null ? null : Number(row.target_stock),
        }));
        setLevels(rows);
      } catch (err) {
        console.error('Error loading location stock levels:', err);
      }
    }

    loadLevels();
  }, [isEditing, item?.id]);

  useEffect(() => {
    if (!isEditing || !item?.id) return;
    const itemId = item.id;

    InventoryRPC.getCatalogItemLinks(itemId)
      .then(setLinks)
      .catch((err) => console.error('Error loading reference links:', err));
  }, [isEditing, item?.id]);

  // Load Amazon Business integration status + mapping for this item
  useEffect(() => {
    if (!isEditing || !item?.id) return;

    async function loadAmazon() {
      setAmazonLoading(true);
      try {
        // Check if Amazon Business is connected
        const statusRes = await fetch('/api/settings/integrations/amazon-business');
        const statusJson = await statusRes.json();
        if (!statusJson.data?.connected) {
          setAmazonConnected(false);
          return;
        }
        setAmazonConnected(true);

        // Fetch mappings and find one for this item
        const mappingsRes = await fetch('/api/settings/integrations/amazon-business/item-mappings');
        const mappingsJson = await mappingsRes.json();
        const match = (mappingsJson.data || []).find(
          (m: any) => m.catalog_item_id === item!.id
        );
        if (match) {
          setAmazonMapping({
            id: match.id,
            vendor_sku: match.vendor_sku,
            pack_size: Number(match.pack_size) || 1,
            unit_cost: match.unit_cost,
            last_known_price: match.last_known_price,
            is_preferred: match.is_preferred ?? false,
            notes: match.notes,
          });
          setAmazonPackQty(String(Number(match.pack_size) || 1));
          setAmazonPreferred(match.is_preferred ?? false);
        }
      } catch (err) {
        console.error('Error loading Amazon status:', err);
      } finally {
        setAmazonLoading(false);
      }
    }

    loadAmazon();
  }, [isEditing, item?.id]);

  const handleResolveAsin = async () => {
    if (!asinInput.trim()) return;
    setAsinResolving(true);
    setAmazonError('');
    setResolvedAsin(null);
    try {
      const res = await fetch('/api/settings/integrations/amazon-business/item-mappings/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ input: asinInput.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAmazonError(json.error?.message || 'Failed to resolve ASIN');
        return;
      }
      setResolvedAsin(json.data);
    } catch (err: any) {
      setAmazonError(err.message);
    } finally {
      setAsinResolving(false);
    }
  };

  const handleSaveAmazonMapping = async () => {
    const asin = resolvedAsin?.asin || amazonMapping?.vendor_sku;
    if (!asin || !item?.id) return;
    setAmazonSaving(true);
    setAmazonError('');
    try {
      const res = await fetch('/api/settings/integrations/amazon-business/item-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          catalog_item_id: item.id,
          asin,
          pack_quantity: Number(amazonPackQty) || 1,
          is_preferred: amazonPreferred,
          last_known_price: resolvedAsin?.price ?? amazonMapping?.last_known_price ?? undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAmazonError(json.error?.message || 'Failed to save mapping');
        return;
      }
      // Update local state with saved mapping
      setAmazonMapping({
        id: json.data.id,
        vendor_sku: asin,
        pack_size: Number(amazonPackQty) || 1,
        unit_cost: json.data.unit_cost,
        last_known_price: resolvedAsin?.price ?? amazonMapping?.last_known_price ?? null,
        is_preferred: amazonPreferred,
        notes: json.data.notes,
      });
      setResolvedAsin(null);
      setAsinInput('');
    } catch (err: any) {
      setAmazonError(err.message);
    } finally {
      setAmazonSaving(false);
    }
  };

  const handleRemoveAmazonMapping = async () => {
    if (!amazonMapping?.id) return;
    if (!confirm('Remove Amazon ASIN mapping for this item?')) return;
    setAmazonSaving(true);
    setAmazonError('');
    try {
      const res = await fetch('/api/settings/integrations/amazon-business/item-mappings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'x-idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ mapping_id: amazonMapping.id }),
      });
      if (!res.ok) {
        const json = await res.json();
        setAmazonError(json.error?.message || 'Failed to remove mapping');
        return;
      }
      setAmazonMapping(null);
      setAsinInput('');
      setResolvedAsin(null);
      setAmazonPackQty('1');
      setAmazonPreferred(false);
    } catch (err: any) {
      setAmazonError(err.message);
    } finally {
      setAmazonSaving(false);
    }
  };

  useEffect(() => {
    if (isEditing) return;

    const category = categories.find((cat) => cat.id === form.category_id);
    if (!category) return;

    const categoryMode = category.sku_mode || 'sequential';

    if (categoryMode === 'manual') {
      return;
    }

    const separator = skuSettings?.separator || '-';
    const prefix = category.sku_prefix ? category.sku_prefix.toUpperCase() : '';
    const parent = categories.find((cat) => cat.id === category.parent_category_id);
    const parentPrefix = parent?.sku_prefix ? parent.sku_prefix.toUpperCase() : '';

    if (categoryMode === 'sequential') {
      const next = skuSettings?.next_sequence ?? 1;
      const padded = String(next).padStart(3, '0');
      const sku = prefix ? `${prefix}${separator}${padded}` : padded;
      setForm((prev) => ({ ...prev, base_sku: padded, sku }));
      return;
    }

    if (categoryMode === 'attribute_based') {
      const next = skuSettings?.next_sequence ?? 1;
      const padded = form.base_sku ? form.base_sku.toUpperCase() : String(next).padStart(3, '0');
      const parts = [parentPrefix, prefix, padded].filter(Boolean);
      const sku = parts.join(separator);
      setForm((prev) => ({ ...prev, base_sku: padded, sku }));
    }
  }, [form.category_id, form.base_sku, skuSettings, categories, isEditing]);

  const buildSkuForCategory = () => {
    const category = categories.find((cat) => cat.id === form.category_id);
    if (!category) return form.sku;
    const categoryMode = category.sku_mode || 'sequential';
    if (categoryMode === 'manual') return form.sku;

    const separator = skuSettings?.separator || '-';
    const prefix = category.sku_prefix ? category.sku_prefix.toUpperCase() : '';
    const parent = categories.find((cat) => cat.id === category.parent_category_id);
    const parentPrefix = parent?.sku_prefix ? parent.sku_prefix.toUpperCase() : '';

    if (categoryMode === 'sequential') {
      const next = skuSettings?.next_sequence ?? 1;
      const padded = String(next).padStart(3, '0');
      return prefix ? `${prefix}${separator}${padded}` : padded;
    }

    if (categoryMode === 'attribute_based') {
      const next = skuSettings?.next_sequence ?? 1;
      const baseSku = form.base_sku?.toUpperCase() || String(next).padStart(3, '0');
      const parts = [parentPrefix, prefix, baseSku].filter(Boolean);
      return parts.join(separator);
    }

    return form.sku;
  };

  const fetchCategories = async () => {
    try {
      const data = await InventoryRPC.getItemCategories();
      setCategories(data || []);
    } catch (err) {
      console.error('Error fetching categories:', err);
    }
  };

  const buildLevelPayload = (catalogItemId: string, includeEmpty: boolean) => {
    return levels
      // Drop rows without a real location — the inventory-levels route requires
      // a non-empty location_id, and a blank row would fail validation and block
      // the whole item save.
      .filter((level) => !!level.location_id)
      .filter((level) => includeEmpty || level.reorder_point !== null || level.target_stock !== null)
      .map((level) => ({
        catalog_item_id: catalogItemId,
        location_id: level.location_id,
        current_stock: level.current_stock || 0,
        reorder_point: level.reorder_point,
        target_stock: level.target_stock,
      }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const category = categories.find((cat) => cat.id === form.category_id);
      const categoryMode = category?.sku_mode || 'sequential';
      const autoGeneratedBaseSku =
        categoryMode === 'attribute_based' && !form.base_sku
          ? String(skuSettings?.next_sequence ?? 1).padStart(3, '0')
          : form.base_sku;
      const autoSku = buildSkuForCategory();

      const payload: Record<string, unknown> = {
        name: form.name,
        description: form.description || null,
        category_id: form.category_id || null,
        uom_term_id: form.uom_term_id || null,
        tracking_mode: form.tracking_mode,
        reorder_point: form.reorder_point ? Number(form.reorder_point) : null,
        base_sku: categoryMode === 'attribute_based' ? autoGeneratedBaseSku || null : null,
        material_term_id: form.material_term_id || null,
        product_term_id: form.product_term_id || null,
        quality_tier_term_id: form.quality_tier_term_id || null,
      };

      const cleanLinks = cleanReferenceLinks(links);

      // SKU handling: `sku` is NOT NULL. For a manual-mode category we send the
      // entered/built SKU. On create (non-manual) we send null so the RPC
      // generates one. On EDIT (non-manual) we must NOT send sku at all —
      // otherwise we'd null out the existing value and hit the NOT NULL constraint.
      if (categoryMode === 'manual') {
        payload.sku = autoSku;
      } else if (!isEditing) {
        payload.sku = null;
      }

      let catalogItemId = item?.id;

      if (isEditing && item) {
        if (!item.last_event_id) {
          throw AppError.badRequest('Missing last_event_id for this item. Please refresh and try again.');
        }

        await InventoryRPC.updateCatalogItem(
          item.id,
          { ...payload, reference_links: cleanLinks } as Parameters<typeof InventoryRPC.updateCatalogItem>[1],
          item.last_event_id,
        );
        catalogItemId = item.id;
      } else {
        const created = await InventoryRPC.createCatalogItem({
          ...payload,
          last_event_id: crypto.randomUUID(),
        } as Parameters<typeof InventoryRPC.createCatalogItem>[0]);
        catalogItemId = created.id;

        // reference_links isn't a create-RPC param — apply it in a follow-up
        // OCC update using the event id the create just returned.
        if (cleanLinks.length > 0 && created.last_event_id) {
          await InventoryRPC.updateCatalogItem(
            created.id,
            { reference_links: cleanLinks } as Parameters<typeof InventoryRPC.updateCatalogItem>[1],
            created.last_event_id,
          );
        }
      }

      if (!isEditing) {
        // SKU sequencing is handled server-side in rpc_create_catalog_item.
      }

      if (catalogItemId) {
        const levelsPayload = buildLevelPayload(catalogItemId, isEditing);
        if (levelsPayload.length > 0) {
          await InventoryRPC.upsertInventoryLevels(levelsPayload);
        }
      }

      // Set initial stock for new items (via stock adjustment)
      if (!isEditing && catalogItemId && initialStockLocation && initialStockQty) {
        const qty = Number(initialStockQty);
        if (qty > 0) {
          try {
            await InventoryRPC.adjustInventory({
              location_id: initialStockLocation,
              catalog_item_id: catalogItemId,
              new_qty: qty,
              reason: 'count_variance' as const,
              notes: 'Initial stock set during item creation',
            });
          } catch (stockErr: any) {
            console.error('Initial stock adjustment failed:', stockErr);
            // Item was created successfully, just warn about stock
            setError(`Item created but initial stock failed: ${stockErr.message}. You can adjust stock later.`);
            setSaving(false);
            // Still call onCreated after a short delay so the item shows up
            setTimeout(onCreated, 2000);
            return;
          }
        }
      }

      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLevelChange = (locationId: string, field: 'reorder_point' | 'target_stock', value: string) => {
    setLevels((prev) => {
      const next = [...prev];
      const existing = next.find((level) => level.location_id === locationId);
      const numeric = value === '' ? null : Number(value);
      if (existing) {
        existing[field] = numeric;
      } else {
        next.push({
          location_id: locationId,
          current_stock: 0,
          reorder_point: field === 'reorder_point' ? numeric : null,
          target_stock: field === 'target_stock' ? numeric : null,
        });
      }
      return next;
    });
  };

  const saveLevels = async () => {
    if (!item?.id) return;
    setLevelsSaving(true);
    try {
      const payload = buildLevelPayload(item.id, true);
      await InventoryRPC.upsertInventoryLevels(payload);
    } catch (err) {
      console.error('Error saving inventory levels:', err);
    } finally {
      setLevelsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl h-[85vh] mx-4 flex flex-col">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">{isEditing ? 'Edit Catalog Item' : 'Create Catalog Item'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          {isEditing && item?.id && (
            <div className="flex flex-col items-center gap-1 pb-3 border-b">
              <EntityImageUpload
                entityType="catalog_item"
                entityId={item.id}
                size="lg"
                generateContext={{ name: form.name, description: form.description }}
              />
              <span className="text-xs text-muted-foreground">Item Photo — upload, or generate with AI</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium">Category</label>
              <button
                type="button"
                onClick={onAddCategory}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                + Create New
              </button>
            </div>
            <select
              value={form.category_id}
              onChange={(e) => {
                if (e.target.value === '__create_new__') {
                  onAddCategory();
                  return;
                }
                setForm({ ...form, category_id: e.target.value });
              }}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">-- Select Category (Optional) --</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
              <option value="__create_new__">+ Create New Category...</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">SKU *</label>
            <input
              type="text"
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              required
              readOnly={!isEditing && categories.find((cat) => cat.id === form.category_id)?.sku_mode !== 'manual'}
            />
            {!isEditing && categories.find((cat) => cat.id === form.category_id)?.sku_mode !== 'manual' && (
              <p className="mt-2 text-xs text-muted-foreground">
                SKU is auto-generated from the category settings.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Base SKU</label>
            <input
              type="text"
              value={form.base_sku}
              onChange={(e) => setForm({ ...form, base_sku: e.target.value.toUpperCase() })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              placeholder="e.g., 001 or MAC"
              readOnly={!isEditing && categories.find((cat) => cat.id === form.category_id)?.sku_mode === 'sequential'}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Used for attribute-based SKU assembly. Sequential mode auto-fills this value.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={2}
            />
          </div>

          {/* Material Classification */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-semibold mb-3">Material Classification <span className="text-muted-foreground font-normal">(optional)</span></h4>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Material</label>
                <select
                  value={form.material_term_id}
                  onChange={(e) => setForm({ ...form, material_term_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  disabled={materialLoading}
                >
                  <option value="">-- None --</option>
                  {materialTerms.map((t) => (
                    <option key={t.term_id} value={t.term_id}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Product Type</label>
                <select
                  value={form.product_term_id}
                  onChange={(e) => setForm({ ...form, product_term_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  disabled={productLoading}
                >
                  <option value="">-- None --</option>
                  {productTerms.map((t) => (
                    <option key={t.term_id} value={t.term_id}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Quality Tier</label>
                <select
                  value={form.quality_tier_term_id}
                  onChange={(e) => setForm({ ...form, quality_tier_term_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  disabled={tierLoading}
                >
                  <option value="">-- None --</option>
                  {tierTerms.map((t) => (
                    <option key={t.term_id} value={t.term_id}>{t.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Unit of Measure</label>
              <select
                value={form.uom_term_id}
                onChange={(e) => {
                  const selected = uomTerms.find(t => t.term_id === e.target.value);
                  if (selected) {
                    setForm({ ...form, uom_term_id: selected.term_id });
                  } else {
                    setForm({ ...form, uom_term_id: e.target.value });
                  }
                }}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {uomLoading ? (
                  <option>Loading...</option>
                ) : uomTerms.length > 0 ? (
                  uomTerms.map((uom) => (
                    <option key={uom.term_id} value={uom.term_id}>{uom.label}</option>
                  ))
                ) : (
                  <>
                    <option value="EA">Each</option>
                    <option value="BOX">Box</option>
                    <option value="CASE">Case</option>
                    <option value="LB">Pound</option>
                    <option value="KG">Kilogram</option>
                    <option value="GAL">Gallon</option>
                  </>
                )}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Tracking Mode</label>
              <select
                value={form.tracking_mode}
                onChange={(e) => setForm({ ...form, tracking_mode: e.target.value as TrackingMode })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="stock">Stock</option>
                <option value="serialized">Serialized</option>
                <option value="both">Both</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Default Reorder Point</label>
            <input
              type="number"
              value={form.reorder_point}
              onChange={(e) => setForm({ ...form, reorder_point: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              min="0"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Used when a location does not have a specific reorder point.
            </p>
          </div>

          {/* Initial Stock section for new items */}
          {!isEditing && (
            <div className="border-t pt-4">
              <div className="mb-3">
                <h4 className="text-sm font-semibold">Initial Stock <span className="text-muted-foreground font-normal">(optional)</span></h4>
                <p className="text-xs text-muted-foreground">
                  Set initial quantity at a location. You can adjust stock later from the Stock page.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Location</label>
                  <select
                    value={initialStockLocation}
                    onChange={(e) => setInitialStockLocation(e.target.value)}
                    className="w-full px-2 py-1.5 border rounded-md text-sm"
                  >
                    <option value="">-- None --</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Quantity</label>
                  <input
                    type="number"
                    min="0"
                    value={initialStockQty}
                    onChange={(e) => setInitialStockQty(e.target.value)}
                    className="w-full px-2 py-1.5 border rounded-md text-sm"
                    placeholder="0"
                    disabled={!initialStockLocation}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-1">
              <div>
                <h4 className="text-sm font-semibold">Location Stock Management</h4>
                <p className="text-xs text-muted-foreground">
                  Override the default reorder point per location, or set a target stock. Leave blank to use the default above.
                </p>
              </div>
              {isEditing && (
                <button
                  type="button"
                  onClick={saveLevels}
                  disabled={levelsSaving}
                  className="px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 shrink-0"
                >
                  {levelsSaving ? 'Saving...' : 'Save Levels'}
                </button>
              )}
            </div>

            {locations.length === 0 ? (
              <div className="mt-3 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                No locations found. Add a location to manage per-site stock.
              </div>
            ) : (() => {
              const defaultReorderPoint = form.reorder_point !== '' && Number.isFinite(Number(form.reorder_point))
                ? Number(form.reorder_point)
                : null;
              const isConfigured = (locId: string) => {
                const lvl = levels.find((row) => row.location_id === locId);
                return !!lvl && (lvl.reorder_point !== null || lvl.target_stock !== null || (lvl.current_stock ?? 0) > 0);
              };
              const search = locationSearch.trim().toLowerCase();
              const visibleLocations = locations.filter((loc) => {
                if (search) return loc.name.toLowerCase().includes(search);
                if (showAllLocations) return true;
                return isConfigured(loc.id);
              });
              const hiddenCount = locations.length - visibleLocations.length;

              return (
                <div className="mt-3 space-y-2">
                  {locations.length > 6 && (
                    <input
                      type="text"
                      value={locationSearch}
                      onChange={(e) => setLocationSearch(e.target.value)}
                      placeholder={`Search ${locations.length} locations...`}
                      className="w-full px-3 py-1.5 border rounded-md text-sm"
                    />
                  )}

                  {visibleLocations.length > 0 && (
                    <div className="grid grid-cols-[1fr_4rem_5.5rem_5.5rem] gap-2 px-2 text-[11px] font-medium text-muted-foreground">
                      <span>Location</span>
                      <span className="text-right">On hand</span>
                      <span>Reorder</span>
                      <span>Target</span>
                    </div>
                  )}

                  {visibleLocations.map((loc) => {
                    const level = levels.find((row) => row.location_id === loc.id);
                    const currentStock = level?.current_stock ?? 0;
                    const reorderPoint = level?.reorder_point ?? null;
                    const effectiveReorderPoint = reorderPoint ?? defaultReorderPoint;
                    const isLow = effectiveReorderPoint !== null && currentStock <= effectiveReorderPoint;

                    return (
                      <div
                        key={loc.id}
                        className="grid grid-cols-[1fr_4rem_5.5rem_5.5rem] items-center gap-2 rounded-md border px-2 py-1.5"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{loc.name}</div>
                          {isLow ? (
                            <div className="text-[11px] font-medium text-amber-600">Below reorder</div>
                          ) : formatLocationType(loc.location_type) ? (
                            <div className="truncate text-[11px] text-muted-foreground capitalize">
                              {formatLocationType(loc.location_type)}
                            </div>
                          ) : null}
                        </div>
                        <div className="text-right font-mono text-xs text-muted-foreground">{currentStock}</div>
                        <input
                          type="number"
                          min="0"
                          value={reorderPoint ?? ''}
                          onChange={(e) => handleLevelChange(loc.id, 'reorder_point', e.target.value)}
                          placeholder={defaultReorderPoint !== null ? String(defaultReorderPoint) : '—'}
                          title={reorderPoint === null && defaultReorderPoint !== null ? `Using default: ${defaultReorderPoint}` : undefined}
                          className="w-full px-2 py-1 border rounded-md text-sm"
                        />
                        <input
                          type="number"
                          min="0"
                          value={level?.target_stock ?? ''}
                          onChange={(e) => handleLevelChange(loc.id, 'target_stock', e.target.value)}
                          placeholder="—"
                          className="w-full px-2 py-1 border rounded-md text-sm"
                        />
                      </div>
                    );
                  })}

                  {visibleLocations.length === 0 && (
                    <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                      {search ? 'No locations match your search.' : 'No locations configured yet.'}
                    </div>
                  )}

                  {!search && hiddenCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAllLocations(true)}
                      className="text-xs font-medium text-blue-600 hover:text-blue-700"
                    >
                      Show all {locations.length} locations ({hiddenCount} more)
                    </button>
                  )}
                  {!search && showAllLocations && (
                    <button
                      type="button"
                      onClick={() => setShowAllLocations(false)}
                      className="text-xs font-medium text-blue-600 hover:text-blue-700"
                    >
                      Show only configured locations
                    </button>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Reference Links — plain URLs (product pages, spec sheets, suppliers) */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-semibold mb-1">Reference Links</h4>
            <p className="text-xs text-muted-foreground mb-3">
              Save any product page, spec sheet, or supplier URL for quick access. For orderable Amazon products, use the Amazon Business section below.
            </p>
            <ReferenceLinksEditor links={links} onChange={setLinks} disabled={saving} />
          </div>

          {/* Amazon Business Mapping (edit mode only) */}
          {isEditing && (
            <div className="border-t pt-4">
              <div className="flex items-center gap-2 mb-3">
                <h4 className="text-sm font-semibold">Amazon Business</h4>
                {amazonConnected ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    Connected
                  </span>
                ) : !amazonLoading ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
                    Not Connected
                  </span>
                ) : null}
              </div>

              {amazonLoading && (
                <p className="text-xs text-muted-foreground">Loading Amazon mapping...</p>
              )}

              {!amazonLoading && !amazonConnected && (
                <p className="text-xs text-muted-foreground">
                  Connect Amazon Business in{' '}
                  <a href="/settings/integrations" className="text-blue-600 hover:underline">Settings &gt; Integrations</a>{' '}
                  to link products by ASIN.
                </p>
              )}

              {amazonError && (
                <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600 mb-3">
                  {amazonError}
                </div>
              )}

              {/* Existing mapping display */}
              {!amazonLoading && amazonConnected && amazonMapping && !resolvedAsin && (
                <div className="rounded-md border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">ASIN:</span>
                      <a
                        href={`https://www.amazon.com/dp/${amazonMapping.vendor_sku}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-mono text-blue-600 hover:underline"
                      >
                        {amazonMapping.vendor_sku}
                      </a>
                      {amazonMapping.is_preferred && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
                          Preferred
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveAmazonMapping}
                      disabled={amazonSaving}
                      className="text-xs text-red-600 hover:text-red-800 font-medium"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>Pack Qty: {amazonMapping.pack_size}</span>
                    {amazonMapping.last_known_price != null && (
                      <span>Price: ${amazonMapping.last_known_price.toFixed(2)}</span>
                    )}
                  </div>

                  {/* Inline edit pack qty / preferred */}
                  <div className="flex items-center gap-3 pt-1">
                    <div className="flex items-center gap-1.5">
                      <label className="text-[11px] font-medium">Pack Qty</label>
                      <input
                        type="number"
                        min="1"
                        value={amazonPackQty}
                        onChange={(e) => setAmazonPackQty(e.target.value)}
                        className="w-16 px-1.5 py-1 border rounded text-xs"
                      />
                    </div>
                    <label className="flex items-center gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={amazonPreferred}
                        onChange={(e) => setAmazonPreferred(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      Preferred
                    </label>
                    {(Number(amazonPackQty) !== amazonMapping.pack_size || amazonPreferred !== amazonMapping.is_preferred) && (
                      <button
                        type="button"
                        onClick={handleSaveAmazonMapping}
                        disabled={amazonSaving}
                        className="px-2 py-1 text-[11px] font-semibold bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        {amazonSaving ? 'Saving...' : 'Update'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Add new mapping form */}
              {!amazonLoading && amazonConnected && !amazonMapping && !resolvedAsin && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Link an Amazon product to this item by pasting an Amazon URL or ASIN.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={asinInput}
                      onChange={(e) => setAsinInput(e.target.value)}
                      placeholder="Paste Amazon URL or ASIN..."
                      className="flex-1 px-2 py-1.5 border rounded-md text-sm"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleResolveAsin(); } }}
                    />
                    <button
                      type="button"
                      onClick={handleResolveAsin}
                      disabled={asinResolving || !asinInput.trim()}
                      className="px-3 py-1.5 text-xs font-semibold bg-gray-800 text-white rounded-md hover:bg-gray-900 disabled:opacity-50"
                    >
                      {asinResolving ? 'Resolving...' : 'Resolve'}
                    </button>
                  </div>
                </div>
              )}

              {/* Resolved ASIN preview + confirm */}
              {amazonConnected && resolvedAsin && (
                <div className="rounded-md border p-3 space-y-3">
                  <div className="flex gap-3">
                    {resolvedAsin.image_url && (
                      <img
                        src={resolvedAsin.image_url}
                        alt={resolvedAsin.title || resolvedAsin.asin}
                        className="w-12 h-12 object-contain rounded border"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      {resolvedAsin.title && (
                        <p className="text-xs font-medium truncate">{resolvedAsin.title}</p>
                      )}
                      <div className="flex items-center gap-2 mt-0.5">
                        <a
                          href={resolvedAsin.product_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-mono text-blue-600 hover:underline"
                        >
                          {resolvedAsin.asin}
                        </a>
                        {resolvedAsin.price != null && (
                          <span className="text-xs text-muted-foreground">${resolvedAsin.price.toFixed(2)}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <label className="text-[11px] font-medium">Pack Qty</label>
                      <input
                        type="number"
                        min="1"
                        value={amazonPackQty}
                        onChange={(e) => setAmazonPackQty(e.target.value)}
                        className="w-16 px-1.5 py-1 border rounded text-xs"
                      />
                    </div>
                    <label className="flex items-center gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={amazonPreferred}
                        onChange={(e) => setAmazonPreferred(e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      Preferred
                    </label>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setResolvedAsin(null); setAsinInput(''); }}
                      className="flex-1 px-3 py-1.5 text-xs border text-gray-700 rounded-md hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveAmazonMapping}
                      disabled={amazonSaving}
                      className="flex-1 px-3 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                      {amazonSaving ? 'Saving...' : 'Link Product'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? (isEditing ? 'Updating...' : 'Creating...') : (isEditing ? 'Update Item' : 'Create Item')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
