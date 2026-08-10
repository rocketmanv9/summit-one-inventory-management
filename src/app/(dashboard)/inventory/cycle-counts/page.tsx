'use client';

import { AppError } from '@rocketmanv9/chassis/errors';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MobileSessionQRDialog } from '@/components/cycle-counts/MobileSessionQRDialog';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { HowItWorksCard, HowThisWorksButton, useHowItWorks } from '@/components/ui/HowItWorksCard';
import { EyeOff, Camera, Scale, UserCheck, MapPin, Package, ClipboardList, CheckCircle2, ListChecks, Zap, Sparkles, ChevronLeft } from 'lucide-react';
import { apiWrite, authenticatedFetch } from '@/lib/api-client';
import { useUOMLabelMap } from '@/hooks/useGVTerms';
import { useActiveLocation } from '@/lib/active-location';
import { BarcodeLabelDialog, type BarcodeLabelItem } from '@/components/modals/BarcodeLabelDialog';

const COUNT_TYPE_LABELS: Record<string, string> = {
  full: 'Full Inventory',
  partial: 'Partial Count',
  spot_check: 'Spot Check',
  initial: 'Initial Count',
};

// Count-type cards for the create wizard: label + a one-line plain-English
// explanation + whether the type needs an explicit item pick (partial/spot).
const COUNT_TYPE_OPTIONS: Array<{
  value: 'full' | 'partial' | 'spot_check' | 'initial';
  label: string;
  explainer: string;
  Icon: typeof Package;
  needsItems: boolean;
}> = [
  { value: 'full', label: 'Full Inventory', explainer: 'Count everything at the yard — the complete picture.', Icon: Package, needsItems: false },
  { value: 'partial', label: 'Partial Count', explainer: 'Count only the items you choose.', Icon: ListChecks, needsItems: true },
  { value: 'spot_check', label: 'Spot Check', explainer: 'A quick verify of a few specific items.', Icon: Zap, needsItems: true },
  { value: 'initial', label: 'Initial Count', explainer: 'First-time baseline for a new location.', Icon: Sparkles, needsItems: false },
];

const STATUS_META: Record<string, { label: string; description: string }> = {
  draft: { label: 'Draft', description: 'Being set up — counting has not started yet' },
  scheduled: { label: 'Scheduled', description: 'Scheduled to start at a future date/time' },
  in_progress: { label: 'In Progress', description: 'Counting underway' },
  under_review: { label: 'Under Review', description: 'Awaiting approval — variance decisions needed before posting' },
  submitted_for_review: { label: 'Pending Review', description: 'Awaiting approval — variance decisions needed before posting' },
  approved: { label: 'Approved', description: 'Approved — adjustments posted to stock' },
  posted: { label: 'Posted', description: 'Finalized — stock updated' },
  closed: { label: 'Closed', description: 'Finalized and closed — no further changes' },
  cancelled: { label: 'Cancelled', description: 'Cancelled — no stock changes were made' },
};

const titleCase = (value: string) =>
  value.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

const countTypeLabel = (countType: string) =>
  COUNT_TYPE_LABELS[countType] || titleCase(countType);

const statusMeta = (status: string) =>
  STATUS_META[status] || { label: titleCase(status), description: '' };

interface CycleCount {
  id: string;
  count_number: string;
  tenant_id: string;
  location_id: string;
  count_type: string;
  is_blind: boolean;
  status: string;
  scheduled_for?: string;
  started_at?: string;
  snapshot_at?: string;
  snapshot_captured_at?: string;
  completed_at?: string;
  approved_at?: string;
  approved_by_user_id?: string;
  posted_at?: string;
  created_at: string;
  location?: { 
    id: string; 
    name: string; 
    location_types?: { name: string }; 
  };
}

interface CreateModalInitialValues {
  locationId?: string;
  countType?: string;
  itemIds?: string[];
}

function CycleCountsPageContent() {
  const help = useHowItWorks('inventory-cycle-counts-help');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { defaultLocationId, activeLocation } = useActiveLocation();
  const [cycleCounts, setCycleCounts] = useState<CycleCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createInitialValues, setCreateInitialValues] = useState<CreateModalInitialValues | null>(null);
  const [selectedCount, setSelectedCount] = useState<CycleCount | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Record<string, number>>({});
  // Debounced copy of the search box so we don't fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const PAGE_SIZE = 25;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search?.trim() || ''), 300);
    return () => clearTimeout(t);
  }, [filters.search]);

  // Any filter/search change resets to the first page.
  useEffect(() => { setPage(0); }, [filters.status, filters.when, debouncedSearch]);

  useEffect(() => {
    fetchCycleCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, filters.when, debouncedSearch, page]);

  // Deep-link support: ?create=1&location=<location_id>&item=<catalog_item_id>
  // auto-opens the create modal prefilled, then clears the params so refresh doesn't re-trigger.
  useEffect(() => {
    if (searchParams.get('create') !== '1') return;
    const locationId = searchParams.get('location') || undefined;
    const itemId = searchParams.get('item') || undefined;
    setCreateInitialValues({
      locationId,
      countType: 'spot_check',
      itemIds: itemId ? [itemId] : undefined,
    });
    setShowCreateModal(true);
    router.replace('/inventory/cycle-counts', { scroll: false });
  }, [searchParams, router]);

  /** Local-time window for the "When" filter — [start, end] inclusive. Weeks run Mon–Sun. */
  const dateWindow = (when: string): [Date, Date] | null => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOf = (d: Date) => new Date(d.getTime() - 1); // exclusive bound → 23:59:59.999
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    switch (when) {
      case 'today':
        return [today, endOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1))];
      case 'this_week':
        return [monday, endOf(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7))];
      case 'next_week': {
        const nextMon = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
        return [nextMon, endOf(new Date(nextMon.getFullYear(), nextMon.getMonth(), nextMon.getDate() + 7))];
      }
      case 'this_month':
        return [new Date(now.getFullYear(), now.getMonth(), 1), endOf(new Date(now.getFullYear(), now.getMonth() + 1, 1))];
      case 'next_month':
        return [new Date(now.getFullYear(), now.getMonth() + 1, 1), endOf(new Date(now.getFullYear(), now.getMonth() + 2, 1))];
      default:
        return null;
    }
  };

  const fetchCycleCounts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (filters.when === 'overdue') {
        params.set('overdue', '1');
      } else if (filters.when) {
        const window = dateWindow(filters.when);
        if (window) {
          params.set('due_from', window[0].toISOString());
          params.set('due_to', window[1].toISOString());
        }
      }
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(page * PAGE_SIZE));

      const res = await authenticatedFetch(`/api/inventory/cycle-counts?${params}`);
      const { data, total: totalCount, summary: statusSummary } = await res.json();
      setCycleCounts(data || []);
      setTotal(totalCount || 0);
      if (statusSummary) setSummary(statusSummary);
    } catch (error) {
      console.error('Error fetching cycle counts:', error);
    } finally {
      setLoading(false);
    }
  };

  // Reassign a not-yet-finished count to another qualified counter, right from
  // the list (previously only possible from the "My Assigned Counts" card).
  const [reassignTarget, setReassignTarget] = useState<CycleCount | null>(null);
  const [reassignTo, setReassignTo] = useState('');
  const [reassignBusy, setReassignBusy] = useState(false);
  const [qualifiedUsers, setQualifiedUsers] = useState<
    { user_id: string; name: string | null; email: string | null; qualified: boolean }[]
  >([]);

  const openReassign = async (row: CycleCount) => {
    setReassignTarget(row);
    setReassignTo('');
    if (qualifiedUsers.length === 0) {
      try {
        const res = await authenticatedFetch('/api/inventory/count-qualified');
        const { data } = await res.json();
        setQualifiedUsers((data || []).filter((u: any) => u.qualified));
      } catch (error) {
        console.error('Error loading qualified counters:', error);
      }
    }
  };

  const handleReassign = async () => {
    if (!reassignTarget || !reassignTo) return;
    setReassignBusy(true);
    try {
      const res = await apiWrite(`/api/inventory/cycle-counts/${reassignTarget.id}/assign`, {
        method: 'POST',
        body: { assigned_to_user_id: reassignTo },
      });
      if (!res.ok) {
        const data = await res.json();
        throw AppError.internal(typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to reassign count');
      }
      setReassignTarget(null);
      fetchCycleCounts();
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setReassignBusy(false);
    }
  };

  const handleCancelCount = async (cycleCount: CycleCount) => {
    const reason = prompt(
      `Cancel cycle count ${cycleCount.count_number}? This voids it — no stock changes are made.\n\nOptional reason:`,
      ''
    );
    // prompt returns null when the user hits Cancel on the dialog → abort.
    if (reason === null) return;
    try {
      const res = await apiWrite(`/api/inventory/cycle-counts/${cycleCount.id}/cancel`, {
        method: 'POST',
        body: { reason: reason || undefined },
      });
      if (!res.ok) {
        const data = await res.json();
        throw AppError.internal(typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to cancel count');
      }
      fetchCycleCounts();
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-700',
      scheduled: 'bg-cyan-100 text-cyan-700',
      in_progress: 'bg-blue-100 text-blue-700',
      under_review: 'bg-purple-100 text-purple-700',
      approved: 'bg-green-100 text-green-700',
      posted: 'bg-emerald-100 text-emerald-700',
      closed: 'bg-gray-100 text-gray-600',
      cancelled: 'bg-red-100 text-red-700',
    };
    return colors[status] || 'bg-gray-100 text-gray-600';
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  };

  const columns = [
    {
      key: 'cycle_count_number',
      header: 'Count #',
      render: (row: CycleCount) => (
        <div>
          <div className="font-mono text-sm font-medium">{row.count_number}</div>
          {row.is_blind && (
            <div className="text-xs text-amber-600 mt-0.5">🔒 Blind Count</div>
          )}
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      sortable: true,
      render: (row: CycleCount) => (
        <div>
          <div className="font-medium">{row.location?.name || '-'}</div>
          <div className="text-xs text-muted-foreground capitalize">
            {row.location?.location_types?.name || ''}
          </div>
        </div>
      ),
    },
    {
      key: 'count_type',
      header: 'Type',
      render: (row: CycleCount) => (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          {countTypeLabel(row.count_type)}
        </span>
      ),
    },
    {
      key: 'scheduled_for',
      header: 'Scheduled',
      render: (row: CycleCount) => (
        <div className="text-sm">
          {formatDate(row.scheduled_for || row.started_at || row.created_at)}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: CycleCount) => {
        const meta = statusMeta(row.status);
        return (
          <span
            title={meta.description || undefined}
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(row.status)}`}
          >
            {meta.label}
          </span>
        );
      },
    },
    {
      key: 'progress',
      header: 'Progress',
      render: (row: CycleCount) => {
        if (row.status === 'draft') return <span className="text-sm text-muted-foreground">Not started</span>;
        if (row.status === 'posted' || row.status === 'closed') {
          return <span className="text-sm text-green-600 font-medium">✓ Complete</span>;
        }
        if (row.status === 'approved') {
          return <span className="text-sm text-green-600 font-medium">Approved</span>;
        }
        if (row.status === 'under_review') {
          return <span className="text-sm text-purple-600 font-medium">Under Review</span>;
        }
        if (row.snapshot_captured_at) {
          return <span className="text-sm text-blue-600">Snapshot captured</span>;
        }
        return <span className="text-sm text-muted-foreground">In progress...</span>;
      },
    },
    {
      key: 'actions',
      header: '',
      render: (row: CycleCount) => (
        <div className="flex gap-2 justify-end">
          {row.status === 'draft' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleStartCount(row);
              }}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
            >
              Start Count
            </button>
          )}
          {row.status === 'in_progress' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedCount(row);
              }}
              className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-md hover:bg-green-700 font-medium"
            >
              View Details
            </button>
          )}
          {row.status === 'under_review' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedCount(row);
              }}
              className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-md hover:bg-purple-700 font-medium"
            >
              Review
            </button>
          )}
          {(row.status === 'approved' || row.status === 'posted') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedCount(row);
              }}
              className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 font-medium"
            >
              View
            </button>
          )}
          {['draft', 'scheduled', 'in_progress'].includes(row.status) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                openReassign(row);
              }}
              className="px-3 py-1.5 text-xs text-gray-700 border rounded-md hover:bg-gray-50 font-medium"
            >
              Reassign
            </button>
          )}
          {['draft', 'scheduled', 'in_progress', 'under_review'].includes(row.status) && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleCancelCount(row);
              }}
              className="px-3 py-1.5 text-xs text-red-600 rounded-md hover:bg-red-50 font-medium"
            >
              Cancel
            </button>
          )}
        </div>
      ),
    },
  ];

  const handleStartCount = async (cycleCount: CycleCount) => {
    if (!confirm(`Start cycle count ${cycleCount.count_number}?`)) return;

    try {
      const res = await apiWrite(`/api/inventory/cycle-counts/${cycleCount.id}/start`, {
        method: 'POST',
      });

      if (!res.ok) {
        const data = await res.json();
        throw AppError.internal(typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to start count');
      }

      fetchCycleCounts();
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    }
  };

  const filterConfig = [
    {
      key: 'search',
      label: 'Search',
      type: 'search' as const,
      placeholder: 'Count # (e.g. CC-0042)',
    },
    {
      // Scheduling window (scheduled_for; unscheduled counts fall back to
      // their created date). Overdue = scheduled in the past, still not counted.
      key: 'when',
      label: 'When',
      type: 'select' as const,
      options: [
        { value: 'overdue', label: '⚠ Overdue' },
        { value: 'today', label: 'Today' },
        { value: 'this_week', label: 'This Week' },
        { value: 'next_week', label: 'Next Week' },
        { value: 'this_month', label: 'This Month' },
        { value: 'next_month', label: 'Next Month' },
      ],
    },
    {
      key: 'status',
      label: 'Status',
      type: 'select' as const,
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'scheduled', label: 'Scheduled' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'under_review', label: 'Under Review' },
        { value: 'approved', label: 'Approved' },
        { value: 'posted', label: 'Posted' },
        { value: 'closed', label: 'Closed' },
        { value: 'cancelled', label: 'Cancelled' },
      ],
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Cycle Counts"
          description="Manage inventory cycle counts and variance reviews. Example: Physically count all asphalt mix at the plant yard, compare to system records, and approve adjustments for 5 tons that was used for equipment maintenance (variance)."
          actions={
            <>
              {!help.show && <HowThisWorksButton onClick={help.open} />}
              <button
                onClick={() => {
                  // Preselect the active location so a new count defaults to the
                  // yard you're viewing; the modal still lets you change it.
                  setCreateInitialValues(defaultLocationId ? { locationId: defaultLocationId } : null);
                  setShowCreateModal(true);
                }}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                + Start Cycle Count
              </button>
            </>
          }
        />

        {activeLocation && (
          <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
            <MapPin className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-gray-700">
              New counts default to <span className="font-semibold">{activeLocation.name}</span> — your active location. You can pick a different location in the dialog.
            </span>
          </div>
        )}

        {help.show && (
          <HowItWorksCard
            title="How cycle counts work"
            onDismiss={help.dismiss}
            steps={[
              { title: 'Create the count', body: 'Pick a location and a count type — full inventory, partial, or a quick spot check. Make it blind if counters should not see the expected quantities.' },
              { title: 'Count the stock', body: 'Start the count to snapshot expected quantities, then record what is physically there. Counts can be reassigned to any qualified counter while still open.' },
              { title: 'Review variances', body: 'Where the counted quantity differs from the snapshot, the count goes to Under Review — each variance gets an approve/adjust decision before anything posts.' },
              { title: 'Post adjustments', body: 'Approving posts stock adjustments so the system matches reality. Every change lands in the audit ledger; cancelled counts make no stock changes.' },
            ]}
            legend={[
              { badge: <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">Draft</span>, text: 'being set up' },
              { badge: <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-cyan-100 text-cyan-700">Scheduled</span>, text: 'starts at a future date' },
              { badge: <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">In Progress</span>, text: 'counting underway' },
              { badge: <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">Under Review</span>, text: 'variance decisions needed' },
              { badge: <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">Posted</span>, text: 'adjustments applied to stock' },
              { badge: <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Cancelled</span>, text: 'voided — no stock changes' },
            ]}
            glossary={[
              { Icon: Camera, term: 'Snapshot', blurb: 'expected quantities frozen at the moment the count starts, so counting compares against a fixed baseline' },
              { Icon: EyeOff, term: 'Blind count', blurb: 'counters cannot see expected quantities — they record what they find, which keeps counts honest' },
              { Icon: Scale, term: 'Variance', blurb: 'the difference between counted and expected quantity; each one is approved or rejected during review' },
              { Icon: UserCheck, term: 'Qualified counter', blurb: 'only people marked as qualified (Settings → Position Access) can be assigned or reassigned a count' },
            ]}
          />
        )}

        <div className="grid grid-cols-4 gap-4">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="text-2xl font-bold text-blue-700">
              {summary.draft || 0}
            </div>
            <div className="text-sm text-blue-600">Draft</div>
          </div>
          <div className="p-4 bg-cyan-50 border border-cyan-200 rounded-lg">
            <div className="text-2xl font-bold text-cyan-700">
              {summary.in_progress || 0}
            </div>
            <div className="text-sm text-cyan-600">In Progress</div>
          </div>
          <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
            <div className="text-2xl font-bold text-purple-700">
              {summary.under_review || 0}
            </div>
            <div className="text-sm text-purple-600">Under Review</div>
          </div>
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="text-2xl font-bold text-green-700">
              {(summary.posted || 0) + (summary.closed || 0)}
            </div>
            <div className="text-sm text-green-600">Completed</div>
          </div>
        </div>

        <FilterBar
          filters={filterConfig}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClear={() => setFilters({})}
        />

        <DataTable
          data={cycleCounts}
          columns={columns}
          loading={loading}
          emptyMessage="No cycle counts found"
          rowKey={(row) => row.id}
          onRowClick={setSelectedCount}
        />

        {total > 0 && (
          <div className="flex items-center justify-between text-sm">
            <div className="text-muted-foreground">
              {total === 0 ? '0' : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)}`} of {total}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || loading}
                className="px-3 py-1.5 border rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Prev
              </button>
              <span className="text-muted-foreground">
                Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * PAGE_SIZE >= total || loading}
                className="px-3 py-1.5 border rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {reassignTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setReassignTarget(null)}>
            <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold">Reassign {reassignTarget.count_number}</h3>
              <p className="mt-1 text-sm text-gray-500">
                The new assignee gets a task and a notification. Only qualified counters are listed.
              </p>
              <select
                autoFocus
                value={reassignTo}
                onChange={(e) => setReassignTo(e.target.value)}
                className="mt-4 w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="">Choose a counter…</option>
                {qualifiedUsers.map((u) => (
                  <option key={u.user_id} value={u.user_id}>{u.name || u.email}</option>
                ))}
              </select>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => setReassignTarget(null)}
                  disabled={reassignBusy}
                  className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReassign}
                  disabled={reassignBusy || !reassignTo}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {reassignBusy ? 'Reassigning…' : 'Reassign'}
                </button>
              </div>
            </div>
          </div>
        )}

        {selectedCount && (
          <CycleCountDetailPanel
            cycleCount={selectedCount}
            onClose={() => setSelectedCount(null)}
            onUpdate={fetchCycleCounts}
          />
        )}

        {showCreateModal && (
          <CreateCycleCountModal
            initialLocationId={createInitialValues?.locationId ?? defaultLocationId}
            initialCountType={createInitialValues?.countType}
            initialItemIds={createInitialValues?.itemIds}
            onClose={() => {
              setShowCreateModal(false);
              setCreateInitialValues(null);
            }}
            onCreated={() => {
              setShowCreateModal(false);
              setCreateInitialValues(null);
              fetchCycleCounts();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

export default function CycleCountsPage() {
  return (
    <Suspense fallback={null}>
      <CycleCountsPageContent />
    </Suspense>
  );
}

function CycleCountDetailPanel({ cycleCount, onClose, onUpdate }: {
  cycleCount: CycleCount;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const uomLabels = useUOMLabelMap();
  const [countLines, setCountLines] = useState<any[]>([]);
  const [loadingLines, setLoadingLines] = useState(true);
  const [showMobileDialog, setShowMobileDialog] = useState(false);
  const [labelItems, setLabelItems] = useState<BarcodeLabelItem[] | null>(null);
  const [labelLoading, setLabelLoading] = useState(false);

  // After approval, print labels for everything counted — assigns real tags
  // to any "mark present (no serial)" placeholders at print time.
  const handlePrintLabels = async () => {
    setLabelLoading(true);
    try {
      const res = await apiWrite(`/api/inventory/cycle-counts/${cycleCount.id}/labels`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw AppError.internal(typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to build labels');
      }
      const items: BarcodeLabelItem[] = data.data?.items || [];
      if (items.length === 0) {
        alert('Nothing to print — no counted items with a barcode/SKU or tagged units.');
        return;
      }
      setLabelItems(items);
    } catch (err: any) {
      alert(err.message || 'Failed to build labels');
    } finally {
      setLabelLoading(false);
    }
  };

  useEffect(() => {
    if (cycleCount.status === 'in_progress' || cycleCount.status === 'under_review') {
      fetchCountLines();
    } else {
      setCountLines([]);
      setLoadingLines(false);
    }
  }, [cycleCount.id, cycleCount.status]);

  const fetchCountLines = async () => {
    setLoadingLines(true);
    try {
      const res = await fetch(`/api/inventory/cycle-counts/${cycleCount.id}/lines`);
      const { data } = await res.json();
      
      console.log('Fetched lines:', data);
      
      // For each line, fetch assets if it's a serialized item
      const linesWithAssets = await Promise.all((data || []).map(async (line: any) => {
        console.log(`Line ${line.catalog_item?.name} tracking mode:`, line.catalog_item?.tracking_mode);
        if (line.catalog_item?.tracking_mode === 'serialized') {
          console.log(`Fetching assets for serialized item: ${line.catalog_item.name}`);
          const assetsRes = await fetch(`/api/inventory/cycle-counts/${cycleCount.id}/lines/${line.id}/assets`);
          const assetsData = await assetsRes.json();
          console.log('Assets data:', assetsData);
          return {
            ...line,
            expected_assets: assetsData.data?.expected_assets || [],
            counted_assets: assetsData.data?.counted_assets || []
          };
        }
        return line;
      }));
      
      console.log('Lines with assets:', linesWithAssets);
      setCountLines(linesWithAssets);
    } catch (error) {
      console.error('Error fetching count lines:', error);
    } finally {
      setLoadingLines(false);
    }
  };

  const updateAssetCount = async (lineId: string, assetIds: string[]) => {
    try {
      const res = await apiWrite(`/api/inventory/cycle-counts/${cycleCount.id}/lines/${lineId}/assets`, {
        method: 'POST',
        body: { asset_ids: assetIds }
      });
      
      if (!res.ok) {
        throw AppError.internal('Failed to update asset count');
      }
      
      fetchCountLines();
    } catch (error) {
      console.error('Error updating asset count:', error);
      alert('Failed to update asset count');
    }
  };

  // Type/add a serial for a serialized line without a scanner — creates the
  // asset if it's new and marks it present (additive).
  const addSerialToLine = async (lineId: string, serial: string, placeholder = false) => {
    const tag = serial.trim();
    if (!tag && !placeholder) return;
    try {
      const res = await apiWrite(`/api/inventory/cycle-counts/${cycleCount.id}/lines/${lineId}/assets`, {
        method: 'PUT',
        body: placeholder ? { placeholder: true } : { serial: tag },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw AppError.internal(typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to add serial');
      }
      fetchCountLines();
    } catch (error: any) {
      alert(error.message || 'Failed to add serial');
    }
  };

  const updateCountLine = async (lineId: string, actualQty: number | null) => {
    try {
      const res = await apiWrite(`/api/inventory/cycle-counts/${cycleCount.id}/lines/${lineId}`, {
        method: 'PATCH',
        body: { actual_qty: actualQty }
      });
      if (!res.ok) throw AppError.internal('Failed to update count');
      fetchCountLines();
    } catch (error) {
      alert('Error updating count');
    }
  };

  const handleVarianceDecision = async (lineId: string, decision: string, reason?: string) => {
    // Patch just this line in place — no refetch, so the panel doesn't reload
    // and your scroll position is preserved after each decision.
    setCountLines((prev) => prev.map((l) =>
      l.id === lineId ? { ...l, decision_status: decision, decision_reason: reason ?? l.decision_reason } : l
    ));
    try {
      const res = await apiWrite(`/api/inventory/cycle-counts/${cycleCount.id}/lines/${lineId}/decide`, {
        method: 'POST',
        body: { decision, reason }
      });
      if (!res.ok) {
        const data = await res.json();
        throw AppError.internal(typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to record decision');
      }
    } catch (error: any) {
      alert(error.message || 'Error recording variance decision');
      fetchCountLines(); // resync on failure
    }
  };

  // Initial counts: every counted line is a "variance" against expected 0 —
  // that's the whole point, so one click accepts them all as initial stock.
  const acceptAllInitialStock = async () => {
    const pending = countLines.filter((l) =>
      l.qty_counted !== null && (!l.decision_status || l.decision_status === 'pending')
    );
    if (pending.length === 0) return;
    setCountLines((prev) => prev.map((l) =>
      pending.some((p) => p.id === l.id)
        ? { ...l, decision_status: 'accepted', decision_reason: 'initial_stock' }
        : l
    ));
    try {
      await Promise.all(pending.map((l) =>
        apiWrite(`/api/inventory/cycle-counts/${cycleCount.id}/lines/${l.id}/decide`, {
          method: 'POST',
          body: { decision: 'accepted', reason: 'initial_stock' },
        })
      ));
    } catch (error: any) {
      alert(error.message || 'Error accepting lines');
      fetchCountLines();
    }
  };

  // Void the count without posting anything. Valid from draft/in-progress/
  // under-review — covers the "I opened a count but didn't actually count
  // anything" case where Approve & Post would otherwise be the only option.
  const handleCancel = async () => {
    const reason = prompt(
      `Cancel cycle count ${cycleCount.count_number}? This voids it — no stock changes are made.\n\nOptional reason:`,
      ''
    );
    if (reason === null) return;
    try {
      const res = await apiWrite(`/api/inventory/cycle-counts/${cycleCount.id}/cancel`, {
        method: 'POST',
        body: { reason: reason || undefined },
      });
      if (!res.ok) {
        const data = await res.json();
        throw AppError.internal(typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to cancel count');
      }
      onUpdate();
      onClose();
    } catch (error: any) {
      alert(error.message || 'Error cancelling cycle count');
    }
  };

  const nothingCounted =
    countLines.length > 0 && countLines.every((l) => l.qty_counted === null);

  return (
    <div className="fixed inset-y-0 right-0 w-[48rem] bg-white shadow-xl border-l z-40 overflow-y-auto">
      <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-white z-10">
        <h3 className="font-semibold">Cycle Count Details</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl">✕</button>
      </div>

      <div className="p-6 space-y-6">
        {/* Header Info */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <span className="font-mono text-lg font-bold">{cycleCount.count_number}</span>
            <span
              title={statusMeta(cycleCount.status).description || undefined}
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                cycleCount.status === 'posted' ? 'bg-green-100 text-green-800' :
                cycleCount.status === 'under_review' ? 'bg-purple-100 text-purple-800' :
                cycleCount.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                'bg-gray-100 text-gray-800'
              }`}
            >
              {statusMeta(cycleCount.status).label}
            </span>
          </div>

          {cycleCount.is_blind && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg mb-4">
              <div className="flex items-start gap-2">
                <span className="text-amber-600">🔒</span>
                <div>
                  <div className="text-sm font-medium text-amber-900">Blind Count Active</div>
                  <div className="text-xs text-amber-700 mt-0.5">
                    Expected quantities are hidden from counter to reduce bias
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Location Info */}
        <div className="p-4 bg-gray-50 rounded-lg border">
          <div className="text-xs text-muted-foreground mb-1">Location</div>
          <div className="font-medium text-lg">{cycleCount.location?.name || 'Unknown'}</div>
          <div className="text-sm text-muted-foreground capitalize">
            {cycleCount.location?.location_types?.name || ''}
          </div>
        </div>

        {/* Count Type */}
        <div>
          <div className="text-xs text-muted-foreground mb-2">Count Type</div>
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
            {countTypeLabel(cycleCount.count_type)}
          </span>
        </div>

        {/* Item Counting Section */}
        {(cycleCount.status === 'in_progress' || cycleCount.status === 'under_review') && (
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium">Items to Count</div>
              <div className="text-xs text-muted-foreground">
                {countLines.filter(l => l.qty_counted !== null).length} / {countLines.length} counted
              </div>
            </div>

            {loadingLines ? (
              <div className="text-center py-8 text-muted-foreground">Loading items...</div>
            ) : countLines.length === 0 && cycleCount.count_type === 'initial' ? (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="text-sm text-blue-800">
                  No items added yet. Workers will add items from the field using the mobile app.
                </div>
              </div>
            ) : countLines.length === 0 ? (
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="text-sm text-yellow-800">
                  No items found at this location. This could mean:
                  <ul className="list-disc ml-4 mt-2 space-y-1">
                    <li>The location is empty</li>
                    <li>Stock balances haven't been initialized</li>
                    <li>Items need to be received first</li>
                  </ul>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Initial count under review: everything counted is a variance
                    vs expected 0 — that's expected, so accept them all at once. */}
                {cycleCount.status === 'under_review' && cycleCount.count_type === 'initial' && (() => {
                  const pending = countLines.filter((l) =>
                    l.qty_counted !== null && (!l.decision_status || l.decision_status === 'pending')
                  ).length;
                  if (pending === 0) return null;
                  return (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between gap-3">
                      <div className="text-sm text-green-800">
                        This is an initial count — every line is new stock. Accept all {pending} at once.
                      </div>
                      <button
                        onClick={acceptAllInitialStock}
                        className="shrink-0 px-3 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700"
                      >
                        Accept All as Initial Stock
                      </button>
                    </div>
                  );
                })()}
                <div className="space-y-2 max-h-96 overflow-y-auto">
                {countLines.map((line) => (
                  <div key={line.id} className="p-3 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="font-medium text-sm">{line.catalog_item?.name || 'Unknown Item'}</div>
                        <div className="text-xs text-muted-foreground">{line.catalog_item?.sku}</div>
                      </div>
                      {!cycleCount.is_blind && (
                        <div className="text-xs text-muted-foreground">
                          Expected: <span className="font-medium">{line.qty_expected}</span>
                        </div>
                      )}
                    </div>
                    
                    {cycleCount.status === 'in_progress' ? (
                      line.catalog_item?.tracking_mode === 'serialized' ? (
                        // Serialized: Show asset checkboxes
                        <div className="space-y-2">
                          <div className="text-xs font-medium text-gray-700">Select assets found:</div>
                          {line.expected_assets && line.expected_assets.length > 0 ? (
                            <div className="space-y-1">
                              {line.expected_assets.map((asset: any) => {
                                const isChecked = line.counted_assets?.some((ca: any) => ca.asset_id === asset.id) || false;
                                return (
                                  <label key={asset.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-2 rounded">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={(e) => {
                                        const currentAssetIds = line.counted_assets?.map((ca: any) => ca.asset_id) || [];
                                        const newAssetIds = e.target.checked
                                          ? [...currentAssetIds, asset.id]
                                          : currentAssetIds.filter((id: string) => id !== asset.id);
                                        updateAssetCount(line.id, newAssetIds);
                                      }}
                                      className="rounded"
                                    />
                                    <span className="flex-1">
                                      {asset.asset_tag || asset.serial_number || 'Unnamed Asset'}
                                      <span className="text-xs text-gray-500 ml-2">({asset.status})</span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="text-xs text-gray-500">No assets expected at this location — type a serial / tag below to add one.</div>
                          )}
                          {/* Manual entry — no scanner needed. Type a serial/tag and Enter or Add. */}
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const input = (e.currentTarget.elements.namedItem('serial') as HTMLInputElement);
                              if (input?.value.trim()) {
                                addSerialToLine(line.id, input.value);
                                input.value = '';
                              }
                            }}
                            className="flex gap-2 mt-2"
                          >
                            <input
                              name="serial"
                              type="text"
                              placeholder="Enter serial / asset tag"
                              autoComplete="off"
                              className="flex-1 px-2 py-1 border rounded text-sm"
                            />
                            <button type="submit" className="px-3 py-1 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700">
                              Add
                            </button>
                          </form>
                          {/* No serial yet? Just mark one present — creates an
                              untagged unit you can serial-tag and label later. */}
                          <button
                            type="button"
                            onClick={() => addSerialToLine(line.id, '', true)}
                            className="mt-2 w-full px-3 py-1.5 bg-green-50 border border-green-300 text-green-700 rounded text-sm font-medium hover:bg-green-100"
                          >
                            + Mark 1 present (no serial)
                          </button>
                          {line.qty_counted !== null && !cycleCount.is_blind && (
                            <div className="text-xs text-gray-600 mt-2">
                              Found: <span className="font-medium">{line.qty_counted}</span> / Expected: {line.qty_expected}
                            </div>
                          )}
                        </div>
                      ) : (
                        // Fungible: Show quantity input
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-muted-foreground">Actual Count:</label>
                          <input
                            type="number"
                            defaultValue={line.qty_counted ?? ''}
                            onBlur={(e) => {
                              const value = e.target.value === '' ? null : parseFloat(e.target.value);
                              if (value !== line.qty_counted) {
                                updateCountLine(line.id, value);
                              }
                            }}
                            className="flex-1 px-2 py-1 border rounded text-sm"
                            placeholder="Enter count"
                            step="0.01"
                          />
                          {line.qty_counted !== null && !cycleCount.is_blind && (
                            <span className={`text-xs font-medium ${
                              Math.abs((line.qty_counted || 0) - line.qty_expected) > 0.01
                                ? 'text-red-600'
                                : 'text-green-600'
                            }`}>
                              {((line.qty_counted || 0) - line.qty_expected) >= 0 ? '+' : ''}
                              {((line.qty_counted || 0) - line.qty_expected).toFixed(2)}
                            </span>
                          )}
                        </div>
                      )
                    ) : cycleCount.status === 'under_review' ? (
                      // Variance decision UI
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm">
                            Counted: <span className="font-medium">{line.qty_counted ?? 'Not counted'}</span>
                          </div>
                          {cycleCount.count_type === 'initial' && line.qty_expected === 0 ? (
                            <span className="text-xs font-medium text-blue-600">
                              Counted: {line.qty_counted}
                            </span>
                          ) : (
                            line.qty_counted !== null && Math.abs((line.qty_counted || 0) - line.qty_expected) > 0.01 && (
                              <span className="text-xs font-medium text-red-600">
                                Variance: {((line.qty_counted || 0) - line.qty_expected) >= 0 ? '+' : ''}
                                {((line.qty_counted || 0) - line.qty_expected).toFixed(2)} ({(((line.qty_counted || 0) - line.qty_expected) / line.qty_expected * 100).toFixed(1)}%)
                              </span>
                            )
                          )}
                        </div>

                        {/* For serialized items, show which assets are missing/extra */}
                        {line.catalog_item?.tracking_mode === 'serialized' && line.expected_assets && line.expected_assets.length > 0 && (
                          <div className="text-xs space-y-1">
                            {line.expected_assets.map((asset: any) => {
                              const wasCounted = line.counted_assets?.some((ca: any) => ca.asset_id === asset.id);
                              return (
                                <div key={asset.id} className={`flex items-center gap-2 ${!wasCounted ? 'text-red-600' : 'text-green-600'}`}>
                                  <span>{wasCounted ? '✓' : '✗'}</span>
                                  <span>{asset.asset_tag || asset.serial_number || 'Unnamed Asset'}</span>
                                  <span className="text-gray-500">({wasCounted ? 'Found' : 'Missing'})</span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Show variance decision UI if variance exists */}
                        {line.qty_counted !== null && Math.abs((line.qty_counted || 0) - line.qty_expected) > 0.01 && (
                          <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded">
                            {line.decision_status === 'pending' || !line.decision_status ? (
                              <div className="space-y-2">
                                <div className="text-xs font-medium text-yellow-900">Decision Required</div>
                                <select
                                  className="w-full text-xs px-2 py-1 border rounded"
                                  defaultValue=""
                                  onChange={(e) => {
                                    const reason = e.target.value;
                                    if (reason) {
                                      handleVarianceDecision(line.id, 'accepted', reason);
                                    }
                                  }}
                                >
                                  <option value="">Select reason to accept...</option>
                                  <option value="initial_stock">Initial stock count</option>
                                  <option value="usage_not_recorded">Usage not recorded</option>
                                  <option value="transfer_not_recorded">Transfer not recorded</option>
                                  <option value="loss_theft">Loss/Theft</option>
                                  <option value="damage_disposal">Damage/Disposal</option>
                                  <option value="counting_error">Counting error</option>
                                  <option value="receiving_error">Receiving error</option>
                                  <option value="bulk_drift">Bulk estimation drift</option>
                                  <option value="unknown">Unknown</option>
                                </select>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => handleVarianceDecision(line.id, 'investigating')}
                                    className="flex-1 px-2 py-1 text-xs bg-orange-100 text-orange-700 rounded hover:bg-orange-200"
                                  >
                                    Investigate
                                  </button>
                                  <button
                                    onClick={() => handleVarianceDecision(line.id, 'rejected')}
                                    className="flex-1 px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                                  >
                                    Reject Count
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between gap-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                  line.decision_status === 'accepted' ? 'bg-green-100 text-green-800' :
                                  line.decision_status === 'investigating' ? 'bg-orange-100 text-orange-800' :
                                  'bg-red-100 text-red-800'
                                }`}>
                                  {line.decision_status === 'accepted' ? `✓ Accepted: ${line.decision_reason?.replace(/_/g, ' ')}` :
                                   line.decision_status === 'investigating' ? '⚠ Investigating' :
                                   '✗ Rejected'}
                                </span>
                                <button
                                  onClick={() => handleVarianceDecision(line.id, 'pending')}
                                  className="text-xs text-blue-600 hover:text-blue-800 underline"
                                >
                                  Change
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* No variance - auto-accepted */}
                        {line.qty_counted !== null && Math.abs((line.qty_counted || 0) - line.qty_expected) <= 0.01 && (
                          <div className="text-xs text-green-600">✓ Match - no adjustment needed</div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="text-sm">
                          Counted: <span className="font-medium">{line.qty_counted ?? 'Not counted'}</span>
                        </div>
                        {line.qty_counted !== null && (
                          <span className={`text-xs font-medium ${
                            Math.abs((line.qty_counted || 0) - line.qty_expected) > 0.01
                              ? 'text-red-600'
                              : 'text-green-600'
                          }`}>
                            Variance: {((line.qty_counted || 0) - line.qty_expected) >= 0 ? '+' : ''}
                            {((line.qty_counted || 0) - line.qty_expected).toFixed(2)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Timeline */}
        <div className="border-t pt-4">
          <div className="text-sm font-medium mb-3">Timeline</div>
          <div className="space-y-3">
            {cycleCount.scheduled_for && (
              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                </div>
                <div>
                  <div className="text-sm font-medium">Scheduled</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(cycleCount.scheduled_for).toLocaleString()}
                  </div>
                </div>
              </div>
            )}
            {cycleCount.started_at && (
              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-cyan-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-cyan-600"></div>
                </div>
                <div>
                  <div className="text-sm font-medium">Started</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(cycleCount.started_at).toLocaleString()}
                  </div>
                </div>
              </div>
            )}
            {cycleCount.snapshot_at && (
              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-purple-600"></div>
                </div>
                <div>
                  <div className="text-sm font-medium">Snapshot Captured</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(cycleCount.snapshot_at).toLocaleString()}
                  </div>
                </div>
              </div>
            )}
            {cycleCount.completed_at && (
              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-yellow-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-yellow-600"></div>
                </div>
                <div>
                  <div className="text-sm font-medium">Completed</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(cycleCount.completed_at).toLocaleString()}
                  </div>
                </div>
              </div>
            )}
            {cycleCount.approved_at && (
              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-green-600"></div>
                </div>
                <div>
                  <div className="text-sm font-medium">Approved</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(cycleCount.approved_at).toLocaleString()}
                  </div>
                </div>
              </div>
            )}
            {cycleCount.posted_at && (
              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-600"></div>
                </div>
                <div>
                  <div className="text-sm font-medium">Posted to Inventory</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(cycleCount.posted_at).toLocaleString()}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Print labels — available once the count is approved/posted/closed.
            Assigns real tags to "mark present (no serial)" placeholders. */}
        {(cycleCount.status === 'approved' || cycleCount.status === 'posted' || cycleCount.status === 'closed') && (
          <div className="border-t pt-4 space-y-3">
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="text-sm font-medium text-green-900 mb-1">Count Posted — Print Labels</div>
              <div className="text-sm text-green-700">
                Print labels for everything counted. Items marked present without a serial get a real
                asset tag assigned now, so you can label and apply them.
              </div>
            </div>
            <button
              onClick={handlePrintLabels}
              disabled={labelLoading}
              className="w-full px-4 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 font-medium flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              {labelLoading ? 'Preparing labels…' : 'Print Labels for This Count'}
            </button>
            {labelItems && (
              <BarcodeLabelDialog
                items={labelItems}
                entityType="item"
                onClose={() => setLabelItems(null)}
              />
            )}
          </div>
        )}

        {/* Next Steps */}
        {cycleCount.status === 'draft' && (
          <div className="border-t pt-4 space-y-3">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="text-sm font-medium text-blue-900 mb-2">Ready to Start</div>
              <div className="text-sm text-blue-700">
                Click "Start Count" below to begin counting. This will snapshot the current inventory
                quantities and allow you to enter actual counts.
              </div>
            </div>
            <button
              onClick={async () => {
                if (!confirm(`Start cycle count ${cycleCount.count_number}?`)) return;
                try {
                  const res = await apiWrite(`/api/inventory/cycle-counts/${cycleCount.id}/start`, {
                    method: 'POST',
                  });
                  if (!res.ok) {
                    const data = await res.json();
                    throw AppError.internal(typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to start count');
                  }
                  onClose();
                  onUpdate();
                } catch (error: any) {
                  alert(error.message || 'Error starting cycle count');
                }
              }}
              className="w-full px-4 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
            >
              Start Count
            </button>
            <button
              onClick={handleCancel}
              className="w-full px-4 py-2.5 border border-red-200 text-red-600 rounded-md hover:bg-red-50 font-medium"
            >
              Cancel Count
            </button>
          </div>
        )}

        {cycleCount.status === 'in_progress' && (
          <div className="border-t pt-4 space-y-3">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="text-sm font-medium text-blue-900 mb-2">Next Steps</div>
              <div className="text-sm text-blue-700">
                Use a handheld RFID scanner or manually enter counts for items in this location.
                Once complete, submit the count for review.
              </div>
            </div>
            <button
              onClick={() => setShowMobileDialog(true)}
              className="w-full px-4 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Mobile Count (QR Code)
            </button>
            <MobileSessionQRDialog
              isOpen={showMobileDialog}
              onClose={() => setShowMobileDialog(false)}
              cycleCountId={cycleCount.id}
              cycleCountNumber={cycleCount.count_number}
            />
            <button
              onClick={async () => {
                if (!confirm('Submit this cycle count for review?')) return;
                try {
                  const res = await apiWrite(`/api/inventory/cycle-counts/${cycleCount.id}/submit`, {
                    method: 'POST',
                  });
                  if (!res.ok) {
                    const data = await res.json();
                    throw AppError.internal(typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to submit');
                  }
                  onUpdate();
                  onClose();
                } catch (error: any) {
                  alert(error.message || 'Error submitting cycle count');
                }
              }}
              className="w-full px-4 py-3 bg-purple-600 text-white rounded-md hover:bg-purple-700 font-medium"
            >
              Submit for Review
            </button>
            <button
              onClick={handleCancel}
              className="w-full px-4 py-2.5 border border-red-200 text-red-600 rounded-md hover:bg-red-50 font-medium"
            >
              Cancel Count
            </button>
          </div>
        )}

        {cycleCount.status === 'under_review' && (
          <div className="border-t pt-4 space-y-3">
            {nothingCounted && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="text-sm font-medium text-amber-900 mb-1">Nothing was counted</div>
                <div className="text-sm text-amber-700">
                  No items in this count have a recorded count. Approving will post no changes —
                  if this count was opened by mistake, cancel it instead.
                </div>
              </div>
            )}
            {/* Check if all variance has been decided */}
            {(() => {
              const varianceLines = countLines.filter(l => 
                l.qty_counted !== null && Math.abs((l.qty_counted || 0) - l.qty_expected) > 0.01
              );
              const undecidedLines = varianceLines.filter(l => 
                !l.decision_status || l.decision_status === 'pending'
              );
              
              if (undecidedLines.length > 0) {
                return (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="text-sm font-medium text-amber-900 mb-2">⚠ Variance Requires Decisions</div>
                    <div className="text-sm text-amber-700">
                      {undecidedLines.length} item(s) with variance need decisions before posting.
                      Please accept (with reason), investigate, or reject each variance above.
                    </div>
                  </div>
                );
              }

              // Loose-tracking items don't produce "discrepancies" — the count
              // IS the re-truing. They come back pre-accepted (decision_reason
              // 'estimate_retrued'); pull them out of the accepted list so they
              // read as "estimates re-trued" rather than variances to worry about.
              const isEstimateLine = (l: any) =>
                l.catalog_item?.loose_tracking || l.decision_reason === 'estimate_retrued';
              const estimateLines = varianceLines.filter(l => l.decision_status === 'accepted' && isEstimateLine(l));
              const acceptedLines = varianceLines.filter(l => l.decision_status === 'accepted' && !isEstimateLine(l));
              const investigatingLines = varianceLines.filter(l => l.decision_status === 'investigating');
              const rejectedLines = varianceLines.filter(l => l.decision_status === 'rejected');

              // Format reason for display
              const formatReason = (reason: string | null) => {
                if (!reason) return 'No reason';
                return reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
              };

              return (
                <>
                  {/* Combined Preview of Changes */}
                  {(acceptedLines.length > 0 || estimateLines.length > 0 || investigatingLines.length > 0 || rejectedLines.length > 0 || varianceLines.length === 0) && (
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-blue-900">📋 What Will Happen When You Approve:</div>
                        <div className="text-xs font-medium text-green-700 bg-green-100 px-2 py-1 rounded">✓ Ready to Post</div>
                      </div>
                      
                      <div className="text-xs text-blue-700 space-y-0.5 pb-2 border-b border-blue-200">
                        {acceptedLines.length > 0 && <div>• {acceptedLines.length} variance(s) will be adjusted</div>}
                        {estimateLines.length > 0 && <div>• {estimateLines.length} estimate(s) re-trued (loosely-tracked items)</div>}
                        {investigatingLines.length > 0 && <div>• {investigatingLines.length} variance(s) marked for investigation</div>}
                        {rejectedLines.length > 0 && <div>• {rejectedLines.length} count(s) rejected</div>}
                        {varianceLines.length === 0 && <div>• No variance detected - counts match expected</div>}
                      </div>
                      
                      {acceptedLines.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Stock Adjustments (Inventory Will Change):</div>
                          {acceptedLines.map((line) => {
                            const item = line.catalog_item;
                            const delta = (line.qty_counted || 0) - line.qty_expected;
                            const newQty = line.qty_expected + delta;
                            return (
                              <div key={line.id} className="pl-3 border-l-2 border-blue-300">
                                <div className="text-xs font-medium text-blue-900">{item?.name || 'Unknown Item'}</div>
                                <div className="text-xs text-blue-700 mt-0.5">
                                  <span className="font-medium">Reason:</span> {formatReason(line.decision_reason)}
                                </div>
                                {cycleCount.count_type === 'initial' && line.qty_expected === 0 ? (
                                  <div className="text-xs text-blue-700 flex items-center gap-2 mt-0.5">
                                    <span>Initial stock: {line.qty_counted} {uomLabels[(item as any)?.uom_term_id] || 'units'}</span>
                                  </div>
                                ) : (
                                  <div className="text-xs text-blue-700 flex items-center gap-2 mt-0.5">
                                    <span>Stock: {line.qty_expected} {uomLabels[(item as any)?.uom_term_id] || 'units'}</span>
                                    <span className={delta < 0 ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
                                      {delta >= 0 ? '+' : ''}{delta}
                                    </span>
                                    <span>→ {newQty} {uomLabels[(item as any)?.uom_term_id] || 'units'}</span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {estimateLines.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-violet-800 uppercase tracking-wide">Estimates Re-trued (Loosely-tracked — Not Discrepancies):</div>
                          {estimateLines.map((line) => {
                            const item = line.catalog_item;
                            const delta = (line.qty_counted || 0) - line.qty_expected;
                            const newQty = line.qty_expected + delta;
                            const unit = uomLabels[(item as any)?.uom_term_id] || 'units';
                            return (
                              <div key={line.id} className="pl-3 border-l-2 border-violet-300">
                                <div className="text-xs font-medium text-violet-900">{item?.name || 'Unknown Item'}</div>
                                <div className="text-xs text-violet-700 flex items-center gap-2 mt-0.5">
                                  <span>Estimate: ~{line.qty_expected} {unit}</span>
                                  <span className={delta < 0 ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
                                    {delta >= 0 ? '+' : ''}{delta}
                                  </span>
                                  <span>→ ~{newQty} {unit}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {investigatingLines.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-orange-800 uppercase tracking-wide">Flagged for Investigation (No Stock Change):</div>
                          {investigatingLines.map((line) => {
                            const item = line.catalog_item;
                            const delta = (line.qty_counted || 0) - line.qty_expected;
                            return (
                              <div key={line.id} className="pl-3 border-l-2 border-orange-300">
                                <div className="text-xs font-medium text-orange-900">{item?.name || 'Unknown Item'}</div>
                                <div className="text-xs text-orange-700">
                                  Variance: {delta >= 0 ? '+' : ''}{delta} {uomLabels[(item as any)?.uom_term_id] || 'units'} - Requires follow-up
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {rejectedLines.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-red-800 uppercase tracking-wide">Rejected Counts (No Stock Change):</div>
                          {rejectedLines.map((line) => {
                            const item = line.catalog_item;
                            return (
                              <div key={line.id} className="pl-3 border-l-2 border-red-300">
                                <div className="text-xs font-medium text-red-900">{item?.name || 'Unknown Item'}</div>
                                <div className="text-xs text-red-700">
                                  Count marked invalid - preserved for audit only
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}

            <button
              onClick={async () => {
                // Final validation
                const varianceLines = countLines.filter(l => 
                  l.qty_counted !== null && Math.abs((l.qty_counted || 0) - l.qty_expected) > 0.01
                );
                const undecidedLines = varianceLines.filter(l => 
                  !l.decision_status || l.decision_status === 'pending'
                );

                if (undecidedLines.length > 0) {
                  alert(`Cannot post: ${undecidedLines.length} variance line(s) require decisions.`);
                  return;
                }

                if (!confirm('Approve this cycle count and post adjustments to inventory? This will:\n\n• Create stock movements for accepted variances\n• Update inventory quantities\n• Flag items for investigation\n• Preserve rejected counts for audit\n\nThis action cannot be undone.')) {
                  return;
                }

                try {
                  const res = await apiWrite(`/api/inventory/cycle-counts/${cycleCount.id}/approve`, {
                    method: 'POST',
                  });
                  
                  if (!res.ok) {
                    const data = await res.json();
                    throw AppError.internal(typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to approve');
                  }

                  const result = await res.json();
                  
                  // Show success message with summary
                  if (result.data?.adjustments_created > 0) {
                    alert(`✓ Cycle count posted successfully!\n\n${result.data.adjustments_created} adjustment(s) created\n${result.data.reorder_suggestions?.length || 0} reorder suggestion(s) generated`);
                  } else {
                    alert('✓ Cycle count posted successfully! No adjustments needed.');
                  }

                  // Reopen the now-posted count to print its labels.
                  alert('Reopen this count to print labels for everything you just counted.');
                  onUpdate();
                  onClose();
                } catch (error: any) {
                  alert(`Error: ${error.message || 'Failed to approve cycle count'}`);
                }
              }}
              disabled={(() => {
                const varianceLines = countLines.filter(l => 
                  l.qty_counted !== null && Math.abs((l.qty_counted || 0) - l.qty_expected) > 0.01
                );
                const undecidedLines = varianceLines.filter(l => 
                  !l.decision_status || l.decision_status === 'pending'
                );
                return undecidedLines.length > 0;
              })()}
              className={`w-full px-4 py-3 rounded-md font-medium transition-colors ${
                (() => {
                  const varianceLines = countLines.filter(l => 
                    l.qty_counted !== null && Math.abs((l.qty_counted || 0) - l.qty_expected) > 0.01
                  );
                  const undecidedLines = varianceLines.filter(l => 
                    !l.decision_status || l.decision_status === 'pending'
                  );
                  return undecidedLines.length > 0
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-green-600 text-white hover:bg-green-700';
                })()
              }`}
            >
              Approve & Post to Inventory
            </button>
            <button
              onClick={handleCancel}
              className="w-full px-4 py-2.5 border border-red-200 text-red-600 rounded-md hover:bg-red-50 font-medium"
            >
              Cancel Count (no changes posted)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface WizardLocation {
  id: string;
  name: string;
  location_type?: { name: string };
}

interface LocationStat {
  item_lines: number;
  total_on_hand: number;
  last_counted_at: string | null;
}

interface WizardItem {
  id: string;
  name: string;
  sku?: string | null;
}

const relativeLastCounted = (iso: string | null): string => {
  if (!iso) return 'Never counted';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Never counted';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'Counted today';
  if (days === 1) return 'Counted yesterday';
  if (days < 30) return `Counted ${days} days ago`;
  if (days < 60) return 'Counted last month';
  if (days < 365) return `Counted ${Math.round(days / 30)} months ago`;
  return `Counted ${Math.round(days / 365)}y ago`;
};

// Stepped create wizard — three labeled steps so it's never a mystery what you're
// about to count:
//   1 Where     → visual yard cards (item lines, on-hand units, last counted)
//   2 What kind → count-type cards with a one-line plain-English explanation
//   3 Which     → item picker, only for partial / spot check
// Deep-links (?create=1&location=&item=) prefill and jump straight to step 2.
function CreateCycleCountModal({ onClose, onCreated, initialLocationId, initialCountType, initialItemIds }: {
  onClose: () => void;
  onCreated: () => void;
  initialLocationId?: string;
  initialCountType?: string;
  initialItemIds?: string[];
}) {
  const [form, setForm] = useState({
    location_id: initialLocationId || '',
    count_type: (initialCountType as 'full' | 'partial' | 'spot_check' | 'initial') || 'full',
    is_blind: false,
    scheduled_for: '',
    specific_items: initialItemIds || ([] as string[]),
    notes: '',
    assigned_to_user_id: '',
  });
  // Start on "What kind" when a deep-link already chose the yard for us.
  const [step, setStep] = useState<1 | 2 | 3>(initialLocationId ? 2 : 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [locations, setLocations] = useState<WizardLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [locationStats, setLocationStats] = useState<Record<string, LocationStat>>({});
  const [items, setItems] = useState<WizardItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  // Qualified counters the count can be assigned to (empty default = assign to me).
  const [counters, setCounters] = useState<Array<{ user_id: string; name: string | null; email: string | null }>>([]);

  const selectedLocation = locations.find((l) => l.id === form.location_id) || null;
  const countTypeMeta = COUNT_TYPE_OPTIONS.find((o) => o.value === form.count_type) || COUNT_TYPE_OPTIONS[0];
  const needsItems = countTypeMeta.needsItems;

  useEffect(() => {
    fetchLocations();
    fetchLocationStats();
    fetchCounters();
  }, []);

  // Lazily load the catalog the first time we reach the "Which items" step.
  useEffect(() => {
    if (step === 3 && needsItems && !itemsLoaded && !loadingItems) fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, needsItems]);

  const fetchLocations = async () => {
    try {
      const res = await authenticatedFetch('/api/inventory/locations');
      const { data } = await res.json();
      setLocations(data || []);
    } catch (error) {
      console.error('Error fetching locations:', error);
    } finally {
      setLoadingLocations(false);
    }
  };

  const fetchLocationStats = async () => {
    try {
      const res = await authenticatedFetch('/api/inventory/cycle-counts/location-stats');
      const { data } = await res.json();
      setLocationStats(data || {});
    } catch (error) {
      // Non-fatal — cards just render without the stat line.
      console.error('Error fetching location stats:', error);
    }
  };

  const fetchItems = async () => {
    setLoadingItems(true);
    try {
      const res = await authenticatedFetch('/api/inventory/items');
      const { data } = await res.json();
      setItems((data || []).map((i: any) => ({ id: i.id, name: i.name, sku: i.sku })));
      setItemsLoaded(true);
    } catch (error) {
      console.error('Error fetching items:', error);
    } finally {
      setLoadingItems(false);
    }
  };

  const fetchCounters = async () => {
    try {
      const res = await authenticatedFetch('/api/inventory/count-qualified');
      const { data } = await res.json();
      setCounters((data || []).filter((u: any) => u.qualified));
    } catch (error) {
      console.error('Error fetching qualified counters:', error);
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError('');

    try {
      const res = await apiWrite('/api/inventory/cycle-counts', {
        method: 'POST',
        body: {
          location_id: form.location_id,
          count_type: form.count_type,
          is_blind: form.is_blind,
          scheduled_for: form.scheduled_for || undefined,
          catalog_item_ids: form.specific_items.length > 0 ? form.specific_items : null,
          assigned_to_user_id: form.assigned_to_user_id || undefined,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        const msg = typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to start cycle count';
        throw AppError.internal(msg);
      }

      onCreated();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  // Set default scheduled time to now
  useEffect(() => {
    const now = new Date();
    const formatted = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setForm(prev => ({ ...prev, scheduled_for: formatted }));
  }, []);

  // The last step is either "What kind" (full/initial) or "Which items"
  // (partial/spot). The primary button submits from whichever is last.
  const lastStep: 2 | 3 = needsItems ? 3 : 2;
  const isLastStep = step === lastStep;

  const goNext = () => {
    if (step === 1 && form.location_id) setStep(2);
    else if (step === 2 && needsItems) setStep(3);
  };
  const goBack = () => {
    if (step === 3) setStep(2);
    else if (step === 2) setStep(1);
  };

  // Step title reflects the choice made so far ("Spot check at Portland Yard").
  const stepTitle = (() => {
    if (step === 1) return 'Where are you counting?';
    const where = selectedLocation ? ` at ${selectedLocation.name}` : '';
    if (step === 2) return `What kind of count${where}?`;
    return `${countTypeMeta.label}${where} — which items?`;
  })();

  const STEP_LABELS = needsItems
    ? [{ n: 1, label: 'Where' }, { n: 2, label: 'What kind' }, { n: 3, label: 'Which items' }]
    : [{ n: 1, label: 'Where' }, { n: 2, label: 'What kind' }];

  const filteredItems = items.filter((i) => {
    if (!itemSearch.trim()) return true;
    const q = itemSearch.trim().toLowerCase();
    return i.name.toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q);
  });

  const primaryDisabled =
    saving ||
    !form.location_id ||
    (isLastStep && needsItems && form.specific_items.length === 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header + labeled progress: 1 Where → 2 What kind → 3 Which items */}
        <div className="sticky top-0 bg-white px-6 py-4 border-b z-10">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Start a Cycle Count</h3>
              <p className="text-sm text-muted-foreground mt-0.5">{stepTitle}</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
          </div>
          <div className="flex items-center gap-2 mt-3">
            {STEP_LABELS.map((s, idx) => {
              const active = step === s.n;
              const done = step > s.n;
              return (
                <div key={s.n} className="flex items-center gap-2">
                  <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                    active ? 'bg-primary text-primary-foreground' : done ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-500'
                  }`}>
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                      active ? 'bg-white/25' : done ? 'bg-primary/20' : 'bg-gray-300 text-white'
                    }`}>
                      {done ? '✓' : s.n}
                    </span>
                    {s.label}
                  </div>
                  {idx < STEP_LABELS.length - 1 && <span className="text-gray-300">→</span>}
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-start gap-2">
              <span className="text-lg">⚠️</span>
              <div>
                <div className="font-medium">Error</div>
                <div>{error}</div>
              </div>
            </div>
          )}

          {/* ---- STEP 1: WHERE — visual yard cards ---- */}
          {step === 1 && (
            <div className="space-y-3">
              {loadingLocations ? (
                <div className="text-sm text-muted-foreground py-8 text-center">Loading yards…</div>
              ) : locations.length === 0 ? (
                <div className="text-sm text-muted-foreground py-8 text-center">No active locations found.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {locations.map((loc) => {
                    const selected = form.location_id === loc.id;
                    const stat = locationStats[loc.id];
                    return (
                      <button
                        key={loc.id}
                        type="button"
                        onClick={() => setForm({ ...form, location_id: loc.id })}
                        className={`text-left p-4 border-2 rounded-lg transition-all ${
                          selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <MapPin className={`h-4 w-4 shrink-0 ${selected ? 'text-primary' : 'text-gray-400'}`} />
                            <span className="font-medium truncate">{loc.name}</span>
                          </div>
                          {selected && <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />}
                        </div>
                        {loc.location_type?.name && (
                          <div className="text-xs text-muted-foreground capitalize mt-0.5 ml-6">{loc.location_type.name}</div>
                        )}
                        <div className="mt-3 ml-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <span className="inline-flex items-center gap-1 text-gray-600">
                            <ClipboardList className="h-3.5 w-3.5" />
                            {stat ? `${stat.item_lines} item${stat.item_lines === 1 ? '' : 's'}` : '—'}
                          </span>
                          <span className="inline-flex items-center gap-1 text-gray-600">
                            <Package className="h-3.5 w-3.5" />
                            {stat ? `${stat.total_on_hand} on hand` : '—'}
                          </span>
                        </div>
                        <div className="mt-1 ml-6 text-xs text-muted-foreground">
                          {relativeLastCounted(stat?.last_counted_at ?? null)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ---- STEP 2: WHAT KIND — count-type cards with explanations ---- */}
          {step === 2 && (
            <div className="space-y-6">
              {selectedLocation && (
                <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                  <MapPin className="h-4 w-4 shrink-0 text-primary" />
                  <span className="text-gray-700">
                    Counting at <span className="font-semibold">{selectedLocation.name}</span>
                    {selectedLocation.location_type?.name ? ` (${selectedLocation.location_type.name})` : ''}.
                  </span>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-2">Count type</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {COUNT_TYPE_OPTIONS.map((opt) => {
                    const selected = form.count_type === opt.value;
                    const Icon = opt.Icon;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setForm({ ...form, count_type: opt.value })}
                        className={`text-left p-4 border-2 rounded-lg transition-all ${
                          selected ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Icon className={`h-4 w-4 shrink-0 ${selected ? 'text-primary' : 'text-gray-400'}`} />
                          <span className="font-medium">{opt.label}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1.5">{opt.explainer}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Assignee */}
              <div>
                <label className="block text-sm font-medium mb-2">Assign to</label>
                <select
                  value={form.assigned_to_user_id}
                  onChange={(e) => setForm({ ...form, assigned_to_user_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">Me</option>
                  {counters.map((u) => (
                    <option key={u.user_id} value={u.user_id}>{u.name || u.email || u.user_id}</option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  The assignee gets a task and a notification. Only qualified counters are listed.
                </p>
              </div>

              {/* Scheduled Date/Time */}
              <div>
                <label className="block text-sm font-medium mb-2">Scheduled for</label>
                <input
                  type="datetime-local"
                  value={form.scheduled_for}
                  onChange={(e) => setForm({ ...form, scheduled_for: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  When should this count be performed? Leave blank to start immediately.
                </p>
              </div>

              {/* Blind Count Option */}
              {form.count_type !== 'initial' && (
                <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <input
                    type="checkbox"
                    id="blind-count"
                    checked={form.is_blind}
                    onChange={(e) => setForm({ ...form, is_blind: e.target.checked })}
                    className="mt-1 h-4 w-4 rounded border-gray-300"
                  />
                  <div className="flex-1">
                    <label htmlFor="blind-count" className="text-sm font-medium cursor-pointer">
                      Blind count (hide expected quantities)
                    </label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Recommended for accuracy. Counter won&apos;t see system quantities, reducing bias.
                    </p>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium mb-2">Notes (optional)</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Add any special instructions or context for this count..."
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[72px]"
                />
              </div>
            </div>
          )}

          {/* ---- STEP 3: WHICH ITEMS — only for partial / spot check ---- */}
          {step === 3 && needsItems && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Pick the items to include in this {countTypeMeta.label.toLowerCase()}.
                {' '}<span className="font-medium text-gray-700">{form.specific_items.length} selected</span>.
              </div>
              <input
                type="text"
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder="Search items by name or SKU…"
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {loadingItems ? (
                <div className="text-sm text-muted-foreground py-8 text-center">Loading items…</div>
              ) : filteredItems.length === 0 ? (
                <div className="text-sm text-muted-foreground py-8 text-center">No matching items.</div>
              ) : (
                <div className="max-h-80 overflow-y-auto border rounded-lg divide-y">
                  {filteredItems.map((item) => {
                    const checked = form.specific_items.includes(item.id);
                    return (
                      <label
                        key={item.id}
                        className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setForm((prev) => ({
                              ...prev,
                              specific_items: e.target.checked
                                ? [...prev.specific_items, item.id]
                                : prev.specific_items.filter((id) => id !== item.id),
                            }));
                          }}
                          className="h-4 w-4"
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{item.name}</div>
                          {item.sku && <div className="text-xs text-muted-foreground">{item.sku}</div>}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer nav — Back / Cancel on the left, Next / create on the right. */}
        <div className="sticky bottom-0 bg-white flex items-center justify-between gap-3 px-6 py-4 border-t">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium"
            >
              Cancel
            </button>
            {step > 1 && (
              <button
                type="button"
                onClick={goBack}
                className="inline-flex items-center gap-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
            )}
          </div>
          {isLastStep ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={primaryDisabled}
              className="px-5 py-2.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {saving ? 'Creating…' : form.scheduled_for ? 'Schedule Count' : 'Start Count Now'}
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              disabled={step === 1 && !form.location_id}
              className="px-5 py-2.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
