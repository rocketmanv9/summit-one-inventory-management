'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';

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

  useEffect(() => {
    fetchStock();
  }, [filters]);

  const fetchStock = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.location_id) params.set('location_id', filters.location_id);
      if (filters.below_reorder === 'true') params.set('below_reorder', 'true');

      const res = await fetch(`/api/inventory/stock?${params}`);
      const { data } = await res.json();
      setStock(data || []);
    } catch (error) {
      console.error('Error fetching stock:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchLedger = async (itemId: string, locationId: string) => {
    setLedgerLoading(true);
    try {
      const params = new URLSearchParams({
        type: 'movements',
        catalog_item_id: itemId,
        location_id: locationId,
        limit: '20'
      });
      const res = await fetch(`/api/inventory/audit?${params}`);
      const { data } = await res.json();
      setLedgerData(data?.movements || []);
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
      key: 'on_order_qty',
      header: 'On Order',
      sortable: true,
      className: 'text-right font-mono',
      render: (row: StockBalance) => row.on_order_qty?.toLocaleString() ?? 0,
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
                      <button className="px-3 py-2 text-sm bg-orange-100 text-orange-800 rounded hover:bg-orange-200 transition-colors">
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
    </AppShell>
  );
}
