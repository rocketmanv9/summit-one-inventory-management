'use client';

import { useState, useEffect, useRef } from 'react';
import { Filter, Save, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import type { GlobeFilters } from '@/lib/rpc/operations';
import type { VisibleLayers } from './GlobeVisualization';
import { useFilterPresets } from '@/hooks/useFilterPresets';

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

function toggleStatus(statuses: string[], value: string): string[] {
  return statuses.includes(value)
    ? statuses.filter((s) => s !== value)
    : [...statuses, value];
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
}: GlobeFilterBarProps) {
  const { presets, loading, savePreset, deletePreset } = useFilterPresets();
  const [savingName, setSavingName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
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

  const handleDeletePreset = (id: string) => {
    deletePreset(id);
  };

  return (
    <div className="w-72 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 sticky top-0 bg-white z-10">
        <Filter className="h-4 w-4 text-gray-500" />
        <span className="text-sm font-semibold text-gray-800">Map Filters</span>
      </div>

      <div className="px-4 py-3 space-y-4 flex-1">
        {/* Saved Presets */}
        <div>
          <button
            onClick={() => setPresetsOpen(!presetsOpen)}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-2 hover:text-gray-800"
          >
            {presetsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Saved Filters
          </button>

          {presetsOpen && (
            <div className="space-y-1.5 mb-2">
              {presets.length === 0 && (
                <p className="text-[11px] text-gray-400 italic">No saved filters yet</p>
              )}
              {presets.map((p) => (
                <div key={p.id} className="flex items-center gap-1">
                  <button
                    onClick={() => handleLoadPreset(p)}
                    className="flex-1 text-left text-xs px-2 py-1 rounded hover:bg-gray-100 text-gray-700 truncate"
                    title={`Load "${p.name}"`}
                  >
                    {p.name}
                  </button>
                  <button
                    onClick={() => handleDeletePreset(p.id)}
                    className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                    title="Delete preset"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}

              {showSaveInput ? (
                <div className="flex gap-1 mt-1">
                  <input
                    autoFocus
                    value={savingName}
                    onChange={(e) => setSavingName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSavePreset(); if (e.key === 'Escape') setShowSaveInput(false); }}
                    placeholder="Preset name..."
                    className="flex-1 text-xs px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <button
                    onClick={handleSavePreset}
                    disabled={!savingName.trim()}
                    className="px-2 py-1 text-xs bg-primary text-white rounded hover:bg-primary/90 disabled:opacity-40"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowSaveInput(true)}
                  className="flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                >
                  <Save className="h-3 w-3" />
                  Save current filters
                </button>
              )}
            </div>
          )}
        </div>

        {/* Layers */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">Show on Map</label>
          <div className="space-y-1.5">
            {LAYER_OPTIONS.map((opt) => (
              <label key={opt.key} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
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
        </div>

        {/* Transfer Statuses */}
        <div className="border-t border-gray-100 pt-3">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-gray-600">Transfer Status</label>
            <button
              onClick={() => onTransferStatusChange(
                transferStatuses.length === TRANSFER_STATUS_OPTIONS.length ? [] : TRANSFER_STATUS_OPTIONS.map((s) => s.value)
              )}
              className="text-[10px] text-primary hover:underline"
            >
              {transferStatuses.length === TRANSFER_STATUS_OPTIONS.length ? 'None' : 'All'}
            </button>
          </div>
          <div className="space-y-1">
            {TRANSFER_STATUS_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={transferStatuses.length === 0 || transferStatuses.includes(opt.value)}
                  onChange={() => {
                    if (transferStatuses.length === 0) {
                      onTransferStatusChange(TRANSFER_STATUS_OPTIONS.map((s) => s.value).filter((v) => v !== opt.value));
                    } else {
                      onTransferStatusChange(toggleStatus(transferStatuses, opt.value));
                    }
                  }}
                  className="rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className={`w-2 h-2 rounded-full ${opt.color}`} />
                <span className="text-xs">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* PO Statuses */}
        <div className="border-t border-gray-100 pt-3">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-gray-600">PO Status</label>
            <button
              onClick={() => onPoStatusChange(
                poStatuses.length === PO_STATUS_OPTIONS.length ? [] : PO_STATUS_OPTIONS.map((s) => s.value)
              )}
              className="text-[10px] text-primary hover:underline"
            >
              {poStatuses.length === PO_STATUS_OPTIONS.length ? 'None' : 'All'}
            </button>
          </div>
          <div className="space-y-1">
            {PO_STATUS_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={poStatuses.length === 0 || poStatuses.includes(opt.value)}
                  onChange={() => {
                    if (poStatuses.length === 0) {
                      onPoStatusChange(PO_STATUS_OPTIONS.map((s) => s.value).filter((v) => v !== opt.value));
                    } else {
                      onPoStatusChange(toggleStatus(poStatuses, opt.value));
                    }
                  }}
                  className="rounded border-gray-300 text-primary focus:ring-primary"
                />
                <span className={`w-2 h-2 rounded-full ${opt.color}`} />
                <span className="text-xs">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Date Range */}
        <div className="border-t border-gray-100 pt-3">
          <label className="block text-xs font-medium text-gray-600 mb-2">Date Range</label>
          <div className="space-y-2">
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">From</label>
              <input
                type="date"
                value={filters.date_from || ''}
                onChange={(e) => updateFilter('date_from', e.target.value)}
                disabled={timelineActive}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-0.5">To</label>
              <input
                type="date"
                value={filters.date_to || ''}
                onChange={(e) => updateFilter('date_to', e.target.value)}
                disabled={timelineActive}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="border-t border-gray-100 pt-3">
          <div className="text-xs font-medium text-gray-600 mb-2">Legend</div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span className="w-3 h-3 rounded-full bg-blue-500" />
              Yard / Warehouse
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span className="w-3 h-3 rounded-full bg-orange-500" />
              Job Site
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span className="w-3 h-3 rounded-full bg-indigo-500" />
              Plant
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span className="w-3 h-3 rounded-full bg-green-500" />
              Vendor
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span className="w-3 h-1 rounded-full bg-amber-500" />
              Transfer (Draft)
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span className="w-3 h-1 rounded-full bg-blue-500" />
              Transfer (In Transit)
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span className="w-3 h-1 rounded-full bg-green-500" />
              Transfer (Completed)
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span className="w-3 h-1 rounded-full bg-purple-500" />
              Purchase Order
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
