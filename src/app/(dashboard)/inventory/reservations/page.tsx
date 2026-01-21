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
  allocation_type: 'soft' | 'hard' | 'kit';
  status: string;
  job_ref?: string;
  external_order_ref?: string;
  needed_by?: string;
  expiration_date?: string;
  created_at: string;
  catalog_items?: { id: string; name: string; sku: string };
  locations?: { id: string; name: string };
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

  const columns = [
    {
      key: 'item',
      header: 'Item',
      sortable: true,
      render: (row: Reservation) => (
        <div>
          <div className="font-medium">{row.catalog_items?.name || '-'}</div>
          <div className="text-xs text-muted-foreground">{row.catalog_items?.sku || ''}</div>
        </div>
      ),
    },
    {
      key: 'qty',
      header: 'Qty',
      className: 'text-right font-mono',
      render: (row: Reservation) => row.qty.toLocaleString(),
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

function CreateReservationModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    catalog_item_id: '',
    location_id: '',
    qty: '',
    allocation_type: 'soft',
    job_ref: '',
    external_order_ref: '',
    needed_by: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const res = await fetch('/api/inventory/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          qty: parseInt(form.qty),
          needed_by: form.needed_by || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create reservation');
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
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Create Reservation</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Item ID *</label>
            <input
              type="text"
              value={form.catalog_item_id}
              onChange={(e) => setForm({ ...form, catalog_item_id: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              placeholder="Catalog Item UUID"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Location ID *</label>
            <input
              type="text"
              value={form.location_id}
              onChange={(e) => setForm({ ...form, location_id: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              placeholder="Location UUID"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Quantity *</label>
              <input
                type="number"
                value={form.qty}
                onChange={(e) => setForm({ ...form, qty: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                min="1"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <select
                value={form.allocation_type}
                onChange={(e) => setForm({ ...form, allocation_type: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="soft">Soft</option>
                <option value="hard">Hard</option>
                <option value="kit">Kit</option>
              </select>
            </div>
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

          <div>
            <label className="block text-sm font-medium mb-1">Needed By</label>
            <input
              type="date"
              value={form.needed_by}
              onChange={(e) => setForm({ ...form, needed_by: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

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
