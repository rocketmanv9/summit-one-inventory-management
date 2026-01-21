'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';

interface StockMovement {
  id: string;
  catalog_item_id: string;
  location_id: string;
  movement_type: string;
  qty: number;
  reference_type?: string;
  reference_id?: string;
  notes?: string;
  created_at: string;
  catalog_items?: { id: string; name: string; sku: string };
  locations?: { id: string; name: string };
}

interface InventoryEvent {
  id: string;
  tenant_id: string;
  catalog_item_id?: string;
  location_id?: string;
  event_type: string;
  qty?: number;
  payload?: any;
  occurred_at: string;
}

export default function AuditPage() {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [events, setEvents] = useState<InventoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'movements' | 'events'>('movements');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selectedItem, setSelectedItem] = useState<StockMovement | InventoryEvent | null>(null);

  useEffect(() => {
    fetchData();
  }, [filters, activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type: activeTab === 'movements' ? 'movements' : 'events' });
      if (filters.movement_type) params.set('movement_type', filters.movement_type);
      if (filters.catalog_item_id) params.set('catalog_item_id', filters.catalog_item_id);
      if (filters.start_date) params.set('start_date', filters.start_date);
      if (filters.end_date) params.set('end_date', filters.end_date);

      const res = await fetch(`/api/inventory/audit?${params}`);
      const { data } = await res.json();

      if (activeTab === 'movements') {
        setMovements(data?.movements || []);
      } else {
        setEvents(data?.events || []);
      }
    } catch (error) {
      console.error('Error fetching audit data:', error);
    } finally {
      setLoading(false);
    }
  };

  const movementColumns = [
    {
      key: 'created_at',
      header: 'Date/Time',
      sortable: true,
      render: (row: StockMovement) => new Date(row.created_at).toLocaleString(),
    },
    {
      key: 'movement_type',
      header: 'Type',
      render: (row: StockMovement) => (
        <StatusChip status={row.movement_type} />
      ),
    },
    {
      key: 'item',
      header: 'Item',
      render: (row: StockMovement) => (
        <div>
          <div className="font-medium">{row.catalog_items?.name || '-'}</div>
          <div className="text-xs text-muted-foreground">{row.catalog_items?.sku || ''}</div>
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      render: (row: StockMovement) => row.locations?.name || '-',
    },
    {
      key: 'qty',
      header: 'Qty',
      className: 'text-right font-mono',
      render: (row: StockMovement) => (
        <span className={row.qty >= 0 ? 'text-green-600' : 'text-red-600'}>
          {row.qty >= 0 ? '+' : ''}{row.qty}
        </span>
      ),
    },
    {
      key: 'reference',
      header: 'Reference',
      render: (row: StockMovement) => (
        <div className="text-sm">
          {row.reference_type && (
            <span className="font-medium capitalize">{row.reference_type}</span>
          )}
          {row.reference_id && (
            <span className="text-muted-foreground ml-1 font-mono text-xs">
              {row.reference_id.slice(0, 8)}
            </span>
          )}
          {!row.reference_type && '-'}
        </div>
      ),
    },
  ];

  const eventColumns = [
    {
      key: 'occurred_at',
      header: 'Date/Time',
      sortable: true,
      render: (row: InventoryEvent) => new Date(row.occurred_at).toLocaleString(),
    },
    {
      key: 'event_type',
      header: 'Event Type',
      render: (row: InventoryEvent) => (
        <span className="font-mono text-sm">{row.event_type}</span>
      ),
    },
    {
      key: 'catalog_item_id',
      header: 'Item ID',
      render: (row: InventoryEvent) => (
        <span className="font-mono text-xs">{row.catalog_item_id?.slice(0, 8) || '-'}</span>
      ),
    },
    {
      key: 'location_id',
      header: 'Location ID',
      render: (row: InventoryEvent) => (
        <span className="font-mono text-xs">{row.location_id?.slice(0, 8) || '-'}</span>
      ),
    },
    {
      key: 'qty',
      header: 'Qty',
      className: 'text-right font-mono',
      render: (row: InventoryEvent) => row.qty ?? '-',
    },
    {
      key: 'id',
      header: 'Event ID',
      render: (row: InventoryEvent) => (
        <span className="font-mono text-xs text-muted-foreground">{row.id.slice(0, 8)}</span>
      ),
    },
  ];

  const movementFilterConfig = [
    {
      key: 'movement_type',
      label: 'Type',
      type: 'select' as const,
      options: [
        { value: 'received', label: 'Received' },
        { value: 'issued', label: 'Issued' },
        { value: 'adjusted', label: 'Adjusted' },
        { value: 'transferred', label: 'Transferred' },
        { value: 'counted', label: 'Counted' },
        { value: 'damaged', label: 'Damaged' },
        { value: 'returned', label: 'Returned' },
      ],
    },
    {
      key: 'start_date',
      label: 'From',
      type: 'date' as const,
    },
    {
      key: 'end_date',
      label: 'To',
      type: 'date' as const,
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Audit Ledger"
          description="View stock movements and inventory events. Example: See the complete history of how 1000 tons of asphalt moved through your system: received from vendor → stored in yard → transferred to Truck #5 → issued to Highway 101 project."
          actions={
            <button
              onClick={fetchData}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
            >
              Refresh
            </button>
          }
        />

        <div className="flex gap-2 border-b">
          <button
            onClick={() => setActiveTab('movements')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'movements'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Stock Movements
          </button>
          <button
            onClick={() => setActiveTab('events')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'events'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Inventory Events
          </button>
        </div>

        <FilterBar
          filters={movementFilterConfig}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClear={() => setFilters({})}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={selectedItem ? 'lg:col-span-2' : 'lg:col-span-3'}>
            {activeTab === 'movements' ? (
              <DataTable
                data={movements}
                columns={movementColumns}
                loading={loading}
                emptyMessage="No stock movements found"
                rowKey={(row) => row.id}
                onRowClick={(row) => setSelectedItem(row)}
              />
            ) : (
              <DataTable
                data={events}
                columns={eventColumns}
                loading={loading}
                emptyMessage="No inventory events found"
                rowKey={(row) => row.id}
                onRowClick={(row) => setSelectedItem(row)}
              />
            )}
          </div>

          {selectedItem && (
            <div className="lg:col-span-1">
              <div className="rounded-lg border bg-card p-4 sticky top-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold">Details</h3>
                  <button
                    onClick={() => setSelectedItem(null)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-3 text-sm">
                  {activeTab === 'movements' && 'movement_type' in selectedItem && (
                    <>
                      <div>
                        <div className="text-muted-foreground">Movement Type</div>
                        <StatusChip status={(selectedItem as StockMovement).movement_type} />
                      </div>
                      <div>
                        <div className="text-muted-foreground">Item</div>
                        <div className="font-medium">
                          {(selectedItem as StockMovement).catalog_items?.name}
                        </div>
                        <div className="font-mono text-xs">
                          {(selectedItem as StockMovement).catalog_items?.sku}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Location</div>
                        <div>{(selectedItem as StockMovement).locations?.name}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Quantity</div>
                        <div className={`font-mono text-lg ${
                          (selectedItem as StockMovement).qty >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {(selectedItem as StockMovement).qty >= 0 ? '+' : ''}
                          {(selectedItem as StockMovement).qty}
                        </div>
                      </div>
                      {(selectedItem as StockMovement).notes && (
                        <div>
                          <div className="text-muted-foreground">Notes</div>
                          <div>{(selectedItem as StockMovement).notes}</div>
                        </div>
                      )}
                      <div>
                        <div className="text-muted-foreground">Timestamp</div>
                        <div>{new Date((selectedItem as StockMovement).created_at).toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Movement ID</div>
                        <div className="font-mono text-xs break-all">{selectedItem.id}</div>
                      </div>
                    </>
                  )}

                  {activeTab === 'events' && 'event_type' in selectedItem && (
                    <>
                      <div>
                        <div className="text-muted-foreground">Event Type</div>
                        <div className="font-mono">{(selectedItem as InventoryEvent).event_type}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Occurred At</div>
                        <div>{new Date((selectedItem as InventoryEvent).occurred_at).toLocaleString()}</div>
                      </div>
                      {(selectedItem as InventoryEvent).payload && (
                        <div>
                          <div className="text-muted-foreground mb-1">Payload</div>
                          <pre className="p-2 bg-muted/50 rounded text-xs overflow-auto max-h-48">
                            {JSON.stringify((selectedItem as InventoryEvent).payload, null, 2)}
                          </pre>
                        </div>
                      )}
                      <div>
                        <div className="text-muted-foreground">Event ID</div>
                        <div className="font-mono text-xs break-all">{selectedItem.id}</div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
