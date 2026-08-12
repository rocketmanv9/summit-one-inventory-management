'use client';

/**
 * Who can buy what — buyable item groups (sprint item 11, Grant 2026-08-10).
 *
 * Grant's intent: "a configurable way to save who can buy what and stuff from
 * inventory, like groups of items per position that people are allowed to buy,
 * and then that should show up under quick actions for inventory for them to
 * get stuff."
 *
 * The INTERNAL-catalog sibling of Purchase links (item 04): there, admins gate
 * outside sites by position; here, admins gate named groups of catalog items by
 * position. The mobile quick action (item 12) shows a user only the groups their
 * position allows (server-filtered by /buyable-groups/mine) and turns their picks
 * into a draft PO (/buyable-groups/request) through the normal approval flow.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, X, Users, Package, ShoppingCart } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { apiWrite } from '@/lib/api-client';
import { useViewAs } from '@/lib/view-as';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { useEntityImages } from '@/hooks/useEntityImages';
import { useUOMLabelMap } from '@/hooks/useGVTerms';
import { ItemPickerModal, type PickerItem } from '@/components/purchasing/ItemPickerModal';

interface GroupItem {
  id?: string;
  catalog_item_id: string;
  default_qty: number;
  preferred_vendor_id: string | null;
  sort_order?: number;
  name: string | null;
  sku: string | null;
  uom_term_id: string | null;
}

interface BuyableGroup {
  id: string;
  name: string;
  description: string | null;
  allowed_positions: string[];
  active: boolean;
  sort_order: number;
  last_event_id: string | null;
  items: GroupItem[];
}

type FormState = {
  name: string;
  description: string;
  allowed_positions: string[];
  sort_order: string;
  items: GroupItem[];
};

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  allowed_positions: [],
  sort_order: '0',
  items: [],
};

// useViewAs() only works INSIDE <AppShell> (it mounts the ViewAsProvider).
// Calling it in the same component that renders the shell silently returned the
// provider-less defaults — no position chips and isAdmin=false, which made this
// editor read-only for everyone (groups could only be configured by SQL).
// Fixed 2026-08-12 (tyler-ideas item 02) by splitting shell and content.
export default function BuyableGroupsPage() {
  return (
    <AppShell>
      <BuyableGroupsContent />
    </AppShell>
  );
}

function BuyableGroupsContent() {
  const { positions, isAdmin } = useViewAs();
  const uomLabels = useUOMLabelMap();
  const [groups, setGroups] = useState<BuyableGroup[]>([]);
  const [catalog, setCatalog] = useState<PickerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState<BuyableGroup | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const { imageMap } = useEntityImages('catalog_item', catalog.map((i) => i.id));

  const positionTitles = useMemo(() => {
    const titles = new Set(positions.map((p) => p.title).filter(Boolean));
    return Array.from(titles).sort((a, b) => a.localeCompare(b));
  }, [positions]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [groupsRes, items] = await Promise.all([
        fetch('/api/inventory/buyable-groups', { credentials: 'include' }).then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j?.error?.message || `Request failed (${r.status})`);
          return (j.data ?? []) as BuyableGroup[];
        }),
        InventoryRPC.getCatalogItems({ active: true }).catch(() => []),
      ]);
      setGroups(groupsRes);
      setCatalog(
        (items as any[]).map((i) => ({
          id: i.id,
          name: i.name,
          sku: i.sku,
          description: i.description ?? null,
          uom_term_id: i.uom_term_id ?? null,
          is_parent: i.is_parent ?? false,
        })),
      );
    } catch (e: any) {
      setError(e?.message || 'Failed to load buyable groups.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditing(null);
    setCreating(true);
    setFormErr('');
  };

  const openEdit = (group: BuyableGroup) => {
    setForm({
      name: group.name,
      description: group.description ?? '',
      allowed_positions: group.allowed_positions ?? [],
      sort_order: String(group.sort_order ?? 0),
      items: group.items ?? [],
    });
    setEditing(group);
    setCreating(false);
    setFormErr('');
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
    setFormErr('');
  };

  const togglePosition = (title: string) => {
    setForm((prev) => {
      const has = prev.allowed_positions.includes(title);
      return {
        ...prev,
        allowed_positions: has
          ? prev.allowed_positions.filter((t) => t !== title)
          : [...prev.allowed_positions, title],
      };
    });
  };

  const addItem = (item: PickerItem) => {
    setForm((prev) => {
      if (prev.items.some((i) => i.catalog_item_id === item.id)) return prev;
      return {
        ...prev,
        items: [
          ...prev.items,
          {
            catalog_item_id: item.id,
            default_qty: 1,
            preferred_vendor_id: null,
            name: item.name,
            sku: item.sku,
            uom_term_id: item.uom_term_id,
          },
        ],
      };
    });
  };

  const removeItem = (catalogItemId: string) => {
    setForm((prev) => ({ ...prev, items: prev.items.filter((i) => i.catalog_item_id !== catalogItemId) }));
  };

  const setItemQty = (catalogItemId: string, qty: number) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((i) => (i.catalog_item_id === catalogItemId ? { ...i, default_qty: qty } : i)),
    }));
  };

  const save = async () => {
    if (!form.name.trim()) { setFormErr('Name is required.'); return; }
    if (form.items.length === 0) { setFormErr('Add at least one item to the group.'); return; }
    setSaving(true);
    setFormErr('');
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        allowed_positions: form.allowed_positions,
        sort_order: Number(form.sort_order) || 0,
        items: form.items.map((i, idx) => ({
          catalog_item_id: i.catalog_item_id,
          default_qty: Math.max(1, Math.round(i.default_qty || 1)),
          preferred_vendor_id: i.preferred_vendor_id,
          sort_order: idx,
        })),
      };
      const res = editing
        ? await apiWrite(`/api/inventory/buyable-groups/${editing.id}`, { method: 'PATCH', body: payload })
        : await apiWrite('/api/inventory/buyable-groups', { method: 'POST', body: payload });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Save failed (${res.status})`);
      closeForm();
      await load();
    } catch (e: any) {
      setFormErr(e?.message || 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (group: BuyableGroup) => {
    if (!confirm(`Deactivate "${group.name}"? It will stop appearing as a quick action.`)) return;
    try {
      const res = await apiWrite(`/api/inventory/buyable-groups/${group.id}`, { method: 'DELETE', body: {} });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Failed (${res.status})`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not deactivate.');
    }
  };

  const activeGroups = groups.filter((g) => g.active);
  const inactiveGroups = groups.filter((g) => !g.active);

  return (
    <>
      <PageHeader
        title="Who can buy what"
        description="Groups of catalog items each position is allowed to buy — a quick action to get stuff."
      />

      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm text-blue-900">
          Build named kits of items — for example an <strong>Estimator kit</strong> — and pick which
          positions may buy from each. On their phone, those users get a quick action to grab exactly
          these items; their picks become a draft purchase order that rides the normal approval flow.
          Leave positions empty to keep a group admin-only. Looking for outside sites instead?{' '}
          <a href="/settings/purchase-links" className="font-medium underline">Purchase links</a>.
          Prefer one grid of every position × group?{' '}
          <a href="/inventory/buying-access" className="font-medium underline">Buying access matrix</a>.
        </p>
      </div>

      {!isAdmin && (
        <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm text-yellow-800">Only administrators can add or edit buyable groups.</p>
        </div>
      )}

      <div className="max-w-4xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Groups</h3>
          {isAdmin && (
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> New group
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-16 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading buyable groups…
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
        ) : (
          <div className="space-y-3">
            {activeGroups.length === 0 && (
              <p className="rounded-md border border-dashed bg-gray-50 p-6 text-center text-sm text-gray-500">
                No buyable groups yet. {isAdmin ? 'Add one to give a position a guided way to buy catalog items.' : ''}
              </p>
            )}
            {activeGroups.map((group) => (
              <GroupRow key={group.id} group={group} isAdmin={isAdmin} onEdit={openEdit} onDeactivate={deactivate} />
            ))}

            {inactiveGroups.length > 0 && (
              <>
                <h4 className="pt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">Inactive</h4>
                {inactiveGroups.map((group) => (
                  <GroupRow key={group.id} group={group} isAdmin={isAdmin} onEdit={openEdit} onDeactivate={deactivate} />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {(creating || editing) && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{editing ? 'Edit group' : 'New buyable group'}</h3>
              <button onClick={closeForm} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <Field label="Name">
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Estimator kit"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Description">
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  placeholder="What this kit is for"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </Field>

              <Field label="Items in this group">
                <div className="rounded-md border p-2">
                  {form.items.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-gray-500">No items yet — add some from the catalog.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {form.items.map((it) => (
                        <div key={it.catalog_item_id} className="flex items-center gap-2 rounded border bg-gray-50 px-2 py-1.5">
                          <Package className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {it.name ?? it.catalog_item_id}
                            {it.sku && <span className="ml-1 font-mono text-xs text-gray-400">{it.sku}</span>}
                          </span>
                          <label className="flex items-center gap-1 text-xs text-gray-500">
                            qty
                            <input
                              type="number"
                              min={1}
                              value={it.default_qty}
                              onChange={(e) => setItemQty(it.catalog_item_id, Number(e.target.value))}
                              className="w-14 rounded border px-1.5 py-0.5 text-sm"
                            />
                            <span>{uomLabels[it.uom_term_id || ''] || ''}</span>
                          </label>
                          <button type="button" onClick={() => removeItem(it.catalog_item_id)} className="rounded p-0.5 text-gray-400 hover:bg-gray-200">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="mt-2 inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    <Plus className="h-3 w-3" /> Add item
                  </button>
                </div>
              </Field>

              <Field label="Positions allowed (empty = admins only)">
                <div className="rounded-md border p-2">
                  <div className="flex flex-wrap gap-1.5">
                    {positionTitles.map((title) => {
                      const on = form.allowed_positions.includes(title);
                      return (
                        <button
                          key={title}
                          type="button"
                          onClick={() => togglePosition(title)}
                          className={`rounded-full border px-2.5 py-1 text-xs ${
                            on ? 'border-primary bg-primary/10 text-primary' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {title}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Field>

              {formErr && <p className="text-sm text-red-700">{formErr}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={closeForm} disabled={saving} className="rounded-md border px-4 py-2 text-sm">
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {editing ? 'Save changes' : 'Create group'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ItemPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        items={catalog}
        imageMap={imageMap}
        uomLabels={uomLabels}
        selectedIds={form.items.map((i) => i.catalog_item_id)}
        emptyMessage="No catalog items available."
        onSelect={(item) => addItem(item)}
      />
    </>
  );
}

function GroupRow({
  group,
  isAdmin,
  onEdit,
  onDeactivate,
}: {
  group: BuyableGroup;
  isAdmin: boolean;
  onEdit: (g: BuyableGroup) => void;
  onDeactivate: (g: BuyableGroup) => void;
}) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-4 ${group.active ? '' : 'opacity-60'}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-4 w-4 flex-shrink-0 text-gray-400" />
          <span className="font-medium">{group.name}</span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
            {group.items.length} item{group.items.length === 1 ? '' : 's'}
          </span>
        </div>
        {group.description && <div className="mt-1 truncate text-xs text-gray-500">{group.description}</div>}
        <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
          <Users className="h-3 w-3" />
          {group.allowed_positions.length === 0 ? (
            <span className="text-amber-700">Admins only</span>
          ) : (
            <span>{group.allowed_positions.join(', ')}</span>
          )}
        </div>
      </div>
      {isAdmin && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(group)}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
          {group.active && (
            <button
              onClick={() => onDeactivate(group)}
              className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-3 w-3" /> Deactivate
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}
