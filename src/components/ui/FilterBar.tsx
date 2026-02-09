'use client';

import { useState } from 'react';

interface FilterOption {
  value: string;
  label: string;
}

interface FilterConfig {
  key: string;
  label: string;
  type: 'select' | 'search' | 'date';
  options?: FilterOption[];
  placeholder?: string;
}

interface FilterBarProps {
  filters: FilterConfig[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onClear?: () => void;
}

export function FilterBar({ filters, values, onChange, onClear }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 p-4 bg-muted/30 rounded-lg border">
      {filters.map((filter) => (
        <div key={filter.key} className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
            {filter.label}:
          </label>
          {filter.type === 'select' && filter.options && (
            <select
              value={values[filter.key] || ''}
              onChange={(e) => onChange(filter.key, e.target.value)}
              className="h-9 px-3 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">All</option>
              {filter.options.map((opt, index) => (
                <option key={opt.value || opt.label || index} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
          {filter.type === 'search' && (
            <input
              type="text"
              value={values[filter.key] || ''}
              onChange={(e) => onChange(filter.key, e.target.value)}
              placeholder={filter.placeholder || 'Search...'}
              className="h-9 px-3 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary w-48"
            />
          )}
          {filter.type === 'date' && (
            <input
              type="date"
              value={values[filter.key] || ''}
              onChange={(e) => onChange(filter.key, e.target.value)}
              className="h-9 px-3 rounded-md border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          )}
        </div>
      ))}
      {onClear && Object.values(values).some((v) => v) && (
        <button
          onClick={onClear}
          className="h-9 px-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
