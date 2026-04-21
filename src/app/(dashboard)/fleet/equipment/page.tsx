'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Equipment = {
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
};

type CatalogEquipment = {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  description: string | null;
  equipment_type_id: string | null;
};

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function EquipmentPage() {
  const [activeTab, setActiveTab] = useState<'my' | 'catalog'>('my');

  /* ---- My Equipment state ---- */
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);

  /* ---- Catalog state ---- */
  const [catalog, setCatalog] = useState<CatalogEquipment[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<string>>(new Set());
  const [adopting, setAdopting] = useState(false);

  /* ---- Data fetching ---- */

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
    fetchEquipment();
  }, []);

  useEffect(() => {
    if (activeTab === 'catalog' && catalog.length === 0) {
      fetchCatalog();
    }
  }, [activeTab]);

  /* ---- Actions ---- */

  const handleDelete = async (item: Equipment) => {
    if (!confirm(`Delete equipment "${item.name}"? This cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/gv/equipment/${item.id}`, {
        method: 'DELETE',
        headers: { 'X-Idempotency-Key': crypto.randomUUID() },
      });
      if (!res.ok) throw new Error('Failed to delete equipment');
      await fetchEquipment();
    } catch (err) {
      console.error('Error deleting equipment:', err);
      alert('Failed to delete equipment');
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
      setActiveTab('my');
      await fetchEquipment();
    } catch (err) {
      console.error('Error adopting equipment:', err);
      alert('Failed to adopt equipment');
    } finally {
      setAdopting(false);
    }
  };

  const toggleCatalogSelection = (id: string) => {
    setSelectedCatalogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /* ---- Derived stats ---- */

  const totalCount = equipment.length;
  const catalogCount = equipment.filter((e) => !e.is_custom).length;
  const customCount = equipment.filter((e) => e.is_custom).length;

  /* ---- Filtered equipment ---- */

  const filteredEquipment = equipment.filter((item) => {
    if (filters.search) {
      const search = filters.search.toLowerCase();
      if (!item.name.toLowerCase().includes(search)) return false;
    }
    return true;
  });

  /* ---- Columns ---- */

  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row: Equipment) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'equipment_type_id',
      header: 'Type',
      render: (row: Equipment) => <span className="text-sm">{row.equipment_type_id || '-'}</span>,
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
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            row.is_custom
              ? 'bg-purple-100 text-purple-800'
              : 'bg-blue-100 text-blue-800'
          }`}
        >
          {row.is_custom ? 'Custom' : 'Catalog'}
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
            onClick={(e) => {
              e.stopPropagation();
              // Edit not implemented yet — placeholder
              alert('Edit coming soon');
            }}
            className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
          >
            Edit
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(row);
            }}
            className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded hover:bg-red-200"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const filterConfig = [
    {
      key: 'search',
      label: 'Search',
      type: 'search' as const,
      placeholder: 'Search by name...',
    },
  ];

  /* ---- Render ---- */

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Equipment"
          description="Manage your organization's heavy equipment references. Browse the shared catalog to adopt standard equipment types, or add custom equipment specific to your operations."
          actions={
            activeTab === 'my' ? (
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                + Add Equipment
              </button>
            ) : undefined
          }
        />

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="text-2xl font-bold text-gray-700">{totalCount}</div>
            <div className="text-sm text-gray-600">Total Equipment</div>
          </div>
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="text-2xl font-bold text-blue-700">{catalogCount}</div>
            <div className="text-sm text-blue-600">Catalog</div>
          </div>
          <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
            <div className="text-2xl font-bold text-purple-700">{customCount}</div>
            <div className="text-sm text-purple-600">Custom</div>
          </div>
        </div>

        {/* Tab buttons */}
        <div className="flex gap-2 border-b">
          <button
            onClick={() => setActiveTab('my')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'my'
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
        {activeTab === 'my' && (
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
              emptyMessage="No equipment found. Add custom equipment or adopt from the catalog."
              rowKey={(row) => row.id}
            />
          </>
        )}

        {/* Catalog tab */}
        {activeTab === 'catalog' && (
          <>
            {selectedCatalogIds.size > 0 && (
              <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <span className="text-sm text-blue-800 font-medium">
                  {selectedCatalogIds.size} item{selectedCatalogIds.size !== 1 ? 's' : ''} selected
                </span>
                <button
                  onClick={handleAdopt}
                  disabled={adopting}
                  className="px-4 py-1.5 bg-primary text-primary-foreground text-sm rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {adopting ? 'Adopting...' : 'Adopt Selected'}
                </button>
                <button
                  onClick={() => setSelectedCatalogIds(new Set())}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Clear selection
                </button>
              </div>
            )}

            {catalogLoading ? (
              <div className="rounded-lg border bg-card">
                <div className="animate-pulse">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="p-4 border-b last:border-b-0">
                      <div className="h-5 bg-gray-200 rounded w-1/3 mb-2" />
                      <div className="h-4 bg-gray-100 rounded w-2/3" />
                    </div>
                  ))}
                </div>
              </div>
            ) : catalog.length === 0 ? (
              <div className="rounded-lg border bg-card p-12 text-center">
                <p className="text-muted-foreground">No catalog equipment available.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {catalog.map((item) => {
                  const isSelected = selectedCatalogIds.has(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => toggleCatalogSelection(item.id)}
                      className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-primary/5 border-primary'
                          : 'bg-card hover:bg-muted/50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleCatalogSelection(item.id)}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{item.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {[item.manufacturer, item.model].filter(Boolean).join(' - ') || 'No details'}
                        </div>
                        {item.description && (
                          <div className="text-sm text-muted-foreground mt-1 truncate">
                            {item.description}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Create modal */}
        {showCreateModal && (
          <CreateEquipmentModal
            onClose={() => setShowCreateModal(false)}
            onComplete={() => {
              setShowCreateModal(false);
              fetchEquipment();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Create Equipment Modal                                             */
/* ------------------------------------------------------------------ */

function CreateEquipmentModal({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    manufacturer: '',
    model: '',
    description: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const res = await fetch('/api/gv/equipment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          name: form.name,
          manufacturer: form.manufacturer || undefined,
          model: form.model || undefined,
          description: form.description || undefined,
          notes: form.notes || undefined,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message || 'Failed to create equipment');
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
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-semibold">Add Equipment</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="e.g. CAT 420F2 Backhoe Loader"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Manufacturer</label>
              <input
                type="text"
                value={form.manufacturer}
                onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. Caterpillar"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Model</label>
              <input
                type="text"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. 420F2"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3}
              placeholder="Brief description of this equipment type..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={2}
              placeholder="Internal notes..."
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
              {saving ? 'Creating...' : 'Create Equipment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
