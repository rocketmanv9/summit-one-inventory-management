'use client';

import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react';
import {
  Filter,
  Trash2,
  ChevronDown,
  RotateCcw,
  Check,
  Bookmark,
  BookmarkPlus,
  Sparkles,
  Layers as LayersIcon,
  Truck,
  ShoppingCart,
  CalendarDays,
  Info,
} from 'lucide-react';
import type { GlobeFilters } from '@/lib/rpc/operations';
import type { VisibleLayers } from './GlobeVisualization';
import { useFilterPresets, type FilterPresetConfig } from '@/hooks/useFilterPresets';

interface GlobeFilterBarProps {
  filters: GlobeFilters;
  onChange: (filters: GlobeFilters) => void;
  visibleLayers: VisibleLayers;
  onToggleLayer: (layer: keyof VisibleLayers, value: boolean) => void;
  transferStatuses: string[];
  onTransferStatusChange: (statuses: string[]) => void;
  poStatuses: string[];
  onPoStatusChange: (statuses: string[]) => void;
  timelineActive: boolean;
  reviewActive?: boolean;
}

const LEGACY_STORAGE_KEY = 'globe-filter-presets';

const TRANSFER_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft', color: 'bg-amber-500' },
  { value: 'in_transit', label: 'In Transit', color: 'bg-blue-500' },
  { value: 'partially_received', label: 'Partially Received', color: 'bg-cyan-500' },
  { value: 'completed', label: 'Completed', color: 'bg-green-500' },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-gray-400' },
];

const PO_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft', color: 'bg-gray-400' },
  { value: 'awaiting_approval', label: 'Awaiting Approval', color: 'bg-yellow-500' },
  { value: 'approved', label: 'Approved', color: 'bg-blue-400' },
  { value: 'placed', label: 'Placed', color: 'bg-indigo-500' },
  { value: 'acknowledged', label: 'Acknowledged', color: 'bg-violet-500' },
  { value: 'partially_received', label: 'Partially Received', color: 'bg-cyan-500' },
  { value: 'fully_received', label: 'Fully Received', color: 'bg-green-500' },
  { value: 'cancelled', label: 'Cancelled', color: 'bg-red-400' },
  { value: 'closed', label: 'Closed', color: 'bg-gray-500' },
];

const LAYER_OPTIONS: { key: keyof VisibleLayers; label: string; color: string }[] = [
  { key: 'locations', label: 'Locations', color: 'bg-blue-500' },
  { key: 'vendors', label: 'Vendors', color: 'bg-green-500' },
  { key: 'transfers', label: 'Transfers', color: 'bg-amber-500' },
  { key: 'pos', label: 'Purchase Orders', color: 'bg-purple-500' },
];

const ALL_LAYERS_ON: VisibleLayers = { locations: true, vendors: true, transfers: true, pos: true };

function toggleStatus(statuses: string[], value: string): string[] {
  return statuses.includes(value)
    ? statuses.filter((s) => s !== value)
    : [...statuses, value];
}

/** Stable serialization so we can detect which saved preset matches the current view. */
function serializeConfig(c: FilterPresetConfig): string {
  return JSON.stringify({
    filters: Object.fromEntries(
      Object.entries(c.filters)
        .filter(([, v]) => v != null && v !== '')
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
    visibleLayers: LAYER_OPTIONS.map((l) => Boolean(c.visibleLayers[l.key])),
    transferStatuses: [...c.transferStatuses].sort(),
    poStatuses: [...c.poStatuses].sort(),
  });
}

/** Collapsible section with an icon, title, and a summary badge of what's active. */
function Section({
  icon,
  title,
  badge,
  badgeActive,
  defaultOpen = false,
  children,
}: {
  icon: ReactNode;
  title: string;
  badge?: string;
  badgeActive?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50 transition-colors"
      >
        <span className="text-gray-400">{icon}</span>
        <span className="text-sm font-medium text-gray-800 flex-1 text-left">{title}</span>
        {badge && (
          <span
            className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
              badgeActive ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {badge}
          </span>
        )}
        <ChevronDown
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="px-3 pb-3 pt-1 border-t border-gray-100">{children}</div>}
    </div>
  );
}

export function GlobeFilterBar({
  filters,
  onChange,
  visibleLayers,
  onToggleLayer,
  transferStatuses,
  onTransferStatusChange,
  poStatuses,
  onPoStatusChange,
  timelineActive,
  reviewActive,
}: GlobeFilterBarProps) {
  const { presets, loading, savePreset, deletePreset } = useFilterPresets();
  const [savingName, setSavingName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const migratedRef = useRef(false);

  // One-time migration: upload localStorage presets to server
  useEffect(() => {
    if (loading || migratedRef.current) return;
    migratedRef.current = true;
    if (presets.length > 0) return; // already have server presets
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return;
      const legacy = JSON.parse(raw) as Array<{
        name: string;
        filters: GlobeFilters;
        visibleLayers: VisibleLayers;
        transferStatuses: string[];
        poStatuses: string[];
      }>;
      if (!Array.isArray(legacy) || legacy.length === 0) return;
      for (const p of legacy) {
        savePreset(p.name, {
          filters: p.filters,
          visibleLayers: p.visibleLayers,
          transferStatuses: p.transferStatuses,
          poStatuses: p.poStatuses,
        });
      }
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Ignore migration errors
    }
  }, [loading, presets.length, savePreset]);

  const updateFilter = (key: keyof GlobeFilters, value: string) => {
    onChange({ ...filters, [key]: value || undefined });
  };

  const handleSavePreset = () => {
    const name = savingName.trim();
    if (!name) return;
    savePreset(name, { filters, visibleLayers, transferStatuses, poStatuses });
    setSavingName('');
    setShowSaveInput(false);
  };

  const handleLoadPreset = (preset: (typeof presets)[number]) => {
    onChange(preset.config.filters);
    for (const [k, v] of Object.entries(preset.config.visibleLayers) as [keyof VisibleLayers, boolean][]) {
      onToggleLayer(k, v);
    }
    onTransferStatusChange(preset.config.transferStatuses);
    onPoStatusChange(preset.config.poStatuses);
  };

  const handleResetAll = () => {
    onChange({});
    onTransferStatusChange([]);
    onPoStatusChange([]);
    for (const opt of LAYER_OPTIONS) onToggleLayer(opt.key, true);
  };

  // --- Derived summary state ---
  const layersOn = LAYER_OPTIONS.filter((o) => visibleLayers[o.key]).length;
  const dateActive = Boolean(filters.date_from || filters.date_to);
  const transfersAll = transferStatuses.length === 0;
  const posAll = poStatuses.length === 0;

  const currentSerialized = useMemo(
    () => serializeConfig({ filters, visibleLayers, transferStatuses, poStatuses }),
    [filters, visibleLayers, transferStatuses, poStatuses],
  );
  const activePresetId = useMemo(
    () => presets.find((p) => serializeConfig(p.config) === currentSerialized)?.id ?? null,
    [presets, currentSerialized],
  );

  const activeFilterCount =
    (layersOn < LAYER_OPTIONS.length ? 1 : 0) +
    (!transfersAll ? 1 : 0) +
    (!posAll ? 1 : 0) +
    (dateActive ? 1 : 0);

  return (
    <div className="w-80 flex-shrink-0 bg-gray-50 border-r border-gray-200 flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 sticky top-0 bg-gray-50 z-10">
        <Filter className="h-4 w-4 text-gray-500" />
        <span className="text-sm font-semibold text-gray-800">Map Filters</span>
        {activeFilterCount > 0 && (
          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-primary text-white">
            {activeFilterCount}
          </span>
        )}
        <button
          onClick={handleResetAll}
          disabled={activeFilterCount === 0}
          className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Reset all filters"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset
        </button>
      </div>

      <div
        className={`px-3 py-3 space-y-3 flex-1 transition-opacity ${
          reviewActive ? 'opacity-50 pointer-events-none' : ''
        }`}
      >
        {/* Saved Filters — prominent card at the top */}
        <div className="rounded-xl border border-gray-200 bg-gradient-to-b from-white to-gray-50/60 p-3 space-y-3 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-sm">
              <Bookmark className="h-4 w-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-gray-800 flex-1">Saved Filters</span>
            {presets.length > 0 && (
              <span className="text-[11px] font-medium text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">
                {presets.length}
              </span>
            )}
          </div>

          {/* Preset list */}
          {presets.length === 0 ? (
            <div className="flex flex-col items-center text-center gap-1.5 py-4 px-2 rounded-lg border border-dashed border-gray-200 bg-gray-50/50">
              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                <BookmarkPlus className="h-5 w-5 text-primary/70" />
              </div>
              <p className="text-xs font-medium text-gray-500">No saved filters yet</p>
              <p className="text-[11px] text-gray-400 leading-snug">
                Set up the map below, then save it for one-click access.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {presets.map((p) => {
                const isActive = p.id === activePresetId;
                return (
                  <div
                    key={p.id}
                    className={`group relative flex items-center rounded-lg border px-1 transition-all ${
                      isActive
                        ? 'border-primary/30 bg-primary/5 shadow-sm ring-1 ring-primary/10'
                        : 'border-gray-100 bg-white hover:border-gray-200 hover:shadow-sm'
                    }`}
                  >
                    <button
                      onClick={() => handleLoadPreset(p)}
                      className="flex-1 flex items-center gap-2 text-left text-sm px-2 py-2 text-gray-700 truncate"
                      title={`Load "${p.name}"`}
                    >
                      <span
                        className={`flex-shrink-0 flex items-center justify-center h-5 w-5 rounded-md ${
                          isActive ? 'bg-primary text-white' : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        {isActive ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Bookmark className="h-3 w-3" />
                        )}
                      </span>
                      <span className="truncate font-medium">{p.name}</span>
                      {isActive && (
                        <span className="ml-auto flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-primary bg-primary/10 rounded-full px-1.5 py-0.5">
                          Active
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => deletePreset(p.id)}
                      className="flex-shrink-0 p-1.5 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                      title={`Delete "${p.name}"`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Save current view */}
          {showSaveInput ? (
            <div className="space-y-1.5">
              <div className="flex gap-1.5">
                <input
                  autoFocus
                  value={savingName}
                  onChange={(e) => setSavingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSavePreset();
                    if (e.key === 'Escape') {
                      setShowSaveInput(false);
                      setSavingName('');
                    }
                  }}
                  placeholder="Name this view…"
                  className="flex-1 text-sm px-2.5 py-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
                <button
                  onClick={handleSavePreset}
                  disabled={!savingName.trim()}
                  className="px-3 py-2 text-sm font-medium bg-primary text-white rounded-lg shadow-sm hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Save
                </button>
              </div>
              <p className="text-[10px] text-gray-400 px-0.5">
                Press <kbd className="font-sans font-medium text-gray-500">Enter</kbd> to save,
                {' '}
                <kbd className="font-sans font-medium text-gray-500">Esc</kbd> to cancel
              </p>
            </div>
          ) : (
            <button
              onClick={() => setShowSaveInput(true)}
              className="group w-full flex items-center justify-center gap-1.5 text-sm font-medium text-white rounded-lg py-2 bg-gradient-to-r from-primary to-primary/80 shadow-sm hover:shadow-md hover:brightness-105 active:scale-[0.99] transition-all"
            >
              <Sparkles className="h-4 w-4 transition-transform group-hover:scale-110" />
              Save current view
            </button>
          )}
        </div>

        {/* Layers */}
        <Section
          icon={<LayersIcon className="h-4 w-4" />}
          title="Show on Map"
          badge={`${layersOn}/${LAYER_OPTIONS.length}`}
          badgeActive={layersOn < LAYER_OPTIONS.length}
          defaultOpen
        >
          <div className="space-y-1 pt-1">
            {LAYER_OPTIONS.map((opt) => (
              <label
                key={opt.key}
                className="flex items-center gap-2.5 text-sm text-gray-700 cursor-pointer py-0.5"
              >
                <input
                  type="checkbox"
                  checked={visibleLayers[opt.key]}
                  onChange={(e) => onToggleLayer(opt.key, e.target.checked)}
                  className="rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className={`w-2.5 h-2.5 rounded-full ${opt.color}`} />
                {opt.label}
              </label>
            ))}
          </div>
        </Section>

        {/* Transfer Statuses */}
        <Section
          icon={<Truck className="h-4 w-4" />}
          title="Transfer Status"
          badge={transfersAll ? 'All' : `${transferStatuses.length}/${TRANSFER_STATUS_OPTIONS.length}`}
          badgeActive={!transfersAll}
        >
          <div className="flex justify-end pt-1">
            <button
              onClick={() =>
                onTransferStatusChange(
                  transferStatuses.length === TRANSFER_STATUS_OPTIONS.length
                    ? []
                    : TRANSFER_STATUS_OPTIONS.map((s) => s.value),
                )
              }
              className="text-xs text-primary hover:underline"
            >
              {transferStatuses.length === TRANSFER_STATUS_OPTIONS.length ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div className="space-y-1">
            {TRANSFER_STATUS_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2.5 text-sm text-gray-700 cursor-pointer py-0.5"
              >
                <input
                  type="checkbox"
                  checked={transferStatuses.length === 0 || transferStatuses.includes(opt.value)}
                  onChange={() => {
                    if (transferStatuses.length === 0) {
                      onTransferStatusChange(
                        TRANSFER_STATUS_OPTIONS.map((s) => s.value).filter((v) => v !== opt.value),
                      );
                    } else {
                      onTransferStatusChange(toggleStatus(transferStatuses, opt.value));
                    }
                  }}
                  className="rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className={`w-2 h-2 rounded-full ${opt.color}`} />
                {opt.label}
              </label>
            ))}
          </div>
        </Section>

        {/* PO Statuses */}
        <Section
          icon={<ShoppingCart className="h-4 w-4" />}
          title="PO Status"
          badge={posAll ? 'All' : `${poStatuses.length}/${PO_STATUS_OPTIONS.length}`}
          badgeActive={!posAll}
        >
          <div className="flex justify-end pt-1">
            <button
              onClick={() =>
                onPoStatusChange(
                  poStatuses.length === PO_STATUS_OPTIONS.length
                    ? []
                    : PO_STATUS_OPTIONS.map((s) => s.value),
                )
              }
              className="text-xs text-primary hover:underline"
            >
              {poStatuses.length === PO_STATUS_OPTIONS.length ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div className="space-y-1">
            {PO_STATUS_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2.5 text-sm text-gray-700 cursor-pointer py-0.5"
              >
                <input
                  type="checkbox"
                  checked={poStatuses.length === 0 || poStatuses.includes(opt.value)}
                  onChange={() => {
                    if (poStatuses.length === 0) {
                      onPoStatusChange(
                        PO_STATUS_OPTIONS.map((s) => s.value).filter((v) => v !== opt.value),
                      );
                    } else {
                      onPoStatusChange(toggleStatus(poStatuses, opt.value));
                    }
                  }}
                  className="rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className={`w-2 h-2 rounded-full ${opt.color}`} />
                {opt.label}
              </label>
            ))}
          </div>
        </Section>

        {/* Date Range */}
        <Section
          icon={<CalendarDays className="h-4 w-4" />}
          title="Date Range"
          badge={dateActive ? 'Set' : undefined}
          badgeActive={dateActive}
        >
          {timelineActive && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded-md px-2 py-1.5 mt-1">
              Date range is controlled by the timeline while it&apos;s active.
            </p>
          )}
          <div className="space-y-2 pt-1">
            <div>
              <label className="block text-xs text-gray-500 mb-1">From</label>
              <input
                type="date"
                value={filters.date_from || ''}
                onChange={(e) => updateFilter('date_from', e.target.value)}
                disabled={timelineActive}
                className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <input
                type="date"
                value={filters.date_to || ''}
                onChange={(e) => updateFilter('date_to', e.target.value)}
                disabled={timelineActive}
                className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          </div>
        </Section>

        {/* Legend */}
        <Section icon={<Info className="h-4 w-4" />} title="Legend">
          <div className="space-y-1.5 pt-1">
            <LegendRow color="bg-blue-500" label="Yard / Warehouse" />
            <LegendRow color="bg-orange-500" label="Job Site" />
            <LegendRow color="bg-indigo-500" label="Plant" />
            <LegendRow color="bg-green-500" label="Vendor" />
            <LegendRow color="bg-amber-500" label="Transfer (Draft)" line />
            <LegendRow color="bg-blue-500" label="Transfer (In Transit)" line />
            <LegendRow color="bg-green-500" label="Transfer (Completed)" line />
            <LegendRow color="bg-purple-500" label="Purchase Order" line />
          </div>
        </Section>
      </div>
    </div>
  );
}

function LegendRow({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs text-gray-600">
      <span className={`${line ? 'w-3 h-1' : 'w-3 h-3'} rounded-full ${color}`} />
      {label}
    </div>
  );
}
