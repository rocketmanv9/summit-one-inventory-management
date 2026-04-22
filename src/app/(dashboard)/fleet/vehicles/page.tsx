'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface Vehicle {
  id: string;
  name: string;
  vehicle_type_id: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  description: string | null;
  notes: string | null;
  is_active: boolean;
  is_custom: boolean;
  tags: string[] | null;
}

interface CatalogVehicle {
  id: string;
  name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  description: string | null;
}

type ActiveTab = 'my-vehicles' | 'catalog';

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

export default function FleetVehiclesPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('my-vehicles');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [catalogVehicles, setCatalogVehicles] = useState<CatalogVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<string>>(new Set());
  const [adopting, setAdopting] = useState(false);
  const [notesVehicle, setNotesVehicle] = useState<Vehicle | null>(null);

  /* ---- Fetching ---- */

  const fetchVehicles = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/gv/vehicles');
      if (!res.ok) throw new Error('Failed to fetch vehicles');
      const json = await res.json();
      setVehicles(json.data || []);
    } catch (err) {
      console.error('Error fetching vehicles:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCatalog = async () => {
    setCatalogLoading(true);
    try {
      const res = await fetch('/api/gv/vehicles/catalog');
      if (!res.ok) throw new Error('Failed to fetch catalog');
      const json = await res.json();
      setCatalogVehicles(json.data || []);
    } catch (err) {
      console.error('Error fetching catalog:', err);
    } finally {
      setCatalogLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'my-vehicles') {
      fetchVehicles();
    } else if (catalogVehicles.length === 0) {
      fetchCatalog();
    }
  }, [activeTab]);

  /* ---- Handlers ---- */

  const handleRemove = async (vehicle: Vehicle) => {
    if (!confirm(`Remove "${vehicle.name}" from your fleet?`)) return;

    try {
      const res = await fetch(`/api/gv/vehicles/${vehicle.id}`, {
        method: 'DELETE',
        headers: { 'X-Idempotency-Key': crypto.randomUUID() },
      });
      if (!res.ok) throw new Error('Failed to remove vehicle');
      await fetchVehicles();
    } catch (err) {
      console.error('Error removing vehicle:', err);
      alert('Failed to remove vehicle');
    }
  };

  const handleAdopt = async () => {
    if (selectedCatalogIds.size === 0) return;
    setAdopting(true);

    try {
      const res = await fetch('/api/gv/vehicles/adopt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ catalogVehicleIds: Array.from(selectedCatalogIds) }),
      });
      if (!res.ok) throw new Error('Failed to adopt vehicles');

      setSelectedCatalogIds(new Set());
      setActiveTab('my-vehicles');
    } catch (err) {
      console.error('Error adopting vehicles:', err);
      alert('Failed to adopt selected vehicles');
    } finally {
      setAdopting(false);
    }
  };

  const toggleCatalogSelection = (id: string) => {
    setSelectedCatalogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* ---- Table config ---- */

  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row: Vehicle) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'make',
      header: 'Make',
      render: (row: Vehicle) => row.make || '-',
    },
    {
      key: 'model',
      header: 'Model',
      render: (row: Vehicle) => row.model || '-',
    },
    {
      key: 'year',
      header: 'Year',
      render: (row: Vehicle) => row.year ?? '-',
    },
    {
      key: 'source',
      header: 'Source',
      render: (row: Vehicle) => (
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
          row.is_custom
            ? 'bg-purple-100 text-purple-800'
            : 'bg-blue-100 text-blue-800'
        }`}>
          {row.is_custom ? 'Custom' : 'Catalog'}
        </span>
      ),
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (row: Vehicle) => (
        <span className="text-sm text-muted-foreground truncate max-w-[200px] block">
          {row.notes || '-'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: Vehicle) => (
        <StatusChip status={row.is_active ? 'active' : 'inactive'} />
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row: Vehicle) => (
        <div className="flex gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); setNotesVehicle(row); }}
            className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
          >
            Notes
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleRemove(row); }}
            className="px-2 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100"
          >
            Remove
          </button>
        </div>
      ),
    },
  ];

  const filterConfig = [
    { key: 'search', label: 'Search', type: 'search' as const, placeholder: 'Vehicle name...' },
  ];

  const filteredVehicles = vehicles.filter((v) => {
    if (filters.search) return v.name.toLowerCase().includes(filters.search.toLowerCase());
    return true;
  });

  /* ---- Render ---- */

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Fleet Vehicles"
          description="Reference your fleet's vehicles from inventory. Add from the shared catalog, create custom entries, or leave notes."
          actions={
            activeTab === 'my-vehicles' ? (
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                + Add Custom
              </button>
            ) : selectedCatalogIds.size > 0 ? (
              <button
                onClick={handleAdopt}
                disabled={adopting}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {adopting ? 'Adding...' : `Add Selected (${selectedCatalogIds.size})`}
              </button>
            ) : null
          }
        />

        {/* Tabs */}
        <div className="flex gap-2 border-b">
          <button
            onClick={() => setActiveTab('my-vehicles')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'my-vehicles'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            My Vehicles
          </button>
          <button
            onClick={() => setActiveTab('catalog')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'catalog'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Catalog
          </button>
        </div>

        {/* My Vehicles tab */}
        {activeTab === 'my-vehicles' && (
          <>
            <FilterBar
              filters={filterConfig}
              values={filters}
              onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
              onClear={() => setFilters({})}
            />
            <DataTable
              data={filteredVehicles}
              columns={columns}
              loading={loading}
              emptyMessage="No vehicles in your fleet yet. Add from the catalog or create a custom entry."
              rowKey={(row) => row.id}
            />
          </>
        )}

        {/* Catalog tab */}
        {activeTab === 'catalog' && (
          <>
            {catalogLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                Loading catalog...
              </div>
            ) : catalogVehicles.length === 0 ? (
              <div className="rounded-lg border bg-card p-12 text-center">
                <p className="text-muted-foreground">No catalog vehicles available.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {catalogVehicles.map((cv) => {
                  const isSelected = selectedCatalogIds.has(cv.id);
                  return (
                    <div
                      key={cv.id}
                      onClick={() => toggleCatalogSelection(cv.id)}
                      className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-medium">{cv.name}</div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {[cv.make, cv.model, cv.year].filter(Boolean).join(' / ') || 'No details'}
                          </div>
                          {cv.description && (
                            <div className="text-xs text-muted-foreground mt-2 line-clamp-2">{cv.description}</div>
                          )}
                        </div>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleCatalogSelection(cv.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="ml-3 mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Add Custom Vehicle Modal */}
        {showAddModal && (
          <AddCustomVehicleModal
            onClose={() => setShowAddModal(false)}
            onComplete={() => { setShowAddModal(false); fetchVehicles(); }}
          />
        )}

        {/* Notes Modal */}
        {notesVehicle && (
          <NotesModal
            item={notesVehicle}
            entityLabel="vehicle"
            endpoint={`/api/gv/vehicles/${notesVehicle.id}`}
            onClose={() => setNotesVehicle(null)}
            onSaved={() => { setNotesVehicle(null); fetchVehicles(); }}
          />
        )}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/*  Add Custom Vehicle Modal                                                  */
/* -------------------------------------------------------------------------- */

function AddCustomVehicleModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [form, setForm] = useState({ name: '', make: '', model: '', year: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const payload: Record<string, unknown> = { name: form.name };
      if (form.make) payload.make = form.make;
      if (form.model) payload.model = form.model;
      if (form.year) payload.year = parseInt(form.year, 10);
      if (form.notes) payload.notes = form.notes;

      const res = await fetch('/api/gv/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error?.message || 'Failed to add vehicle');
      }
      onComplete();
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
          <h3 className="text-lg font-semibold">Add Custom Vehicle to Fleet</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">X</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">{error}</div>}
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="e.g. Ford F-350 Super Duty" required />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Make</label>
              <input type="text" value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary" placeholder="Ford" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Model</label>
              <input type="text" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary" placeholder="F-350" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Year</label>
              <input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary" placeholder="2024" min="1900" max="2100" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3} placeholder="Any notes about this vehicle..." />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
              {saving ? 'Adding...' : 'Add Vehicle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Notes Modal                                                               */
/* -------------------------------------------------------------------------- */

function NotesModal({
  item,
  entityLabel,
  endpoint,
  onClose,
  onSaved,
}: {
  item: { id: string; name: string; notes: string | null };
  entityLabel: string;
  endpoint: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [notes, setNotes] = useState(item.notes || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) throw new Error(`Failed to update ${entityLabel} notes`);
      onSaved();
    } catch (err) {
      console.error(`Error updating ${entityLabel} notes:`, err);
      alert('Failed to save notes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Notes — {item.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">X</button>
        </div>
        <div className="p-6 space-y-4">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            rows={5}
            placeholder={`Notes about this ${entityLabel}...`}
          />
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Notes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
