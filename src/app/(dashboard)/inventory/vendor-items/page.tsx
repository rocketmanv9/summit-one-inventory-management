'use client';

import { AppError } from '@rocketmanv9/chassis/errors';

import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, Star, Package, DollarSign, Building2 } from 'lucide-react';
import { HowItWorksCard, HowThisWorksButton, useHowItWorks } from '@/components/ui/HowItWorksCard';
import { AppShell } from '@/components/layout/AppShell';
import { CapabilityGate } from '@/components/access/CapabilityGate';
import { PageHeader } from '@/components/ui/PageHeader';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { useUOMLabelMap, useUOMTerms } from '@/hooks/useGVTerms';

type Vendor = {
  id: string;
  name: string;
  code: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  payment_terms?: string | null;
  lead_time_days?: number | null;
  notes?: string | null;
  active?: boolean | null;
  created_at?: string;
  last_event_id?: string | null;
};

type CatalogItem = {
  id: string;
  name: string;
  sku: string;
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
  catalog_item?: CatalogItem | null;
};

export default function VendorItemsPage() {
  const help = useHowItWorks('inventory-vendor-items-help');
  const uomLabels = useUOMLabelMap();
  const { terms: uomTerms, loading: uomLoading } = useUOMTerms();
  const [vendorItems, setVendorItems] = useState<VendorItem[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<VendorItem | null>(null);
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [priceItemId, setPriceItemId] = useState('');
  const [priceValue, setPriceValue] = useState('');
  const [priceRowIds, setPriceRowIds] = useState<Set<string>>(new Set());
  const [priceSaving, setPriceSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterVendor, setFilterVendor] = useState('');
  const [filterPreferred, setFilterPreferred] = useState<boolean | null>(null);

  // Addresses per vendor, fetched lazily — used for the branch dropdown and to
  // label branch-override rows in the table and price modal.
  const [vendorAddresses, setVendorAddresses] = useState<Record<string, VendorAddress[]>>({});

  const fetchVendorAddresses = async (vendorId: string) => {
    if (!vendorId || vendorAddresses[vendorId]) return;
    try {
      const res = await fetch(`/api/inventory/vendors/${vendorId}/addresses`);
      if (!res.ok) return;
      const json = await res.json();
      setVendorAddresses((prev) => ({ ...prev, [vendorId]: json.data || [] }));
    } catch {
      /* branch labels degrade gracefully */
    }
  };

  // Load addresses for any vendor that has branch-priced rows so labels render.
  useEffect(() => {
    const vendorIds = [...new Set(vendorItems.filter((vi) => vi.vendor_address_id).map((vi) => vi.vendor_id))];
    vendorIds.forEach((vid) => { void fetchVendorAddresses(vid); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorItems]);

  const branchLabel = (vendorId: string, addressId: string | null) => {
    if (!addressId) return null;
    const addr = (vendorAddresses[vendorId] || []).find((a) => a.id === addressId);
    if (!addr) return 'Branch';
    return addr.label?.split(' (')[0] || [addr.city, addr.state].filter(Boolean).join(', ') || 'Branch';
  };

  const [formData, setFormData] = useState({
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
  });

  useEffect(() => {
    fetchVendorItems();
    fetchVendors();
    fetchCatalogItems();
  }, []);

  const fetchVendorItems = async () => {
    try {
      const data = await SupplyChainRPC.getVendorItems();
      setVendorItems((data || []) as any);
    } catch (error) {
      console.error('Error fetching vendor items:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchVendors = async () => {
    try {
      const data = await SupplyChainRPC.getVendors();
      setVendors(data || []);
    } catch (error) {
      console.error('Error fetching vendors:', error);
    }
  };

  const fetchCatalogItems = async () => {
    try {
      const data = await InventoryRPC.getCatalogItems();
      setCatalogItems(data || []);
    } catch (error) {
      console.error('Error fetching catalog items:', error);
    }
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

    try {
      if (editingItem) {
        if (!editingItem.last_event_id) {
          throw AppError.badRequest('Missing last_event_id for this vendor item. Please refresh and try again.');
        }

        await SupplyChainRPC.updateVendorItem(editingItem.id, payload, editingItem.last_event_id);
      } else {
        await SupplyChainRPC.createVendorItem({
          ...payload,
          last_event_id: crypto.randomUUID(),
        });
      }

      await fetchVendorItems();
      handleCloseModal();
    } catch (error) {
      console.error('Error saving vendor item:', error);
      alert(error instanceof Error ? error.message : 'Failed to save vendor item');
    }
  };

  const handleEdit = (item: VendorItem) => {
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

  const handleDelete = async (item: VendorItem) => {
    if (!confirm('Are you sure you want to delete this vendor item mapping?')) return;

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

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingItem(null);
    setFormData({
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
    });
  };

  // Rows for the bulk price modal: every vendor carrying the selected material
  const priceRows = vendorItems.filter((vi) => vi.catalog_item_id === priceItemId);

  const handleSelectPriceItem = (catalogItemId: string) => {
    setPriceItemId(catalogItemId);
    const rows = vendorItems.filter((vi) => vi.catalog_item_id === catalogItemId);
    setPriceRowIds(new Set(rows.map((r) => r.id)));
    // Prefill with the most common current price so "same price everywhere" is one keystroke away
    const costs = rows.map((r) => r.unit_cost).filter((c): c is number => c != null);
    setPriceValue(costs.length ? String(costs.sort((a, b) => a - b)[Math.floor(costs.length / 2)]) : '');
  };

  const handleBulkPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    const cost = parseFloat(priceValue);
    if (!priceItemId || isNaN(cost) || cost < 0 || priceRowIds.size === 0) return;
    setPriceSaving(true);
    try {
      const allSelected = priceRows.every((r) => priceRowIds.has(r.id));
      await SupplyChainRPC.bulkUpdateVendorItemPrice(
        priceItemId, cost, allSelected ? undefined : [...priceRowIds]
      );
      await fetchVendorItems();
      setShowPriceModal(false);
      setPriceItemId('');
      setPriceValue('');
      setPriceRowIds(new Set());
    } catch (error) {
      console.error('Error updating material pricing:', error);
      alert(error instanceof Error ? error.message : 'Failed to update pricing');
    } finally {
      setPriceSaving(false);
    }
  };

  const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
  const catalogMap = new Map(catalogItems.map((item) => [item.id, item]));

  // Only materials that actually have vendor mappings belong in the price dropdown
  const mappedItemIds = new Set(vendorItems.map((vi) => vi.catalog_item_id));
  const priceableItems = catalogItems.filter((ci) => mappedItemIds.has(ci.id));

  const enrichedVendorItems: EnrichedVendorItem[] = vendorItems.map((item) => ({
    ...item,
    vendor: vendorMap.get(item.vendor_id) || null,
    catalog_item: catalogMap.get(item.catalog_item_id) || null,
  }));

  const filteredVendorItems = enrichedVendorItems.filter((item) => {
    const matchesSearch =
      !searchTerm ||
      item.catalog_item?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.catalog_item?.sku?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.vendor?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.vendor_sku.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesVendor = !filterVendor || item.vendor_id === filterVendor;
    const matchesPreferred = filterPreferred === null || item.is_preferred === filterPreferred;

    return matchesSearch && matchesVendor && matchesPreferred;
  });

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
          description="Manage vendor catalog mappings and pricing. Links your existing catalog items to vendors with vendor-specific SKUs, costs, lead times, and preferred vendor status. Items must exist in your catalog before creating vendor mappings."
          actions={!help.show ? <HowThisWorksButton onClick={help.open} /> : undefined}
        />
      </div>

      {help.show && (
        <div className="mb-6">
          <HowItWorksCard
            title="How vendor items work"
            onDismiss={help.dismiss}
            steps={[
              { title: 'Map an item to a vendor', body: 'Link one of your catalog items to a vendor that sells it, recording their SKU, unit of measure, and pack size. The item must already exist in your catalog.' },
              { title: 'Price the mapping', body: 'Set the unit cost, currency, lead time, and minimum order quantity. Optionally pick a branch/plant so the price applies to that vendor location only, overriding the company-wide default.' },
              { title: 'Mark a preferred vendor', body: 'Star one vendor per item as preferred — it becomes the go-to source when building purchase orders and reorder suggestions.' },
              { title: 'Keep prices current', body: '"Update Pricing" changes one material across every vendor that carries it in a single pass — uncheck vendors that quoted differently and update them separately.' },
            ]}
            legendTitle="Badges"
            legend={[
              { badge: <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-yellow-800 bg-yellow-100 rounded-full"><Star className="w-3 h-3 fill-current" />Preferred</span>, text: 'the default vendor for this item when ordering' },
              { badge: <span className="text-xs text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">Branch</span>, text: 'a branch-specific price — untagged rows are the company-wide default' },
            ]}
            glossary={[
              { Icon: Package, term: 'Vendor SKU', blurb: 'the vendor’s own part number for your catalog item — printed on POs so they recognize the order' },
              { Icon: Building2, term: 'Branch price', blurb: 'a price scoped to one vendor address (plant/store); it wins over the company default when ordering from that branch' },
              { Icon: DollarSign, term: 'Lead time', blurb: 'days from order to delivery for this vendor+item — feeds reorder timing and PO expected dates' },
            ]}
          />
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 flex flex-wrap gap-4">
        <input
          type="text"
          placeholder="Search by item, SKU, or vendor..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent flex-1 min-w-[200px]"
        />
        
        <select
          value={filterVendor}
          onChange={(e) => setFilterVendor(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">All Vendors</option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.name}
            </option>
          ))}
        </select>

        <select
          value={filterPreferred === null ? '' : filterPreferred.toString()}
          onChange={(e) =>
            setFilterPreferred(e.target.value === '' ? null : e.target.value === 'true')
          }
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="">All Items</option>
          <option value="true">Preferred Only</option>
          <option value="false">Non-Preferred</option>
        </select>

        <button
          onClick={() => setShowPriceModal(true)}
          className="px-4 py-2 border border-emerald-600 text-emerald-700 rounded-lg hover:bg-emerald-50 flex items-center gap-2"
        >
          <DollarSign className="w-4 h-4" />
          Update Pricing
        </button>

        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Vendor Item
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Catalog Item
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Vendor
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Vendor SKU
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Unit Cost
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Lead Time
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredVendorItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                  <Package className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                  <p>No vendor items found</p>
                  <p className="text-sm">Add vendor items to manage supplier catalogs and pricing</p>
                </td>
              </tr>
            ) : (
              filteredVendorItems.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {item.catalog_item?.name}
                    </div>
                    <div className="text-sm text-gray-500">{item.catalog_item?.sku}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {item.vendor?.name}
                      {item.vendor_address_id && (
                        <span className="ml-2 text-xs text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">
                          {branchLabel(item.vendor_id, item.vendor_address_id)}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500">{item.vendor?.code}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{item.vendor_sku}</div>
                    {item.vendor_uom_term_id && (
                      <div className="text-sm text-gray-500">
                        {item.pack_size} {uomLabels[item.vendor_uom_term_id] || item.vendor_uom_term_id}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {item.unit_cost ? (
                      <div className="text-sm text-gray-900">
                        ${item.unit_cost.toFixed(2)} {item.currency}
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {item.lead_time_days ? `${item.lead_time_days} days` : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {item.is_preferred && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-yellow-800 bg-yellow-100 rounded-full">
                        <Star className="w-3 h-3 fill-current" />
                        Preferred
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleEdit(item)}
                      className="text-slate-600 hover:text-slate-900 mr-3"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(item)}
                      className="text-red-600 hover:text-red-900"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Bulk price update modal */}
      {showPriceModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-xl font-bold mb-1">Update Material Pricing</h2>
              <p className="text-sm text-gray-500 mb-4">
                Set one price for a material across every vendor that carries it, or uncheck
                vendors that quoted differently and update them separately.
              </p>

              <form onSubmit={handleBulkPrice} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Material *</label>
                  <select
                    required
                    value={priceItemId}
                    onChange={(e) => handleSelectPriceItem(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="">Select material...</option>
                    {priceableItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.sku} - {item.name}
                      </option>
                    ))}
                  </select>
                </div>

                {priceItemId && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        New Unit Cost *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        required
                        value={priceValue}
                        onChange={(e) => setPriceValue(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-sm font-medium text-gray-700">
                          Apply to {priceRowIds.size} of {priceRows.length} prices
                        </label>
                        <button
                          type="button"
                          className="text-xs text-blue-600 hover:underline"
                          onClick={() =>
                            setPriceRowIds(
                              priceRowIds.size === priceRows.length
                                ? new Set()
                                : new Set(priceRows.map((r) => r.id))
                            )
                          }
                        >
                          {priceRowIds.size === priceRows.length ? 'Clear all' : 'Select all'}
                        </button>
                      </div>
                      <div className="border border-gray-200 rounded-lg divide-y max-h-64 overflow-y-auto">
                        {priceRows.map((row) => (
                          <label
                            key={row.id}
                            className="flex items-center justify-between px-3 py-2 text-sm cursor-pointer hover:bg-gray-50"
                          >
                            <span className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={priceRowIds.has(row.id)}
                                onChange={(e) => {
                                  const next = new Set(priceRowIds);
                                  if (e.target.checked) next.add(row.id);
                                  else next.delete(row.id);
                                  setPriceRowIds(next);
                                }}
                                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                              />
                              <span>
                                {vendorMap.get(row.vendor_id)?.name || row.vendor_id}
                                {row.vendor_address_id && (
                                  <span className="ml-1 text-xs text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">
                                    {branchLabel(row.vendor_id, row.vendor_address_id)}
                                  </span>
                                )}
                              </span>
                            </span>
                            <span className="text-gray-500">
                              {row.unit_cost != null ? `$${row.unit_cost.toFixed(2)}` : '—'}
                            </span>
                          </label>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-gray-400">
                        Purple tags are branch-specific prices; untagged rows are the vendor&apos;s company-wide default.
                      </p>
                    </div>
                  </>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowPriceModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={priceSaving || !priceItemId || priceRowIds.size === 0}
                    className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {priceSaving ? 'Updating…' : `Update ${priceRowIds.size} price${priceRowIds.size === 1 ? '' : 's'}`}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <h2 className="text-xl font-bold mb-4">
                {editingItem ? 'Edit Vendor Item' : 'Add Vendor Item'}
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Vendor *
                    </label>
                    <select
                      required
                      disabled={!!editingItem}
                      value={formData.vendor_id}
                      onChange={(e) => {
                        setFormData({ ...formData, vendor_id: e.target.value, vendor_address_id: '' });
                        void fetchVendorAddresses(e.target.value);
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
                    >
                      <option value="">Select vendor...</option>
                      {vendors.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>
                          {vendor.name}
                        </option>
                      ))}
                    </select>
                    {formData.vendor_id && (vendorAddresses[formData.vendor_id]?.length ?? 0) > 0 && (
                      <>
                        <label className="block text-sm font-medium text-gray-700 mb-1 mt-2">
                          Branch / Plant
                        </label>
                        <select
                          value={formData.vendor_address_id}
                          onChange={(e) =>
                            setFormData({ ...formData, vendor_address_id: e.target.value })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Catalog Item *
                    </label>
                    <select
                      required
                      disabled={!!editingItem}
                      value={formData.catalog_item_id}
                      onChange={(e) =>
                        setFormData({ ...formData, catalog_item_id: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
                    >
                      <option value="">Select item...</option>
                      {catalogItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.sku} - {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Vendor SKU *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.vendor_sku}
                      onChange={(e) =>
                        setFormData({ ...formData, vendor_sku: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Vendor UOM
                    </label>
                    <select
                      value={formData.vendor_uom_term_id}
                      onChange={(e) =>
                        setFormData({ ...formData, vendor_uom_term_id: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Pack Size
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.pack_size}
                      onChange={(e) =>
                        setFormData({ ...formData, pack_size: parseFloat(e.target.value) || 1 })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Unit Cost
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.unit_cost}
                      onChange={(e) =>
                        setFormData({ ...formData, unit_cost: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Currency
                    </label>
                    <select
                      value={formData.currency}
                      onChange={(e) =>
                        setFormData({ ...formData, currency: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Lead Time (days)
                    </label>
                    <input
                      type="number"
                      value={formData.lead_time_days}
                      onChange={(e) =>
                        setFormData({ ...formData, lead_time_days: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Minimum Order Qty
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.min_order_qty}
                      onChange={(e) =>
                        setFormData({ ...formData, min_order_qty: e.target.value })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>

                <CapabilityGate capability="vendors.preferred">
                  <div>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formData.is_preferred}
                        onChange={(e) =>
                          setFormData({ ...formData, is_preferred: e.target.checked })
                        }
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700 flex items-center gap-1">
                        <Star className="w-4 h-4" />
                        Preferred Vendor for this Item
                      </span>
                    </label>
                  </div>
                </CapabilityGate>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) =>
                      setFormData({ ...formData, notes: e.target.value })
                    }
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    {editingItem ? 'Update' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
    </AppShell>
  );
}
