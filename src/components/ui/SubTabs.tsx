'use client';

import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SubTab<T extends string = string> {
  value: T;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  /** Optional trailing element, e.g. a count or a status dot. */
  badge?: ReactNode;
}

interface SubTabsProps<T extends string> {
  tabs: SubTab<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  'aria-label'?: string;
}

// State-driven in-page tab strip. Visually identical to the route-driven
// PageTabs strip — this is the ONE pattern for switching views inside a page.
export function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  'aria-label': ariaLabel = 'Views',
}: SubTabsProps<T>) {
  return (
    <div className={cn('mb-6 border-b border-border', className)}>
      <nav className="-mb-px flex flex-wrap gap-1" role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = tab.value === value;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(tab.value)}
              className={cn(
                'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              )}
            >
              {Icon && <Icon className="h-4 w-4 flex-shrink-0" />}
              {tab.label}
              {tab.badge}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
