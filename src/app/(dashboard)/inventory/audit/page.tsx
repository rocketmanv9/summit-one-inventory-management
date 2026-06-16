'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { SubTabs } from '@/components/ui/SubTabs';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { InventoryRPC } from '@/lib/rpc/inventory';

interface StockMovement {
  id: string;
  catalog_item_id: string;
  location_id: string | null;
  movement_type: string;
  quantity_delta: number;
  posting_status: string | null;
  reason: string | null;
  source_ref_type: string | null;
  source_ref_id: string | null;
  reversal_ref_id: string | null;
  occurred_at: string | null;
  created_at: string;
  last_event_id: string | null;
  catalog_items?: { id: string; name: string; sku: string } | null;
  locations?: { id: string; name: string } | null;
}

interface InventoryEvent {
  id: string;
  tenant_id: string;
  event_type: string;
  occurred_at: string;
  actor_user_id: string | null;
  source_system: string | null;
  payload?: any;
  created_at: string;
}

interface LedgerEntry {
  movement_id: string;
  occurred_at: string;
  movement_type: string;
  quantity_delta: number;
  qty_before: number;
  qty_after: number;
  reason: string | null;
  source_ref_type: string | null;
  source_ref_id: string | null;
  posting_status: string;
  created_by_user_id: string | null;
  last_event_id: string;
}

export default function AuditPage() {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [events, setEvents] = useState<InventoryEvent[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'movements' | 'events' | 'ledger'>('movements');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selectedItem, setSelectedItem] = useState<StockMovement | InventoryEvent | null>(null);

  // Ledger-specific state
  const [catalogItems, setCatalogItems] = useState<Array<{ id: string; name: string; sku: string }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [ledgerItemId, setLedgerItemId] = useState('');
  const [ledgerLocationId, setLedgerLocationId] = useState('');

  useEffect(() => {
    if (activeTab === 'ledger') {
      fetchLedgerOptions();
    } else {
      fetchData();
    }
  }, [filters, activeTab]);

  const fetchLedgerOptions = async () => {
    try {
      const [items, locs] = await Promise.all([
        InventoryRPC.getCatalogItems({ active: true }),
        InventoryRPC.getLocations({ active: true }),
      ]);
      setCatalogItems((items || []).map(i => ({ id: i.id, name: i.name, sku: i.sku })));
      setLocations((locs || []).map(l => ({ id: l.id, name: l.name })));
    } catch (error) {
      console.error('Error fetching ledger options:', error);
    }
  };

  const fetchLedgerData = async () => {
    if (!ledgerItemId || !ledgerLocationId) return;
    setLoading(true);
    try {
      const result = await InventoryRPC.getLedgerWithBalance(ledgerItemId, ledgerLocationId, 100);
      setLedgerEntries(result);
    } catch (error) {
      console.error('Error fetching ledger data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'movements') {
        const data = await InventoryRPC.getStockMovements({
          movement_type: filters.movement_type || undefined,
          catalog_item_id: filters.catalog_item_id || undefined,
        });
        setMovements(data as StockMovement[]);
      } else {
        const data = await InventoryRPC.getInventoryEvents({
          event_type: filters.event_type || undefined,
          start_date: filters.start_date || undefined,
          end_date: filters.end_date || undefined,
        });
        setEvents(data);
      }
    } catch (error) {
      console.error('Error fetching audit data:', error);
    } finally {
      setLoading(false);
    }
  };

  const movementColumns = [
    {
      key: 'occurred_at',
      header: 'Date/Time',
      sortable: true,
      render: (row: StockMovement) => new Date(row.occurred_at || row.created_at).toLocaleString(),
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
      key: 'quantity_delta',
      header: 'Qty',
      className: 'text-right font-mono',
      render: (row: StockMovement) => (
        <span className={row.quantity_delta >= 0 ? 'text-green-600' : 'text-red-600'}>
          {row.quantity_delta >= 0 ? '+' : ''}{row.quantity_delta}
        </span>
      ),
    },
    {
      key: 'reference',
      header: 'Reference',
      render: (row: StockMovement) => (
        <div className="text-sm">
          {row.source_ref_type && (
            <span className="font-medium capitalize">{row.source_ref_type}</span>
          )}
          {row.source_ref_id && (
            <span className="text-muted-foreground ml-1 font-mono text-xs">
              {row.source_ref_id.slice(0, 8)}
            </span>
          )}
          {!row.source_ref_type && '-'}
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
      key: 'source_system',
      header: 'Source',
      render: (row: InventoryEvent) => (
        <span className="text-sm">{row.source_system || '-'}</span>
      ),
    },
    {
      key: 'actor_user_id',
      header: 'Actor',
      render: (row: InventoryEvent) => (
        <span className="font-mono text-xs">{row.actor_user_id?.slice(0, 8) || '-'}</span>
      ),
    },
    {
      key: 'id',
      header: 'Event ID',
      render: (row: InventoryEvent) => (
        <span className="font-mono text-xs text-muted-foreground">{row.id.slice(0, 8)}</span>
      ),
    },
  ];

  const ledgerColumns = [
    {
      key: 'occurred_at',
      header: 'Date/Time',
      sortable: true,
      render: (row: LedgerEntry) => new Date(row.occurred_at).toLocaleString(),
    },
    {
      key: 'movement_type',
      header: 'Type',
      render: (row: LedgerEntry) => <StatusChip status={row.movement_type} />,
    },
    {
      key: 'quantity_delta',
      header: 'Delta',
      className: 'text-right font-mono',
      render: (row: LedgerEntry) => (
        <span className={row.quantity_delta >= 0 ? 'text-green-600' : 'text-red-600'}>
          {row.quantity_delta >= 0 ? '+' : ''}{row.quantity_delta}
        </span>
      ),
    },
    {
      key: 'qty_before',
      header: 'Before',
      className: 'text-right font-mono',
      render: (row: LedgerEntry) => <span>{row.qty_before}</span>,
    },
    {
      key: 'qty_after',
      header: 'After',
      className: 'text-right font-mono font-semibold',
      render: (row: LedgerEntry) => <span>{row.qty_after}</span>,
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (row: LedgerEntry) => (
        <span className="text-muted-foreground text-sm">{row.reason || '-'}</span>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      render: (row: LedgerEntry) => (
        <div className="text-sm">
          {row.source_ref_type && (
            <span className="font-medium capitalize">{row.source_ref_type}</span>
          )}
          {row.source_ref_id && (
            <span className="text-muted-foreground ml-1 font-mono text-xs">
              {row.source_ref_id.slice(0, 8)}
            </span>
          )}
          {!row.source_ref_type && '-'}
        </div>
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
              onClick={activeTab === 'ledger' ? fetchLedgerData : fetchData}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
            >
              Refresh
            </button>
          }
        />

        <SubTabs
          value={activeTab}
          onChange={setActiveTab}
          tabs={[
            { value: 'movements', label: 'Stock Movements' },
            { value: 'events', label: 'Inventory Events' },
            { value: 'ledger', label: 'Ledger Explorer' },
          ]}
        />

        {activeTab === 'ledger' ? (
          <>
            <div className="flex gap-4 items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium mb-1">Item *</label>
                <select
                  value={ledgerItemId}
                  onChange={(e) => setLedgerItemId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select an item...</option>
                  {catalogItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.sku})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium mb-1">Location *</label>
                <select
                  value={ledgerLocationId}
                  onChange={(e) => setLedgerLocationId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select a location...</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={fetchLedgerData}
                disabled={!ledgerItemId || !ledgerLocationId}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
              >
                Load Ledger
              </button>
            </div>

            {ledgerEntries.length > 0 && (
              <DataTable
                data={ledgerEntries}
                columns={ledgerColumns}
                loading={loading}
                emptyMessage="No ledger entries found for this item/location"
                rowKey={(row) => row.movement_id}
              />
            )}

            {ledgerItemId && ledgerLocationId && ledgerEntries.length === 0 && !loading && (
              <div className="text-center p-8 text-muted-foreground border rounded-lg">
                No movements found for the selected item and location. Click &quot;Load Ledger&quot; to fetch data.
              </div>
            )}

            {(!ledgerItemId || !ledgerLocationId) && (
              <div className="text-center p-8 text-muted-foreground border rounded-lg">
                Select an item and location above to see the complete balance history with before/after running balances.
              </div>
            )}
          </>
        ) : (
          <>
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
                        x
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
                              {(selectedItem as StockMovement).catalog_items?.name || '-'}
                            </div>
                            <div className="font-mono text-xs">
                              {(selectedItem as StockMovement).catalog_items?.sku || ''}
                            </div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Location</div>
                            <div>{(selectedItem as StockMovement).locations?.name || '-'}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Quantity</div>
                            <div className={`font-mono text-lg ${
                              (selectedItem as StockMovement).quantity_delta >= 0 ? 'text-green-600' : 'text-red-600'
                            }`}>
                              {(selectedItem as StockMovement).quantity_delta >= 0 ? '+' : ''}
                              {(selectedItem as StockMovement).quantity_delta}
                            </div>
                          </div>
                          {(selectedItem as StockMovement).reason && (
                            <div>
                              <div className="text-muted-foreground">Reason</div>
                              <div>{(selectedItem as StockMovement).reason}</div>
                            </div>
                          )}
                          {(selectedItem as StockMovement).posting_status && (
                            <div>
                              <div className="text-muted-foreground">Status</div>
                              <StatusChip status={(selectedItem as StockMovement).posting_status!} />
                            </div>
                          )}
                          <div>
                            <div className="text-muted-foreground">Timestamp</div>
                            <div>{new Date((selectedItem as StockMovement).occurred_at || (selectedItem as StockMovement).created_at).toLocaleString()}</div>
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
                          {(selectedItem as InventoryEvent).source_system && (
                            <div>
                              <div className="text-muted-foreground">Source System</div>
                              <div>{(selectedItem as InventoryEvent).source_system}</div>
                            </div>
                          )}
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
          </>
        )}
      </div>
    </AppShell>
  );
}
