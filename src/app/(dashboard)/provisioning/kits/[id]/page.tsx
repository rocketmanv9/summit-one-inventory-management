'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { ProvisioningRPC } from '@/lib/rpc/provisioning';
import { Save, Plus, Trash2 } from 'lucide-react';

interface KitLine {
  id?: string;
  catalog_item_id: string;
  catalog_item_name?: string;
  qty: number;
  is_required?: boolean;
  size_source: string | null;
  fixed_variant_attributes?: Record<string, string> | null;
  provider_id: string | null;
  substitute_catalog_item_id: string | null;
  sort_order: number;
}

interface Kit {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  lines: KitLine[];
  created_at: string;
  updated_at: string | null;
}

export default function KitDetailPage() {
  const params = useParams();
  const kitId = params.id as string;
  const [kit, setKit] = useState<Kit | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [lines, setLines] = useState<KitLine[]>([]);
  const [showAddLine, setShowAddLine] = useState(false);
  const [newLine, setNewLine] = useState<KitLine>({
    catalog_item_id: '',
    qty: 1,
    size_source: null,
    provider_id: null,
    substitute_catalog_item_id: null,
    sort_order: 0,
  });

  useEffect(() => {
    fetchKit();
  }, [kitId]);

  const fetchKit = async () => {
    setLoading(true);
    try {
      const data = await ProvisioningRPC.getKit(kitId);
      const k = data?.data || data;
      setKit(k);
      setName(k.name || '');
      setDescription(k.description || '');
      setIsActive(k.is_active ?? true);
      setLines(k.lines || []);
    } catch (error) {
      console.error('Error fetching kit:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await ProvisioningRPC.updateKit(kitId, {
        name,
        description: description || null,
        is_active: isActive,
        lines: lines.map((l, i) => ({
          catalog_item_id: l.catalog_item_id,
          qty: l.qty,
          is_required: l.is_required,
          size_source: l.size_source,
          fixed_variant_attributes: l.fixed_variant_attributes,
          provider_id: l.provider_id,
          substitute_catalog_item_id: l.substitute_catalog_item_id,
          sort_order: i,
        })),
      });
      alert('Kit saved successfully');
      fetchKit();
    } catch (error) {
      console.error('Error saving kit:', error);
      alert('Failed to save kit');
    } finally {
      setSaving(false);
    }
  };

  const addLine = () => {
    if (!newLine.catalog_item_id) return;
    setLines([...lines, { ...newLine, sort_order: lines.length }]);
    setNewLine({ catalog_item_id: '', qty: 1, size_source: null, provider_id: null, substitute_catalog_item_id: null, sort_order: 0 });
    setShowAddLine(false);
  };

  const removeLine = (index: number) => {
    setLines(lines.filter((_, i) => i !== index));
  };

  const updateLine = (index: number, field: string, value: unknown) => {
    setLines(lines.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  };

  const lineColumns = [
    {
      key: 'catalog_item',
      header: 'Item',
      render: (row: KitLine) => (
        <span className="font-medium">{row.catalog_item_name || row.catalog_item_id}</span>
      ),
    },
    {
      key: 'qty',
      header: 'Qty',
      className: 'w-24',
      render: (row: KitLine) => {
        const idx = lines.indexOf(row);
        return (
          <input
            type="number"
            value={row.qty}
            onChange={(e) => updateLine(idx, 'qty', parseInt(e.target.value) || 1)}
            className="w-20 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            min={1}
          />
        );
      },
    },
    {
      key: 'size_source',
      header: 'Size Source',
      render: (row: KitLine) => {
        const idx = lines.indexOf(row);
        return (
          <select
            value={row.size_source || ''}
            onChange={(e) => updateLine(idx, 'size_source', e.target.value || null)}
            className="px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">None</option>
            <option value="shirt_size">Shirt Size</option>
            <option value="pant_size">Pant Size</option>
            <option value="shoe_size">Shoe Size</option>
            <option value="hat_size">Hat Size</option>
            <option value="glove_size">Glove Size</option>
          </select>
        );
      },
    },
    {
      key: 'provider_id',
      header: 'Provider Override',
      render: (row: KitLine) => {
        const idx = lines.indexOf(row);
        return (
          <input
            type="text"
            value={row.provider_id || ''}
            onChange={(e) => updateLine(idx, 'provider_id', e.target.value || null)}
            className="w-32 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="Provider ID..."
          />
        );
      },
    },
    {
      key: 'substitute_catalog_item_id',
      header: 'Substitute Item',
      render: (row: KitLine) => {
        const idx = lines.indexOf(row);
        return (
          <input
            type="text"
            value={row.substitute_catalog_item_id || ''}
            onChange={(e) => updateLine(idx, 'substitute_catalog_item_id', e.target.value || null)}
            className="w-32 px-2 py-1 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="Item ID..."
          />
        );
      },
    },
    {
      key: 'actions',
      header: '',
      className: 'w-12',
      render: (row: KitLine) => {
        const idx = lines.indexOf(row);
        return (
          <button
            onClick={(e) => { e.stopPropagation(); removeLine(idx); }}
            className="p-1.5 rounded hover:bg-red-50 text-red-500"
            title="Remove line"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        );
      },
    },
  ];

  if (loading) {
    return (
      <AppShell>
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-gray-200 rounded w-1/3" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </AppShell>
    );
  }

  if (!kit) {
    return (
      <AppShell>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Kit not found</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={kit.name}
          backHref="/provisioning/kits"
          actions={
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 flex items-center gap-2 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : 'Save Kit'}
            </button>
          }
        />

        {/* Kit metadata */}
        <div className="rounded-lg border bg-card p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="flex items-end gap-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="kit-active"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                <label htmlFor="kit-active" className="text-sm font-medium">Active</label>
              </div>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={2}
            />
          </div>
        </div>

        {/* Kit lines */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">Kit Lines</h3>
            <button
              onClick={() => setShowAddLine(true)}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 flex items-center gap-1"
            >
              <Plus className="h-3 w-3" />
              Add Line
            </button>
          </div>

          <DataTable
            data={lines}
            columns={lineColumns}
            emptyMessage="No lines in this kit. Add items to get started."
            rowKey={(_, i) => String(i)}
          />
        </div>

        {/* Add Line Modal */}
        {showAddLine && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h2 className="text-xl font-semibold mb-4">Add Kit Line</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Catalog Item ID *</label>
                  <input
                    type="text"
                    value={newLine.catalog_item_id}
                    onChange={(e) => setNewLine({ ...newLine, catalog_item_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Catalog item UUID..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Quantity</label>
                  <input
                    type="number"
                    value={newLine.qty}
                    onChange={(e) => setNewLine({ ...newLine, qty: parseInt(e.target.value) || 1 })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    min={1}
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setShowAddLine(false)} className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50">Cancel</button>
                  <button
                    onClick={addLine}
                    disabled={!newLine.catalog_item_id}
                    className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
