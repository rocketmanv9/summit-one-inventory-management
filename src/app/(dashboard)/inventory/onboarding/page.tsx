'use client';

/**
 * New hires — the onboarding queue (item 04, kits/amazon/fleet sprint).
 *
 * The automation's receipt. Every time HR adds a person, the kit engine
 * resolves their kit, reserves what's on the shelf at their location and drafts
 * a PO for the rest. This page is the reason none of that is spooky: one row
 * per hire, the per-line math it used, the reservations it made, and links to
 * the POs it drafted.
 *
 * Sibling of /settings/position-kits (the recipe) — this is the kitchen.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  UserPlus,
  Loader2,
  RefreshCw,
  PackageCheck,
  ShoppingCart,
  AlertTriangle,
  MapPin,
  ExternalLink,
  Play,
  Search,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { apiWrite } from '@/lib/api-client';

interface PlanLine {
  catalog_item_id: string;
  name: string | null;
  sku: string | null;
  note: string | null;
  needed: number;
  have: number;
  reserve: number;
  shortfall: number;
}

interface Plan {
  kit_id: string;
  kit_name: string;
  order_mode: 'draft' | 'auto_submit';
  lines: PlanLine[];
  total_needed: number;
  total_reserve: number;
  total_shortfall: number;
}

interface ProvisionPO {
  id: string;
  po_number: string | null;
  status: string | null;
  vendor_name_snapshot: string | null;
}

interface Provision {
  id: string;
  hr_person_id: string;
  kit_id: string | null;
  person_name: string | null;
  position_title: string | null;
  location_name: string | null;
  status: 'planned' | 'provisioned' | 'skipped_no_kit' | 'skipped_backfill' | 'error';
  order_mode: 'draft' | 'auto_submit' | null;
  plan: Plan | null;
  error: string | null;
  source: string | null;
  created_at: string;
  processed_at: string | null;
  purchase_orders: ProvisionPO[];
  reservations: Array<{ id: string; qty: number; status: string }>;
}

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  provisioned: { label: 'Provisioned', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  planned: { label: 'In progress', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  error: { label: 'Needs attention', cls: 'bg-red-50 text-red-700 border-red-200' },
  skipped_no_kit: { label: 'No kit', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  skipped_backfill: { label: 'Pre-existing', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
};

async function readJson(res: Response) {
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { error: text }; }
  if (!res.ok) {
    return { ok: false as const, message: json?.error?.message || json?.error || json?.message || `Request failed (${res.status})`, json };
  }
  return { ok: true as const, json };
}

export default function OnboardingPage() {
  return (
    <AppShell>
      <OnboardingContent />
    </AppShell>
  );
}

function OnboardingContent() {
  const [rows, setRows] = useState<Provision[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async (history: boolean) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/inventory/onboarding${history ? '?status=all' : ''}`, { credentials: 'include' });
      const result = await readJson(res);
      if (!result.ok) { setError(result.message); return; }
      setRows((result.json.data?.provisions ?? []) as Provision[]);
      setCounts(result.json.data?.counts ?? {});
    } catch (e: any) {
      setError(e?.message || 'Failed to load the onboarding queue.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(showHistory); }, [load, showHistory]);

  const provisionNow = async (row: Provision) => {
    setBusyId(row.id);
    setError('');
    setNotice('');
    try {
      const res = await apiWrite('/api/inventory/onboarding/provision', {
        method: 'POST',
        body: { hr_person_id: row.hr_person_id, force: true },
      });
      const result = await readJson(res);
      if (!result.ok) { setError(result.message); return; }
      setNotice(result.json.data?.outcome?.message || 'Provisioning re-run.');
      await load(showHistory);
    } catch (e: any) {
      setError(e?.message || 'Could not provision this hire.');
    } finally {
      setBusyId(null);
    }
  };

  const scanForNewHires = async () => {
    setScanning(true);
    setError('');
    setNotice('');
    try {
      const res = await apiWrite('/api/inventory/onboarding/provision', { method: 'POST', body: { scan: true } });
      const result = await readJson(res);
      if (!result.ok) { setError(result.message); return; }
      const s = result.json.data?.scan;
      setNotice(
        s && s.candidates > 0
          ? `Found ${s.candidates} new hire(s): ${s.provisioned} provisioned, ${s.skipped} skipped, ${s.errors} error(s).`
          : 'No new hires waiting — everyone on the roster has been handled.',
      );
      await load(showHistory);
    } catch (e: any) {
      setError(e?.message || 'Scan failed.');
    } finally {
      setScanning(false);
    }
  };

  const attention = useMemo(() => rows.filter((r) => r.status === 'error' || r.status === 'planned'), [rows]);

  return (
    <div className="p-6">
      <PageHeader
        title="New hires"
        description="What inventory did about every person HR added: kit resolved, shelf stock reserved, the rest put on a PO. Nothing is sent to a vendor without approval."
      />

      {/* Counters — the whole ledger at a glance, including the pre-existing roster. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['provisioned', 'planned', 'error', 'skipped_no_kit', 'skipped_backfill'] as const).map((s) => (
          counts[s] ? (
            <span key={s} className={`rounded-full border px-3 py-1 text-xs font-medium ${STATUS_STYLE[s].cls}`}>
              {STATUS_STYLE[s].label}: {counts[s]}
            </span>
          ) : null
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={scanForNewHires}
          disabled={scanning}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
        >
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Check for new hires
        </button>
        <button
          onClick={() => load(showHistory)}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
        <label className="ml-auto inline-flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showHistory} onChange={(e) => setShowHistory(e.target.checked)} />
          Show pre-existing staff
        </label>
        <Link href="/settings/position-kits" className="text-sm text-primary hover:underline">
          Edit kits →
        </Link>
      </div>

      {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">{notice}</div>}

      {attention.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {attention.length} hire{attention.length === 1 ? ' needs' : 's need'} a look — usually a missing location or a
            kit that couldn&apos;t be ordered. Fix the cause, then hit &ldquo;Provision now&rdquo;.
          </span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 p-8 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading the queue…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center">
          <UserPlus className="mx-auto h-8 w-8 text-gray-400" />
          <p className="mt-3 font-medium text-gray-700">No new hires yet</p>
          <p className="mt-1 text-sm text-gray-500">
            When HR adds someone, their kit shows up here automatically — reserved from the shelf, ordered if short.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const style = STATUS_STYLE[row.status] ?? { label: row.status, cls: 'bg-gray-100 text-gray-600 border-gray-200' };
            return (
              <div key={row.id} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900">{row.person_name || 'Unnamed hire'}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${style.cls}`}>{style.label}</span>
                      {row.order_mode === 'auto_submit' && (
                        <span className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
                          auto-submit
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-gray-600">
                      {row.position_title && <span>{row.position_title}</span>}
                      {row.location_name && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" /> {row.location_name}
                        </span>
                      )}
                      {row.plan?.kit_name && <span className="text-gray-500">Kit: {row.plan.kit_name}</span>}
                      <span className="text-gray-400">
                        {new Date(row.created_at).toLocaleString()} · via {row.source ?? 'unknown'}
                      </span>
                    </div>
                  </div>

                  {(row.status === 'error' || row.status === 'planned' || row.status === 'skipped_no_kit') && (
                    <button
                      onClick={() => provisionNow(row)}
                      disabled={busyId === row.id}
                      className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-60"
                    >
                      {busyId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      Provision now
                    </button>
                  )}
                </div>

                {row.error && (
                  <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{row.error}</div>
                )}

                {/* Per-line chips: what was pulled off the shelf vs what got ordered. */}
                {row.plan?.lines?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {row.plan.lines.map((l) => (
                      <span
                        key={l.catalog_item_id}
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                          l.shortfall > 0
                            ? 'border-blue-200 bg-blue-50 text-blue-800'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        }`}
                        title={l.note || undefined}
                      >
                        {l.shortfall > 0 ? <ShoppingCart className="h-3.5 w-3.5" /> : <PackageCheck className="h-3.5 w-3.5" />}
                        <span className="font-medium">{l.name || l.sku || 'Item'}</span>
                        <span className="text-[11px] opacity-80">
                          ×{l.needed}
                          {l.reserve > 0 && ` · ${l.reserve} reserved`}
                          {l.shortfall > 0 && ` · ${l.shortfall} on order`}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : row.status === 'skipped_no_kit' ? (
                  <div className="mt-3 text-sm text-gray-500">
                    No kit is configured for this position — <Link href="/settings/position-kits" className="text-primary hover:underline">set one up</Link> and re-run.
                  </div>
                ) : null}

                {row.purchase_orders.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    {row.purchase_orders.map((po) => (
                      <Link
                        key={po.id}
                        href={`/inventory/purchasing?po=${po.id}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-gray-700 hover:bg-gray-100"
                      >
                        <ShoppingCart className="h-3.5 w-3.5" />
                        {po.po_number || 'PO'}
                        <span className="text-xs text-gray-500">
                          {po.status}{po.vendor_name_snapshot ? ` · ${po.vendor_name_snapshot}` : ''}
                        </span>
                        <ExternalLink className="h-3 w-3 opacity-60" />
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
