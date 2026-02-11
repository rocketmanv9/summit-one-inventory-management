'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { InventoryRPC } from '@/lib/rpc/inventory';

interface Reservation {
  id: string;
  catalog_item_id: string;
  location_id: string | null;
  destination_location_id: string | null;
  qty: number;
  reservation_type: string | null;
  asset_id: string | null;
  allocation_type: string | null;
  status: string | null;
  job_ref: Record<string, unknown> | string | null;
  external_order_ref: string | null;
  needed_by: string | null;
  expiration_date: string | null;
  reserved_from: string | null;
  reserved_until: string | null;
  notes: string | null;
  created_at: string;
  last_event_id: string | null;
  catalog_items?: { id: string; name: string; sku: string; tracking_mode?: string } | null;
  locations?: { id: string; name: string } | null;
  destination_locations?: { id: string; name: string } | null;
  assets?: { id: string; asset_tag: string; serial_number?: string | null; vin?: string | null } | null;
}

export default function ReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [reservationTypes, setReservationTypes] = useState<
    Array<{ type_key: string; display_name: string; is_active: boolean }>
  >([]);

  useEffect(() => {
    fetchReservations();
  }, [filters]);

  useEffect(() => {
    fetchReservationTypes();
  }, []);

  const fetchReservations = async () => {
    setLoading(true);
    try {
      const data = await InventoryRPC.getReservations({
        status: filters.status || undefined,
        allocation_type: filters.allocation_type || undefined,
      });
      setReservations(data || []);
    } catch (error) {
      console.error('Error fetching reservations:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchReservationTypes = async () => {
    try {
      const data = await InventoryRPC.getReservationTypes({ includeInactive: false });
      setReservationTypes(
        (data || []).map((type) => ({
          type_key: type.type_key,
          display_name: type.display_name,
          is_active: type.is_active,
        }))
      );
    } catch (error) {
      console.error('Error fetching reservation types:', error);
    }
  };

  const allocationTypeLabel = (typeKey?: string | null) => {
    if (!typeKey) return '';
    const match = reservationTypes.find((type) => type.type_key === typeKey);
    return match?.display_name || typeKey;
  };

  const handleFulfill = async (reservation: Reservation) => {
    // Validation: Check if action is allowed in current state
    if (reservation.status !== 'active') {
      alert(`Cannot fulfill reservation in status: ${reservation.status}. Only active reservations can be fulfilled.`);
      return;
    }

    if (!confirm('Fulfill this reservation? This will issue the stock and reduce on-hand quantity.')) {
      return;
    }

    try {
      if (!reservation.last_event_id) {
        throw new Error('Missing last_event_id for this reservation. Please refresh and try again.');
      }

      await InventoryRPC.fulfillReservation(reservation.id, reservation.last_event_id);
      
      alert('Reservation fulfilled successfully!');
      fetchReservations();
    } catch (error) {
      console.error('Error fulfilling reservation:', error);
      alert('Failed to fulfill reservation. Please try again.');
    }
  };

  const handleRelease = async (reservation: Reservation) => {
    // Validation: Check if action is allowed in current state
    if (reservation.status !== 'active') {
      alert(`Cannot release reservation in status: ${reservation.status}. Only active reservations can be released.`);
      return;
    }

    if (!confirm('Release this reservation? The stock will become available again without issuing.')) {
      return;
    }

    try {
      if (!reservation.last_event_id) {
        throw new Error('Missing last_event_id for this reservation. Please refresh and try again.');
      }

      await InventoryRPC.releaseReservation(reservation.id, reservation.last_event_id);
      
      alert('Reservation released successfully!');
      fetchReservations();
    } catch (error) {
      console.error('Error releasing reservation:', error);
      alert('Failed to release reservation. Please try again.');
    }
  };

  const handleUndoFulfill = async (reservation: Reservation) => {
    if (!confirm('Undo fulfillment? This will restore the reservation to active status and return stock (if fungible).')) {
      return;
    }

    try {
      if (!reservation.last_event_id) {
        throw new Error('Missing last_event_id for this reservation. Please refresh and try again.');
      }

      await InventoryRPC.undoFulfillReservation(reservation.id, reservation.last_event_id);
      
      alert('Fulfillment reversed successfully!');
      fetchReservations();
    } catch (error) {
      console.error('Error undoing fulfillment:', error);
      alert('Failed to undo fulfillment. Please try again.');
    }
  };

  const handleUndoRelease = async (reservation: Reservation) => {
    if (!confirm('Undo release? This will restore the reservation to active status and re-reserve the stock/asset.')) {
      return;
    }

    try {
      if (!reservation.last_event_id) {
        throw new Error('Missing last_event_id for this reservation. Please refresh and try again.');
      }

      await InventoryRPC.undoReleaseReservation(reservation.id, reservation.last_event_id);
      
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
                {row.assets.asset_tag}
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
      key: 'destination',
      header: 'Needed At',
      render: (row: Reservation) => row.destination_locations?.name || '-',
    },
    {
      key: 'allocation_type',
      header: 'Type',
      render: (row: Reservation) => (
        <span className="inline-flex px-2 py-1 text-xs font-medium rounded bg-gray-100 text-gray-700">
          {allocationTypeLabel(row.allocation_type) || '—'}
        </span>
      ),
    },
    {
      key: 'job_ref',
      header: 'Job/Order',
      render: (row: Reservation) => {
        const jobText = row.job_ref ? String(row.job_ref) : '';
        return (
          <div>
            {jobText && <div className="font-mono text-sm">{jobText}</div>}
            {row.external_order_ref && (
              <div className="text-xs text-muted-foreground">{row.external_order_ref}</div>
            )}
            {!jobText && !row.external_order_ref && '-'}
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
      key: 'reserved_window',
      header: 'Reserved',
      render: (row: Reservation) => {
        if (!row.reserved_from || !row.reserved_until) return '-';
        const from = new Date(row.reserved_from);
        const until = new Date(row.reserved_until);
        return (
          <div className="text-sm">
            <div>{from.toLocaleDateString()}</div>
            <div className="text-xs text-muted-foreground">to {until.toLocaleDateString()}</div>
          </div>
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
                handleFulfill(row);
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
                handleRelease(row);
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
                  handleUndoFulfill(row);
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
                  handleUndoRelease(row);
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
        { value: 'released', label: 'Released' },
        { value: 'cancelled', label: 'Cancelled' },
        { value: 'expired', label: 'Expired' },
      ],
    },
    {
      key: 'allocation_type',
      label: 'Type',
      type: 'select' as const,
      options: reservationTypes.map((type) => ({
        value: type.type_key,
        label: type.display_name,
      })),
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Reservations"
          description="Manage stock reservations and allocations. Example: Reserve 300 tons of asphalt for the State Route 12 project starting next week, ensuring it's not allocated to other jobs, then release it when the material is issued to the job site."
          actions={
            <div className="flex gap-2">
              <a
                href="/settings/reservation-types"
                className="px-4 py-2 border border-gray-200 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
              >
                Manage Types
              </a>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                + Create Reservation
              </button>
            </div>
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
              {reservations.filter(r => r.allocation_type === 'internal_order').length}
            </div>
            <div className="text-sm text-purple-600">Internal</div>
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
            reservationTypes={reservationTypes}
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
  reservationTypes: Array<{ type_key: string; display_name: string; is_active: boolean }>;
}

function CreateReservationModal({ onClose, onCreated, reservationTypes }: CreateReservationModalProps) {
  const [form, setForm] = useState({
    catalog_item_id: '',
    asset_ids: [] as string[],
    location_id: '',
    destination_location_id: '',
    qty: '',
    allocation_type: 'other',
    job_ref: '',
    external_order_ref: '',
    needed_by: '',
    reserved_from: '',
    reserved_until: '',
    notes: '',
  });
  const [catalogItems, setCatalogItems] = useState<{ id: string; name: string; sku: string; tracking_mode?: string }[]>([]);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [availableAssets, setAvailableAssets] = useState<{ asset_id: string; asset_tag: string; serial_number?: string | null; location_id?: string | null; location_name?: string | null; is_available: boolean }[]>([]);
  const [selectedItem, setSelectedItem] = useState<{ tracking_mode?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isSerializedItem = (mode?: string) => {
    const value = mode || 'stock';
    return value === 'serialized' || value === 'both' || value === 'hybrid';
  };
  const typeOptions = reservationTypes.length > 0
    ? reservationTypes
    : [
        { type_key: 'job', display_name: 'Job', is_active: true },
        { type_key: 'project', display_name: 'Project', is_active: true },
        { type_key: 'customer_order', display_name: 'Customer Order', is_active: true },
        { type_key: 'internal_order', display_name: 'Internal Order', is_active: true },
        { type_key: 'other', display_name: 'Other', is_active: true },
      ];

  useEffect(() => {
    if (!typeOptions.length) return;
    if (!typeOptions.some((type) => type.type_key === form.allocation_type)) {
      setForm((prev) => ({ ...prev, allocation_type: typeOptions[0].type_key }));
    }
  }, [typeOptions.map((type) => type.type_key).join('|')]);

  useEffect(() => {
    fetchCatalogItems();
    fetchLocations();
  }, []);

  useEffect(() => {
    // When catalog item changes, fetch available assets if it's serialized
    if (form.catalog_item_id) {
      const item = catalogItems.find(i => i.id === form.catalog_item_id);
      setSelectedItem(item || null);

      const mode = item?.tracking_mode || 'stock';
      const isSerialized = mode === 'serialized' || mode === 'both' || mode === 'hybrid';

      if (isSerialized) {
        fetchAvailableAssets();
      } else {
        setAvailableAssets([]);
        setForm(prev => ({ ...prev, asset_ids: [] }));
      }
    }
  }, [form.catalog_item_id, form.location_id, form.reserved_from, form.reserved_until]);

  const fetchCatalogItems = async () => {
    try {
      const data = await InventoryRPC.getCatalogItems({ active: true });
      setCatalogItems((data || []).map((item) => ({
        id: item.id,
        name: item.name,
        sku: item.sku,
        tracking_mode: item.tracking_mode,
      })));
    } catch (error) {
      console.error('Error fetching catalog items:', error);
    }
  };

  const fetchLocations = async () => {
    try {
      const data = await InventoryRPC.getLocations({ active: true });
      setLocations((data || []).map((location) => ({
        id: location.id,
        name: location.name,
      })));
    } catch (error) {
      console.error('Error fetching locations:', error);
    }
  };

  const fetchAvailableAssets = async () => {
    if (!form.catalog_item_id) return;

    try {
      const reservedFrom = form.reserved_from ? new Date(form.reserved_from).toISOString() : null;
      const reservedUntil = form.reserved_until ? new Date(form.reserved_until).toISOString() : null;

      if ((reservedFrom && !reservedUntil) || (!reservedFrom && reservedUntil)) {
        setAvailableAssets([]);
        return;
      }

      const data = await InventoryRPC.findAvailableAssets({
        catalog_item_id: form.catalog_item_id,
        location_id: form.location_id || null,
        reserved_from: reservedFrom,
        reserved_until: reservedUntil,
      });
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
      if ((form.reserved_from && !form.reserved_until) || (!form.reserved_from && form.reserved_until)) {
        throw new Error('Please set both Reserve From and Reserve Until, or leave both blank.');
      }

      const reservedFrom = form.reserved_from ? new Date(form.reserved_from).toISOString() : null;
      const reservedUntil = form.reserved_until ? new Date(form.reserved_until).toISOString() : null;

      const basePayload = {
        allocation_type: form.allocation_type,
        job_ref: form.job_ref || null,
        external_order_ref: form.external_order_ref || null,
        needed_by: form.needed_by || null,
        reserved_from: reservedFrom,
        reserved_until: reservedUntil,
        notes: form.notes || null,
        destination_location_id: form.destination_location_id || null,
      };

      // Add fields based on reservation type
      if (isSerializedItem(selectedItem?.tracking_mode)) {
        // Serialized reservation
        if (form.asset_ids.length === 0) {
          throw new Error('Please select at least one asset');
        }
        for (const assetId of form.asset_ids) {
          await InventoryRPC.reserveAsset({
            asset_id: assetId,
            allocation_type: basePayload.allocation_type,
            job_ref: basePayload.job_ref,
            external_order_ref: basePayload.external_order_ref,
            needed_by: basePayload.needed_by,
            reserved_from: basePayload.reserved_from,
            reserved_until: basePayload.reserved_until,
            notes: basePayload.notes,
            destination_location_id: basePayload.destination_location_id,
            last_event_id: crypto.randomUUID(),
          });
        }
      } else {
        // Fungible reservation
        if (!form.qty || parseInt(form.qty) <= 0) {
          throw new Error('Please enter a valid quantity');
        }
        if (!form.location_id) {
          throw new Error('Please select a location');
        }
        await InventoryRPC.reserveFungible({
          catalog_item_id: form.catalog_item_id,
          location_id: form.location_id,
          qty: parseInt(form.qty),
          allocation_type: basePayload.allocation_type,
          job_ref: basePayload.job_ref,
          external_order_ref: basePayload.external_order_ref,
          needed_by: basePayload.needed_by,
          reserved_from: basePayload.reserved_from,
          reserved_until: basePayload.reserved_until,
          notes: basePayload.notes,
          destination_location_id: basePayload.destination_location_id,
          last_event_id: crypto.randomUUID(),
        });
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
                  {isSerializedItem(item.tracking_mode) && ' (Serialized)'}
                </option>
              ))}
            </select>
            {isSerializedItem(selectedItem?.tracking_mode) && (
              <p className="text-xs text-blue-600 mt-1">
                📦 This is a serialized item - you'll select a specific asset below
              </p>
            )}
          </div>

          {isSerializedItem(selectedItem?.tracking_mode) ? (
            /* Serialized asset selection */
            <div>
              <label className="block text-sm font-medium mb-1">Filter by Location (optional)</label>
              <select
                value={form.location_id}
                onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary mb-3"
              >
                <option value="">All locations</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>

              <label className="block text-sm font-medium mb-1">Select Asset *</label>
              <div className="space-y-2 max-h-40 overflow-y-auto rounded-md border p-2">
                {availableAssets.length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    No matching assets found.
                  </div>
                )}
                {availableAssets.map((asset) => {
                  const checked = form.asset_ids.includes(asset.asset_id);
                  return (
                    <label key={asset.asset_id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!asset.is_available}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...form.asset_ids, asset.asset_id]
                            : form.asset_ids.filter((id) => id !== asset.asset_id);
                          setForm({ ...form, asset_ids: next });
                        }}
                      />
                      <span className={asset.is_available ? '' : 'text-muted-foreground'}>
                        {asset.asset_tag}
                        {asset.serial_number && ` - ${asset.serial_number}`}
                        {asset.location_name && ` (${asset.location_name})`}
                        {!asset.is_available && ' (Reserved)'}
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Selected: {form.asset_ids.length}
              </p>
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
                  required={!isSerializedItem(selectedItem?.tracking_mode)}
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
                  required={!isSerializedItem(selectedItem?.tracking_mode)}
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Destination Needed At</label>
            <select
              value={form.destination_location_id}
              onChange={(e) => setForm({ ...form, destination_location_id: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Select destination (optional)...</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
            {form.destination_location_id && form.asset_ids.length > 0 && (() => {
              const selectedAssets = availableAssets.filter((asset) => form.asset_ids.includes(asset.asset_id));
              const mismatched = selectedAssets.filter((asset) => asset.location_id && asset.location_id !== form.destination_location_id);
              if (mismatched.length === 0) return null;
              return (
                <p className="text-xs text-amber-600 mt-1">
                  {mismatched.length} selected asset{mismatched.length === 1 ? '' : 's'} are at a different location. Consider a transfer before the reserved window.
                </p>
              );
            })()}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <select
                value={form.allocation_type}
                onChange={(e) => setForm({ ...form, allocation_type: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {typeOptions.map((type) => (
                  <option key={type.type_key} value={type.type_key}>
                    {type.display_name}
                  </option>
                ))}
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Reserve From</label>
              <input
                type="datetime-local"
                value={form.reserved_from}
                onChange={(e) => setForm({ ...form, reserved_from: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Reserve Until</label>
              <input
                type="datetime-local"
                value={form.reserved_until}
                onChange={(e) => setForm({ ...form, reserved_until: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3}
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
