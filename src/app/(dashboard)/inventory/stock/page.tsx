'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { createBrowserAuthedClient } from '@/supabase/client';
import { AdjustStockModal } from '@/components/inventory/AdjustStockModal';

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
  catalog_items?: { id: string; name: string; sku: string; uom_term_id: string };
  locations?: { id: string; name: string; location_type: string };
}

export default function StockBalancesPage() {
  const [stock, setStock] = useState<StockBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selectedItem, setSelectedItem] = useState<StockBalance | null>(null);
  const [ledgerData, setLedgerData] = useState<any[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState(false);
  const [filterLocations, setFilterLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustForm, setAdjustForm] = useState({
    catalog_item_id: '',
    // When the chosen item is a variant parent, the adjustment targets a specific
    // child (size/color). variant_item_id holds that resolved child id; for plain
    // items it stays empty and we adjust catalog_item_id directly.
    variant_item_id: '',
    location_id: '',
    new_qty: '',
    reason: '',
    notes: '',
    override_reason: '',
  });
  const [adjustError, setAdjustError] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [guardrailBlock, setGuardrailBlock] = useState<{
    code: string;
    message: string;
    details?: Record<string, any>;
    action?: string;
  } | null>(null);
  const [adjustItems, setAdjustItems] = useState<Array<{
    id: string;
    name: string;
    sku: string;
    is_parent?: boolean;
    variant_dimensions?: string[] | null;
    variant_options?: Record<string, string[]> | null;
  }>>([]);
  const [adjustLocations, setAdjustLocations] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    fetchStock();
  }, [filters]);

  useEffect(() => {
    const loadFilterLocations = async () => {
      try {
        const locations = await InventoryRPC.getLocations({ active: true });
        setFilterLocations((locations || []).map((loc) => ({ id: loc.id, name: loc.name })));
      } catch (error) {
        console.error('Error loading locations:', error);
      }
    };

    loadFilterLocations();
  }, []);

  useEffect(() => {
    if (!showAdjustModal) return;
    if (adjustItems.length > 0 && adjustLocations.length > 0) return;

    const loadAdjustLookups = async () => {
      try {
        const [items, locations] = await Promise.all([
          InventoryRPC.getCatalogItems({ active: true, tracking_mode: 'stock' }),
          InventoryRPC.getLocations({ active: true }),
        ]);
        setAdjustItems((items || []).map((item: any) => ({
          id: item.id,
          name: item.name,
          sku: item.sku,
          is_parent: item.is_parent ?? false,
          variant_dimensions: item.variant_dimensions ?? null,
          variant_options: item.variant_options ?? null,
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
    setLedgerError(false);
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
      setLedgerData([]);
      setLedgerError(true);
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
        variant_item_id: '',
        location_id: locationId,
        new_qty: prefill.on_hand_qty?.toString() ?? '',
        // Brand-new/zero balance â†’ default to Initial count; otherwise make the
        // user pick a reason explicitly.
        reason: Number(prefill.on_hand_qty ?? 0) <= 0 ? 'count_variance' : '',
        notes: '',
        override_reason: '',
      });
    } else {
      setAdjustForm({
        catalog_item_id: '',
        variant_item_id: '',
        location_id: '',
        new_qty: '',
        reason: '',
        notes: '',
        override_reason: '',
      });
    }
    setGuardrailBlock(null);
    setShowAdjustModal(true);
  };

  const submitAdjustment = async () => {
    setAdjustError('');
    setGuardrailBlock(null);
    if (!adjustForm.catalog_item_id || !adjustForm.location_id) {
      setAdjustError('Select an item and location.');
      return;
    }
    // A parent (variant) item can't hold stock itself â€” the user must pick which
    // variant (size/color) they're adjusting, and we target that child's balance.
    const selected = adjustItems.find((i) => i.id === adjustForm.catalog_item_id);
    const targetItemId = selected?.is_parent ? adjustForm.variant_item_id : adjustForm.catalog_item_id;
    if (selected?.is_parent && !targetItemId) {
      setAdjustError('Select which variant to adjust.');
      return;
    }
    const qty = Number(adjustForm.new_qty);
    if (!Number.isFinite(qty)) {
      setAdjustError('Enter a valid quantity.');
      return;
    }
    if (!adjustForm.reason) {
      setAdjustError('Select a reason for this adjustment.');
      return;
    }

    setAdjustSaving(true);
    try {
      const result = await InventoryRPC.adjustInventory({
        catalog_item_id: targetItemId,
        location_id: adjustForm.location_id,
        new_qty: qty,
        reason: adjustForm.reason as 'count_variance' | 'damage' | 'theft' | 'expiration' | 'other',
        notes: adjustForm.notes,
        override_reason: adjustForm.override_reason || undefined,
      });

      if (!result.success && result.error) {
        if (result.error.code === 'OVERRIDE_REASON_REQUIRED') {
          // Show override reason form
          setGuardrailBlock(result.error);
        } else {
          // Hard block
          setGuardrailBlock(result.error);
        }
        return;
      }

      if (result.override_logged) {
        alert('Adjustment saved. Override has been logged for audit.');
      }

      setShowAdjustModal(false);
      setGuardrailBlock(null);
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
      // DataTable types header as string but renders it as a ReactNode â€” cast so
      // we can attach a hover tooltip to the header label.
      header: (<span title="On Hand: physical quantity at this location">On Hand</span>) as unknown as string,
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
      header: (<span title="Reserved: allocated to jobs/reservations">Reserved</span>) as unknown as string,
      sortable: true,
      className: 'text-right font-mono',
      render: (row: StockBalance) => row.reserved_qty?.toLocaleString() ?? 0,
    },
    {
      key: 'available_qty',
      header: (<span title="Available: on hand minus reserved">Available</span>) as unknown as string,
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
      key: 'location_id',
      label: 'Location',
      type: 'select' as const,
      options: filterLocations.map((loc) => ({ value: loc.id, label: loc.name })),
    },
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
            <button
              onClick={fetchStock}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              Refresh
            </button>
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
                    âœ•
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
                    <div className="grid grid-cols-1 gap-2">
                      <button
                        onClick={() => openAdjustModal(selectedItem)}
                        className="px-3 py-2 text-sm bg-orange-100 text-orange-800 rounded hover:bg-orange-200 transition-colors"
                      >
                        Adjust Stock
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
                    ) : ledgerError ? (
                      <p className="text-sm text-red-600">Couldn&apos;t load recent activity.</p>
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
          guardrailBlock={guardrailBlock}
          onClose={() => { setShowAdjustModal(false); setGuardrailBlock(null); }}
          onChange={(next) => { setAdjustForm((prev) => ({ ...prev, ...next })); setGuardrailBlock(null); }}
          onSubmit={submitAdjustment}
          onBatchComplete={async (allSucceeded) => {
            await fetchStock();
            if (allSucceeded) {
              setShowAdjustModal(false);
              setGuardrailBlock(null);
              setSelectedItem(null);
            }
          }}
        />
      )}
    </AppShell>
  );
}
