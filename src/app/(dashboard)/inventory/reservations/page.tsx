'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';

interface Reservation {
  id: string;
  catalog_item_id: string;
  location_id: string;
  qty: number;
  reservation_type: 'fungible' | 'serialized';
  asset_id?: string;
  allocation_type: 'job' | 'project' | 'customer_order' | 'internal_order' | 'other' | null;
  status: string;
  job_ref?: string;
  external_order_ref?: string;
  needed_by?: string;
  expiration_date?: string;
  created_at: string;
  catalog_items?: { id: string; name: string; sku: string; tracking_mode?: string };
  locations?: { id: string; name: string };
  assets?: { id: string; asset_tag: string; serial_number?: string; vin?: string };
}

export default function ReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);

  useEffect(() => {
    fetchReservations();
  }, [filters]);

  const fetchReservations = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.allocation_type) params.set('allocation_type', filters.allocation_type);

      const res = await fetch(`/api/inventory/reservations?${params}`);
      const { data } = await res.json();
      setReservations(data || []);
    } catch (error) {
      console.error('Error fetching reservations:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFulfill = async (reservationId: string, status: string) => {
    // Validation: Check if action is allowed in current state
    if (status !== 'active') {
      alert(`Cannot fulfill reservation in status: ${status}. Only active reservations can be fulfilled.`);
      return;
    }

    if (!confirm('Fulfill this reservation? This will issue the stock and reduce on-hand quantity.')) {
      return;
    }

    try {
      const res = await fetch(`/api/inventory/reservations/${reservationId}/fulfill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          last_event_id: `fulfill_${reservationId}_${Date.now()}`
        })
      });
      
      const result = await res.json();
      
      if (!res.ok) {
        // Show specific error message
        alert(`Error: ${result.error}${result.code ? ` (${result.code})` : ''}`);
        return;
      }
      
      alert('Reservation fulfilled successfully!');
      fetchReservations();
    } catch (error) {
      console.error('Error fulfilling reservation:', error);
      alert('Failed to fulfill reservation. Please try again.');
    }
  };

  const handleRelease = async (reservationId: string, status: string) => {
    // Validation: Check if action is allowed in current state
    if (status !== 'active') {
      alert(`Cannot release reservation in status: ${status}. Only active reservations can be released.`);
      return;
    }

    if (!confirm('Release this reservation? The stock will become available again without issuing.')) {
      return;
    }

    try {
      const res = await fetch(`/api/inventory/reservations/${reservationId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          last_event_id: `release_${reservationId}_${Date.now()}`
        })
      });
      
      const result = await res.json();
      
      if (!res.ok) {
        // Show specific error message
        alert(`Error: ${result.error}${result.code ? ` (${result.code})` : ''}`);
        return;
      }
      
      alert('Reservation released successfully!');
      fetchReservations();
    } catch (error) {
      console.error('Error releasing reservation:', error);
      alert('Failed to release reservation. Please try again.');
    }
  };

  const handleUndoFulfill = async (reservationId: string) => {
    if (!confirm('Undo fulfillment? This will restore the reservation to active status and return stock (if fungible).')) {
      return;
    }

    try {
      const res = await fetch(`/api/inventory/reservations/${reservationId}/undo-fulfill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          last_event_id: `undo_fulfill_${reservationId}_${Date.now()}`
        })
      });
      
      const result = await res.json();
      
      if (!res.ok) {
        alert(`Error: ${result.error}`);
        return;
      }
      
      alert('Fulfillment reversed successfully!');
      fetchReservations();
    } catch (error) {
      console.error('Error undoing fulfillment:', error);
      alert('Failed to undo fulfillment. Please try again.');
    }
  };

  const handleUndoRelease = async (reservationId: string) => {
    if (!confirm('Undo release? This will restore the reservation to active status and re-reserve the stock/asset.')) {
      return;
    }

    try {
      const res = await fetch(`/api/inventory/reservations/${reservationId}/undo-release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          last_event_id: `undo_release_${reservationId}_${Date.now()}`
        })
      });
      
      const result = await res.json();
      
      if (!res.ok) {
        alert(`Error: ${result.error}`);
        return;
      }
      
      alert('Release reversed successfully!');
      fetchReservations();
    } catch (error) {
      console.error('Error undoing release:', error);
      alert('Failed to undo release. Please try again.');
    }
  };

  const columns = [
    {
      key: 'item',
      header: 'Item',
      sortable: true,
      render: (row: Reservation) => (
        <div>
          <div className="font-medium">{row.catalog_items?.name || '-'}</div>
          <div className="text-xs text-muted-foreground">
            {row.catalog_items?.sku || ''}
            {row.reservation_type === 'serialized' && row.assets && (
              <span className="ml-2 text-blue-600">
                🏷️ {row.assets.asset_tag}
                {row.assets.serial_number && ` (${row.assets.serial_number})`}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'qty',
      header: 'Qty',
      className: 'text-right font-mono',
      render: (row: Reservation) => (
        <div>
          <div>{row.qty.toLocaleString()}</div>
          {row.reservation_type && (
            <div className="text-xs text-muted-foreground">
              {row.reservation_type === 'serialized' ? '(Asset)' : '(Stock)'}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      render: (row: Reservation) => row.locations?.name || '-',
    },
    {
      key: 'allocation_type',
      header: 'Type',
      render: (row: Reservation) => (
        <StatusChip status={row.allocation_type} />
      ),
    },
    {
      key: 'job_ref',
      header: 'Job/Order',
      render: (row: Reservation) => {
        let jobRefText = null;
        if (row.job_ref) {
          try {
            const jobData = typeof row.job_ref === 'string' ? JSON.parse(row.job_ref) : row.job_ref;
            jobRefText = jobData?.job_name || jobData?.job_id || null;
          } catch {
            jobRefText = row.job_ref;
          }
        }
        
        return (
          <div>
            {jobRefText && <div className="font-mono text-sm">{jobRefText}</div>}
            {row.external_order_ref && (
              <div className="text-xs text-muted-foreground">{row.external_order_ref}</div>
            )}
            {!jobRefText && !row.external_order_ref && '-'}
          </div>
        );
      },
    },
    {
      key: 'needed_by',
      header: 'Needed By',
      render: (row: Reservation) => {
        if (!row.needed_by) return '-';
        const date = new Date(row.needed_by);
        const isOverdue = date < new Date();
        return (
          <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
            {date.toLocaleDateString()}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: Reservation) => (
        <StatusChip status={row.status} />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: Reservation) => {
        const isActive = row.status === 'active';
        const isFulfilled = row.status === 'fulfilled';
        const isExpired = row.status === 'expired';
        const isReleased = row.status === 'released';
        
        return (
          <div className="flex gap-2">
            {/* Fulfill button - only enabled for active reservations */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleFulfill(row.id, row.status);
              }}
              disabled={!isActive}
              className={`px-3 py-1 text-sm rounded ${
                isActive
                  ? 'bg-green-600 hover:bg-green-700 text-white cursor-pointer'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
              title={
                isActive
                  ? 'Issue stock and fulfill reservation'
                  : isFulfilled
                  ? 'Already fulfilled'
                  : isExpired
                  ? 'Cannot fulfill expired reservation'
                  : 'Cannot fulfill in current status'
              }
            >
              Fulfill
            </button>
            
            {/* Release button - only enabled for active reservations */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRelease(row.id, row.status);
              }}
              disabled={!isActive}
              className={`px-3 py-1 text-sm rounded ${
                isActive
                  ? 'bg-yellow-600 hover:bg-yellow-700 text-white cursor-pointer'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
              title={
                isActive
                  ? 'Release reservation without issuing stock'
                  : isFulfilled
                  ? 'Already fulfilled'
                  : isReleased
                  ? 'Already released'
                  : 'Cannot release in current status'
              }
            >
              Release
            </button>
            
            {/* Undo Fulfill button - only for fulfilled reservations */}
            {isFulfilled && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleUndoFulfill(row.id);
                }}
                className="px-3 py-1 text-sm rounded bg-orange-600 hover:bg-orange-700 text-white"
                title="Undo fulfillment - restore to active status"
              >
                Undo
              </button>
            )}
            
            {/* Undo Release button - only for released reservations */}
            {isReleased && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleUndoRelease(row.id);
                }}
                className="px-3 py-1 text-sm rounded bg-orange-600 hover:bg-orange-700 text-white"
                title="Undo release - restore to active status"
              >
                Undo
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
        { value: 'active', label: 'Active' },
        { value: 'fulfilled', label: 'Fulfilled' },
        { value: 'cancelled', label: 'Cancelled' },
        { value: 'expired', label: 'Expired' },
      ],
    },
    {
      key: 'allocation_type',
      label: 'Type',
      type: 'select' as const,
      options: [
        { value: 'soft', label: 'Soft' },
        { value: 'hard', label: 'Hard' },
        { value: 'kit', label: 'Kit' },
      ],
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Reservations"
          description="Manage stock reservations and allocations. Example: Reserve 300 tons of asphalt for the State Route 12 project starting next week, ensuring it's not allocated to other jobs, then release it when the material is issued to the job site."
          actions={
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              + Create Reservation
            </button>
          }
        />

        <div className="grid grid-cols-4 gap-4">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="text-2xl font-bold text-blue-700">
              {reservations.filter(r => r.status === 'active').length}
            </div>
            <div className="text-sm text-blue-600">Active</div>
          </div>
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="text-2xl font-bold text-green-700">
              {reservations.filter(r => r.status === 'fulfilled').length}
            </div>
            <div className="text-sm text-green-600">Fulfilled</div>
          </div>
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="text-2xl font-bold text-red-700">
              {reservations.filter(r => {
                if (!r.needed_by) return false;
                return new Date(r.needed_by) < new Date() && r.status === 'active';
              }).length}
            </div>
            <div className="text-sm text-red-600">Overdue</div>
          </div>
          <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
            <div className="text-2xl font-bold text-purple-700">
              {reservations.filter(r => r.allocation_type === 'kit').length}
            </div>
            <div className="text-sm text-purple-600">Kits</div>
          </div>
        </div>

        <FilterBar
          filters={filterConfig}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClear={() => setFilters({})}
        />

        <DataTable
          data={reservations}
          columns={columns}
          loading={loading}
          emptyMessage="No reservations found"
          rowKey={(row) => row.id}
        />

        {showCreateModal && (
          <CreateReservationModal
            onClose={() => setShowCreateModal(false)}
            onCreated={() => {
              setShowCreateModal(false);
              fetchReservations();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

// CreateReservationModal Component
interface CreateReservationModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function CreateReservationModal({ onClose, onCreated }: CreateReservationModalProps) {
  const [form, setForm] = useState({
    catalog_item_id: '',
    asset_id: '',
    location_id: '',
    qty: '',
    allocation_type: 'other',
    job_ref: '',
    external_order_ref: '',
    needed_by: '',
  });
  const [catalogItems, setCatalogItems] = useState<{ id: string; name: string; sku: string; tracking_mode?: string }[]>([]);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [availableAssets, setAvailableAssets] = useState<{ asset_id: string; asset_tag: string; serial_number?: string; is_available: boolean }[]>([]);
  const [selectedItem, setSelectedItem] = useState<{ tracking_mode?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchCatalogItems();
    fetchLocations();
  }, []);

  useEffect(() => {
    // When catalog item changes, fetch available assets if it's serialized
    if (form.catalog_item_id) {
      const item = catalogItems.find(i => i.id === form.catalog_item_id);
      setSelectedItem(item || null);
      
      if (item?.tracking_mode === 'serialized') {
        fetchAvailableAssets();
      } else {
        setAvailableAssets([]);
        setForm(prev => ({ ...prev, asset_id: '' }));
      }
    }
  }, [form.catalog_item_id, form.location_id]);

  const fetchCatalogItems = async () => {
    try {
      const res = await fetch('/api/inventory/items');
      const { data } = await res.json();
      setCatalogItems(data || []);
    } catch (error) {
      console.error('Error fetching catalog items:', error);
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

  const fetchAvailableAssets = async () => {
    if (!form.catalog_item_id) return;
    
    try {
      const params = new URLSearchParams({ catalog_item_id: form.catalog_item_id });
      if (form.location_id) params.set('location_id', form.location_id);
      
      const res = await fetch(`/api/inventory/assets/available?${params}`);
      const { data } = await res.json();
      setAvailableAssets(data || []);
    } catch (error) {
      console.error('Error fetching available assets:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const payload: any = {
        allocation_type: form.allocation_type,
        job_ref: form.job_ref || null,
        external_order_ref: form.external_order_ref || null,
        needed_by: form.needed_by || null,
      };

      // Add fields based on reservation type
      if (selectedItem?.tracking_mode === 'serialized') {
        // Serialized reservation
        if (!form.asset_id) {
          throw new Error('Please select an asset');
        }
        payload.asset_id = form.asset_id;
      } else {
        // Fungible reservation
        if (!form.qty || parseInt(form.qty) <= 0) {
          throw new Error('Please enter a valid quantity');
        }
        payload.catalog_item_id = form.catalog_item_id;
        payload.location_id = form.location_id;
        payload.qty = parseInt(form.qty);
      }

      const res = await fetch('/api/inventory/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Failed to create reservation');
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
      <div className="bg-white rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-semibold mb-4">Create Reservation</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Item *</label>
            <select
              value={form.catalog_item_id}
              onChange={(e) => setForm({ ...form, catalog_item_id: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              required
            >
              <option value="">Select an item...</option>
              {catalogItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sku} - {item.name}
                  {item.tracking_mode === 'serialized' && ' (Serialized)'}
                </option>
              ))}
            </select>
            {selectedItem?.tracking_mode === 'serialized' && (
              <p className="text-xs text-blue-600 mt-1">
                📦 This is a serialized item - you'll select a specific asset below
              </p>
            )}
          </div>

          {selectedItem?.tracking_mode === 'serialized' ? (
            /* Serialized asset selection */
            <div>
              <label className="block text-sm font-medium mb-1">Select Asset *</label>
              <select
                value={form.asset_id}
                onChange={(e) => setForm({ ...form, asset_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                <option value="">Select an asset...</option>
                {availableAssets.map((asset) => (
                  <option 
                    key={asset.asset_id} 
                    value={asset.asset_id}
                    disabled={!asset.is_available}
                  >
                    {asset.asset_tag}
                    {asset.serial_number && ` - ${asset.serial_number}`}
                    {!asset.is_available && ' (Reserved)'}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            /* Fungible location/qty selection */
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Location *</label>
                <select
                  value={form.location_id}
                  onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  required={selectedItem?.tracking_mode !== 'serialized'}
                >
                  <option value="">Select a location...</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Quantity *</label>
                <input
                  type="number"
                  value={form.qty}
                  onChange={(e) => setForm({ ...form, qty: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  min="1"
                  required={selectedItem?.tracking_mode !== 'serialized'}
                />
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <select
                value={form.allocation_type}
                onChange={(e) => setForm({ ...form, allocation_type: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="job">Job</option>
                <option value="project">Project</option>
                <option value="customer_order">Customer Order</option>
                <option value="internal_order">Internal Order</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Job Reference</label>
              <input
                type="text"
                value={form.job_ref}
                onChange={(e) => setForm({ ...form, job_ref: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Job number..."
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Needed By</label>
            <input
              type="date"
              value={form.needed_by}
              onChange={(e) => setForm({ ...form, needed_by: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
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
              {saving ? 'Creating...' : 'Create Reservation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
