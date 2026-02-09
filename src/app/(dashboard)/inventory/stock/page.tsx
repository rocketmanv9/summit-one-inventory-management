'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { createBrowserAuthedClient } from '@/supabase/client';

interface StockBalance {
  id: string;
  catalog_item_id: string;
  item_name?: string;
  item_sku?: string;
  location_id: string;
  location_name?: string;
  on_hand_qty: number;
  reserved_qty: number;
  available_qty: number;
  qty_on_order?: number;
  inventory_position?: number;
  reorder_point?: number;
  catalog_items?: { id: string; name: string; sku: string; unit_of_measure: string };
  locations?: { id: string; name: string; location_type: string };
}

export default function StockBalancesPage() {
  const [stock, setStock] = useState<StockBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selectedItem, setSelectedItem] = useState<StockBalance | null>(null);
  const [ledgerData, setLedgerData] = useState<any[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustForm, setAdjustForm] = useState({
    catalog_item_id: '',
    location_id: '',
    new_qty: '',
    reason: 'count_variance',
    notes: '',
  });
  const [adjustError, setAdjustError] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [adjustItems, setAdjustItems] = useState<Array<{ id: string; name: string; sku: string }>>([]);
  const [adjustLocations, setAdjustLocations] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    fetchStock();
  }, [filters]);

  useEffect(() => {
    if (!showAdjustModal) return;
    if (adjustItems.length > 0 && adjustLocations.length > 0) return;

    const loadAdjustLookups = async () => {
      try {
        const [items, locations] = await Promise.all([
          InventoryRPC.getCatalogItems({ active: true }),
          InventoryRPC.getLocations({ active: true }),
        ]);
        setAdjustItems((items || []).map((item) => ({
          id: item.id,
          name: item.name,
          sku: item.sku,
        })));
        setAdjustLocations((locations || []).map((loc) => ({
          id: loc.id,
          name: loc.name,
        })));
      } catch (error) {
        console.error('Error loading adjust lookups:', error);
      }
    };

    loadAdjustLookups();
  }, [showAdjustModal, adjustItems.length, adjustLocations.length]);

  const fetchStock = async () => {
    setLoading(true);
    try {
      const data = await InventoryRPC.getStockBalances({
        location_id: filters.location_id,
      });

      const normalized = (data || []).map((row: any) => {
        const reorderPoint = row.reorder_point ?? row.catalog_items?.reorder_point ?? null;
        return {
          ...row,
          item_name: row.item_name ?? row.catalog_items?.name,
          item_sku: row.item_sku ?? row.catalog_items?.sku,
          location_name: row.location_name ?? row.locations?.name,
          on_hand_qty: row.on_hand_qty ?? row.qty_on_hand ?? 0,
          reserved_qty: row.reserved_qty ?? row.qty_reserved ?? 0,
          available_qty: row.available_qty ?? row.qty_available ?? 0,
          reorder_point: reorderPoint,
        } as StockBalance;
      });

      const filtered = filters.below_reorder === 'true'
        ? normalized.filter((row) =>
            row.reorder_point !== null && row.on_hand_qty <= (row.reorder_point ?? 0)
          )
        : normalized;

      setStock(filtered);
    } catch (error) {
      console.error('Error fetching stock:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchLedger = async (itemId: string, locationId: string) => {
    setLedgerLoading(true);
    try {
      const supabase = createBrowserAuthedClient().schema('inventory');
      const { data, error } = await supabase
        .from('stock_movements')
        .select('movement_type, quantity_delta, occurred_at')
        .eq('catalog_item_id', itemId)
        .eq('location_id', locationId)
        .order('occurred_at', { ascending: false })
        .limit(20);

      if (error) {
        throw error;
      }

      const normalized = (data || []).map((movement: any) => ({
        movement_type: movement.movement_type,
        qty: movement.quantity_delta,
        created_at: movement.occurred_at,
      }));

      setLedgerData(normalized);
    } catch (error) {
      console.error('Error fetching ledger:', error);
    } finally {
      setLedgerLoading(false);
    }
  };

  const handleRowClick = (item: StockBalance) => {
    setSelectedItem(item);
    const itemId = item.catalog_item_id || item.catalog_items?.id;
    const locationId = item.location_id || item.locations?.id;
    if (itemId && locationId) {
      fetchLedger(itemId, locationId);
    }
  };

  const openAdjustModal = (prefill?: StockBalance | null) => {
    setAdjustError('');
    if (prefill) {
      const itemId = prefill.catalog_item_id || prefill.catalog_items?.id || '';
      const locationId = prefill.location_id || prefill.locations?.id || '';
      setAdjustForm({
        catalog_item_id: itemId,
        location_id: locationId,
        new_qty: prefill.on_hand_qty?.toString() ?? '',
        reason: 'count_variance',
        notes: '',
      });
    } else {
      setAdjustForm({
        catalog_item_id: '',
        location_id: '',
        new_qty: '',
        reason: 'count_variance',
        notes: '',
      });
    }
    setShowAdjustModal(true);
  };

  const submitAdjustment = async () => {
    setAdjustError('');
    if (!adjustForm.catalog_item_id || !adjustForm.location_id) {
      setAdjustError('Select an item and location.');
      return;
    }
    const qty = Number(adjustForm.new_qty);
    if (!Number.isFinite(qty)) {
      setAdjustError('Enter a valid quantity.');
      return;
    }

    setAdjustSaving(true);
    try {
      await InventoryRPC.adjustInventory({
        catalog_item_id: adjustForm.catalog_item_id,
        location_id: adjustForm.location_id,
        new_qty: qty,
        reason: adjustForm.reason as 'count_variance' | 'damage' | 'theft' | 'expiration' | 'other',
        notes: adjustForm.notes,
      });
      setShowAdjustModal(false);
      await fetchStock();
      setSelectedItem(null);
    } catch (error: any) {
      setAdjustError(error?.message || 'Failed to adjust inventory.');
    } finally {
      setAdjustSaving(false);
    }
  };

  const columns = [
    {
      key: 'item',
      header: 'Item',
      sortable: true,
      render: (row: StockBalance) => (
        <div>
          <div className="font-medium">{row.item_name || row.catalog_items?.name || '-'}</div>
          <div className="text-xs text-muted-foreground">{row.item_sku || row.catalog_items?.sku || '-'}</div>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      sortable: true,
      render: (row: StockBalance) => (
        <div>
          <div>{row.location_name || row.locations?.name || '-'}</div>
          <div className="text-xs text-muted-foreground capitalize">
            {row.locations?.location_type?.replace('_', ' ') || ''}
          </div>
        </div>
      ),
    },
    {
      key: 'on_hand_qty',
      header: 'On Hand',
      sortable: true,
      className: 'text-right font-mono',
      render: (row: StockBalance) => (
        <span className={row.on_hand_qty <= 0 ? 'text-red-600 font-semibold' : ''}>
          {row.on_hand_qty?.toLocaleString() ?? 0}
        </span>
      ),
    },
    {
      key: 'reserved_qty',
      header: 'Reserved',
      sortable: true,
      className: 'text-right font-mono',
      render: (row: StockBalance) => row.reserved_qty?.toLocaleString() ?? 0,
    },
    {
      key: 'available_qty',
      header: 'Available',
      sortable: true,
      className: 'text-right font-mono',
      render: (row: StockBalance) => (
        <span className={row.available_qty <= 0 ? 'text-red-600 font-semibold' : 'text-green-600'}>
          {row.available_qty?.toLocaleString() ?? 0}
        </span>
      ),
    },
    {
      key: 'qty_on_order',
      header: 'On Order',
      sortable: true,
      className: 'text-right font-mono text-blue-600',
      render: (row: StockBalance) => (
        <span title="Quantity on open purchase orders not yet received">
          {row.qty_on_order?.toLocaleString() ?? 0}
        </span>
      ),
    },
    {
      key: 'inventory_position',
      header: 'Position',
      sortable: true,
      className: 'text-right font-mono font-semibold',
      render: (row: StockBalance) => {
        const position = row.inventory_position ?? 0;
        return (
          <span 
            className={position <= 0 ? 'text-red-600' : position > 10 ? 'text-green-600' : 'text-yellow-600'}
            title="On Hand - Reserved + On Order (total expected available)"
          >
            {position.toLocaleString()}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: StockBalance) => {
        if (row.on_hand_qty <= 0) return <StatusChip status="Stockout" />;
        if (row.reorder_point && row.on_hand_qty <= row.reorder_point) return <StatusChip status="Low Stock" />;
        return <StatusChip status="In Stock" />;
      },
    },
  ];

  const filterConfig = [
    {
      key: 'below_reorder',
      label: 'Show',
      type: 'select' as const,
      options: [
        { value: 'true', label: 'Below Reorder Only' },
      ],
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Stock Balances"
          description="View current inventory levels by item and location. Example: See how many tons of asphalt mix you have at the main yard vs. Job Site #234, or track rebar quantities across all truck inventories."
          actions={
            <div className="flex gap-2">
              <button
                onClick={() => openAdjustModal(null)}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Add Starting Stock
              </button>
              <button
                onClick={fetchStock}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                Refresh
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={selectedItem ? 'lg:col-span-2' : 'lg:col-span-3'}>
            <DataTable
              data={stock}
              columns={columns}
              loading={loading}
              emptyMessage="No stock balances found"
              rowKey={(row) => `${row.catalog_item_id || row.id}-${row.location_id}`}
              onRowClick={handleRowClick}
            />
          </div>

          {selectedItem && (
            <div className="lg:col-span-1">
              <div className="rounded-lg border bg-card p-4 sticky top-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold">Stock Details</h3>
                  <button
                    onClick={() => setSelectedItem(null)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Item</div>
                    <div className="font-medium">
                      {selectedItem.item_name || selectedItem.catalog_items?.name}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {selectedItem.item_sku || selectedItem.catalog_items?.sku}
                    </div>
                  </div>

                  <div>
                    <div className="text-sm text-muted-foreground">Location</div>
                    <div className="font-medium">
                      {selectedItem.location_name || selectedItem.locations?.name}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold">{selectedItem.on_hand_qty}</div>
                      <div className="text-xs text-muted-foreground">On Hand</div>
                    </div>
                    <div className="p-3 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold text-green-600">{selectedItem.available_qty}</div>
                      <div className="text-xs text-muted-foreground">Available</div>
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <h4 className="font-medium mb-2">Quick Actions</h4>
                    <div className="grid grid-cols-2 gap-2">
                      <button className="px-3 py-2 text-sm bg-blue-100 text-blue-800 rounded hover:bg-blue-200 transition-colors">
                        Reserve
                      </button>
                      <button className="px-3 py-2 text-sm bg-purple-100 text-purple-800 rounded hover:bg-purple-200 transition-colors">
                        Transfer
                      </button>
                      <button
                        onClick={() => openAdjustModal(selectedItem)}
                        className="px-3 py-2 text-sm bg-orange-100 text-orange-800 rounded hover:bg-orange-200 transition-colors"
                      >
                        Adjust
                      </button>
                      <button className="px-3 py-2 text-sm bg-gray-100 text-gray-800 rounded hover:bg-gray-200 transition-colors">
                        Count
                      </button>
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <h4 className="font-medium mb-2">Recent Activity</h4>
                    {ledgerLoading ? (
                      <div className="animate-pulse space-y-2">
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="h-12 bg-gray-200 rounded" />
                        ))}
                      </div>
                    ) : ledgerData.length > 0 ? (
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {ledgerData.slice(0, 10).map((movement: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between p-2 bg-muted/30 rounded text-sm">
                            <div>
                              <div className="font-medium capitalize">{movement.movement_type}</div>
                              <div className="text-xs text-muted-foreground">
                                {new Date(movement.created_at).toLocaleDateString()}
                              </div>
                            </div>
                            <div className={`font-mono ${movement.qty >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {movement.qty >= 0 ? '+' : ''}{movement.qty}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No recent activity</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {showAdjustModal && (
        <AdjustStockModal
          form={adjustForm}
          items={adjustItems}
          locations={adjustLocations}
          saving={adjustSaving}
          error={adjustError}
          onClose={() => setShowAdjustModal(false)}
          onChange={(next) => setAdjustForm((prev) => ({ ...prev, ...next }))}
          onSubmit={submitAdjustment}
        />
      )}
    </AppShell>
  );
}

function AdjustStockModal({
  form,
  items,
  locations,
  saving,
  error,
  onClose,
  onChange,
  onSubmit,
}: {
  form: {
    catalog_item_id: string;
    location_id: string;
    new_qty: string;
    reason: string;
    notes: string;
  };
  items: Array<{ id: string; name: string; sku: string }>;
  locations: Array<{ id: string; name: string }>;
  saving: boolean;
  error: string;
  onClose: () => void;
  onChange: (next: Partial<typeof form>) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Add Starting Stock</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        {error && (
          <div className="mb-3 text-sm text-red-600">{error}</div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Item</label>
            <select
              value={form.catalog_item_id}
              onChange={(e) => onChange({ catalog_item_id: e.target.value })}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="">Select item...</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.sku})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Location</label>
            <select
              value={form.location_id}
              onChange={(e) => onChange({ location_id: e.target.value })}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="">Select location...</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">On Hand Quantity</label>
            <input
              type="number"
              min="0"
              value={form.new_qty}
              onChange={(e) => onChange({ new_qty: e.target.value })}
              className="w-full px-3 py-2 border rounded-md"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Reason</label>
            <select
              value={form.reason}
              onChange={(e) => onChange({ reason: e.target.value })}
              className="w-full px-3 py-2 border rounded-md"
            >
              <option value="count_variance">Initial count</option>
              <option value="damage">Damage</option>
              <option value="theft">Theft</option>
              <option value="expiration">Expiration</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
              className="w-full px-3 py-2 border rounded-md"
              rows={3}
            />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
