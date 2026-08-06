'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarPlus, Loader2, Check } from 'lucide-react';
import type { DashboardWidget } from '@/types/dashboard';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { apiWrite } from '@/lib/api-client';
import { useSession } from '@/hooks/useSession';
import { errMessage } from '@/lib/client-errors';

export function CycleCountSuggestions({ widget, locationId }: { widget: DashboardWidget; locationId?: string }) {
  const router = useRouter();
  const { session } = useSession();
  const canSchedule = session?.role === 'admin' || session?.role === 'manager';
  const [data, setData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [scheduleMsg, setScheduleMsg] = useState<string | null>(null);
  const [scheduleErr, setScheduleErr] = useState<string | null>(null);

  // The distinct locations across the visible suggestions — what "Schedule
  // these" acts on. One count gets created per location.
  const visibleLocationIds = [...new Set(data.map((r) => r.location_id).filter(Boolean))] as string[];

  async function handleScheduleThese() {
    if (scheduling || visibleLocationIds.length === 0) return;
    setScheduling(true);
    setScheduleMsg(null);
    setScheduleErr(null);
    try {
      const res = await apiWrite('/api/inventory/cycle-counts/auto-schedule', 'POST', {
        location_ids: visibleLocationIds,
        max_locations: visibleLocationIds.length,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message || 'Failed to schedule counts');
      }
      const created = json?.data?.createdCount ?? 0;
      const reused = json?.data?.reusedCount ?? 0;
      const skippedTerminal = json?.data?.skippedTerminal ?? 0;
      setScheduleMsg(
        created > 0
          ? `Scheduled ${created} count${created === 1 ? '' : 's'}${reused ? ` (${reused} already scheduled)` : ''}.`
          : reused > 0
            ? 'These locations already have scheduled counts.'
            : skippedTerminal > 0
              ? 'Already scheduled and cancelled today — the nightly run will re-offer these tomorrow.'
              : 'Nothing to schedule right now.',
      );
      // Refresh the router so the counts list picks up the new counts.
      router.refresh();
    } catch (err) {
      setScheduleErr(errMessage(err, 'Failed to schedule counts'));
    } finally {
      setScheduling(false);
    }
  }

  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      setError(null);
      try {
        // Each suggestion is item-at-location; pull extra when scoping so the
        // list stays full after filtering to the active location.
        const result = await InventoryRPC.getCycleCountSuggestions(locationId ? 50 : 10);
        const scoped = locationId ? result.filter((r) => r.location_id === locationId) : result;
        setData(scoped.slice(0, 10));
      } catch (error) {
        console.error('Error fetching cycle count suggestions:', error);
        setError(errMessage(error, 'Unknown error'));
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [widget.widget_key, widget.config, locationId]);

  if (isLoading) {
    return (
      <div className="p-4 animate-pulse">
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        Failed to load — {error}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        No cycle count suggestions
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {canSchedule && (
        <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 border-b">
          <div className="text-xs text-muted-foreground">
            {visibleLocationIds.length > 0 && (
              <>Turn these into assigned counts across {visibleLocationIds.length} location{visibleLocationIds.length === 1 ? '' : 's'}.</>
            )}
          </div>
          <button
            type="button"
            onClick={handleScheduleThese}
            disabled={scheduling || visibleLocationIds.length === 0}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-primary border border-primary/30 rounded hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            {scheduling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarPlus className="w-3.5 h-3.5" />}
            Schedule these
          </button>
        </div>
      )}
      {(scheduleMsg || scheduleErr) && (
        <div className={`flex items-center gap-1.5 px-4 py-2 text-xs ${scheduleErr ? 'text-red-600 bg-red-50' : 'text-green-700 bg-green-50'}`}>
          {!scheduleErr && <Check className="w-3.5 h-3.5" />}
          {scheduleErr || scheduleMsg}
        </div>
      )}
      <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
      {data.map((item, idx) => (
        <div key={idx} className="flex items-start justify-between text-sm border-b pb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold">
                {item.priority_score}
              </span>
              {item.catalog_item_id ? (
                <Link
                  href={`/inventory/items/${item.catalog_item_id}`}
                  className="font-medium truncate hover:text-primary hover:underline"
                >
                  {item.item_name}
                </Link>
              ) : (
                <span className="font-medium truncate">{item.item_name}</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5 ml-8">
              {item.sku} | {item.location_name}
              {item.abc_class && ` | ABC: ${item.abc_class}`}
            </div>
            {item.reasons && item.reasons.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1 ml-8">
                {item.reasons.map((reason: string, ri: number) => (
                  <span key={ri} className="inline-flex px-1.5 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded">
                    {reason}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 ml-2 shrink-0">
            <div className="text-xs text-muted-foreground">
              {item.days_since_last_count < 999
                ? `${item.days_since_last_count}d ago`
                : 'Never counted'}
            </div>
            {item.location_id && (
              <button
                type="button"
                onClick={() => {
                  const params = new URLSearchParams({ create: '1', location: item.location_id });
                  if (item.catalog_item_id) params.set('item', item.catalog_item_id);
                  router.push(`/inventory/cycle-counts?${params.toString()}`);
                }}
                className="px-2 py-0.5 text-xs font-medium text-primary border border-primary/30 rounded hover:bg-primary/10 transition-colors"
              >
                Count
              </button>
            )}
          </div>
        </div>
      ))}
      </div>
    </div>
  );
}
