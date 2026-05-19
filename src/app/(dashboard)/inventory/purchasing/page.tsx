'use client';

import { AppError } from '@rocketmanv9/chassis/errors';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { useUOMLabelMap, useUOMTerms } from '@/hooks/useGVTerms';
import { AddVendorModal } from '@/components/modals/AddVendorModal';
import { updatePurchaseOrderStatus, deletePurchaseOrder, updatePurchaseOrder } from '@/lib/api/purchase-orders';

interface PurchaseOrder {
  id: string;
  po_number: string;
  vendor_id?: string;
  vendor_name_snapshot?: string;
  vendor_code_snapshot?: string;
  delivery_location_id?: string;
  status: string;
  expected_delivery_date?: string;
  notes?: string;
  created_at: string;
  last_event_id: string;
  purchase_order_lines?: Array<{
    id: string;
    catalog_item_id: string;
    qty_ordered: number;
    qty_received: number;
    unit_cost: number;
    status: string;
  }>;
}

export default function PurchasingPage() {
  const uomLabels = useUOMLabelMap();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [locations, setLocations] = useState<Map<string, string>>(new Map());
  const [catalogItems, setCatalogItems] = useState<Map<string, any>>(new Map());
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [pendingVendorId, setPendingVendorId] = useState<string | null>(null);

  useEffect(() => {
    loadReferenceData();
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [filters]);

  const loadReferenceData = async () => {
    try {
      // Load locations
      const locationData = await InventoryRPC.getLocations();
      const locationMap = new Map(locationData.map(loc => [loc.id, loc.name]));
      setLocations(locationMap);

      // Load catalog items
      const itemData = await InventoryRPC.getCatalogItems();
      const itemMap = new Map(itemData.map(item => [item.id, item]));
      setCatalogItems(itemMap);
    } catch (error) {
      console.error('Error loading reference data:', error);
    }
  };

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const data = await SupplyChainRPC.getPurchaseOrders({
        status: filters.status
      });
      console.log('Fetched orders:', data);
      setOrders(data || []);
    } catch (error) {
      console.error('Error fetching purchase orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateTotal = (po: PurchaseOrder) => {
    return po.purchase_order_lines?.reduce((sum, line) => sum + (line.qty_ordered * line.unit_cost), 0) || 0;
  };

  const calculateProgress = (po: PurchaseOrder) => {
    const totalQty = po.purchase_order_lines?.reduce((sum, line) => sum + line.qty_ordered, 0) || 0;
    const receivedQty = po.purchase_order_lines?.reduce((sum, line) => sum + line.qty_received, 0) || 0;
    return totalQty > 0 ? Math.round((receivedQty / totalQty) * 100) : 0;
  };

  const handleSubmitForApproval = async (poId: string, status: string, lastEventId: string) => {
    if (status !== 'draft') {
      alert(`Cannot submit PO in status: ${status}. Only draft POs can be submitted.`);
      return;
    }

    if (!confirm('Submit this PO for approval?')) return;

    try {
      const { error } = await updatePurchaseOrderStatus(poId, 'awaiting_approval', lastEventId);

      if (error) {
        alert(`Error: ${error.message}`);
        return;
      }

      alert('PO submitted for approval!');
      fetchOrders();
    } catch (error) {
      console.error('Error submitting PO:', error);
      alert('Failed to submit PO. Please try again.');
    }
  };

  const handleApprovePO = async (poId: string, status: string, lastEventId: string) => {
    if (status !== 'awaiting_approval') {
      alert(`Cannot approve PO in status: ${status}. Only POs awaiting approval can be approved.`);
      return;
    }

    if (!confirm('Approve this PO?')) return;

    try {
      const { error } = await updatePurchaseOrderStatus(poId, 'approved', lastEventId);

      if (error) {
        alert(`Error: ${error.message}`);
        return;
      }

      alert('PO approved!');
      fetchOrders();
    } catch (error) {
      console.error('Error approving PO:', error);
      alert('Failed to approve PO. Please try again.');
    }
  };

  const handlePlacePO = async (poId: string, status: string, lastEventId: string) => {
    if (status !== 'approved') {
      alert(`Cannot place PO in status: ${status}. Only approved POs can be placed.`);
      return;
    }

    if (!confirm('Place this PO with vendor?')) return;

    try {
      const { error } = await updatePurchaseOrderStatus(poId, 'placed', lastEventId);

      if (error) {
        alert(`Error: ${error.message}`);
        return;
      }

      alert('PO placed with vendor!');
      fetchOrders();
    } catch (error) {
      console.error('Error placing PO:', error);
      alert('Failed to place PO. Please try again.');
    }
  };

  const handleDeletePO = async (poId: string, status: string, poNumber: string, lastEventId: string) => {
    if (!['draft', 'awaiting_approval'].includes(status)) {
      alert(`Cannot delete PO in status: ${status}. Only draft or awaiting approval POs can be deleted.`);
      return;
    }

    if (!confirm(`Delete PO ${poNumber}? This will void the purchase order.`)) {
      return;
    }

    try {
      const { error } = await deletePurchaseOrder(poId, lastEventId);

      if (error) {
        alert(`Error: ${error.message}`);
        return;
      }

      alert('PO voided successfully!');
      fetchOrders();
    } catch (error) {
      console.error('Error voiding PO:', error);
      alert('Failed to void PO. Please try again.');
    }
  };

  const columns = [
    {
      key: 'po_number',
      header: 'PO Number',
      sortable: true,
      render: (row: PurchaseOrder) => (
        <span className="font-mono font-medium">{row.po_number}</span>
      ),
    },
    {
      key: 'vendor',
      header: 'Vendor',
      sortable: true,
      render: (row: PurchaseOrder) => (
        <div>
          <div className="font-medium">{row.vendor_name_snapshot || '-'}</div>
          {row.vendor_code_snapshot && (
            <div className="text-xs text-muted-foreground font-mono">{row.vendor_code_snapshot}</div>
          )}
        </div>
      ),
    },
    {
      key: 'lines',
      header: 'Lines',
      render: (row: PurchaseOrder) => (
        <div>
          <div>{row.purchase_order_lines?.length || 0} item(s)</div>
          <div className="text-xs text-muted-foreground">
            ${calculateTotal(row).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
      ),
    },
    {
      key: 'progress',
      header: 'Received',
      render: (row: PurchaseOrder) => {
        const progress = calculateProgress(row);
        return (
          <div className="w-24">
            <div className="flex items-center justify-between text-xs mb-1">
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${progress === 100 ? 'bg-green-500' : 'bg-blue-500'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      key: 'expected_delivery_date',
      header: 'Expected',
      sortable: true,
      render: (row: PurchaseOrder) => {
        if (!row.expected_delivery_date) return '-';
        const date = new Date(row.expected_delivery_date);
        const isLate = date < new Date() && row.status !== 'received' && row.status !== 'closed';
        return (
          <span className={isLate ? 'text-red-600 font-medium' : ''}>
            {date.toLocaleDateString()}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: PurchaseOrder) => (
        <StatusChip status={row.status} />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: PurchaseOrder) => {
        const isDraft = row.status === 'draft';
        const isAwaitingApproval = row.status === 'awaiting_approval';
        const isApproved = row.status === 'approved';
        const isPlaced = row.status === 'placed' || row.status === 'acknowledged';
        const isPartiallyReceived = row.status === 'partially_received';
        const isFullyReceived = row.status === 'fully_received';
        const isClosed = row.status === 'closed';
        
        return (
          <div className="flex gap-2">
            {/* Submit button - only for draft */}
            {isDraft && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleSubmitForApproval(row.id, row.status, row.last_event_id);
                }}
                className="px-3 py-1 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white"
                title="Submit for approval"
              >
                Submit
              </button>
            )}

            {/* Approve button - only for awaiting approval */}
            {isAwaitingApproval && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleApprovePO(row.id, row.status, row.last_event_id);
                }}
                className="px-3 py-1 text-sm rounded bg-green-600 hover:bg-green-700 text-white"
                title="Approve purchase order"
              >
                Approve
              </button>
            )}

            {/* Place Order button - only for approved */}
            {isApproved && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handlePlacePO(row.id, row.status, row.last_event_id);
                }}
                className="px-3 py-1 text-sm rounded bg-purple-600 hover:bg-purple-700 text-white"
                title="Place order with vendor"
              >
                Place Order
              </button>
            )}

            {/* Edit button - only for draft */}
            {isDraft && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedOrder(row);
                  setShowEditModal(true);
                }}
                className="px-3 py-1 text-sm rounded bg-gray-600 hover:bg-gray-700 text-white"
                title="Edit purchase order"
              >
                Edit
              </button>
            )}

            {/* Delete button - for draft or awaiting approval */}
            {(isDraft || isAwaitingApproval) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeletePO(row.id, row.status, row.po_number, row.last_event_id);
                }}
                className="px-3 py-1 text-sm rounded bg-red-600 hover:bg-red-700 text-white"
                title="Delete purchase order"
              >
                Delete
              </button>
            )}

            {/* View button - for all non-draft statuses */}
            {!isDraft && !isClosed && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedOrder(row);
                }}
                className="px-3 py-1 text-sm rounded bg-gray-500 hover:bg-gray-600 text-white"
                title="View details"
              >
                View
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const filterConfig = [
    {
      key: 'status',
      label: 'Status',
      type: 'select' as const,
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'submitted', label: 'Submitted' },
        { value: 'approved', label: 'Approved' },
        { value: 'in_transit', label: 'In Transit' },
        { value: 'partially_received', label: 'Partially Received' },
        { value: 'received', label: 'Received' },
        { value: 'closed', label: 'Closed' },
        { value: 'cancelled', label: 'Cancelled' },
      ],
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Purchase Orders"
          description="Manage purchase orders and track vendor deliveries. Example: Create a PO for 500 tons of asphalt from Acme Materials, track delivery status, and receive partial shipments as they arrive at your yard."
          actions={
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              + Create PO
            </button>
          }
        />

        <div className="grid grid-cols-4 gap-4">
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="text-2xl font-bold text-yellow-700">
              {orders.filter(o => o.status === 'draft' || o.status === 'submitted').length}
            </div>
            <div className="text-sm text-yellow-600">Pending Approval</div>
          </div>
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="text-2xl font-bold text-blue-700">
              {orders.filter(o => o.status === 'approved' || o.status === 'in_transit').length}
            </div>
            <div className="text-sm text-blue-600">Open</div>
          </div>
          <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
            <div className="text-2xl font-bold text-orange-700">
              {orders.filter(o => o.status === 'partially_received').length}
            </div>
            <div className="text-sm text-orange-600">Partial</div>
          </div>
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="text-2xl font-bold text-red-700">
              {orders.filter(o => {
                if (!o.expected_delivery_date) return false;
                return new Date(o.expected_delivery_date) < new Date() &&
                       !['received', 'closed', 'cancelled'].includes(o.status);
              }).length}
            </div>
            <div className="text-sm text-red-600">Late</div>
          </div>
        </div>

        <FilterBar
          filters={filterConfig}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClear={() => setFilters({})}
        />

        <DataTable
          data={orders}
          columns={columns}
          loading={loading}
          emptyMessage="No purchase orders found"
          rowKey={(row) => row.id}
          onRowClick={setSelectedOrder}
        />

        {selectedOrder && !showEditModal && (
          <PODetailPanel
            po={selectedOrder}
            onClose={() => setSelectedOrder(null)}
            locations={locations}
            catalogItems={catalogItems}
          />
        )}

        {showCreateModal && (
          <CreatePOModal
            onClose={() => setShowCreateModal(false)}
            onCreated={() => {
              setShowCreateModal(false);
              fetchOrders();
            }}
            onAddVendor={() => setShowVendorModal(true)}
            newVendorId={pendingVendorId}
          />
        )}

        {showEditModal && selectedOrder && (
          <EditPOModal
            po={selectedOrder}
            onClose={() => {
              setShowEditModal(false);
              setSelectedOrder(null);
            }}
            onUpdated={() => {
              setShowEditModal(false);
              setSelectedOrder(null);
              fetchOrders();
            }}
            onAddVendor={() => setShowVendorModal(true)}
            newVendorId={pendingVendorId}
          />
        )}

        <AddVendorModal
          open={showVendorModal}
          onClose={() => setShowVendorModal(false)}
          onSuccess={async (_vendorName: string) => {
            setShowVendorModal(false);
            // Fetch latest vendors to get the new one's ID for auto-selection
            try {
              const vendors = await SupplyChainRPC.getVendors();
              const newest = vendors.sort((a, b) =>
                new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
              )[0];
              if (newest) {
                setPendingVendorId(newest.id);
              }
            } catch {
              // Vendor was created but auto-select failed — modal will refresh its list
            }
          }}
        />
      </div>
    </AppShell>
  );
}

function PODetailPanel({
  po,
  onClose,
  locations,
  catalogItems
}: {
  po: PurchaseOrder;
  onClose: () => void;
  locations: Map<string, string>;
  catalogItems: Map<string, any>;
}) {
  const uomLabels = useUOMLabelMap();
  const [receipts, setReceipts] = useState<Array<{
    id: string;
    receipt_number: string;
    received_at: string;
    location_id?: string;
    locations?: { name: string };
    users?: { email: string };
    receipt_lines?: Array<{
      catalog_item_id: string;
      qty_received: number;
      catalog_items?: { name: string };
    }>;
  }>>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(true);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    fetchReceipts();
  }, [po.id]);

  const fetchReceipts = async () => {
    setLoadingReceipts(true);
    try {
      const data = await SupplyChainRPC.getReceipts({ po_id: po.id });
      setReceipts(data || []);
    } catch (error) {
      console.error('Error fetching receipts:', error);
    } finally {
      setLoadingReceipts(false);
    }
  };

  const updateStatus = async (newStatus: string) => {
    setUpdatingStatus(true);
    try {
      const { error } = await updatePurchaseOrderStatus(po.id, newStatus, po.last_event_id);

      if (error) {
        throw AppError.internal(error.message);
      }

      // Refresh the page to show updated PO
      window.location.reload();
    } catch (error: any) {
      console.error('Error updating status:', error);
      alert(`Failed to update status: ${error.message}`);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const deletePO = async () => {
    if (!confirm(`Are you sure you want to void PO ${po.po_number}? This will cancel the purchase order.`)) {
      return;
    }

    setUpdatingStatus(true);
    try {
      const { error } = await deletePurchaseOrder(po.id, po.last_event_id);

      if (error) {
        throw AppError.internal(error.message);
      }

      // Close panel and refresh to remove voided PO from list
      onClose();
      window.location.reload();
    } catch (error: any) {
      console.error('Error voiding PO:', error);
      alert(`Failed to void PO: ${error.message}`);
    } finally {
      setUpdatingStatus(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[28rem] bg-white shadow-xl border-l z-40 overflow-y-auto">
      <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-white">
        <h3 className="font-semibold">PO Details</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <span className="font-mono font-medium text-lg">{po.po_number}</span>
          <StatusChip status={po.status} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground">Vendor</div>
            <div className="font-medium">{po.vendor_name_snapshot || '-'}</div>
            {po.vendor_code_snapshot && (
              <div className="text-xs text-muted-foreground font-mono">{po.vendor_code_snapshot}</div>
            )}
          </div>
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground">Ship To</div>
            <div className="font-medium">{locations.get(po.delivery_location_id || '') || po.delivery_location_id || 'N/A'}</div>
          </div>
        </div>

        {po.expected_delivery_date && (
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground">Expected Delivery</div>
            <div className="font-medium">{new Date(po.expected_delivery_date).toLocaleDateString()}</div>
          </div>
        )}

        <div className="border-t pt-4">
          <h4 className="font-medium mb-2">Line Items</h4>
          <div className="space-y-2">
            {po.purchase_order_lines?.map((line) => {
              const item = catalogItems.get(line.catalog_item_id);
              return (
                <div key={line.id} className="p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-medium">{item?.name || 'Unknown Item'}</div>
                    <StatusChip status={line.status} size="sm" />
                  </div>
                  <div className="text-xs text-muted-foreground mb-2">
                    {item?.sku} | {uomLabels[(item as any)?.uom_term_id] || (item as any)?.uom_term_id || '-'}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">Ordered</div>
                      <div className="font-mono">{line.qty_ordered}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Received</div>
                      <div className="font-mono">{line.qty_received}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Unit Cost</div>
                      <div className="font-mono">${line.unit_cost.toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              );
            }) || <p className="text-muted-foreground text-sm">No items</p>}
          </div>
        </div>

        {po.notes && (
          <div className="border-t pt-4">
            <h4 className="font-medium mb-2">Notes</h4>
            <p className="text-sm text-muted-foreground">{po.notes}</p>
          </div>
        )}

        <div className="border-t pt-4">
          <h4 className="font-medium mb-3">Receipt History</h4>
          {loadingReceipts ? (
            <div className="p-3 bg-muted/30 rounded-lg animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-muted rounded w-1/2"></div>
            </div>
          ) : receipts.length > 0 ? (
            <div className="space-y-2">
              {receipts.map((receipt) => {
                const locationLabel =
                  receipt.locations?.name ||
                  (receipt.location_id
                    ? locations.get(receipt.location_id) || receipt.location_id
                    : 'Unknown');

                return (
                  <div key={receipt.id} className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-sm font-medium">{receipt.receipt_number}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(receipt.received_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Location: {locationLabel}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No receipts yet</p>
          )}
        </div>

        <div className="border-t pt-4">
          <div className="flex flex-col gap-2">
            {/* Status-specific actions */}
            {po.status === 'draft' && (
              <>
                <button
                  onClick={() => updateStatus('awaiting_approval')}
                  disabled={updatingStatus}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {updatingStatus ? 'Updating...' : 'Submit for Approval'}
                </button>
                <button
                  onClick={deletePO}
                  disabled={updatingStatus}
                  className="w-full px-4 py-2 border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50"
                >
                  {updatingStatus ? 'Deleting...' : 'Delete PO'}
                </button>
              </>
            )}

            {po.status === 'awaiting_approval' && (
              <>
                <button
                  onClick={() => updateStatus('approved')}
                  disabled={updatingStatus}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                >
                  {updatingStatus ? 'Updating...' : 'Approve PO'}
                </button>
                <button
                  onClick={() => updateStatus('cancelled')}
                  disabled={updatingStatus}
                  className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                >
                  {updatingStatus ? 'Updating...' : 'Reject'}
                </button>
                <button
                  onClick={deletePO}
                  disabled={updatingStatus}
                  className="w-full px-4 py-2 border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50"
                >
                  {updatingStatus ? 'Deleting...' : 'Delete PO'}
                </button>
              </>
            )}

            {po.status === 'approved' && (
              <button
                onClick={() => updateStatus('placed')}
                disabled={updatingStatus}
                className="w-full px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
              >
                {updatingStatus ? 'Updating...' : 'Place Order (Send to Vendor)'}
              </button>
            )}

            {(po.status === 'partially_received' || po.status === 'fully_received') && (
              <button
                onClick={() => updateStatus('closed')}
                disabled={updatingStatus}
                className="w-full px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                {updatingStatus ? 'Updating...' : 'Close PO'}
              </button>
            )}

            {po.status === 'closed' && (
              <div className="w-full px-4 py-2 text-center text-muted-foreground bg-muted/30 rounded-md">
                PO Closed
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreatePOModal({ onClose, onCreated, onAddVendor, newVendorId }: { onClose: () => void; onCreated: () => void; onAddVendor: () => void; newVendorId?: string | null }) {
  const { terms: uomTerms, loading: uomLoading } = useUOMTerms();
  type POLine = { catalog_item_id: string; item_description: string; uom_term_id: string; qty: string; unit_cost: string };
  const emptyLine: POLine = { catalog_item_id: '', item_description: '', uom_term_id: '', qty: '', unit_cost: '' };
  const [form, setForm] = useState({
    vendor_id: '',
    ship_to_location_id: '',
    expected_delivery_date: '',
    notes: '',
    lines: [{ ...emptyLine }],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [vendors, setVendors] = useState<Array<{ id: string; name: string; code: string | null; created_at: string }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string; location_type?: { name: string } }>>([]);
  const [vendorItems, setVendorItems] = useState<Array<{ id: string; vendor_sku: string; unit_cost: number; catalog_items?: { id: string; sku: string; name: string } | null }>>([]);
  const [useFreetextLines, setUseFreetextLines] = useState(false);

  useEffect(() => {
    fetchVendors();
    fetchLocations();
  }, []);

  // When a new vendor is created inline, refresh and auto-select it
  useEffect(() => {
    if (!newVendorId) return;
    fetchVendors().then(() => {
      setForm((prev) => ({
        ...prev,
        vendor_id: newVendorId,
        lines: [{ ...emptyLine }],
      }));
    });
  }, [newVendorId]);

  useEffect(() => {
    if (form.vendor_id) {
      fetchVendorItems(form.vendor_id);
      setUseFreetextLines(false);
    } else {
      setVendorItems([]);
      setUseFreetextLines(false);
    }
  }, [form.vendor_id]);

  const fetchVendors = async () => {
    try {
      const data = await SupplyChainRPC.getVendors();
      setVendors(data || []);
    } catch (error) {
      console.error('Error fetching vendors:', error);
    }
  };

  const fetchLocations = async () => {
    try {
      const data = await InventoryRPC.getLocations({ active: true });
      setLocations(data || []);
    } catch (error) {
      console.error('Error fetching locations:', error);
    }
  };

  const fetchVendorItems = async (vendorId: string) => {
    try {
      const data = await SupplyChainRPC.getVendorItemsWithCatalog(vendorId);
      setVendorItems(data || []);
    } catch (error) {
      console.error('Error fetching vendor items:', error);
      setVendorItems([]);
    }
  };

  const addLine = () => {
    setForm({
      ...form,
      lines: [...form.lines, { ...emptyLine }],
    });
  };

  const removeLine = (index: number) => {
    setForm({
      ...form,
      lines: form.lines.filter((_, i) => i !== index),
    });
  };

  const updateLine = (index: number, field: string, value: string) => {
    const newLines = [...form.lines];
    newLines[index] = { ...newLines[index], [field]: value };
    setForm({ ...form, lines: newLines });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      let validLines: Array<{
        catalog_item_id?: string;
        item_description?: string;
        uom_term_id?: string;
        qty_ordered: number;
        unit_cost: number;
      }>;

      if (useFreetextLines) {
        // Free-text line items (non-catalog)
        validLines = form.lines
          .filter(l => l.item_description.trim() && l.qty)
          .map(l => ({
            item_description: l.item_description.trim(),
            uom_term_id: l.uom_term_id || undefined,
            qty_ordered: parseInt(l.qty),
            unit_cost: parseFloat(l.unit_cost) || 0,
          }));
      } else {
        // Catalog-based line items
        validLines = form.lines
          .filter(l => l.catalog_item_id && l.qty)
          .map(l => ({
            catalog_item_id: l.catalog_item_id,
            qty_ordered: parseInt(l.qty),
            unit_cost: parseFloat(l.unit_cost) || 0,
          }));
      }

      if (validLines.length === 0) {
        throw AppError.badRequest('Please add at least one line item');
      }

      await SupplyChainRPC.createPurchaseOrder({
        vendor_id: form.vendor_id,
        delivery_location_id: form.ship_to_location_id,
        needed_by_date: form.expected_delivery_date || undefined,
        notes: form.notes || undefined,
        lines: validLines,
      });

      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-semibold">Create Purchase Order</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium">Vendor *</label>
                <button
                  type="button"
                  onClick={onAddVendor}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  + Add New
                </button>
              </div>
              <select
                value={form.vendor_id}
                onChange={(e) => {
                  if (e.target.value === '__create_new__') {
                    onAddVendor();
                    return;
                  }
                  setForm({
                    ...form,
                    vendor_id: e.target.value,
                    lines: [{ ...emptyLine }],
                  });
                }}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                <option value="">Select a vendor...</option>
                {vendors.map(vendor => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.code ? `${vendor.code} - ${vendor.name}` : vendor.name}
                  </option>
                ))}
                <option value="__create_new__">+ Add New Vendor...</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Ship To Location *</label>
              <select
                value={form.ship_to_location_id}
                onChange={(e) => setForm({ ...form, ship_to_location_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                <option value="">Select a location...</option>
                {locations.map(location => (
                  <option key={location.id} value={location.id}>
                    {location.name} ({location.location_type?.name || 'Unknown'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Expected Delivery <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="date"
              value={form.expected_delivery_date}
              onChange={(e) => setForm({ ...form, expected_delivery_date: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium">Line Items</h4>
              <div className="flex items-center gap-3">
                {form.vendor_id && vendorItems.length === 0 && !useFreetextLines && (
                  <span className="text-xs text-muted-foreground">No mapped items</span>
                )}
                {form.vendor_id && (
                  <button
                    type="button"
                    onClick={() => {
                      setUseFreetextLines(!useFreetextLines);
                      setForm({ ...form, lines: [{ ...emptyLine }] });
                    }}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    {useFreetextLines ? 'Use catalog items' : 'Use free-text items'}
                  </button>
                )}
                <button type="button" onClick={addLine} className="text-sm text-primary hover:underline">
                  + Add Line
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {!form.vendor_id && (
                <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
                  Select a vendor first to see available items
                </p>
              )}

              {form.vendor_id && !useFreetextLines && vendorItems.length === 0 && (
                <p className="text-sm text-blue-600 bg-blue-50 border border-blue-200 rounded p-2">
                  No catalog items mapped to this vendor. Use &quot;free-text items&quot; to add items by description, or map items on the Vendor Items page.
                </p>
              )}

              {form.lines.map((line, index) => (
                <div key={index} className="flex gap-2 items-center">
                  {useFreetextLines ? (
                    <>
                      <input
                        type="text"
                        value={line.item_description}
                        onChange={(e) => updateLine(index, 'item_description', e.target.value)}
                        className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="Item description..."
                      />
                      <select
                        value={line.uom_term_id}
                        onChange={(e) => updateLine(index, 'uom_term_id', e.target.value)}
                        className="w-24 px-2 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                      >
                        <option value="">UOM</option>
                        {uomLoading ? (
                          <option disabled>...</option>
                        ) : (
                          uomTerms.map((t) => (
                            <option key={t.term_id} value={t.term_id}>{t.label}</option>
                          ))
                        )}
                      </select>
                    </>
                  ) : (
                    <select
                      value={line.catalog_item_id}
                      onChange={(e) => {
                        const selectedItem = vendorItems.find(vi => vi.catalog_items?.id === e.target.value);

                        const newLines = [...form.lines];
                        newLines[index] = {
                          ...newLines[index],
                          catalog_item_id: e.target.value,
                          unit_cost: selectedItem?.unit_cost ? selectedItem.unit_cost.toString() : newLines[index].unit_cost,
                        };
                        setForm({ ...form, lines: newLines });
                      }}
                      className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                      disabled={!form.vendor_id}
                    >
                      <option value="">Select an item...</option>
                      {vendorItems.map(vi => (
                        <option key={vi.id} value={vi.catalog_items?.id}>
                          {vi.vendor_sku} - {vi.catalog_items?.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    type="number"
                    value={line.qty}
                    onChange={(e) => updateLine(index, 'qty', e.target.value)}
                    className="w-20 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Qty"
                    min="1"
                  />
                  <input
                    type="number"
                    value={line.unit_cost}
                    onChange={(e) => updateLine(index, 'unit_cost', e.target.value)}
                    className="w-24 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="$/unit"
                    step="0.01"
                    min="0"
                  />
                  {form.lines.length > 1 && (
                    <button type="button" onClick={() => removeLine(index)} className="text-red-500 hover:text-red-700">
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={2}
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create PO'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditPOModal({ po, onClose, onUpdated, onAddVendor, newVendorId }: { po: PurchaseOrder; onClose: () => void; onUpdated: () => void; onAddVendor: () => void; newVendorId?: string | null }) {
  const [form, setForm] = useState({
    vendor_id: po.vendor_id || '',
    ship_to_location_id: po.delivery_location_id || '',
    expected_delivery_date: po.expected_delivery_date || '',
    notes: po.notes || '',
    lines: po.purchase_order_lines?.map(line => ({
      id: line.id,
      catalog_item_id: line.catalog_item_id,
      qty: line.qty_ordered.toString(),
      unit_cost: line.unit_cost.toString(),
    })) || [{ id: '', catalog_item_id: '', qty: '', unit_cost: '' }],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [vendors, setVendors] = useState<Array<{ id: string; name: string; code: string | null }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string; location_type?: { name: string } }>>([]);
  const [vendorItems, setVendorItems] = useState<Array<{ id: string; vendor_sku: string; unit_cost: number; catalog_items?: { id: string; sku: string; name: string } | null }>>([]);

  useEffect(() => {
    fetchVendors();
    fetchLocations();
    if (form.vendor_id) {
      fetchVendorItems(form.vendor_id);
    }
  }, []);

  // Auto-select newly created vendor
  useEffect(() => {
    if (!newVendorId) return;
    fetchVendors().then(() => {
      setForm((prev) => ({
        ...prev,
        vendor_id: newVendorId,
        lines: [{ id: '', catalog_item_id: '', qty: '', unit_cost: '' }],
      }));
    });
  }, [newVendorId]);

  useEffect(() => {
    if (form.vendor_id && form.vendor_id !== po.vendor_id) {
      fetchVendorItems(form.vendor_id);
    }
  }, [form.vendor_id]);

  const fetchVendors = async () => {
    try {
      const data = await SupplyChainRPC.getVendors();
      setVendors(data || []);
    } catch (error) {
      console.error('Error fetching vendors:', error);
    }
  };

  const fetchLocations = async () => {
    try {
      const data = await InventoryRPC.getLocations({ active: true });
      setLocations(data || []);
    } catch (error) {
      console.error('Error fetching locations:', error);
    }
  };

  const fetchVendorItems = async (vendorId: string) => {
    try {
      const data = await SupplyChainRPC.getVendorItemsWithCatalog(vendorId);
      setVendorItems(data || []);
    } catch (error) {
      console.error('Error fetching vendor items:', error);
      setVendorItems([]);
    }
  };

  const addLine = () => {
    setForm({
      ...form,
      lines: [...form.lines, { id: '', catalog_item_id: '', qty: '', unit_cost: '' }],
    });
  };

  const removeLine = (index: number) => {
    setForm({
      ...form,
      lines: form.lines.filter((_, i) => i !== index),
    });
  };

  const updateLine = (index: number, field: string, value: string) => {
    const newLines = [...form.lines];
    newLines[index] = { ...newLines[index], [field]: value };
    setForm({ ...form, lines: newLines });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const { error } = await updatePurchaseOrder(po.id, po.last_event_id, {
        vendor_id: form.vendor_id,
        delivery_location_id: form.ship_to_location_id,
        needed_by_date: form.expected_delivery_date || null,
        notes: form.notes || null,
        lines: form.lines
          .filter(l => l.catalog_item_id && l.qty)
          .map(l => ({
            id: l.id || undefined,
            catalog_item_id: l.catalog_item_id,
            qty_ordered: parseInt(l.qty),
            unit_cost: parseFloat(l.unit_cost) || 0,
          })),
      });

      if (error) {
        throw AppError.internal(error.message);
      }

      onUpdated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-semibold">Edit PO - {po.po_number}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium">Vendor *</label>
                <button
                  type="button"
                  onClick={onAddVendor}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  + Add New
                </button>
              </div>
              <select
                value={form.vendor_id}
                onChange={(e) => {
                  if (e.target.value === '__create_new__') {
                    onAddVendor();
                    return;
                  }
                  setForm({
                    ...form,
                    vendor_id: e.target.value,
                    lines: [{ id: '', catalog_item_id: '', qty: '', unit_cost: '' }]
                  });
                }}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                <option value="">Select a vendor...</option>
                {vendors.map(vendor => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.code ? `${vendor.code} - ${vendor.name}` : vendor.name}
                  </option>
                ))}
                <option value="__create_new__">+ Add New Vendor...</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Ship To Location *</label>
              <select
                value={form.ship_to_location_id}
                onChange={(e) => setForm({ ...form, ship_to_location_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                <option value="">Select a location...</option>
                {locations.map(location => (
                  <option key={location.id} value={location.id}>
                    {location.name} ({location.location_type?.name || 'Unknown'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Expected Delivery <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="date"
              value={form.expected_delivery_date}
              onChange={(e) => setForm({ ...form, expected_delivery_date: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium">Line Items</h4>
              <button type="button" onClick={addLine} className="text-sm text-primary hover:underline">
                + Add Line
              </button>
            </div>
            <div className="space-y-2">
              {!form.vendor_id && (
                <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
                  Select a vendor first to see available items
                </p>
              )}
              {form.lines.map((line, index) => (
                <div key={index} className="flex gap-2 items-center">
                  <select
                    value={line.catalog_item_id}
                    onChange={(e) => {
                      const selectedItem = vendorItems.find(vi => vi.catalog_items?.id === e.target.value);
                      updateLine(index, 'catalog_item_id', e.target.value);
                      if (selectedItem?.unit_cost && !line.unit_cost) {
                        updateLine(index, 'unit_cost', selectedItem.unit_cost.toString());
                      }
                    }}
                    className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    disabled={!form.vendor_id}
                  >
                    <option value="">Select an item...</option>
                    {vendorItems.map(vi => (
                      <option key={vi.id} value={vi.catalog_items?.id}>
                        {vi.vendor_sku} - {vi.catalog_items?.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={line.qty}
                    onChange={(e) => updateLine(index, 'qty', e.target.value)}
                    className="w-20 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Qty"
                    min="1"
                  />
                  <input
                    type="number"
                    value={line.unit_cost}
                    onChange={(e) => updateLine(index, 'unit_cost', e.target.value)}
                    className="w-24 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="$/unit"
                    step="0.01"
                    min="0"
                  />
                  {form.lines.length > 1 && (
                    <button type="button" onClick={() => removeLine(index)} className="text-red-500 hover:text-red-700">
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={2}
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
