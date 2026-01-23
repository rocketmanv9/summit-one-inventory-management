'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';

interface PurchaseOrder {
  id: string;
  po_number: string;
  vendor_id?: string;
  ship_to_location_id?: string;
  status: string;
  expected_delivery_date?: string;
  notes?: string;
  created_at: string;
  vendors?: { id: string; name: string; code?: string };
  locations?: { id: string; name: string };
  purchase_order_lines?: Array<{
    id: string;
    catalog_item_id: string;
    qty_ordered: number;
    qty_received: number;
    unit_cost: number;
    status: string;
    catalog_items?: { id: string; name: string; sku: string; unit_of_measure: string };
  }>;
}

export default function PurchasingPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);

  useEffect(() => {
    fetchOrders();
  }, [filters]);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);

      const res = await fetch(`/api/inventory/purchasing?${params}`);
      const { data } = await res.json();
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

  const handleSubmitForApproval = async (poId: string, status: string) => {
    if (status !== 'draft') {
      alert(`Cannot submit PO in status: ${status}. Only draft POs can be submitted.`);
      return;
    }
    
    if (!confirm('Submit this PO for approval?')) return;
    
    try {
      const res = await fetch(`/api/inventory/purchasing/${poId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'awaiting_approval' })
      });
      
      if (!res.ok) {
        const result = await res.json();
        alert(`Error: ${result.error || 'Failed to submit PO'}`);
        return;
      }
      
      alert('PO submitted for approval!');
      fetchOrders();
    } catch (error) {
      console.error('Error submitting PO:', error);
      alert('Failed to submit PO. Please try again.');
    }
  };

  const handleApprovePO = async (poId: string, status: string) => {
    if (status !== 'awaiting_approval') {
      alert(`Cannot approve PO in status: ${status}. Only POs awaiting approval can be approved.`);
      return;
    }
    
    if (!confirm('Approve this PO?')) return;
    
    try {
      const res = await fetch(`/api/inventory/purchasing/${poId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' })
      });
      
      if (!res.ok) {
        const result = await res.json();
        alert(`Error: ${result.error || 'Failed to approve PO'}`);
        return;
      }
      
      alert('PO approved!');
      fetchOrders();
    } catch (error) {
      console.error('Error approving PO:', error);
      alert('Failed to approve PO. Please try again.');
    }
  };

  const handlePlacePO = async (poId: string, status: string) => {
    if (status !== 'approved') {
      alert(`Cannot place PO in status: ${status}. Only approved POs can be placed.`);
      return;
    }
    
    if (!confirm('Place this PO with vendor?')) return;
    
    try {
      const res = await fetch(`/api/inventory/purchasing/${poId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'placed' })
      });
      
      if (!res.ok) {
        const result = await res.json();
        alert(`Error: ${result.error || 'Failed to place PO'}`);
        return;
      }
      
      alert('PO placed with vendor!');
      fetchOrders();
    } catch (error) {
      console.error('Error placing PO:', error);
      alert('Failed to place PO. Please try again.');
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
          <div className="font-medium">{row.vendors?.name || '-'}</div>
          {row.vendors?.code && (
            <div className="text-xs text-muted-foreground font-mono">{row.vendors.code}</div>
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
        const isPlaced = row.status === 'placed';
        const isAcknowledged = row.status === 'acknowledged';
        const isPartiallyReceived = row.status === 'partially_received';
        const isFullyReceived = row.status === 'fully_received';
        const isCancelled = row.status === 'cancelled';
        const isClosed = row.status === 'closed';
        
        return (
          <div className="flex flex-col gap-1 min-w-[120px]">
            {/* Draft state actions */}
            {isDraft && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSubmitForApproval(row.id, row.status);
                  }}
                  className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded"
                >
                  Submit for Approval
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedOrder(row);
                  }}
                  className="px-3 py-1 text-xs bg-gray-600 hover:bg-gray-700 text-white rounded"
                >
                  Edit
                </button>
              </>
            )}
            
            {/* Awaiting approval state actions */}
            {isAwaitingApproval && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleApprovePO(row.id, row.status);
                  }}
                  className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded"
                >
                  Approve
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedOrder(row);
                  }}
                  className="px-3 py-1 text-xs bg-gray-500 hover:bg-gray-600 text-white rounded"
                >
                  View Details
                </button>
              </>
            )}
            
            {/* Approved state actions */}
            {isApproved && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePlacePO(row.id, row.status);
                  }}
                  className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded"
                >
                  Place Order
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedOrder(row);
                  }}
                  className="px-3 py-1 text-xs bg-gray-500 hover:bg-gray-600 text-white rounded"
                >
                  View Details
                </button>
              </>
            )}
            
            {/* Placed/Acknowledged/Partially Received state */}
            {(isPlaced || isAcknowledged || isPartiallyReceived) && (
              <>
                {isPartiallyReceived && (
                  <span className="text-xs text-gray-600 font-medium">Receiving...</span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedOrder(row);
                  }}
                  className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded"
                >
                  {isPartiallyReceived ? 'Continue Receiving' : 'Receive Items'}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedOrder(row);
                  }}
                  className="px-3 py-1 text-xs bg-gray-500 hover:bg-gray-600 text-white rounded"
                >
                  View Details
                </button>
              </>
            )}
            
            {/* Fully received state */}
            {isFullyReceived && (
              <>
                <span className="text-xs text-green-600 font-medium">Fully Received</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedOrder(row);
                  }}
                  className="px-3 py-1 text-xs bg-gray-500 hover:bg-gray-600 text-white rounded"
                >
                  View Details
                </button>
              </>
            )}
            
            {/* Closed/Cancelled states */}
            {(isClosed || isCancelled) && (
              <>
                <span className="text-xs text-gray-600 font-medium">
                  {isClosed ? 'Closed' : 'Cancelled'}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedOrder(row);
                  }}
                  className="px-3 py-1 text-xs bg-gray-500 hover:bg-gray-600 text-white rounded"
                >
                  View Details
                </button>
              </>
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

        {selectedOrder && (
          <PODetailPanel
            po={selectedOrder}
            onClose={() => setSelectedOrder(null)}
          />
        )}

        {showCreateModal && (
          <CreatePOModal
            onClose={() => setShowCreateModal(false)}
            onCreated={() => {
              setShowCreateModal(false);
              fetchOrders();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

function PODetailPanel({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
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
            <div className="font-medium">{po.vendors?.name || '-'}</div>
          </div>
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground">Ship To</div>
            <div className="font-medium">{po.locations?.name || '-'}</div>
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
            {po.purchase_order_lines?.map((line) => (
              <div key={line.id} className="p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium">{line.catalog_items?.name || 'Unknown Item'}</div>
                  <StatusChip status={line.status} size="sm" />
                </div>
                <div className="text-xs text-muted-foreground mb-2">
                  {line.catalog_items?.sku} | {line.catalog_items?.unit_of_measure}
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
            )) || <p className="text-muted-foreground text-sm">No items</p>}
          </div>
        </div>

        {po.notes && (
          <div className="border-t pt-4">
            <h4 className="font-medium mb-2">Notes</h4>
            <p className="text-sm text-muted-foreground">{po.notes}</p>
          </div>
        )}

        <div className="border-t pt-4">
          <div className="flex gap-2">
            <a
              href={`/inventory/receiving?po=${po.id}`}
              className="flex-1 px-4 py-2 text-center bg-green-600 text-white rounded-md hover:bg-green-700"
            >
              Receive Items
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreatePOModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    vendor_id: '',
    ship_to_location_id: '',
    expected_delivery_date: '',
    notes: '',
    lines: [{ catalog_item_id: '', qty: '', unit_cost: '' }],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [vendors, setVendors] = useState<Array<{ id: string; name: string; vendor_number: string }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string; location_type?: { name: string } }>>([]);
  const [catalogItems, setCatalogItems] = useState<Array<{ id: string; sku: string; name: string }>>([]);

  useEffect(() => {
    fetchVendors();
    fetchLocations();
    fetchCatalogItems();
  }, []);

  const fetchVendors = async () => {
    try {
      const res = await fetch('/api/inventory/vendors');
      const { data } = await res.json();
      setVendors(data || []);
    } catch (error) {
      console.error('Error fetching vendors:', error);
    }
  };

  const fetchLocations = async () => {
    try {
      const res = await fetch('/api/inventory/locations');
      const { data } = await res.json();
      setLocations(data || []);
    } catch (error) {
      console.error('Error fetching locations:', error);
    }
  };

  const fetchCatalogItems = async () => {
    try {
      const res = await fetch('/api/inventory/items?limit=1000');
      const { data } = await res.json();
      setCatalogItems(data || []);
    } catch (error) {
      console.error('Error fetching catalog items:', error);
    }
  };

  const addLine = () => {
    setForm({
      ...form,
      lines: [...form.lines, { catalog_item_id: '', qty: '', unit_cost: '' }],
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
      const res = await fetch('/api/inventory/purchasing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_id: form.vendor_id,
          ship_to_location_id: form.ship_to_location_id,
          expected_delivery_date: form.expected_delivery_date || null,
          notes: form.notes || null,
          lines: form.lines
            .filter(l => l.catalog_item_id && l.qty)
            .map(l => ({
              catalog_item_id: l.catalog_item_id,
              qty: parseInt(l.qty),
              unit_cost: parseFloat(l.unit_cost) || 0,
            })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create purchase order');
      }

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
              <label className="block text-sm font-medium mb-1">Vendor *</label>
              <select
                value={form.vendor_id}
                onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                <option value="">Select a vendor...</option>
                {vendors.map(vendor => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.vendor_number} - {vendor.name}
                  </option>
                ))}
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
            <label className="block text-sm font-medium mb-1">Expected Delivery</label>
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
              {form.lines.map((line, index) => (
                <div key={index} className="flex gap-2 items-center">
                  <select
                    value={line.catalog_item_id}
                    onChange={(e) => updateLine(index, 'catalog_item_id', e.target.value)}
                    className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Select an item...</option>
                    {catalogItems.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.sku} - {item.name}
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
              {saving ? 'Creating...' : 'Create PO'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
