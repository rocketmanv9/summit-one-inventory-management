'use client';

/**
 * Buying access — REWORKED group-first (item 03, snap-and-buy sprint, Grant
 * 2026-08-13). The old page led with a positions×groups checkbox matrix, which
 * was backwards: you were configuring access to things before the things were
 * understandable. Grant's verdict: "sucks and doesn't make any sense" — and the
 * killer question it couldn't answer was "how are business cards configured?".
 *
 * The rework answers "set up a thing people can buy, see exactly how it's
 * fulfilled, and know what each position experiences" start to finish:
 *   - LANDING = card per buyable thing: items with fulfillment badges and a
 *     plain-words resolution sentence each ("Draft PO to Lakeside @ $12.40",
 *     "Opens each person's Canva file — NOT set up for 10 of 12 people"),
 *     position chips with member counts, and health flags. Data comes from
 *     /buyable-groups/overview, which computes resolution with the SAME helpers
 *     the consumer draft path uses. The Guided-Purchase placeholder path is
 *     always explicit, never silent.
 *   - "New buyable thing" opens the 4-step setup wizard (GroupWizard) — create
 *     AND edit re-enter it. Name → items+fulfillment (incl. per-person links
 *     inline) → positions → live preview-as via /buyable-groups/preview.
 *   - The matrix survives as the secondary "Access grid" tab for bulk toggling
 *     (it was the wrong front door, not a wrong tool). Cells still hit
 *     POST /buyable-groups/[id]/membership.
 *
 * /settings/buyable-groups now redirects here — one editor, not two.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Grid3x3,
  Loader2,
  Lock,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  ShoppingBag,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { apiWrite } from '@/lib/api-client';
import { useViewAs } from '@/lib/view-as';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { useEntityImages } from '@/hooks/useEntityImages';
import { useUOMLabelMap } from '@/hooks/useGVTerms';
import type { PickerItem } from '@/components/purchasing/ItemPickerModal';
import { GroupWizard } from '@/components/buying-access/GroupWizard';
import {
  Chip,
  groupHealthFlags,
  KindBadge,
  resolutionSummary,
  type OverviewGroup,
} from '@/components/buying-access/fulfillment';

// useViewAs() must run INSIDE <AppShell> (it mounts the ViewAsProvider); a page
// component that both calls the hook and renders the shell silently gets the
// provider-less defaults — the bug that once made these editors read-only.
export default function BuyingAccessPage() {
  return (
    <AppShell>
      <BuyingAccessContent />
    </AppShell>
  );
}

type Tab = 'things' | 'grid';

function BuyingAccessContent() {
  const { isAdmin } = useViewAs();
  const uomLabels = useUOMLabelMap();

  const [groups, setGroups] = useState<OverviewGroup[]>([]);
  const [positionCounts, setPositionCounts] = useState<Record<string, number>>({});
  const [catalog, setCatalog] = useState<PickerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);

  const [tab, setTab] = useState<Tab>('things');
  const [showInactive, setShowInactive] = useState(false);
  const [toggling, setToggling] = useState<Set<string>>(new Set());

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardGroup, setWizardGroup] = useState<OverviewGroup | null>(null);

  const { imageMap } = useEntityImages('catalog_item', catalog.map((i) => i.id));

  const positionTitles = useMemo(
    () => Object.keys(positionCounts).sort((a, b) => a.localeCompare(b)),
    [positionCounts],
  );

  const load = useCallback(async () => {
    setError('');
    try {
      const [overviewRes, items] = await Promise.all([
        fetch('/api/inventory/buyable-groups/overview', { credentials: 'include' }).then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (r.status === 403) { setForbidden(true); return { groups: [], position_counts: {} }; }
          if (!r.ok) throw new Error(j?.error?.message || `Request failed (${r.status})`);
          return j.data as { groups: OverviewGroup[]; position_counts: Record<string, number> };
        }),
        InventoryRPC.getCatalogItems({ active: true }).catch(() => []),
      ]);
      setGroups(overviewRes.groups ?? []);
      setPositionCounts(overviewRes.position_counts ?? {});
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
  const inactiveGroups = useMemo(() => groups.filter((g) => !g.active), [groups]);
  const matrixGroups = showInactive ? groups : activeGroups;

  const openCreate = () => { setWizardGroup(null); setWizardOpen(true); };
  const openEdit = (group: OverviewGroup) => { setWizardGroup(group); setWizardOpen(true); };

  const deactivate = async (group: OverviewGroup) => {
    if (!confirm(`Deactivate "${group.name}"? It disappears from everyone's buying flow (nothing is deleted).`)) return;
    try {
      const res = await apiWrite(`/api/inventory/buyable-groups/${group.id}`, { method: 'DELETE', body: {} });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Failed (${res.status})`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not deactivate.');
    }
  };

  const reactivate = async (group: OverviewGroup) => {
    try {
      const res = await apiWrite(`/api/inventory/buyable-groups/${group.id}`, { method: 'PATCH', body: { active: true } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Failed (${res.status})`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not reactivate.');
    }
  };

  // ── Access-grid cell toggles (unchanged membership semantics) ──────────────
  const toggleCell = async (group: OverviewGroup, title: string) => {
    if (!isAdmin || !group.active) return;
    const key = `${group.id}|${title}`;
    if (toggling.has(key)) return;
    const wasAllowed = group.allowed_positions.includes(title);

    setToggling((prev) => new Set(prev).add(key));
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <PageHeader
        title="Buying access"
        description="Set up the things people can buy, see exactly how each one is fulfilled, and control who gets it."
        actions={
          isAdmin ? (
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> New buyable thing
            </button>
          ) : undefined
        }
      />

      {(forbidden || !isAdmin) && !loading && (
        <div className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm text-yellow-800">
            Buying access is configured by purchasing admins. Ask an administrator if something you need
            isn&apos;t in your buying flow.
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
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
      ) : forbidden ? null : (
        <>
          {/* Tabs */}
          <div className="mt-4 mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border bg-gray-50 p-0.5 text-sm">
              <button
                type="button"
                onClick={() => setTab('things')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
                  tab === 'things' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                Buyable things
                <span className="rounded-full bg-gray-100 px-1.5 text-[10px] text-gray-500">{activeGroups.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('grid')}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors ${
                  tab === 'grid' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                <Grid3x3 className="h-3.5 w-3.5" />
                Access grid
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Outside sites gated by position live under{' '}
              <a href="/settings/purchase-links" className="underline">Purchase links</a>.
            </p>
          </div>

          {tab === 'things' ? (
            <ThingsTab
              activeGroups={activeGroups}
              inactiveGroups={inactiveGroups}
              positionCounts={positionCounts}
              isAdmin={isAdmin}
              onCreate={openCreate}
              onEdit={openEdit}
              onDeactivate={deactivate}
              onReactivate={reactivate}
            />
          ) : (
            <GridTab
              matrixGroups={matrixGroups}
              inactiveCount={inactiveGroups.length}
              showInactive={showInactive}
              setShowInactive={setShowInactive}
              positionTitles={positionTitles}
              positionCounts={positionCounts}
              isAdmin={isAdmin}
              toggling={toggling}
              onToggle={toggleCell}
              onEdit={openEdit}
            />
          )}
        </>
      )}

      <GroupWizard
        open={wizardOpen && isAdmin}
        group={wizardGroup}
        catalog={catalog}
        imageMap={imageMap}
        uomLabels={uomLabels}
        positionTitles={positionTitles}
        positionCounts={positionCounts}
        onClose={() => setWizardOpen(false)}
        onSaved={() => void load()}
      />
    </>
  );
}

// ── Landing: buyable-thing cards ─────────────────────────────────────────────

function ThingsTab({
  activeGroups,
  inactiveGroups,
  positionCounts,
  isAdmin,
  onCreate,
  onEdit,
  onDeactivate,
  onReactivate,
}: {
  activeGroups: OverviewGroup[];
  inactiveGroups: OverviewGroup[];
  positionCounts: Record<string, number>;
  isAdmin: boolean;
  onCreate: () => void;
  onEdit: (g: OverviewGroup) => void;
  onDeactivate: (g: OverviewGroup) => void;
  onReactivate: (g: OverviewGroup) => void;
}) {
  const [showInactive, setShowInactive] = useState(false);

  if (activeGroups.length === 0 && inactiveGroups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-gray-50 p-12 text-center">
        <ShoppingBag className="mx-auto mb-3 h-10 w-10 text-gray-300" />
        <p className="mb-1 text-sm font-medium text-gray-700">Nothing is buyable yet.</p>
        <p className="mx-auto mb-4 max-w-md text-sm text-gray-500">
          A buyable thing is a named kit — business cards, an estimator kit, safety gear — with each
          item&apos;s exact fulfillment and the positions allowed to buy it.
        </p>
        {isAdmin && (
          <button
            onClick={onCreate}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          >
            <Plus className="h-4 w-4" /> Set up the first one
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {activeGroups.map((g) => (
          <GroupCard
            key={g.id}
            group={g}
            positionCounts={positionCounts}
            isAdmin={isAdmin}
            onEdit={onEdit}
            onDeactivate={onDeactivate}
            onReactivate={onReactivate}
          />
        ))}
      </div>

      {inactiveGroups.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowInactive((v) => !v)}
            className="mb-3 text-xs font-medium text-gray-500 underline-offset-2 hover:underline"
          >
            {showInactive ? 'Hide' : 'Show'} {inactiveGroups.length} deactivated thing{inactiveGroups.length === 1 ? '' : 's'}
          </button>
          {showInactive && (
            <div className="grid grid-cols-1 gap-4 opacity-70 lg:grid-cols-2">
              {inactiveGroups.map((g) => (
                <GroupCard
                  key={g.id}
                  group={g}
                  positionCounts={positionCounts}
                  isAdmin={isAdmin}
                  onEdit={onEdit}
                  onDeactivate={onDeactivate}
                  onReactivate={onReactivate}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GroupCard({
  group,
  positionCounts,
  isAdmin,
  onEdit,
  onDeactivate,
  onReactivate,
}: {
  group: OverviewGroup;
  positionCounts: Record<string, number>;
  isAdmin: boolean;
  onEdit: (g: OverviewGroup) => void;
  onDeactivate: (g: OverviewGroup) => void;
  onReactivate: (g: OverviewGroup) => void;
}) {
  const flags = groupHealthFlags(group);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? group.items : group.items.slice(0, 5);

  return (
    <div className="flex flex-col rounded-lg border bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-gray-900">{group.name}</h3>
            {!group.active && (
              <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">deactivated</span>
            )}
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
              {group.items.length} item{group.items.length === 1 ? '' : 's'}
            </span>
          </div>
          {group.description && <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{group.description}</p>}
        </div>
        {isAdmin && (
          <div className="flex flex-shrink-0 items-center gap-1">
            <button
              onClick={() => onEdit(group)}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-gray-600 hover:border-primary hover:text-primary"
            >
              <Pencil className="h-3 w-3" /> Edit
            </button>
            {group.active ? (
              <button
                onClick={() => onDeactivate(group)}
                title="Deactivate"
                className="rounded-md border border-transparent p-1.5 text-gray-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={() => onReactivate(group)}
                title="Reactivate"
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                <RotateCcw className="h-3 w-3" /> Reactivate
              </button>
            )}
          </div>
        )}
      </div>

      {/* Items + fulfillment, in plain words */}
      <div className="flex-1 px-4 py-3">
        {group.items.length === 0 ? (
          <p className="flex items-center gap-2 text-xs text-gray-400">
            <Package className="h-3.5 w-3.5" /> No items — invisible in the buying flow.
          </p>
        ) : (
          <ul className="space-y-2">
            {shown.map((it) => {
              const summary = resolutionSummary(it);
              return (
                <li key={it.id} className="text-xs">
                  <div className="flex items-center gap-1.5">
                    <KindBadge kind={it.fulfillment_kind} />
                    <span className="min-w-0 truncate font-medium text-gray-800">{it.name ?? 'Item'}</span>
                    <span className="flex-shrink-0 text-gray-400">× {it.default_qty}</span>
                  </div>
                  <p className={`mt-0.5 pl-0.5 ${summary.warn ? 'font-medium text-amber-700' : 'text-gray-500'}`}>
                    {summary.warn && <AlertTriangle className="mr-1 inline h-3 w-3" />}
                    {summary.text}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {group.items.length > 5 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 text-[11px] font-medium text-gray-500 underline-offset-2 hover:underline"
          >
            {expanded ? 'Show fewer' : `Show all ${group.items.length} items`}
          </button>
        )}
      </div>

      {/* Who can buy + health */}
      <div className="space-y-2 border-t bg-gray-50/50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-gray-400" />
          {group.allowed_positions.length === 0 ? (
            <Chip className="border-amber-200 bg-amber-50 text-amber-700">
              <Lock className="h-2.5 w-2.5" /> Admins only
            </Chip>
          ) : (
            group.allowed_positions.map((t) => (
              <Chip key={t} className="border-gray-200 bg-white text-gray-600">
                {t}
                <span className="rounded-full bg-gray-100 px-1 text-[10px] text-gray-500">{positionCounts[t] ?? 0}</span>
              </Chip>
            ))
          )}
        </div>
        {flags.length > 0 && (
          <ul className="space-y-0.5">
            {flags.map((f) => (
              <li key={f} className="flex items-start gap-1 text-[11px] font-medium text-amber-700">
                <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" /> {f}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Secondary tab: the access grid (bulk toggling) ───────────────────────────

function GridTab({
  matrixGroups,
  inactiveCount,
  showInactive,
  setShowInactive,
  positionTitles,
  positionCounts,
  isAdmin,
  toggling,
  onToggle,
  onEdit,
}: {
  matrixGroups: OverviewGroup[];
  inactiveCount: number;
  showInactive: boolean;
  setShowInactive: (fn: (v: boolean) => boolean) => void;
  positionTitles: string[];
  positionCounts: Record<string, number>;
  isAdmin: boolean;
  toggling: Set<string>;
  onToggle: (group: OverviewGroup, title: string) => void;
  onEdit: (group: OverviewGroup) => void;
}) {
  if (matrixGroups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-gray-50 p-10 text-center text-sm text-gray-500">
        No buyable things yet — set one up on the Buyable things tab first.
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 text-xs text-gray-500">
        Bulk access control: rows are HR positions, columns are buyable things — click a cell to grant or
        revoke. Click a column header to open that thing&apos;s setup wizard.
      </p>
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
                    onClick={() => (isAdmin ? onEdit(g) : undefined)}
                    title={isAdmin ? `Open "${g.name}" in the wizard` : g.name}
                    className={`group/col mx-auto flex max-w-[9rem] flex-col items-center gap-1 rounded-md px-2 py-1 ${
                      isAdmin ? 'hover:bg-primary/5' : 'cursor-default'
                    }`}
                  >
                    <span className="flex items-center gap-1 text-[13px] font-medium leading-tight text-gray-800">
                      <ShoppingBag className="h-3 w-3 flex-shrink-0 text-gray-400" />
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
              const allowed = matrixGroups.filter((g) => g.active && g.allowed_positions.includes(title));
              const itemCount = allowed.reduce((n, g) => n + g.items.length, 0);
              return (
                <tr key={title} className="border-b last:border-b-0 hover:bg-gray-50/70">
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5">
                    <span className="flex items-center gap-1.5 font-medium text-gray-800">
                      <span className="truncate">{title}</span>
                      <span className="rounded-full bg-gray-100 px-1.5 text-[10px] font-normal text-gray-500">
                        {positionCounts[title] ?? 0}
                      </span>
                    </span>
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
                          onClick={() => onToggle(g, title)}
                          aria-label={`${on ? 'Revoke' : 'Grant'} ${g.name} for ${title}`}
                          title={
                            !g.active
                              ? 'Inactive group'
                              : on
                                ? `${title} can buy ${g.name} — click to revoke`
                                : isAdmin
                                  ? `Click to let ${title} buy ${g.name}`
                                  : `${title} cannot buy ${g.name}`
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
                        {allowed.length} thing{allowed.length === 1 ? '' : 's'}
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

      {inactiveCount > 0 && (
        <button
          type="button"
          onClick={() => setShowInactive((v) => !v)}
          className="mt-3 text-xs font-medium text-gray-500 underline-offset-2 hover:underline"
        >
          {showInactive ? 'Hide' : 'Show'} {inactiveCount} inactive thing{inactiveCount === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}
