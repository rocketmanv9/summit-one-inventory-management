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

interface Equipment {
  id: string;
  name: string;
  equipment_type_id: string | null;
  manufacturer: string | null;
  model: string | null;
  description: string | null;
  notes: string | null;
  is_active: boolean;
  is_custom: boolean;
  tags: string[] | null;
}

interface CatalogEquipment {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  description: string | null;
}

type ActiveTab = 'my-equipment' | 'catalog';

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

export default function FleetEquipmentPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('my-equipment');
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [catalog, setCatalog] = useState<CatalogEquipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<string>>(new Set());
  const [adopting, setAdopting] = useState(false);
  const [notesItem, setNotesItem] = useState<Equipment | null>(null);

  /* ---- Fetching ---- */

  const fetchEquipment = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/gv/equipment');
      if (!res.ok) throw new Error('Failed to fetch equipment');
      const json = await res.json();
      setEquipment(json.data || []);
    } catch (err) {
      console.error('Error fetching equipment:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCatalog = async () => {
    setCatalogLoading(true);
    try {
      const res = await fetch('/api/gv/equipment/catalog');
      if (!res.ok) throw new Error('Failed to fetch catalog');
      const json = await res.json();
      setCatalog(json.data || []);
    } catch (err) {
      console.error('Error fetching catalog:', err);
    } finally {
      setCatalogLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'my-equipment') {
      fetchEquipment();
    } else if (catalog.length === 0) {
      fetchCatalog();
    }
  }, [activeTab]);

  /* ---- Handlers ---- */

  const handleRemove = async (item: Equipment) => {
    if (!confirm(`Remove "${item.name}" from your fleet?`)) return;

    try {
      const res = await fetch(`/api/gv/equipment/${item.id}`, {
        method: 'DELETE',
        headers: { 'X-Idempotency-Key': crypto.randomUUID() },
      });
      if (!res.ok) throw new Error('Failed to remove equipment');
      await fetchEquipment();
    } catch (err) {
      console.error('Error removing equipment:', err);
      alert('Failed to remove equipment');
    }
  };

  const handleAdopt = async () => {
    if (selectedCatalogIds.size === 0) return;
    setAdopting(true);

    try {
      const res = await fetch('/api/gv/equipment/adopt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ catalogEquipmentIds: Array.from(selectedCatalogIds) }),
      });
      if (!res.ok) throw new Error('Failed to adopt equipment');

      setSelectedCatalogIds(new Set());
      setActiveTab('my-equipment');
    } catch (err) {
      console.error('Error adopting equipment:', err);
      alert('Failed to adopt selected equipment');
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
      render: (row: Equipment) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'manufacturer',
      header: 'Manufacturer',
      render: (row: Equipment) => row.manufacturer || '-',
    },
    {
      key: 'model',
      header: 'Model',
      render: (row: Equipment) => row.model || '-',
    },
    {
      key: 'source',
      header: 'Source',
      render: (row: Equipment) => (
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
      render: (row: Equipment) => (
        <span className="text-sm text-muted-foreground truncate max-w-[200px] block">
          {row.notes || '-'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: Equipment) => (
        <StatusChip status={row.is_active ? 'active' : 'inactive'} />
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row: Equipment) => (
        <div className="flex gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); setNotesItem(row); }}
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
    { key: 'search', label: 'Search', type: 'search' as const, placeholder: 'Equipment name...' },
  ];

  const filteredEquipment = equipment.filter((item) => {
    if (filters.search) return item.name.toLowerCase().includes(filters.search.toLowerCase());
    return true;
  });

  /* ---- Render ---- */

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Fleet Equipment"
          description="Reference your fleet's equipment from inventory. Add from the shared catalog, create custom entries, or leave notes."
          actions={
            activeTab === 'my-equipment' ? (
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
            onClick={() => setActiveTab('my-equipment')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'my-equipment'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            My Equipment
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

        {/* My Equipment tab */}
        {activeTab === 'my-equipment' && (
          <>
            <FilterBar
              filters={filterConfig}
              values={filters}
              onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
              onClear={() => setFilters({})}
            />
            <DataTable
              data={filteredEquipment}
              columns={columns}
              loading={loading}
              emptyMessage="No equipment in your fleet yet. Add from the catalog or create a custom entry."
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
            ) : catalog.length === 0 ? (
              <div className="rounded-lg border bg-card p-12 text-center">
                <p className="text-muted-foreground">No catalog equipment available.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {catalog.map((item) => (
                  <label
                    key={item.id}
                    className={`flex items-start gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
                      selectedCatalogIds.has(item.id)
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-card hover:bg-muted/30'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedCatalogIds.has(item.id)}
                      onChange={() => toggleCatalogSelection(item.id)}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{item.name}</div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {[item.manufacturer, item.model].filter(Boolean).join(' - ') || 'No details'}
                      </div>
                      {item.description && (
                        <div className="text-sm text-muted-foreground mt-1 line-clamp-2">{item.description}</div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </>
        )}

        {/* Add Custom Equipment Modal */}
        {showAddModal && (
          <AddCustomEquipmentModal
            onClose={() => setShowAddModal(false)}
            onComplete={() => { setShowAddModal(false); fetchEquipment(); }}
          />
        )}

        {/* Notes Modal */}
        {notesItem && (
          <NotesModal
            item={notesItem}
            entityLabel="equipment"
            endpoint={`/api/gv/equipment/${notesItem.id}`}
            onClose={() => setNotesItem(null)}
            onSaved={() => { setNotesItem(null); fetchEquipment(); }}
          />
        )}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/*  Add Custom Equipment Modal                                                */
/* -------------------------------------------------------------------------- */

function AddCustomEquipmentModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [form, setForm] = useState({ name: '', manufacturer: '', model: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const payload: Record<string, unknown> = { name: form.name };
      if (form.manufacturer) payload.manufacturer = form.manufacturer;
      if (form.model) payload.model = form.model;
      if (form.notes) payload.notes = form.notes;

      const res = await fetch('/api/gv/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message || 'Failed to add equipment');
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
          <h3 className="text-lg font-semibold">Add Custom Equipment to Fleet</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">X</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">{error}</div>}
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="e.g. CAT 420F2 Backhoe Loader" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Manufacturer</label>
              <input type="text" value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary" placeholder="e.g. Caterpillar" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Model</label>
              <input type="text" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary" placeholder="e.g. 420F2" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3} placeholder="Any notes about this equipment..." />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
              {saving ? 'Adding...' : 'Add Equipment'}
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
