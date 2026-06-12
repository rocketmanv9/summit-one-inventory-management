'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppError } from '@rocketmanv9/chassis/errors';
import { authenticatedFetch, apiWrite } from '@/lib/api-client';
import { getStoredAccessToken, getUserIdFromToken } from '@/lib/auth-token';

interface MyCountItem {
  kind: 'scheduled' | 'count';
  schedule_entry_id: string | null;
  cycle_count_id: string | null;
  template_name: string;
  location_name: string | null;
  count_type: string | null;
  is_blind: boolean;
  scheduled_date: string | null;
  count_number: string | null;
  count_status: string | null;
  entry_status: string | null;
  overdue: boolean;
}

interface QualifiedUser {
  user_id: string;
  name: string | null;
  email: string | null;
  qualified: boolean;
}

const COUNT_TYPE_LABELS: Record<string, string> = {
  full: 'Full Inventory',
  partial: 'Partial Count',
  spot_check: 'Spot Check',
};

function extractApiError(data: any, fallback: string): string {
  return typeof data?.error === 'string' ? data.error : data?.error?.message || fallback;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/**
 * "My Assigned Counts" dashboard card: schedule entries and in-flight cycle
 * counts assigned to the signed-in user, with start / open / delegate actions.
 * Renders nothing when the user has no assigned counts.
 */
export function MyAssignedCounts() {
  const router = useRouter();
  const [items, setItems] = useState<MyCountItem[] | null>(null);
  const [qualifiedUsers, setQualifiedUsers] = useState<QualifiedUser[]>([]);
  const [delegatingKey, setDelegatingKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const myUserId = useMemo(() => {
    const token = getStoredAccessToken();
    return token ? getUserIdFromToken(token) : null;
  }, []);

  const fetchItems = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/inventory/count-schedule/my');
      if (!res.ok) throw AppError.internal('Failed to load assigned counts');
      const { data } = await res.json();
      setItems(data || []);
    } catch (err) {
      console.error('Error loading assigned counts:', err);
      setItems([]);
    }
  }, []);

  useEffect(() => {
    fetchItems();
    authenticatedFetch('/api/inventory/count-qualified')
      .then(res => res.json())
      .then(({ data }) => setQualifiedUsers((data || []).filter((u: QualifiedUser) => u.qualified)))
      .catch(err => console.error('Error loading qualified counters:', err));
  }, [fetchItems]);

  if (!items || items.length === 0) return null;

  const itemKey = (item: MyCountItem) => item.schedule_entry_id || item.cycle_count_id || '';

  const handleStart = async (item: MyCountItem) => {
    if (!item.schedule_entry_id) return;
    setBusyKey(itemKey(item));
    try {
      const res = await apiWrite(`/api/inventory/count-schedule/${item.schedule_entry_id}/create-count`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        alert(extractApiError(data, 'Failed to create count'));
        return;
      }
      router.push('/inventory/cycle-counts');
    } finally {
      setBusyKey(null);
    }
  };

  const handleDelegate = async (item: MyCountItem, toUserId: string) => {
    setBusyKey(itemKey(item));
    try {
      let res: Response;
      if (item.cycle_count_id) {
        res = await apiWrite(`/api/inventory/cycle-counts/${item.cycle_count_id}/assign`, {
          method: 'POST',
          body: { assigned_to_user_id: toUserId },
        });
      } else if (item.schedule_entry_id) {
        res = await apiWrite(`/api/inventory/count-schedule/${item.schedule_entry_id}`, {
          method: 'PATCH',
          body: { assigned_to_user_id: toUserId },
        });
      } else {
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        alert(extractApiError(data, 'Failed to delegate count'));
        return;
      }
      setDelegatingKey(null);
      fetchItems();
    } finally {
      setBusyKey(null);
    }
  };

  // Counts under review can't be reassigned; everything else here can be
  const canDelegate = (item: MyCountItem) => item.count_status !== 'under_review';
  const delegateOptions = qualifiedUsers.filter(u => u.user_id !== myUserId);
  const overdueCount = items.filter(i => i.overdue).length;

  return (
    <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-900">My Assigned Counts</h2>
          <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">{items.length}</span>
          {overdueCount > 0 && (
            <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 rounded-full">{overdueCount} overdue</span>
          )}
        </div>
        <a href="/inventory/count-schedule" className="text-sm text-blue-600 hover:text-blue-800 font-medium">
          View schedule →
        </a>
      </div>

      <div className="divide-y divide-gray-100">
        {items.map(item => {
          const key = itemKey(item);
          const busy = busyKey === key;
          const started = !!item.cycle_count_id;
          return (
            <div key={key} className="py-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="text-sm font-medium text-gray-900">
                  {item.template_name}
                  {item.is_blind && (
                    <span className="ml-2 text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">Blind</span>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  {[item.location_name, item.count_type ? COUNT_TYPE_LABELS[item.count_type] || item.count_type : null]
                    .filter(Boolean).join(' · ')}
                </div>
              </div>

              <div className={`text-sm whitespace-nowrap ${item.overdue ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                {formatDate(item.scheduled_date)}
                {item.overdue && ' (overdue)'}
              </div>

              <div className="whitespace-nowrap">
                {item.count_status ? (
                  <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-800 rounded-full">
                    {item.count_status.replace(/_/g, ' ')}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">planned</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {started ? (
                  <a
                    href="/inventory/cycle-counts"
                    className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Open Count
                  </a>
                ) : (
                  <button
                    onClick={() => handleStart(item)}
                    disabled={busy}
                    className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {busy ? 'Working…' : 'Start Count'}
                  </button>
                )}

                {canDelegate(item) && delegateOptions.length > 0 && (
                  delegatingKey === key ? (
                    <select
                      autoFocus
                      defaultValue=""
                      disabled={busy}
                      onChange={e => { if (e.target.value) handleDelegate(item, e.target.value); }}
                      onBlur={() => setDelegatingKey(null)}
                      className="px-2 py-1.5 text-xs border rounded-md bg-white"
                    >
                      <option value="" disabled>Delegate to…</option>
                      {delegateOptions.map(u => (
                        <option key={u.user_id} value={u.user_id}>{u.name || u.email}</option>
                      ))}
                    </select>
                  ) : (
                    <button
                      onClick={() => setDelegatingKey(key)}
                      disabled={busy}
                      className="px-3 py-1.5 text-xs font-medium border text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
                    >
                      Delegate
                    </button>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
