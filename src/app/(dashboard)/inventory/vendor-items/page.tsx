'use client';

import { AppError } from '@rocketmanv9/chassis/errors';

import { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Plus, Edit, Trash2, Star, Package, DollarSign, Building2,
  Search, ArrowLeft, ArrowRight, Clock, ChevronRight, ExternalLink, Award, Zap,
} from 'lucide-react';
import { HowItWorksCard, HowThisWorksButton, useHowItWorks } from '@/components/ui/HowItWorksCard';
import { AppShell } from '@/components/layout/AppShell';
import { CapabilityGate } from '@/components/access/CapabilityGate';
import { PageHeader } from '@/components/ui/PageHeader';
import { useEntityImages } from '@/hooks/useEntityImages';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { useUOMLabelMap, useUOMTerms } from '@/hooks/useGVTerms';

type Vendor = {
  id: string;
  name: string;
  code: string | null;
  active?: boolean | null;
};

type CatalogItem = {
  id: string;
  name: string;
  sku: string;
  description?: string | null;
  uom_term_id?: string | null;
  tracking_mode?: string | null;
};

type VendorAddress = {
  id: string;
  label: string | null;
  city: string | null;
  state: string | null;
};

type VendorItem = {
  id: string;
  vendor_id: string;
  catalog_item_id: string;
  vendor_address_id: string | null;
  vendor_sku: string;
  vendor_uom_term_id: string | null;
  pack_size: number | null;
  is_preferred: boolean | null;
  unit_cost: number | null;
  currency: string | null;
  lead_time_days: number | null;
  min_order_qty: number | null;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
  last_event_id: string | null;
};

type EnrichedVendorItem = VendorItem & {
  vendor?: Vendor | null;
};

const EMPTY_FORM = {
  vendor_id: '',
  catalog_item_id: '',
  vendor_address_id: '',
  vendor_sku: '',
  vendor_uom_term_id: '',
  pack_size: 1,
  is_preferred: false,
  unit_cost: '',
  currency: 'USD',
  lead_time_days: '',
  min_order_qty: '',
  notes: '',
};

function VendorItemsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedItemId = searchParams.get('item') || '';

  const help = useHowItWorks('inventory-vendor-items-help');
  const uomLabels = useUOMLabelMap();
  const { terms: uomTerms, loading: uomLoading } = useUOMTerms();

  const [vendorItems, setVendorItems] = useState<VendorItem[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [overviewSearch, setOverviewSearch] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<VendorItem | null>(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Addresses per vendor, fetched lazily — used for the branch dropdown and to
  // label branch-override rows in the comparison and the form.
  const [vendorAddresses, setVendorAddresses] = useState<Record<string, VendorAddress[]>>({});

  const fetchVendorAddresses = useCallback(async (vendorId: string) => {
    if (!vendorId) return;
    try {
      const res = await fetch(`/api/inventory/vendors/${vendorId}/addresses`);
      if (!res.ok) return;
      const json = await res.json();
      setVendorAddresses((prev) => ({ ...prev, [vendorId]: json.data || [] }));
    } catch {
      /* branch labels degrade gracefully */
    }
  }, []);

  const fetchVendorItems = useCallback(async () => {
    try {
      const data = await SupplyChainRPC.getVendorItems();
      setVendorItems((data || []) as VendorItem[]);
    } catch (error) {
      console.error('Error fetching vendor items:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchVendorItems();
    (async () => {
      try {
        setVendors((await SupplyChainRPC.getVendors()) || []);
      } catch (error) {
        console.error('Error fetching vendors:', error);
      }
    })();
    (async () => {
      try {
        setCatalogItems(((await InventoryRPC.getCatalogItems()) || []) as CatalogItem[]);
      } catch (error) {
        console.error('Error fetching catalog items:', error);
      }
    })();
  }, [fetchVendorItems]);

  // Load addresses for any vendor that has branch-priced rows on the selected
  // item so the branch tags render in the comparison.
  useEffect(() => {
    const ids = [
      ...new Set(
        vendorItems
          .filter((vi) => vi.vendor_address_id && (!selectedItemId || vi.catalog_item_id === selectedItemId))
          .map((vi) => vi.vendor_id)
      ),
    ];
    ids.forEach((vid) => {
      if (!vendorAddresses[vid]) void fetchVendorAddresses(vid);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorItems, selectedItemId]);

  const vendorMap = useMemo(() => new Map(vendors.map((v) => [v.id, v])), [vendors]);
  const catalogMap = useMemo(() => new Map(catalogItems.map((i) => [i.id, i])), [catalogItems]);

  const branchLabel = (vendorId: string, addressId: string | null) => {
    if (!addressId) return null;
    const addr = (vendorAddresses[vendorId] || []).find((a) => a.id === addressId);
    if (!addr) return 'Branch';
    return addr.label?.split(' (')[0] || [addr.city, addr.state].filter(Boolean).join(', ') || 'Branch';
  };

  // ---- Overview: one row per catalog item that has vendor links ----
  type ItemSummary = {
    item: CatalogItem | null;
    catalog_item_id: string;
    vendorCount: number;
    bestPrice: number | null;
    preferredVendorName: string | null;
  };

  const itemSummaries: ItemSummary[] = useMemo(() => {
    const byItem = new Map<string, VendorItem[]>();
    for (const vi of vendorItems) {
      const list = byItem.get(vi.catalog_item_id) || [];
      list.push(vi);
      byItem.set(vi.catalog_item_id, list);
    }
    const rows: ItemSummary[] = [];
    for (const [catalogItemId, rowsForItem] of byItem.entries()) {
      const distinctVendors = new Set(rowsForItem.map((r) => r.vendor_id));
      const costs = rowsForItem.map((r) => r.unit_cost).filter((c): c is number => c != null);
      const preferred = rowsForItem.find((r) => r.is_preferred);
      rows.push({
        item: catalogMap.get(catalogItemId) || null,
        catalog_item_id: catalogItemId,
        vendorCount: distinctVendors.size,
        bestPrice: costs.length ? Math.min(...costs) : null,
        preferredVendorName: preferred ? vendorMap.get(preferred.vendor_id)?.name ?? null : null,
      });
    }
    return rows.sort((a, b) => (a.item?.name || '').localeCompare(b.item?.name || ''));
  }, [vendorItems, catalogMap, vendorMap]);

  const filteredSummaries = useMemo(() => {
    const q = overviewSearch.trim().toLowerCase();
    if (!q) return itemSummaries;
    return itemSummaries.filter(
      (s) =>
        s.item?.name?.toLowerCase().includes(q) ||
        s.item?.sku?.toLowerCase().includes(q)
    );
  }, [itemSummaries, overviewSearch]);

  const overviewImageIds = useMemo(() => filteredSummaries.map((s) => s.catalog_item_id), [filteredSummaries]);
  const { imageMap: overviewImages } = useEntityImages('catalog_item', overviewImageIds);

  // ---- Comparison: vendors carrying the selected item ----
  const selectedItem = selectedItemId ? catalogMap.get(selectedItemId) || null : null;

  const comparisonRows: EnrichedVendorItem[] = useMemo(() => {
    if (!selectedItemId) return [];
    return vendorItems
      .filter((vi) => vi.catalog_item_id === selectedItemId)
      .map((vi) => ({ ...vi, vendor: vendorMap.get(vi.vendor_id) || null }))
      .sort((a, b) => {
        // Preferred first, then cheapest, then fastest.
        if (!!a.is_preferred !== !!b.is_preferred) return a.is_preferred ? -1 : 1;
        const ac = a.unit_cost ?? Infinity;
        const bc = b.unit_cost ?? Infinity;
        if (ac !== bc) return ac - bc;
        return (a.lead_time_days ?? Infinity) - (b.lead_time_days ?? Infinity);
      });
  }, [vendorItems, selectedItemId, vendorMap]);

  const cheapestCost = useMemo(() => {
    const costs = comparisonRows.map((r) => r.unit_cost).filter((c): c is number => c != null);
    return costs.length ? Math.min(...costs) : null;
  }, [comparisonRows]);

  const fastestLead = useMemo(() => {
    const leads = comparisonRows.map((r) => r.lead_time_days).filter((c): c is number => c != null);
    return leads.length ? Math.min(...leads) : null;
  }, [comparisonRows]);

  const selectItem = (id: string) => {
    router.push(id ? `/inventory/vendor-items?item=${id}` : '/inventory/vendor-items');
  };

  // ---- Link CRUD ----
  const openAddModal = () => {
    setEditingItem(null);
    setFormData({ ...EMPTY_FORM, catalog_item_id: selectedItemId || '' });
    setShowModal(true);
  };

  const openEditModal = (item: VendorItem) => {
    setEditingItem(item);
    void fetchVendorAddresses(item.vendor_id);
    setFormData({
      vendor_id: item.vendor_id,
      catalog_item_id: item.catalog_item_id,
      vendor_address_id: item.vendor_address_id || '',
      vendor_sku: item.vendor_sku,
      vendor_uom_term_id: item.vendor_uom_term_id || '',
      pack_size: item.pack_size || 1,
      is_preferred: !!item.is_preferred,
      unit_cost: item.unit_cost?.toString() || '',
      currency: item.currency || 'USD',
      lead_time_days: item.lead_time_days?.toString() || '',
      min_order_qty: item.min_order_qty?.toString() || '',
      notes: item.notes || '',
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingItem(null);
    setFormData(EMPTY_FORM);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      vendor_id: formData.vendor_id,
      catalog_item_id: formData.catalog_item_id,
      vendor_address_id: formData.vendor_address_id || null,
      vendor_sku: formData.vendor_sku,
      vendor_uom_term_id: formData.vendor_uom_term_id || null,
      pack_size: parseFloat(formData.pack_size.toString()) || 1,
      is_preferred: formData.is_preferred,
      unit_cost: formData.unit_cost ? parseFloat(formData.unit_cost) : null,
      currency: formData.currency,
      lead_time_days: formData.lead_time_days ? parseInt(formData.lead_time_days) : null,
      min_order_qty: formData.min_order_qty ? parseFloat(formData.min_order_qty) : null,
      notes: formData.notes || null,
    };

    setSaving(true);
    try {
      if (editingItem) {
        if (!editingItem.last_event_id) {
          throw AppError.badRequest('Missing last_event_id for this vendor item. Please refresh and try again.');
        }
        await SupplyChainRPC.updateVendorItem(editingItem.id, payload, editingItem.last_event_id);
      } else {
        await SupplyChainRPC.createVendorItem({ ...payload, last_event_id: crypto.randomUUID() });
      }
      await fetchVendorItems();
      // A newly-added link on the overview should land you on that item's comparison.
      if (!editingItem && !selectedItemId && payload.catalog_item_id) {
        selectItem(payload.catalog_item_id);
      }
      closeModal();
    } catch (error) {
      console.error('Error saving vendor item:', error);
      alert(error instanceof Error ? error.message : 'Failed to save vendor item');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: VendorItem) => {
    if (!confirm('Remove this vendor from the item? The vendor and item stay; only this pricing link is deleted.')) return;
    try {
      if (!item.last_event_id) {
        throw AppError.badRequest('Missing last_event_id for this vendor item. Please refresh and try again.');
      }
      await SupplyChainRPC.deleteVendorItem(item.id, item.last_event_id);
      await fetchVendorItems();
    } catch (error) {
      console.error('Error deleting vendor item:', error);
      alert('Failed to delete vendor item');
    }
  };

  // Star / unstar preferred straight from a comparison row.
  const togglePreferred = async (item: EnrichedVendorItem, next: boolean) => {
    if (!item.last_event_id) {
      alert('Missing last_event_id for this vendor item. Please refresh and try again.');
      return;
    }
    try {
      await SupplyChainRPC.updateVendorItem(item.id, { is_preferred: next }, item.last_event_id);
      await fetchVendorItems();
    } catch (error) {
      console.error('Error updating preferred vendor:', error);
      alert(error instanceof Error ? error.message : 'Failed to update preferred vendor');
    }
  };

  const fmtCost = (c: number | null, currency: string | null) =>
    c != null ? `$${c.toFixed(2)}${currency && currency !== 'USD' ? ` ${currency}` : ''}` : '—';

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading vendor items...</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div>
        <div className="mb-6">
          <PageHeader
            title="Vendor Items"
            description="Find an item, then compare the vendors that carry it — cheapest cost and fastest lead time called out — and order from the one you want. Add, price, and star vendors for any item right here."
            actions={!help.show ? <HowThisWorksButton onClick={help.open} /> : undefined}
          />
        </div>

        {help.show && (
          <div className="mb-6">
            <HowItWorksCard
              title="How vendor items work"
              onDismiss={help.dismiss}
              steps={[
                { title: 'Pick an item', body: 'Search the catalog and open an item to see every vendor that sells it, side by side.' },
                { title: 'Compare vendors', body: 'Each vendor shows unit cost, lead time, min order qty, pack size and their SKU. The cheapest price and the fastest lead time are highlighted so the best pick is obvious.' },
                { title: 'Order or maintain', body: '"Order from this vendor" starts a purchase order prefilled with that item and vendor. Add a new vendor for the item, edit pricing, or star the preferred source without leaving the page.' },
              ]}
              legendTitle="Highlights"
              legend={[
                { badge: <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-800 bg-emerald-100 rounded-full"><Award className="w-3 h-3" />Cheapest</span>, text: 'the lowest unit cost among vendors carrying this item' },
                { badge: <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-800 bg-blue-100 rounded-full"><Zap className="w-3 h-3" />Fastest</span>, text: 'the shortest lead time among those vendors' },
                { badge: <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-yellow-800 bg-yellow-100 rounded-full"><Star className="w-3 h-3 fill-current" />Preferred</span>, text: 'your chosen go-to vendor for this item when ordering' },
              ]}
              glossary={[
                { Icon: Package, term: 'Vendor SKU', blurb: 'the vendor’s own part number for your item — printed on POs so they recognize the order' },
                { Icon: Building2, term: 'Branch price', blurb: 'a price scoped to one vendor address (plant/store); it wins over the company default when ordering from that branch' },
                { Icon: DollarSign, term: 'Lead time', blurb: 'days from order to delivery for this vendor+item — feeds reorder timing and PO expected dates' },
              ]}
            />
          </div>
        )}

        {selectedItemId ? (
          <ComparisonView
            selectedItem={selectedItem}
            selectedItemId={selectedItemId}
            rows={comparisonRows}
            cheapestCost={cheapestCost}
            fastestLead={fastestLead}
            uomLabels={uomLabels}
            branchLabel={branchLabel}
            fmtCost={fmtCost}
            onBack={() => selectItem('')}
            onAdd={openAddModal}
            onEdit={openEditModal}
            onDelete={handleDelete}
            onTogglePreferred={togglePreferred}
          />
        ) : (
          <OverviewView
            summaries={filteredSummaries}
            totalCount={itemSummaries.length}
            images={overviewImages}
            search={overviewSearch}
            setSearch={setOverviewSearch}
            fmtCost={fmtCost}
            onSelect={selectItem}
            onAdd={openAddModal}
          />
        )}
      </div>

      {showModal && (
        <VendorItemModal
          editingItem={editingItem}
          formData={formData}
          setFormData={setFormData}
          vendors={vendors}
          catalogItems={catalogItems}
          uomTerms={uomTerms}
          uomLoading={uomLoading}
          vendorAddresses={vendorAddresses}
          fetchVendorAddresses={fetchVendorAddresses}
          lockItem={!!selectedItemId && !editingItem}
          saving={saving}
          onSubmit={handleSubmit}
          onClose={closeModal}
        />
      )}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Overview — items that have vendor links, searchable, with vendor count + best price.
// ---------------------------------------------------------------------------
function OverviewView({
  summaries,
  totalCount,
  images,
  search,
  setSearch,
  fmtCost,
  onSelect,
  onAdd,
}: {
  summaries: Array<{
    item: CatalogItem | null;
    catalog_item_id: string;
    vendorCount: number;
    bestPrice: number | null;
    preferredVendorName: string | null;
  }>;
  totalCount: number;
  images: Record<string, string>;
  search: string;
  setSearch: (v: string) => void;
  fmtCost: (c: number | null, currency: string | null) => string;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            autoFocus
            placeholder="Search an item by name or SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11 w-full rounded-lg border border-gray-300 pl-10 pr-3 focus:border-transparent focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={onAdd}
          className="flex h-11 items-center gap-2 rounded-lg bg-blue-600 px-4 text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Add vendor for an item
        </button>
      </div>

      <p className="mb-3 text-sm text-gray-500">
        {summaries.length} of {totalCount} item{totalCount === 1 ? '' : 's'} with vendor pricing · pick one to compare vendors
      </p>

      {summaries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-16 text-center text-gray-500">
          <Package className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <p className="font-medium text-gray-700">No items match your search</p>
          <p className="text-sm">Add a vendor for an item to start comparing prices.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <ul className="divide-y divide-gray-100">
            {summaries.map((s) => (
              <li key={s.catalog_item_id}>
                <button
                  onClick={() => onSelect(s.catalog_item_id)}
                  className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-blue-50/60"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                    {images[s.catalog_item_id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={images[s.catalog_item_id]} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Package className="h-6 w-6 text-gray-300" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-gray-900">
                      {s.item?.name || 'Unknown item'}
                    </div>
                    <div className="truncate text-sm text-gray-500">
                      <span className="font-mono">{s.item?.sku || '—'}</span>
                      {s.preferredVendorName && (
                        <span className="ml-2 inline-flex items-center gap-1 text-yellow-700">
                          <Star className="h-3 w-3 fill-current" />
                          {s.preferredVendorName}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="hidden shrink-0 text-right sm:block">
                    <div className="text-sm font-semibold text-gray-900">
                      {s.vendorCount} vendor{s.vendorCount === 1 ? '' : 's'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {s.bestPrice != null ? `from ${fmtCost(s.bestPrice, 'USD')}` : 'no price yet'}
                    </div>
                  </div>

                  <ChevronRight className="h-5 w-5 shrink-0 text-gray-300" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison — vendors carrying one item, cheapest + fastest highlighted.
// ---------------------------------------------------------------------------
function ComparisonView({
  selectedItem,
  selectedItemId,
  rows,
  cheapestCost,
  fastestLead,
  uomLabels,
  branchLabel,
  fmtCost,
  onBack,
  onAdd,
  onEdit,
  onDelete,
  onTogglePreferred,
}: {
  selectedItem: CatalogItem | null;
  selectedItemId: string;
  rows: EnrichedVendorItem[];
  cheapestCost: number | null;
  fastestLead: number | null;
  uomLabels: Record<string, string>;
  branchLabel: (vendorId: string, addressId: string | null) => string | null;
  fmtCost: (c: number | null, currency: string | null) => string;
  onBack: () => void;
  onAdd: () => void;
  onEdit: (item: VendorItem) => void;
  onDelete: (item: VendorItem) => void;
  onTogglePreferred: (item: EnrichedVendorItem, next: boolean) => void;
}) {
  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" />
        All items
      </button>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{selectedItem?.name || 'Item'}</h2>
          <p className="text-sm text-gray-500">
            <span className="font-mono">{selectedItem?.sku || selectedItemId}</span>
            {' · '}
            {rows.length} vendor{rows.length === 1 ? '' : 's'} carry this item
          </p>
        </div>
        <button
          onClick={onAdd}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Add a vendor
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-16 text-center text-gray-500">
          <Building2 className="mx-auto mb-3 h-12 w-12 text-gray-300" />
          <p className="font-medium text-gray-700">No vendors carry this item yet</p>
          <p className="text-sm">Add a vendor to start tracking its price and lead time.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => {
            const isCheapest = cheapestCost != null && row.unit_cost != null && row.unit_cost === cheapestCost;
            const isFastest = fastestLead != null && row.lead_time_days != null && row.lead_time_days === fastestLead;
            const branch = branchLabel(row.vendor_id, row.vendor_address_id);
            const orderHref = `/inventory/purchasing/create?item_id=${selectedItemId}&vendor=${row.vendor_id}`;

            return (
              <div
                key={row.id}
                className={`flex flex-col rounded-xl border bg-white p-4 shadow-sm transition-shadow hover:shadow-md ${
                  row.is_preferred ? 'border-yellow-300 ring-1 ring-yellow-200' : 'border-gray-200'
                }`}
              >
                {/* Header: vendor + preferred star */}
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/inventory/vendors/${row.vendor_id}`}
                      className="inline-flex items-center gap-1 font-semibold text-gray-900 hover:text-blue-700 hover:underline"
                    >
                      <span className="truncate">{row.vendor?.name || 'Unknown vendor'}</span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-gray-400" />
                    </Link>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                      {row.vendor?.code && <span>{row.vendor.code}</span>}
                      {branch && (
                        <span className="rounded bg-purple-50 px-1.5 py-0.5 text-purple-700">{branch}</span>
                      )}
                    </div>
                  </div>
                  <CapabilityGate capability="vendors.preferred">
                    <button
                      onClick={() => onTogglePreferred(row, !row.is_preferred)}
                      title={row.is_preferred ? 'Preferred vendor — click to unset' : 'Mark as preferred vendor'}
                      className={`shrink-0 rounded-full p-1.5 transition-colors ${
                        row.is_preferred
                          ? 'text-yellow-500 hover:bg-yellow-50'
                          : 'text-gray-300 hover:bg-gray-100 hover:text-gray-400'
                      }`}
                    >
                      <Star className={`h-5 w-5 ${row.is_preferred ? 'fill-current' : ''}`} />
                    </button>
                  </CapabilityGate>
                </div>

                {/* Highlight badges */}
                {(isCheapest || isFastest || row.is_preferred) && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {row.is_preferred && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">
                        <Star className="h-3 w-3 fill-current" />
                        Preferred
                      </span>
                    )}
                    {isCheapest && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        <Award className="h-3 w-3" />
                        Cheapest
                      </span>
                    )}
                    {isFastest && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                        <Zap className="h-3 w-3" />
                        Fastest
                      </span>
                    )}
                  </div>
                )}

                {/* Cost + lead time, the headline numbers */}
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <div className={`rounded-lg px-3 py-2 ${isCheapest ? 'bg-emerald-50' : 'bg-gray-50'}`}>
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <DollarSign className="h-3 w-3" /> Unit cost
                    </div>
                    <div className={`text-lg font-bold ${isCheapest ? 'text-emerald-700' : 'text-gray-900'}`}>
                      {fmtCost(row.unit_cost, row.currency)}
                    </div>
                  </div>
                  <div className={`rounded-lg px-3 py-2 ${isFastest ? 'bg-blue-50' : 'bg-gray-50'}`}>
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Clock className="h-3 w-3" /> Lead time
                    </div>
                    <div className={`text-lg font-bold ${isFastest ? 'text-blue-700' : 'text-gray-900'}`}>
                      {row.lead_time_days != null ? `${row.lead_time_days}d` : '—'}
                    </div>
                  </div>
                </div>

                {/* Secondary detail */}
                <dl className="mb-4 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Vendor SKU</dt>
                    <dd className="font-mono text-gray-900">{row.vendor_sku || '—'}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Pack size</dt>
                    <dd className="text-gray-900">
                      {row.pack_size ?? '—'}
                      {row.vendor_uom_term_id ? ` ${uomLabels[row.vendor_uom_term_id] || ''}` : ''}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Min order qty</dt>
                    <dd className="text-gray-900">{row.min_order_qty ?? '—'}</dd>
                  </div>
                </dl>

                {/* Actions */}
                <div className="mt-auto flex items-center gap-2">
                  <Link
                    href={orderHref}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                  >
                    Order from this vendor
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <button
                    onClick={() => onEdit(row)}
                    title="Edit pricing"
                    className="rounded-lg border border-gray-300 p-2 text-slate-600 hover:bg-gray-50 hover:text-slate-900"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => onDelete(row)}
                    title="Remove this vendor from the item"
                    className="rounded-lg border border-gray-300 p-2 text-red-600 hover:bg-red-50 hover:text-red-800"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / edit a vendor-item link. Same fields as before; item is preselected
// (and locked) when adding from an item's comparison.
// ---------------------------------------------------------------------------
function VendorItemModal({
  editingItem,
  formData,
  setFormData,
  vendors,
  catalogItems,
  uomTerms,
  uomLoading,
  vendorAddresses,
  fetchVendorAddresses,
  lockItem,
  saving,
  onSubmit,
  onClose,
}: {
  editingItem: VendorItem | null;
  formData: typeof EMPTY_FORM;
  setFormData: React.Dispatch<React.SetStateAction<typeof EMPTY_FORM>>;
  vendors: Vendor[];
  catalogItems: CatalogItem[];
  uomTerms: Array<{ term_id: string; label: string }>;
  uomLoading: boolean;
  vendorAddresses: Record<string, VendorAddress[]>;
  fetchVendorAddresses: (vendorId: string) => void;
  lockItem: boolean;
  saving: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white">
        <div className="p-6">
          <h2 className="mb-4 text-xl font-bold">
            {editingItem ? 'Edit vendor pricing' : 'Add a vendor for this item'}
          </h2>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Vendor *</label>
                <select
                  required
                  disabled={!!editingItem}
                  value={formData.vendor_id}
                  onChange={(e) => {
                    setFormData((f) => ({ ...f, vendor_id: e.target.value, vendor_address_id: '' }));
                    fetchVendorAddresses(e.target.value);
                  }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                >
                  <option value="">Select vendor...</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                  ))}
                </select>
                {formData.vendor_id && (vendorAddresses[formData.vendor_id]?.length ?? 0) > 0 && (
                  <>
                    <label className="mb-1 mt-2 block text-sm font-medium text-gray-700">Branch / Plant</label>
                    <select
                      value={formData.vendor_address_id}
                      onChange={(e) => setFormData((f) => ({ ...f, vendor_address_id: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">All locations (company default)</option>
                      {(vendorAddresses[formData.vendor_id] || []).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label?.split(' (')[0] || [a.city, a.state].filter(Boolean).join(', ') || a.id}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-gray-400">
                      Pick a branch to price this item for that location only — it overrides the company default.
                    </p>
                  </>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Catalog Item *</label>
                <select
                  required
                  disabled={!!editingItem || lockItem}
                  value={formData.catalog_item_id}
                  onChange={(e) => setFormData((f) => ({ ...f, catalog_item_id: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                >
                  <option value="">Select item...</option>
                  {catalogItems.map((item) => (
                    <option key={item.id} value={item.id}>{item.sku} - {item.name}</option>
                  ))}
                </select>
                {lockItem && !editingItem && (
                  <p className="mt-1 text-xs text-gray-400">Adding a vendor for the item you&apos;re comparing.</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Vendor SKU *</label>
                <input
                  type="text"
                  required
                  value={formData.vendor_sku}
                  onChange={(e) => setFormData((f) => ({ ...f, vendor_sku: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Vendor UOM</label>
                <select
                  value={formData.vendor_uom_term_id}
                  onChange={(e) => setFormData((f) => ({ ...f, vendor_uom_term_id: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select UOM...</option>
                  {uomLoading ? (
                    <option disabled>Loading...</option>
                  ) : (
                    uomTerms.map((t) => (
                      <option key={t.term_id} value={t.term_id}>{t.label}</option>
                    ))
                  )}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Pack Size</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.pack_size}
                  onChange={(e) => setFormData((f) => ({ ...f, pack_size: parseFloat(e.target.value) || 1 }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Unit Cost</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.unit_cost}
                  onChange={(e) => setFormData((f) => ({ ...f, unit_cost: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Currency</label>
                <select
                  value={formData.currency}
                  onChange={(e) => setFormData((f) => ({ ...f, currency: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                >
                  <option value="USD">USD</option>
                  <option value="CAD">CAD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Lead Time (days)</label>
                <input
                  type="number"
                  value={formData.lead_time_days}
                  onChange={(e) => setFormData((f) => ({ ...f, lead_time_days: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Minimum Order Qty</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.min_order_qty}
                  onChange={(e) => setFormData((f) => ({ ...f, min_order_qty: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <CapabilityGate capability="vendors.preferred">
              <div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_preferred}
                    onChange={(e) => setFormData((f) => ({ ...f, is_preferred: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="flex items-center gap-1 text-sm font-medium text-gray-700">
                    <Star className="h-4 w-4" />
                    Preferred Vendor for this Item
                  </span>
                </label>
              </div>
            </CapabilityGate>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData((f) => ({ ...f, notes: e.target.value }))}
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : editingItem ? 'Update' : 'Add vendor'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function VendorItemsPage() {
  return (
    <Suspense fallback={
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading vendor items...</div>
        </div>
      </AppShell>
    }>
      <VendorItemsPageInner />
    </Suspense>
  );
}
