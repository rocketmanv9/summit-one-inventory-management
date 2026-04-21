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

interface Tool {
  id: string;
  name: string;
  tool_type_id: string | null;
  manufacturer: string | null;
  model: string | null;
  description: string | null;
  notes: string | null;
  is_active: boolean;
  is_custom: boolean;
  tags: string[] | null;
}

interface CatalogTool {
  id: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  description: string | null;
}

type ActiveTab = 'my-tools' | 'catalog';

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

export default function ToolsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('my-tools');
  const [tools, setTools] = useState<Tool[]>([]);
  const [catalogTools, setCatalogTools] = useState<CatalogTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<string>>(new Set());
  const [adopting, setAdopting] = useState(false);

  /* ---- Fetching ---- */

  const fetchTools = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/gv/tools');
      if (!res.ok) throw new Error('Failed to fetch tools');
      const json = await res.json();
      setTools(json.data || []);
    } catch (err) {
      console.error('Error fetching tools:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCatalog = async () => {
    setCatalogLoading(true);
    try {
      const res = await fetch('/api/gv/tools/catalog');
      if (!res.ok) throw new Error('Failed to fetch catalog');
      const json = await res.json();
      setCatalogTools(json.data || []);
    } catch (err) {
      console.error('Error fetching catalog:', err);
    } finally {
      setCatalogLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'my-tools') {
      fetchTools();
    } else {
      fetchCatalog();
    }
  }, [activeTab]);

  /* ---- Handlers ---- */

  const handleDelete = async (tool: Tool) => {
    if (!confirm(`Delete tool "${tool.name}"? This cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/gv/tools/${tool.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
      });
      if (!res.ok) throw new Error('Failed to delete tool');
      await fetchTools();
    } catch (err) {
      console.error('Error deleting tool:', err);
      alert('Failed to delete tool');
    }
  };

  const handleAdopt = async () => {
    if (selectedCatalogIds.size === 0) return;
    setAdopting(true);

    try {
      const res = await fetch('/api/gv/tools/adopt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ catalogToolIds: Array.from(selectedCatalogIds) }),
      });
      if (!res.ok) throw new Error('Failed to adopt tools');

      setSelectedCatalogIds(new Set());
      setActiveTab('my-tools');
    } catch (err) {
      console.error('Error adopting tools:', err);
      alert('Failed to adopt selected tools');
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

  /* ---- My Tools table ---- */

  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row: Tool) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'tool_type_id',
      header: 'Type',
      render: (row: Tool) => (
        <span className="text-sm text-muted-foreground">{row.tool_type_id || '-'}</span>
      ),
    },
    {
      key: 'manufacturer',
      header: 'Manufacturer',
      render: (row: Tool) => row.manufacturer || '-',
    },
    {
      key: 'model',
      header: 'Model',
      render: (row: Tool) => row.model || '-',
    },
    {
      key: 'source',
      header: 'Source',
      render: (row: Tool) => (
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
      key: 'status',
      header: 'Status',
      render: (row: Tool) => (
        <StatusChip status={row.is_active ? 'active' : 'inactive'} />
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row: Tool) => (
        <div className="flex gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              // Edit not yet wired — placeholder
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
      placeholder: 'Tool name...',
    },
  ];

  const filteredTools = tools.filter((tool) => {
    if (filters.search) {
      return tool.name.toLowerCase().includes(filters.search.toLowerCase());
    }
    return true;
  });

  /* ---- Render ---- */

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Tools"
          description="Manage your organization's tools and equipment references. Browse the shared catalog to adopt standard tools, or add custom tools specific to your operations."
          actions={
            activeTab === 'my-tools' ? (
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                + Add Tool
              </button>
            ) : selectedCatalogIds.size > 0 ? (
              <button
                onClick={handleAdopt}
                disabled={adopting}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {adopting
                  ? 'Adopting...'
                  : `Adopt Selected (${selectedCatalogIds.size})`}
              </button>
            ) : null
          }
        />

        {/* Tab buttons */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('my-tools')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'my-tools'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            My Tools
          </button>
          <button
            onClick={() => setActiveTab('catalog')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'catalog'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            Catalog
          </button>
        </div>

        {/* My Tools tab */}
        {activeTab === 'my-tools' && (
          <>
            <FilterBar
              filters={filterConfig}
              values={filters}
              onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
              onClear={() => setFilters({})}
            />

            <DataTable
              data={filteredTools}
              columns={columns}
              loading={loading}
              emptyMessage="No tools found. Add a custom tool or adopt from the catalog."
              rowKey={(row) => row.id}
            />
          </>
        )}

        {/* Catalog tab */}
        {activeTab === 'catalog' && (
          <>
            {catalogLoading ? (
              <div className="rounded-lg border bg-card">
                <div className="animate-pulse">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="h-20 border-b last:border-b-0 flex items-center px-4 gap-4">
                      <div className="h-4 w-4 bg-gray-200 rounded" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 bg-gray-200 rounded w-1/3" />
                        <div className="h-3 bg-gray-200 rounded w-2/3" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : catalogTools.length === 0 ? (
              <div className="rounded-lg border bg-card p-12 text-center">
                <p className="text-muted-foreground">No catalog tools available.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {catalogTools.map((ct) => (
                  <label
                    key={ct.id}
                    className={`flex items-start gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
                      selectedCatalogIds.has(ct.id)
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-card hover:bg-muted/30'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedCatalogIds.has(ct.id)}
                      onChange={() => toggleCatalogSelection(ct.id)}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">{ct.name}</div>
                      <div className="text-sm text-muted-foreground mt-0.5">
                        {[ct.manufacturer, ct.model].filter(Boolean).join(' - ') || 'No manufacturer/model'}
                      </div>
                      {ct.description && (
                        <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {ct.description}
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </>
        )}

        {/* Create Tool Modal */}
        {showCreateModal && (
          <CreateToolModal
            onClose={() => setShowCreateModal(false)}
            onComplete={() => {
              setShowCreateModal(false);
              fetchTools();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/*  Create Tool Modal                                                         */
/* -------------------------------------------------------------------------- */

function CreateToolModal({
  onClose,
  onComplete,
}: {
  onClose: () => void;
  onComplete: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    tool_type_id: '',
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
      const payload: Record<string, unknown> = { name: form.name };
      if (form.tool_type_id) payload.tool_type_id = form.tool_type_id;
      if (form.manufacturer) payload.manufacturer = form.manufacturer;
      if (form.model) payload.model = form.model;
      if (form.description) payload.description = form.description;
      if (form.notes) payload.notes = form.notes;

      const res = await fetch('/api/gv/tools', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.message || 'Failed to create tool');
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
          <h3 className="text-lg font-semibold">Add Custom Tool</h3>
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
              placeholder="e.g. Crafco SS 125"
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
                placeholder="e.g. Crafco"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Model</label>
              <input
                type="text"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. SS 125"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={2}
              placeholder="Brief description of the tool..."
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
              {saving ? 'Creating...' : 'Create Tool'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
