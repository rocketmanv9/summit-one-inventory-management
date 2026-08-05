'use client';

/**
 * FixedDashboard — the single opinionated inventory dashboard.
 *
 * There is no per-user configuration here: no drag/resize, no widget picker,
 * no saved layout. The composition below is curated to surface the highest-signal
 * widgets, grouped into sections (needs-attention → today's flow → planning →
 * value). Every widget component fetches its own data, so the sections render
 * in parallel with no waterfall.
 *
 * The widget components historically took a `DashboardWidget` prop (from the old
 * configurable grid). Most ignore everything but `widget_key`/`config`, so we
 * synthesize lightweight stand-ins via `fixedWidget()` — no DB row required.
 */

import Link from 'next/link';
import type { DashboardWidget } from '@/types/dashboard';
import { PageHeader } from '@/components/ui/PageHeader';
import { MyAssignedCounts } from '@/components/counts/MyAssignedCounts';

import { LowStockWidget } from '@/components/widgets/inventory/LowStockWidget';
import { InventoryForecastWidget } from '@/components/widgets/inventory/InventoryForecastWidget';
import { InventorySummaryWidget } from '@/components/widgets/inventory/InventorySummaryWidget';
import { ReplenishmentSuggestions } from '@/components/widgets/inventory/ReplenishmentSuggestions';
import { TransferSuggestions } from '@/components/widgets/inventory/TransferSuggestions';
import { CycleCountSuggestions } from '@/components/widgets/inventory/CycleCountSuggestions';
import { DeadStockWidget } from '@/components/widgets/inventory/DeadStockWidget';
import { LocationCapacity } from '@/components/widgets/inventory/LocationCapacity';
import { RecentReceiptsRealtime } from '@/components/widgets/flow/RecentReceiptsRealtime';
import { CountInsightsTab } from '@/components/insights/CountInsightsTab';

import { QuickTools } from './QuickTools';

/**
 * Build a stand-in DashboardWidget for a widget component that expects the prop.
 * These are never persisted — the fixed dashboard owns composition, not the DB.
 */
function fixedWidget(widgetKey: string, title: string): DashboardWidget {
  return {
    id: `fixed:${widgetKey}`,
    tenant_id: '',
    dashboard_id: 'fixed',
    widget_key: widgetKey,
    title,
    config: {},
    layout: { x: 0, y: 0, w: 4, h: 1 },
    refresh_seconds: 0,
    created_at: '',
    updated_at: '',
  };
}

/** Section heading + optional "see all" link, consistent across the page. */
function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {sub && <p className="text-sm text-gray-500">{sub}</p>}
    </div>
  );
}

/** A titled card wrapper for widgets whose own body has no header chrome. */
function Panel({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        {href && (
          <Link href={href} className="text-xs font-medium text-blue-600 hover:text-blue-800">
            {linkLabel || 'View all'} &rarr;
          </Link>
        )}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

export function FixedDashboard() {
  return (
    <div className="p-6 sm:p-8 space-y-8">
      <PageHeader
        title="Inventory Dashboard"
        description="Your yard at a glance — what needs attention, what's moving today, and what to plan next."
      />

      {/* Quick tools — reuse the existing modals/routes, no new flows. */}
      <QuickTools />

      {/* Counts assigned to me — personal action list, keep it up top. */}
      <MyAssignedCounts />

      {/* ── Needs attention ─────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Needs attention"
          sub="Stock below reorder, and where you're heading net-negative."
        />
        <div className="grid gap-5 lg:grid-cols-2">
          <LowStockWidget widget={fixedWidget('inventory.widget.low_stock_alerts', 'Low Stock')} />
          <Panel title="Forecast — net position" href="/inventory/metrics" linkLabel="Metrics">
            <InventoryForecastWidget
              widget={fixedWidget('inventory.widget.inventory_forecast', 'Forecast')}
            />
          </Panel>
        </div>
      </section>

      {/* ── Today / flow ────────────────────────────────────────────── */}
      <section>
        <SectionHeader title="Today" sub="Receiving activity as it happens." />
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Recent receipts" href="/inventory/movements" linkLabel="Movements">
            <RecentReceiptsRealtime
              widget={fixedWidget('flow.widget.recent_receipts_realtime', 'Recent Receipts')}
            />
          </Panel>
          <Panel title="Cycle count suggestions" href="/inventory/cycle-counts" linkLabel="Cycle counts">
            <CycleCountSuggestions
              widget={fixedWidget('flow.widget.cycle_count_suggestions', 'Cycle Counts')}
            />
          </Panel>
        </div>
      </section>

      {/* ── Planning ────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Planning"
          sub="What to reorder, what to rebalance between yards."
        />
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Replenishment suggestions" href="/inventory/purchasing" linkLabel="Purchasing">
            <ReplenishmentSuggestions
              widget={fixedWidget('inventory.widget.replenishment_suggestions', 'Replenishment')}
            />
          </Panel>
          <Panel title="Transfer suggestions" href="/inventory/transfers" linkLabel="Transfers">
            <TransferSuggestions
              widget={fixedWidget('inventory.widget.transfer_suggestions', 'Transfers')}
            />
          </Panel>
        </div>
      </section>

      {/* ── Value & health ──────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Value & health"
          sub="Overall position, capital sitting idle, and yard capacity."
        />
        <div className="space-y-5">
          <InventorySummaryWidget
            widget={fixedWidget('inventory.widget.inventory_summary', 'Inventory Overview')}
          />
          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="Dead stock" href="/inventory/metrics" linkLabel="Metrics">
              <DeadStockWidget
                widget={fixedWidget('inventory.widget.dead_stock', 'Dead Stock')}
              />
            </Panel>
            <Panel title="Location capacity" href="/inventory/locations" linkLabel="Locations">
              <LocationCapacity
                widget={fixedWidget('inventory.widget.location_capacity', 'Location Capacity')}
              />
            </Panel>
          </div>
        </div>
      </section>

      {/* ── Counting stats ──────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Counting stats"
          sub="Count adherence, accuracy, and the counter leaderboard."
        />
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
          <CountInsightsTab />
        </div>
      </section>
    </div>
  );
}
