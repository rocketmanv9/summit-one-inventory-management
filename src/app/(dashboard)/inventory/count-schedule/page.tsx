'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { apiWrite, authenticatedFetch } from '@/lib/api-client';

interface Template {
  id: string;
  name: string;
  description: string | null;
  location_id: string;
  count_type: 'full' | 'partial' | 'spot_check';
  is_blind: boolean;
  catalog_item_ids: string[] | null;
  frequency_per_year: number;
  active: boolean;
  notes: string | null;
  location?: { id: string; name: string };
}

interface ScheduleEntry {
  id: string;
  template_id: string;
  scheduled_date: string;
  assigned_to_user_id: string | null;
  status: 'planned' | 'generated' | 'completed' | 'skipped';
  cycle_count_id: string | null;
  ai_rationale: string | null;
  template?: { id: string; name: string; count_type: string; is_blind: boolean; location?: { id: string; name: string } };
  cycle_count?: { id: string; count_number: string; status: string } | null;
  assignee?: { name: string; email: string } | null;
}

interface QualifiedUser {
  user_id: string;
  name: string | null;
  email: string | null;
  role: string;
  qualified: boolean;
}

interface PlanPreviewEntry {
  template_id: string;
  template_name: string;
  scheduled_date: string;
  assigned_to_user_id: string | null;
  rationale: string;
}

const COUNT_TYPE_LABELS: Record<string, string> = {
  full: 'Full Inventory',
  partial: 'Partial Count',
  spot_check: 'Spot Check',
};

const ENTRY_STATUS_STYLES: Record<string, string> = {
  planned: 'bg-blue-100 text-blue-800 border-blue-200',
  generated: 'bg-purple-100 text-purple-800 border-purple-200',
  completed: 'bg-green-100 text-green-800 border-green-200',
  skipped: 'bg-gray-100 text-gray-500 border-gray-200 line-through',
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const toDateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function extractApiError(data: any, fallback: string): string {
  return typeof data?.error === 'string' ? data.error : data?.error?.message || fallback;
}

export default function CountSchedulePage() {
  const [tab, setTab] = useState<'calendar' | 'templates'>('calendar');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [qualifiedUsers, setQualifiedUsers] = useState<QualifiedUser[]>([]);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/inventory/count-templates');
      const { data } = await res.json();
      setTemplates(data || []);
    } catch (err) {
      console.error('Error fetching templates:', err);
    }
  }, []);

  const fetchQualified = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/inventory/count-qualified');
      const { data } = await res.json();
      setQualifiedUsers((data || []).filter((u: QualifiedUser) => u.qualified));
    } catch (err) {
      console.error('Error fetching qualified users:', err);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
    fetchQualified();
  }, [fetchTemplates, fetchQualified]);

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Count Schedule"
          description="Plan recurring cycle counts from audit templates, lay them out on the calendar, and assign qualified counters"
        />

        {/* Tabs */}
        <div className="flex gap-1 border-b">
          {([['calendar', 'Calendar'], ['templates', 'Templates']] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setTab(val)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === val
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'calendar' ? (
          <CalendarTab templates={templates} qualifiedUsers={qualifiedUsers} />
        ) : (
          <TemplatesTab templates={templates} onChanged={fetchTemplates} />
        )}
      </div>
    </AppShell>
  );
}

// ─── Calendar ────────────────────────────────────────────────────────────

function CalendarTab({ templates, qualifiedUsers }: {
  templates: Template[];
  qualifiedUsers: QualifiedUser[];
}) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<ScheduleEntry | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [autoPlan, setAutoPlan] = useState<PlanPreviewEntry[] | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch the visible grid range (incl. leading/trailing days)
      const from = toDateStr(new Date(year, month, -6));
      const to = toDateStr(new Date(year, month + 1, 13));
      const res = await authenticatedFetch(`/api/inventory/count-schedule?from=${from}&to=${to}`);
      const { data } = await res.json();
      setEntries(data || []);
    } catch (err) {
      console.error('Error fetching schedule:', err);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const entriesByDate = useMemo(() => {
    const map: Record<string, ScheduleEntry[]> = {};
    for (const e of entries) {
      (map[e.scheduled_date] ||= []).push(e);
    }
    return map;
  }, [entries]);

  // Build a 6-week grid starting on Sunday
  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const start = new Date(first);
    start.setDate(start.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [year, month]);

  const navigateMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const runAutoSchedule = async (dryRun: boolean) => {
    setAutoRunning(true);
    try {
      const res = await apiWrite('/api/inventory/count-schedule/auto', {
        method: 'POST',
        body: { dry_run: dryRun, horizon_days: 365 },
      });
      const data = await res.json();
      if (!res.ok) {
        alert(extractApiError(data, 'Auto-schedule failed'));
        return;
      }
      if (dryRun) {
        setAutoPlan(data.data?.entries || []);
      } else {
        setAutoPlan(null);
        fetchEntries();
        alert(`${data.data?.created ?? 0} count(s) added to the schedule.`);
      }
    } catch (err: any) {
      alert(err.message || 'Auto-schedule failed');
    } finally {
      setAutoRunning(false);
    }
  };

  const todayStr = toDateStr(today);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => navigateMonth(-1)} className="px-3 py-1.5 border rounded-md hover:bg-gray-50">←</button>
          <button
            onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}
            className="px-3 py-1.5 border rounded-md hover:bg-gray-50 text-sm"
          >
            Today
          </button>
          <button onClick={() => navigateMonth(1)} className="px-3 py-1.5 border rounded-md hover:bg-gray-50">→</button>
          <h2 className="text-lg font-semibold ml-2">{MONTH_NAMES[month]} {year}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50 text-sm font-medium"
          >
            + Add to Schedule
          </button>
          <button
            onClick={() => runAutoSchedule(true)}
            disabled={autoRunning || templates.filter(t => t.active).length === 0}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm font-medium"
            title={templates.filter(t => t.active).length === 0 ? 'Create an active template first' : undefined}
          >
            {autoRunning ? 'Working…' : '✨ AI Auto-Schedule'}
          </button>
        </div>
      </div>

      {qualifiedUsers.length === 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          No qualified counters yet — counts will be scheduled unassigned. An admin can mark people as
          qualified under <span className="font-medium">Settings → Count Qualifications</span>.
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {([['planned', 'Planned'], ['generated', 'Count Created'], ['completed', 'Completed'], ['skipped', 'Skipped']] as const).map(([key, label]) => (
          <span key={key} className={`px-2 py-0.5 rounded border ${ENTRY_STATUS_STYLES[key]}`}>{label}</span>
        ))}
      </div>

      {/* Grid */}
      <div className="border rounded-lg overflow-hidden bg-white">
        <div className="grid grid-cols-7 border-b bg-gray-50">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="px-2 py-2 text-xs font-semibold text-gray-500 text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const dateStr = toDateStr(d);
            const inMonth = d.getMonth() === month;
            const dayEntries = entriesByDate[dateStr] || [];
            return (
              <div
                key={i}
                className={`min-h-[96px] border-b border-r p-1 ${inMonth ? 'bg-white' : 'bg-gray-50'} ${
                  dateStr === todayStr ? 'ring-2 ring-inset ring-blue-400' : ''
                }`}
              >
                <div className={`text-xs mb-1 ${inMonth ? 'text-gray-700' : 'text-gray-400'}`}>{d.getDate()}</div>
                <div className="space-y-0.5">
                  {dayEntries.map(e => (
                    <button
                      key={e.id}
                      onClick={() => setSelectedEntry(e)}
                      className={`w-full text-left px-1.5 py-0.5 rounded border text-[11px] leading-tight truncate hover:opacity-80 ${
                        ENTRY_STATUS_STYLES[e.status] || ENTRY_STATUS_STYLES.planned
                      }`}
                      title={`${e.template?.name || 'Count'}${e.assignee?.name ? ` — ${e.assignee.name}` : ''}`}
                    >
                      <span className="font-medium">{e.template?.name || 'Count'}</span>
                      {e.assignee?.name && <span className="opacity-75"> · {e.assignee.name.split(' ')[0]}</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading schedule…</div>}

      {selectedEntry && (
        <EntryDetailModal
          entry={selectedEntry}
          qualifiedUsers={qualifiedUsers}
          onClose={() => setSelectedEntry(null)}
          onChanged={() => { setSelectedEntry(null); fetchEntries(); }}
        />
      )}

      {showAddModal && (
        <AddEntryModal
          templates={templates.filter(t => t.active)}
          qualifiedUsers={qualifiedUsers}
          onClose={() => setShowAddModal(false)}
          onCreated={() => { setShowAddModal(false); fetchEntries(); }}
        />
      )}

      {autoPlan && (
        <AutoPlanPreviewModal
          plan={autoPlan}
          qualifiedUsers={qualifiedUsers}
          running={autoRunning}
          onConfirm={() => runAutoSchedule(false)}
          onClose={() => setAutoPlan(null)}
        />
      )}
    </div>
  );
}

function EntryDetailModal({ entry, qualifiedUsers, onClose, onChanged }: {
  entry: ScheduleEntry;
  qualifiedUsers: QualifiedUser[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [date, setDate] = useState(entry.scheduled_date);
  const [assignee, setAssignee] = useState(entry.assigned_to_user_id || '');
  const [busy, setBusy] = useState(false);
  const editable = entry.status === 'planned';

  const patchEntry = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await apiWrite(`/api/inventory/count-schedule/${entry.id}`, { method: 'PATCH', body });
      const data = await res.json();
      if (!res.ok) {
        alert(extractApiError(data, 'Update failed'));
        return false;
      }
      return true;
    } catch (err: any) {
      alert(err.message || 'Update failed');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    const ok = await patchEntry({
      scheduled_date: date,
      assigned_to_user_id: assignee || null,
    });
    if (ok) onChanged();
  };

  const handleSkip = async () => {
    if (!confirm('Skip this scheduled count?')) return;
    const ok = await patchEntry({ status: 'skipped' });
    if (ok) onChanged();
  };

  const handleDelete = async () => {
    if (!confirm('Remove this entry from the schedule?')) return;
    setBusy(true);
    try {
      const res = await apiWrite(`/api/inventory/count-schedule/${entry.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        alert(extractApiError(data, 'Delete failed'));
        return;
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const handleCreateCount = async () => {
    if (!confirm('Create the cycle count now? The assigned counter can then start counting.')) return;
    setBusy(true);
    try {
      const res = await apiWrite(`/api/inventory/count-schedule/${entry.id}/create-count`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        alert(extractApiError(data, 'Failed to create count'));
        return;
      }
      router.push('/inventory/cycle-counts');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">{entry.template?.name || 'Scheduled Count'}</h3>
            <p className="text-sm text-muted-foreground">
              {entry.template?.location?.name} · {COUNT_TYPE_LABELS[entry.template?.count_type || ''] || entry.template?.count_type}
              {entry.template?.is_blind ? ' · Blind' : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="p-6 space-y-4">
          {entry.ai_rationale && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
              ✨ {entry.ai_rationale}
            </div>
          )}

          {entry.cycle_count && (
            <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-700">
              Count <span className="font-mono font-medium">{entry.cycle_count.count_number}</span> created
              ({entry.cycle_count.status.replace(/_/g, ' ')})
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              disabled={!editable}
              className="w-full px-3 py-2 border rounded-md disabled:bg-gray-50 disabled:text-gray-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Assigned To</label>
            <select
              value={assignee}
              onChange={e => setAssignee(e.target.value)}
              disabled={!editable}
              className="w-full px-3 py-2 border rounded-md bg-white disabled:bg-gray-50 disabled:text-gray-500"
            >
              <option value="">Unassigned</option>
              {qualifiedUsers.map(u => (
                <option key={u.user_id} value={u.user_id}>{u.name || u.email}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">Only people marked as qualified counters appear here.</p>
          </div>
        </div>

        <div className="px-6 py-4 border-t space-y-2">
          {editable && (
            <button
              onClick={handleCreateCount}
              disabled={busy}
              className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              Create Cycle Count Now
            </button>
          )}
          <div className="flex gap-2">
            {editable && (
              <>
                <button onClick={handleSave} disabled={busy} className="flex-1 px-4 py-2 border rounded-md hover:bg-gray-50 disabled:opacity-50 font-medium">
                  Save Changes
                </button>
                <button onClick={handleSkip} disabled={busy} className="px-4 py-2 border text-gray-500 rounded-md hover:bg-gray-50 disabled:opacity-50">
                  Skip
                </button>
                <button onClick={handleDelete} disabled={busy} className="px-4 py-2 border border-red-200 text-red-600 rounded-md hover:bg-red-50 disabled:opacity-50">
                  Delete
                </button>
              </>
            )}
            {!editable && (
              <button onClick={onClose} className="flex-1 px-4 py-2 border rounded-md hover:bg-gray-50 font-medium">
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AddEntryModal({ templates, qualifiedUsers, onClose, onCreated }: {
  templates: Template[];
  qualifiedUsers: QualifiedUser[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [templateId, setTemplateId] = useState('');
  const [date, setDate] = useState(toDateStr(new Date()));
  const [assignee, setAssignee] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await apiWrite('/api/inventory/count-schedule', {
        method: 'POST',
        body: {
          template_id: templateId,
          scheduled_date: date,
          assigned_to_user_id: assignee || null,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(extractApiError(data, 'Failed to add entry'));
        return;
      }
      onCreated();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Add to Schedule</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

          <div>
            <label className="block text-sm font-medium mb-1">Template <span className="text-red-500">*</span></label>
            <select
              value={templateId}
              onChange={e => setTemplateId(e.target.value)}
              required
              className="w-full px-3 py-2 border rounded-md bg-white"
            >
              <option value="">Select a template…</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.location?.name})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Date <span className="text-red-500">*</span></label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} required className="w-full px-3 py-2 border rounded-md" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Assign To</label>
            <select value={assignee} onChange={e => setAssignee(e.target.value)} className="w-full px-3 py-2 border rounded-md bg-white">
              <option value="">Unassigned</option>
              {qualifiedUsers.map(u => (
                <option key={u.user_id} value={u.user_id}>{u.name || u.email}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-md hover:bg-gray-50 font-medium">Cancel</button>
            <button type="submit" disabled={saving || !templateId} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium">
              {saving ? 'Adding…' : 'Add Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AutoPlanPreviewModal({ plan, qualifiedUsers, running, onConfirm, onClose }: {
  plan: PlanPreviewEntry[];
  qualifiedUsers: QualifiedUser[];
  running: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const nameById = useMemo(
    () => Object.fromEntries(qualifiedUsers.map(u => [u.user_id, u.name || u.email || 'Unknown'])),
    [qualifiedUsers]
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b">
          <h3 className="text-lg font-semibold">✨ Proposed Schedule</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {plan.length === 0
              ? 'Nothing to add — the schedule is already filled for the next year.'
              : `${plan.length} count(s) over the next 12 months. Review and confirm to add them to the calendar.`}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {plan.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Template</th>
                  <th className="pb-2 pr-4">Assigned To</th>
                  <th className="pb-2">Why</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((e, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-4 whitespace-nowrap font-mono text-xs">{e.scheduled_date}</td>
                    <td className="py-2 pr-4">{e.template_name}</td>
                    <td className="py-2 pr-4">
                      {e.assigned_to_user_id ? nameById[e.assigned_to_user_id] || '—' : <span className="text-gray-400">Unassigned</span>}
                    </td>
                    <td className="py-2 text-xs text-gray-500">{e.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-4 border-t flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 border rounded-md hover:bg-gray-50 font-medium">Cancel</button>
          {plan.length > 0 && (
            <button
              onClick={onConfirm}
              disabled={running}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {running ? 'Adding…' : `Add ${plan.length} to Calendar`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Templates ───────────────────────────────────────────────────────────

function TemplatesTab({ templates, onChanged }: {
  templates: Template[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Template | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const handleDelete = async (t: Template) => {
    if (!confirm(`Delete template "${t.name}"? Planned schedule entries for it will be removed too.`)) return;
    const res = await apiWrite(`/api/inventory/count-templates/${t.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      alert(extractApiError(data, 'Delete failed'));
      return;
    }
    onChanged();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium"
        >
          + New Template
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-white">
          <p className="text-muted-foreground">No audit templates yet.</p>
          <p className="text-sm text-muted-foreground mt-1">
            Create one to define how often a location (or specific items) should be cycle counted.
          </p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Frequency</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {templates.map(t => (
                <tr key={t.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">
                    {t.name}
                    {t.is_blind && <span className="ml-2 text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">Blind</span>}
                  </td>
                  <td className="px-4 py-3">{t.location?.name || '—'}</td>
                  <td className="px-4 py-3">{COUNT_TYPE_LABELS[t.count_type] || t.count_type}</td>
                  <td className="px-4 py-3">{t.frequency_per_year}× / year</td>
                  <td className="px-4 py-3">
                    {t.catalog_item_ids?.length
                      ? `${t.catalog_item_ids.length} specific item${t.catalog_item_ids.length === 1 ? '' : 's'}`
                      : 'All items'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${t.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {t.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(t)} className="text-blue-600 hover:underline text-xs mr-3">Edit</button>
                    <button onClick={() => handleDelete(t)} className="text-red-600 hover:underline text-xs">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(showCreate || editing) && (
        <TemplateModal
          template={editing}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={() => { setShowCreate(false); setEditing(null); onChanged(); }}
        />
      )}
    </div>
  );
}

function TemplateModal({ template, onClose, onSaved }: {
  template: Template | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: template?.name || '',
    description: template?.description || '',
    location_id: template?.location_id || '',
    count_type: template?.count_type || 'partial',
    is_blind: template?.is_blind || false,
    frequency_per_year: template?.frequency_per_year || 4,
    active: template?.active ?? true,
    notes: template?.notes || '',
    specific_items: template?.catalog_item_ids || ([] as string[]),
  });
  const [scopeAll, setScopeAll] = useState(!template?.catalog_item_ids?.length);
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [items, setItems] = useState<Array<{ id: string; name: string; sku?: string }>>([]);
  const [itemSearch, setItemSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    authenticatedFetch('/api/inventory/locations')
      .then(res => res.json())
      .then(({ data }) => setLocations(data || []))
      .catch(err => console.error('Error fetching locations:', err));
    authenticatedFetch('/api/inventory/items')
      .then(res => res.json())
      .then(({ data }) => setItems(data || []))
      .catch(err => console.error('Error fetching items:', err));
  }, []);

  const filteredItems = useMemo(() => {
    const q = itemSearch.toLowerCase();
    return items.filter(i =>
      !q || i.name?.toLowerCase().includes(q) || i.sku?.toLowerCase().includes(q)
    ).slice(0, 50);
  }, [items, itemSearch]);

  const toggleItem = (id: string) => {
    setForm(f => ({
      ...f,
      specific_items: f.specific_items.includes(id)
        ? f.specific_items.filter(x => x !== id)
        : [...f.specific_items, id],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = {
        name: form.name,
        description: form.description || undefined,
        location_id: form.location_id,
        count_type: form.count_type,
        is_blind: form.is_blind,
        frequency_per_year: form.frequency_per_year,
        active: form.active,
        notes: form.notes || undefined,
        catalog_item_ids: scopeAll || form.specific_items.length === 0 ? null : form.specific_items,
      };
      const res = template
        ? await apiWrite(`/api/inventory/count-templates/${template.id}`, { method: 'PATCH', body })
        : await apiWrite('/api/inventory/count-templates', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) {
        setError(extractApiError(data, 'Failed to save template'));
        return;
      }
      onSaved();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-6 py-4 border-b flex items-center justify-between z-10">
          <h3 className="text-lg font-semibold">{template ? 'Edit Template' : 'New Audit Template'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Name <span className="text-red-500">*</span></label>
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                required
                placeholder="e.g. Main Yard Quarterly Audit"
                className="w-full px-3 py-2 border rounded-md"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Location <span className="text-red-500">*</span></label>
              <select
                value={form.location_id}
                onChange={e => setForm({ ...form, location_id: e.target.value })}
                required
                className="w-full px-3 py-2 border rounded-md bg-white"
              >
                <option value="">Select location…</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Times Per Year <span className="text-red-500">*</span></label>
              <input
                type="number"
                min={1}
                max={365}
                value={form.frequency_per_year}
                onChange={e => setForm({ ...form, frequency_per_year: Math.max(1, Math.min(365, parseInt(e.target.value) || 1)) })}
                className="w-full px-3 py-2 border rounded-md"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Every ~{Math.max(1, Math.floor(365 / form.frequency_per_year))} days
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Count Type</label>
            <div className="grid grid-cols-3 gap-2">
              {([['full', 'Full Count', 'All items'], ['partial', 'Partial', 'Selected items'], ['spot_check', 'Spot Check', 'Quick check']] as const).map(([val, label, desc]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setForm({ ...form, count_type: val })}
                  className={`p-3 border-2 rounded-lg text-center transition-all ${
                    form.count_type === val ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium text-sm">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <input
              type="checkbox"
              id="tmpl-blind"
              checked={form.is_blind}
              onChange={e => setForm({ ...form, is_blind: e.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="tmpl-blind" className="text-sm cursor-pointer">
              <span className="font-medium">Blind Count</span>
              <span className="block text-xs text-muted-foreground">Counters won't see expected quantities</span>
            </label>
          </div>

          {/* Item scope */}
          <div>
            <label className="block text-sm font-medium mb-2">What to Count</label>
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                onClick={() => setScopeAll(true)}
                className={`px-3 py-1.5 text-sm rounded-md border ${scopeAll ? 'bg-blue-50 border-blue-300 text-blue-700' : 'hover:bg-gray-50'}`}
              >
                Everything at the location
              </button>
              <button
                type="button"
                onClick={() => setScopeAll(false)}
                className={`px-3 py-1.5 text-sm rounded-md border ${!scopeAll ? 'bg-blue-50 border-blue-300 text-blue-700' : 'hover:bg-gray-50'}`}
              >
                Specific items ({form.specific_items.length})
              </button>
            </div>
            {!scopeAll && (
              <div className="border rounded-md">
                <input
                  value={itemSearch}
                  onChange={e => setItemSearch(e.target.value)}
                  placeholder="Search items…"
                  className="w-full px-3 py-2 border-b text-sm focus:outline-none"
                />
                <div className="max-h-48 overflow-y-auto divide-y">
                  {filteredItems.map(i => (
                    <label key={i.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={form.specific_items.includes(i.id)}
                        onChange={() => toggleItem(i.id)}
                        className="h-4 w-4"
                      />
                      <span className="flex-1 truncate">{i.name}</span>
                      {i.sku && <span className="text-xs text-gray-400 font-mono">{i.sku}</span>}
                    </label>
                  ))}
                  {filteredItems.length === 0 && (
                    <div className="px-3 py-4 text-sm text-muted-foreground text-center">No items match</div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="Special instructions carried into every count from this template…"
              className="w-full px-3 py-2 border rounded-md min-h-[60px]"
            />
          </div>

          {template && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.active}
                onChange={e => setForm({ ...form, active: e.target.checked })}
                className="h-4 w-4"
              />
              Active (included in auto-scheduling)
            </label>
          )}

          <div className="flex gap-3 pt-4 border-t">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border rounded-md hover:bg-gray-50 font-medium">Cancel</button>
            <button
              type="submit"
              disabled={saving || !form.name || !form.location_id}
              className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {saving ? 'Saving…' : template ? 'Save Changes' : 'Create Template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
