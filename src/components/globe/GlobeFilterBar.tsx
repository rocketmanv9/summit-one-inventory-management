'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Filter } from 'lucide-react';
import type { GlobeFilters } from '@/lib/rpc/operations';
import type { VisibleLayers } from './GlobeVisualization';

interface GlobeFilterBarProps {
  filters: GlobeFilters;
  onChange: (filters: GlobeFilters) => void;
  visibleLayers: VisibleLayers;
  onToggleLayer: (layer: keyof VisibleLayers, value: boolean) => void;
}

const TRANSFER_STATUSES = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const LAYER_OPTIONS: { key: keyof VisibleLayers; label: string; color: string }[] = [
  { key: 'locations', label: 'Locations', color: 'bg-blue-500' },
  { key: 'vendors', label: 'Vendors', color: 'bg-green-500' },
  { key: 'transfers', label: 'Transfers', color: 'bg-amber-500' },
  { key: 'pos', label: 'Purchase Orders', color: 'bg-purple-500' },
];

export function GlobeFilterBar({
  filters,
  onChange,
  visibleLayers,
  onToggleLayer,
}: GlobeFilterBarProps) {
  const [collapsed, setCollapsed] = useState(false);

  const updateFilter = (key: keyof GlobeFilters, value: string) => {
    onChange({ ...filters, [key]: value || undefined });
  };

  return (
    <div className="absolute top-4 left-4 z-10 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 w-64">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg"
      >
        <span className="flex items-center gap-2">
          <Filter className="h-4 w-4" />
          Filters
        </span>
        {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-3 border-t border-gray-100 pt-3">
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

          {/* Transfer Status */}
          <div className="border-t border-gray-100 pt-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">Transfer Status</label>
            <select
              value={filters.transfer_status || ''}
              onChange={(e) => updateFilter('transfer_status', e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {TRANSFER_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
              <input
                type="date"
                value={filters.date_from || ''}
                onChange={(e) => updateFilter('date_from', e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
              <input
                type="date"
                value={filters.date_to || ''}
                onChange={(e) => updateFilter('date_to', e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-primary"
              />
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
      )}
    </div>
  );
}
