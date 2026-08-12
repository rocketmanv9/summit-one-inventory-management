'use client';

/**
 * Buying access matrix (tyler-ideas sprint item 02, Grant 2026-08-12).
 *
 * The one-glance answer to "who can buy what": HR positions as rows, buyable
 * item groups as columns, a check where that position may buy from that group.
 * Clicking a cell toggles membership (POST /buyable-groups/[id]/membership —
 * a targeted server-side add/remove, safe under concurrent admins). Column
 * headers open a full group editor (items via catalog picker, default qty,
 * preferred-vendor pin, reorder); the right-hand "position lens" previews
 * EXACTLY what a position sees in the buying flow via /buyable-groups/preview,
 * which runs the same server path as the consumer /mine route.
 *
 * The list-style editor at /settings/buyable-groups keeps working unchanged —
 * this is the visual admin layer on the same tables (item 11, 2026-08-10).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  Loader2,
  Lock,
  Pencil,
  Pin,
  Plus,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react';
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
  items: GroupItem[];
}

interface VendorOption {
  vendor_id: string;
  vendor_name: string | null;
  unit_cost: number | null;
  is_preferred: boolean;
}

interface PreviewGroup {
  group: { id: string; name: string; description: string | null };
  items: Array<{
    catalog_item_id: string;
    name: string | null;
    uom: string | null;
    default_qty: number;
    est_unit_cost: number | null;
    preferred_vendor_name: string | null;
  }>;
}

type FormState = {
  name: string;
  description: string;
  allowed_positions: string[];
  sort_order: string;
  active: boolean;
  items: GroupItem[];
};

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  allowed_positions: [],
  sort_order: '0',
  active: true,
  items: [],
};

const money = (n: number | null) =>
  n == null ? null : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// useViewAs() must run INSIDE <AppShell> (it mounts the ViewAsProvider); a page
// component that both calls the hook and renders the shell silently gets the
// provider-less defaults (no positions, isAdmin=false) — the bug that kept the
// original /settings/buyable-groups editor read-only for everyone.
export default function BuyingAccessPage() {
  return (
    <AppShell>
      <BuyingAccessContent />
    </AppShell>
  );
}

function BuyingAccessContent() {
  const { positions, isAdmin } = useViewAs();
  const uomLabels = useUOMLabelMap();

  const [groups, setGroups] = useState<BuyableGroup[]>([]);
  const [catalog, setCatalog] = useState<PickerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [toggling, setToggling] = useState<Set<string>>(new Set());

  // Position lens: hover peeks (client-side), click pins + loads the live preview.
  const [pinnedTitle, setPinnedTitle] = useState<string | null>(null);
  const [hoverTitle, setHoverTitle] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ position: string; data: PreviewGroup[] } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Group editor.
  const [editing, setEditing] = useState<BuyableGroup | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [vendorOptions, setVendorOptions] = useState<Record<string, VendorOption[]>>({});

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
      setError(e?.message || 'Failed to load buying access.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeGroups = useMemo(() => groups.filter((g) => g.active), [groups]);
  const matrixGroups = showInactive ? groups : activeGroups;
  const inactiveCount = groups.length - activeGroups.length;

  // ── Matrix cell toggles ────────────────────────────────────────────────────
  const toggleCell = async (group: BuyableGroup, title: string) => {
    if (!isAdmin || !group.active) return;
    const key = `${group.id}|${title}`;
    if (toggling.has(key)) return;
    const wasAllowed = group.allowed_positions.includes(title);

    setToggling((prev) => new Set(prev).add(key));
    // Optimistic flip; revert on failure.
    const apply = (allowed: boolean) =>
      setGroups((prev) =>
        prev.map((g) =>
          g.id === group.id
            ? {
                ...g,
                allowed_positions: allowed
                  ? Array.from(new Set([...g.allowed_positions, title]))
                  : g.allowed_positions.filter((t) => t !== title),
              }
            : g,
        ),
      );
    apply(!wasAllowed);
    try {
      const res = await apiWrite(`/api/inventory/buyable-groups/${group.id}/membership`, {
        method: 'POST',
        body: { position_title: title, allowed: !wasAllowed },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Toggle failed (${res.status})`);
      // Trust the server's array (another admin may have edited concurrently).
      if (Array.isArray(json?.data?.allowed_positions)) {
        setGroups((prev) =>
          prev.map((g) => (g.id === group.id ? { ...g, allowed_positions: json.data.allowed_positions } : g)),
        );
      }
      // Keep the pinned live preview honest after a change to its position.
      if (pinnedTitle === title) void loadPreview(title);
    } catch (e: any) {
      apply(wasAllowed);
      setError(e?.message || 'Could not update access.');
    } finally {
      setToggling((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // ── Position lens ──────────────────────────────────────────────────────────
  const lensTitle = hoverTitle ?? pinnedTitle;

  const loadPreview = useCallback(async (title: string) => {
    setPreviewLoading(true);
    try {
      const res = await fetch(
        `/api/inventory/buyable-groups/preview?position=${encodeURIComponent(title)}`,
        { credentials: 'include' },
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error?.message || `Preview failed (${res.status})`);
      setPreview({ position: title, data: (j.data ?? []) as PreviewGroup[] });
    } catch (e: any) {
      setPreview(null);
      setError(e?.message || 'Could not load the preview.');
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const pinPosition = (title: string | null) => {
    setPinnedTitle(title);
    setPreview(null);
    if (title) void loadPreview(title);
  };

  const groupsForTitle = useCallback(
    (title: string) => activeGroups.filter((g) => g.allowed_positions.includes(title)),
    [activeGroups],
  );

  // ── Group editor ───────────────────────────────────────────────────────────
  const fetchVendorOptions = useCallback(async (catalogItemIds: string[]) => {
    const missing = catalogItemIds.filter(Boolean);
    if (missing.length === 0) return;
    try {
      const res = await fetch(
        `/api/inventory/buyable-groups/vendor-options?catalog_item_ids=${missing.join(',')}`,
        { credentials: 'include' },
      );
      const j = await res.json().catch(() => ({}));
      if (res.ok && j?.data) setVendorOptions((prev) => ({ ...prev, ...j.data }));
    } catch {
      // Dropdown quietly degrades to "Auto" only.
    }
  }, []);

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
      active: group.active,
      items: group.items ?? [],
    });
    setEditing(group);
    setCreating(false);
    setFormErr('');
    void fetchVendorOptions((group.items ?? []).map((i) => i.catalog_item_id));
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
    void fetchVendorOptions([item.id]);
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

  const setItemVendor = (catalogItemId: string, vendorId: string | null) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((i) =>
        i.catalog_item_id === catalogItemId ? { ...i, preferred_vendor_id: vendorId } : i,
      ),
    }));
  };

  const moveItem = (index: number, dir: -1 | 1) => {
    setForm((prev) => {
      const next = [...prev.items];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...prev, items: next };
    });
  };

  const save = async () => {
    if (!form.name.trim()) { setFormErr('Name is required.'); return; }
    setSaving(true);
    setFormErr('');
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        allowed_positions: form.allowed_positions,
        sort_order: Number(form.sort_order) || 0,
        active: form.active,
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
      if (pinnedTitle) void loadPreview(pinnedTitle);
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
      closeForm();
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not deactivate.');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <PageHeader
        title="Buying access"
        description="Who can buy what, at a glance — click a cell to grant or revoke a position's access to a group."
        actions={
          isAdmin ? (
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> New group
            </button>
          ) : undefined
        }
      />

      <div className="mt-4 mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm text-blue-900">
          Rows are HR positions, columns are <strong>buyable groups</strong> (named kits of catalog
          items). A check means that position gets the group as a phone quick action; their picks
          become a draft PO through the normal approval flow. Prefer a list?{' '}
          <a href="/settings/buyable-groups" className="font-medium underline">Who can buy what</a> has
          the same groups in list form; outside sites live under{' '}
          <a href="/settings/purchase-links" className="font-medium underline">Purchase links</a>.
        </p>
      </div>

      {!isAdmin && (
        <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm text-yellow-800">Read-only: only administrators can change buying access.</p>
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <span>{error}</span>
          <button onClick={() => setError('')} className="rounded p-0.5 text-red-500 hover:bg-red-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-16 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading buying access…
        </div>
      ) : (
        <div className="flex flex-col gap-6 xl:flex-row">
          {/* ── Matrix ── */}
          <div className="min-w-0 flex-1">
            {matrixGroups.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-gray-50 p-10 text-center text-sm text-gray-500">
                No buyable groups yet.{' '}
                {isAdmin ? 'Create one to give a position a guided way to buy catalog items.' : ''}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border bg-white">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50/80">
                      <th className="sticky left-0 z-10 min-w-[11rem] bg-gray-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Position
                      </th>
                      {matrixGroups.map((g) => (
                        <th key={g.id} className={`px-2 py-2 text-center align-bottom ${g.active ? '' : 'opacity-50'}`}>
                          <button
                            type="button"
                            onClick={() => (isAdmin ? openEdit(g) : undefined)}
                            title={isAdmin ? `Edit "${g.name}"` : g.name}
                            className={`group/col mx-auto flex max-w-[9rem] flex-col items-center gap-1 rounded-md px-2 py-1 ${
                              isAdmin ? 'hover:bg-primary/5' : 'cursor-default'
                            }`}
                          >
                            <span className="flex items-center gap-1 text-[13px] font-medium leading-tight text-gray-800">
                              <ShoppingCart className="h-3 w-3 flex-shrink-0 text-gray-400" />
                              <span className="truncate">{g.name}</span>
                              {isAdmin && (
                                <Pencil className="h-3 w-3 flex-shrink-0 text-gray-300 opacity-0 transition-opacity group-hover/col:opacity-100" />
                              )}
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                                {g.items.length} item{g.items.length === 1 ? '' : 's'}
                              </span>
                              {!g.active && (
                                <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-600">inactive</span>
                              )}
                              {g.active && g.allowed_positions.length === 0 && (
                                <span className="flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                                  <Lock className="h-2.5 w-2.5" /> admins
                                </span>
                              )}
                            </span>
                          </button>
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">
                        Can buy
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Admins always see every group — shown, not toggleable. */}
                    <tr className="border-b bg-gray-50/50">
                      <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500">
                        <span className="flex items-center gap-1.5">
                          <Lock className="h-3 w-3" /> Administrators
                        </span>
                      </td>
                      {matrixGroups.map((g) => (
                        <td key={g.id} className="px-2 py-2 text-center">
                          <Check className="mx-auto h-4 w-4 text-gray-300" aria-label="always allowed" />
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right text-xs text-gray-400">everything</td>
                    </tr>
                    {positionTitles.map((title) => {
                      const allowed = groupsForTitle(title);
                      const itemCount = allowed.reduce((n, g) => n + g.items.length, 0);
                      const isLens = lensTitle === title;
                      const isPinned = pinnedTitle === title;
                      return (
                        <tr
                          key={title}
                          onMouseEnter={() => setHoverTitle(title)}
                          onMouseLeave={() => setHoverTitle(null)}
                          className={`border-b last:border-b-0 ${isLens ? 'bg-primary/5' : 'hover:bg-gray-50/70'}`}
                        >
                          <td className={`sticky left-0 z-10 px-3 py-1.5 ${isLens ? 'bg-primary/5' : 'bg-white'}`}>
                            <button
                              type="button"
                              onClick={() => pinPosition(isPinned ? null : title)}
                              title={isPinned ? 'Unpin' : `Preview what a ${title} sees`}
                              className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left font-medium text-gray-800 hover:text-primary"
                            >
                              {isPinned ? (
                                <Pin className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
                              ) : (
                                <Eye className="h-3.5 w-3.5 flex-shrink-0 text-gray-300" />
                              )}
                              <span className="truncate">{title}</span>
                            </button>
                          </td>
                          {matrixGroups.map((g) => {
                            const key = `${g.id}|${title}`;
                            const on = g.allowed_positions.includes(title);
                            const busy = toggling.has(key);
                            const clickable = isAdmin && g.active && !busy;
                            return (
                              <td key={g.id} className="px-2 py-1.5 text-center">
                                <button
                                  type="button"
                                  disabled={!clickable}
                                  onClick={() => toggleCell(g, title)}
                                  aria-label={`${on ? 'Revoke' : 'Grant'} ${g.name} for ${title}`}
                                  title={
                                    !g.active
                                      ? 'Inactive group'
                                      : on
                                        ? `${title} can buy from ${g.name} — click to revoke`
                                        : isAdmin
                                          ? `Click to let ${title} buy from ${g.name}`
                                          : `${title} cannot buy from ${g.name}`
                                  }
                                  className={`group/cell mx-auto flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                                    on
                                      ? 'border-emerald-300 bg-emerald-50 text-emerald-600'
                                      : 'border-transparent text-gray-300'
                                  } ${clickable ? (on ? 'hover:border-red-300 hover:bg-red-50 hover:text-red-500' : 'hover:border-gray-300 hover:bg-gray-100 hover:text-gray-500') : ''} ${
                                    !g.active ? 'opacity-40' : ''
                                  }`}
                                >
                                  {busy ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                                  ) : on ? (
                                    <Check className="h-4 w-4" />
                                  ) : (
                                    <Plus className={`h-3.5 w-3.5 ${clickable ? 'opacity-0 group-hover/cell:opacity-100' : 'opacity-0'}`} />
                                  )}
                                </button>
                              </td>
                            );
                          })}
                          <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs text-gray-500">
                            {allowed.length === 0 ? (
                              <span className="text-gray-300">—</span>
                            ) : (
                              <>
                                {allowed.length} group{allowed.length === 1 ? '' : 's'}
                                <span className="text-gray-400"> · {itemCount} item{itemCount === 1 ? '' : 's'}</span>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {positionTitles.length === 0 && (
                      <tr>
                        <td colSpan={matrixGroups.length + 2} className="px-3 py-8 text-center text-sm text-gray-500">
                          No HR positions found — positions come from the HR roster mirror.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {inactiveCount > 0 && (
              <button
                type="button"
                onClick={() => setShowInactive((v) => !v)}
                className="mt-3 text-xs font-medium text-gray-500 underline-offset-2 hover:underline"
              >
                {showInactive ? 'Hide' : 'Show'} {inactiveCount} inactive group{inactiveCount === 1 ? '' : 's'}
              </button>
            )}
          </div>

          {/* ── Position lens ── */}
          <div className="w-full flex-shrink-0 xl:w-96">
            <div className="rounded-lg border bg-white p-4 xl:sticky xl:top-4">
              <div className="mb-3 flex items-center gap-2">
                <Eye className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Position lens</h3>
              </div>
              <select
                value={pinnedTitle ?? ''}
                onChange={(e) => pinPosition(e.target.value || null)}
                className="mb-3 w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="">Pick a position to preview…</option>
                {positionTitles.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>

              {!lensTitle ? (
                <p className="rounded-md border border-dashed bg-gray-50 p-4 text-xs text-gray-500">
                  Hover a row to peek at a position&apos;s buyable set; pick or click a position to load
                  the <strong>live preview</strong> — exactly what their &quot;Get stuff&quot; quick
                  action serves.
                </p>
              ) : (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-800">{lensTitle}</span>
                    <span className="text-xs text-gray-400">
                      {groupsForTitle(lensTitle).length} group{groupsForTitle(lensTitle).length === 1 ? '' : 's'}
                    </span>
                  </div>

                  {groupsForTitle(lensTitle).length === 0 ? (
                    <p className="rounded-md border border-dashed bg-gray-50 p-3 text-xs text-gray-500">
                      No groups yet — this position has no &quot;Get stuff&quot; quick action.
                    </p>
                  ) : (
                    <ul className="mb-3 space-y-1">
                      {groupsForTitle(lensTitle).map((g) => (
                        <li key={g.id} className="flex items-center justify-between rounded border bg-gray-50 px-2 py-1.5 text-xs">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <ShoppingCart className="h-3 w-3 flex-shrink-0 text-gray-400" />
                            <span className="truncate font-medium">{g.name}</span>
                          </span>
                          <span className="text-gray-400">{g.items.length} item{g.items.length === 1 ? '' : 's'}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Live consumer preview — the /mine-equivalent response for this position. */}
                  {pinnedTitle === lensTitle && (
                    <div className="border-t pt-3">
                      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                        Live buying flow preview
                        {previewLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                      </div>
                      {previewLoading ? null : !preview || preview.position !== lensTitle ? (
                        <p className="text-xs text-gray-400">Preview unavailable.</p>
                      ) : preview.data.length === 0 ? (
                        <p className="rounded-md border border-dashed bg-gray-50 p-3 text-xs text-gray-500">
                          The buying flow shows this position nothing (groups need at least one item).
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {preview.data.map((pg) => (
                            <div key={pg.group.id} className="rounded-md border p-2.5">
                              <div className="mb-1 text-sm font-medium text-gray-800">{pg.group.name}</div>
                              {pg.group.description && (
                                <div className="mb-1.5 text-xs text-gray-500">{pg.group.description}</div>
                              )}
                              <ul className="space-y-1">
                                {pg.items.map((it) => (
                                  <li key={it.catalog_item_id} className="flex items-baseline justify-between gap-2 text-xs">
                                    <span className="min-w-0 truncate text-gray-700">
                                      {it.name ?? 'Item'}
                                      <span className="text-gray-400"> × {it.default_qty}{it.uom ? ` ${it.uom}` : ''}</span>
                                    </span>
                                    <span className="flex-shrink-0 text-gray-500">
                                      {money(it.est_unit_cost) ?? '—'}
                                      {it.preferred_vendor_name && (
                                        <span className="text-gray-400"> · {it.preferred_vendor_name}</span>
                                      )}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Group editor ── */}
      {(creating || editing) && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{editing ? 'Edit group' : 'New buyable group'}</h3>
              <button onClick={closeForm} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_6rem]">
                <Field label="Name">
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Estimator kit"
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="Sort order">
                  <input
                    type="number"
                    value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                </Field>
              </div>
              <Field label="Description">
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  placeholder="What this kit is for"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </Field>

              <Field label="Items — default qty, pinned vendor, order">
                <div className="rounded-md border p-2">
                  {form.items.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-gray-500">
                      No items yet — add some from the catalog. (Groups without items don&apos;t show in the buying flow.)
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {form.items.map((it, idx) => {
                        const options = vendorOptions[it.catalog_item_id] ?? [];
                        return (
                          <div key={it.catalog_item_id} className="flex items-center gap-2 rounded border bg-gray-50 px-2 py-1.5">
                            <div className="flex flex-col">
                              <button
                                type="button"
                                onClick={() => moveItem(idx, -1)}
                                disabled={idx === 0}
                                className="rounded p-0 text-gray-400 hover:text-gray-700 disabled:opacity-20"
                                aria-label="Move up"
                              >
                                <ChevronUp className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveItem(idx, 1)}
                                disabled={idx === form.items.length - 1}
                                className="rounded p-0 text-gray-400 hover:text-gray-700 disabled:opacity-20"
                                aria-label="Move down"
                              >
                                <ChevronDown className="h-3.5 w-3.5" />
                              </button>
                            </div>
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
                            <select
                              value={it.preferred_vendor_id ?? ''}
                              onChange={(e) => setItemVendor(it.catalog_item_id, e.target.value || null)}
                              title="Vendor to draft the PO against (Auto = preferred, then cheapest)"
                              className="w-32 rounded border bg-white px-1.5 py-0.5 text-xs"
                            >
                              <option value="">Auto (best)</option>
                              {options.map((o) => (
                                <option key={o.vendor_id} value={o.vendor_id}>
                                  {o.vendor_name ?? 'Vendor'}
                                  {o.unit_cost != null ? ` — ${money(o.unit_cost)}` : ''}
                                  {o.is_preferred ? ' ★' : ''}
                                </option>
                              ))}
                              {/* Keep an unknown pinned vendor selectable so editing doesn't silently drop it. */}
                              {it.preferred_vendor_id && !options.some((o) => o.vendor_id === it.preferred_vendor_id) && (
                                <option value={it.preferred_vendor_id}>Pinned vendor</option>
                              )}
                            </select>
                            <button
                              type="button"
                              onClick={() => removeItem(it.catalog_item_id)}
                              className="rounded p-0.5 text-gray-400 hover:bg-gray-200"
                              aria-label="Remove item"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
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
                  {positionTitles.length === 0 ? (
                    <p className="px-1 py-1 text-xs text-gray-500">No HR positions found.</p>
                  ) : (
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
                  )}
                </div>
              </Field>

              {editing && !form.active && (
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  />
                  Reactivate this group
                </label>
              )}

              {formErr && <p className="text-sm text-red-700">{formErr}</p>}

              <div className="flex items-center justify-between gap-2 pt-2">
                <div>
                  {editing && editing.active && (
                    <button
                      onClick={() => deactivate(editing)}
                      disabled={saving}
                      className="inline-flex items-center gap-1 rounded-md border border-red-200 px-3 py-2 text-xs text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" /> Deactivate
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}
