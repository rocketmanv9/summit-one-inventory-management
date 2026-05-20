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
  transferStatuses: string[];
  onTransferStatusChange: (statuses: string[]) => void;
  poStatuses: string[];
  onPoStatusChange: (statuses: string[]) => void;
  timelineActive: boolean;
}

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
  const [collapsed, setCollapsed] = useState(false);

  const updateFilter = (key: keyof GlobeFilters, value: string) => {
    onChange({ ...filters, [key]: value || undefined });
  };

  return (
    <div className="absolute top-4 left-4 z-10 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 w-64 max-h-[calc(100vh-8rem)] overflow-y-auto">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg sticky top-0 bg-white/95 backdrop-blur-sm z-10"
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
                        // First click when "all" shown: select only this one
                        onTransferStatusChange(TRANSFER_STATUS_OPTIONS.map((s) => s.value).filter((v) => v !== opt.value));
                      } else {
                        const next = toggleStatus(transferStatuses, opt.value);
                        onTransferStatusChange(next);
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
                        const next = toggleStatus(poStatuses, opt.value);
                        onPoStatusChange(next);
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
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
                <input
                  type="date"
                  value={filters.date_from || ''}
                  onChange={(e) => updateFilter('date_from', e.target.value)}
                  disabled={timelineActive}
                  className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
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
      )}
    </div>
  );
}
