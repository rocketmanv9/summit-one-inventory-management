'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AppError } from '@rocketmanv9/chassis/errors';
import { apiErrorMessage } from '@/lib/client-errors';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  ShieldCheck,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';

interface IntegrityFinding {
  check_name: string;
  severity: 'error' | 'warning';
  detail: string;
  entity: Record<string, unknown>;
  item?: { id: string; name: string; sku: string | null };
  location?: { id: string; name: string };
  po?: { id: string; po_number: string | null };
}

interface IntegrityReport {
  generated_at: string;
  summary: { errors: number; warnings: number; total: number };
  findings: IntegrityFinding[];
}

const CHECK_LABELS: Record<string, string> = {
  balance_vs_ledger: 'Balance vs Ledger',
  reserved_vs_reservations: 'Reservations',
  negative_on_hand: 'Negative Stock',
  over_received_line: 'Over-Receipt',
  po_status_vs_lines: 'PO Status',
};

const CHECK_DESCRIPTIONS: Record<string, string> = {
  balance_vs_ledger: 'Stock balances must equal the sum of posted ledger movements',
  reserved_vs_reservations: 'Reserved quantities must match active reservations',
  negative_on_hand: 'On-hand quantities should not be negative',
  over_received_line: 'PO lines should not be received beyond the ordered quantity',
  po_status_vs_lines: 'PO header status must agree with its line quantities',
};

function checkLabel(name: string): string {
  return CHECK_LABELS[name] || name.replace(/_/g, ' ');
}

// Numerics can arrive as strings from PostgREST — coerce defensively.
function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function SeverityBadge({ severity }: { severity: 'error' | 'warning' }) {
  if (severity === 'error') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold text-white bg-red-600 rounded">
        <XCircle className="h-3 w-3" /> ERROR
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold text-white bg-amber-500 rounded">
      <AlertTriangle className="h-3 w-3" /> WARNING
    </span>
  );
}

function FindingSubject({ finding }: { finding: IntegrityFinding }) {
  // PO findings link to the purchasing list; item findings to the item page.
  if (finding.po) {
    return (
      <Link
        href="/inventory/purchasing"
        className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline"
      >
        {finding.po.po_number ? `PO ${finding.po.po_number}` : 'Purchase order'}
        <ExternalLink className="h-3 w-3" />
      </Link>
    );
  }

  const itemId =
    finding.item?.id ||
    (typeof finding.entity?.catalog_item_id === 'string'
      ? (finding.entity.catalog_item_id as string)
      : null);

  if (itemId) {
    return (
      <div>
        <Link
          href={`/inventory/items/${itemId}`}
          className="inline-flex items-center gap-1 font-medium text-blue-600 hover:underline"
        >
          {finding.item?.name || 'View item'}
          <ExternalLink className="h-3 w-3" />
        </Link>
        {finding.item?.sku && (
          <div className="text-xs text-muted-foreground font-mono">{finding.item.sku}</div>
        )}
      </div>
    );
  }

  return <span className="text-muted-foreground">—</span>;
}

export default function IntegrityPage() {
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/inventory/integrity');
      if (!res.ok) {
        throw AppError.internal(await apiErrorMessage(res, 'Integrity check failed'));
      }
      const json = await res.json();
      setReport(json.data || null);
    } catch (err) {
      console.error('Error running integrity check:', err);
      setError(err instanceof Error ? err.message : 'Integrity check failed');
    } finally {
      setLoading(false);
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    runCheck(true);
  }, [runCheck]);

  const errors = asNumber(report?.summary?.errors) ?? 0;
  const warnings = asNumber(report?.summary?.warnings) ?? 0;
  const allClear = report !== null && errors === 0 && warnings === 0;

  // Group findings by check, preserving a stable, known-first order.
  const grouped = new Map<string, IntegrityFinding[]>();
  if (report) {
    for (const name of Object.keys(CHECK_LABELS)) grouped.set(name, []);
    for (const f of report.findings || []) {
      if (!grouped.has(f.check_name)) grouped.set(f.check_name, []);
      grouped.get(f.check_name)!.push(f);
    }
  }

  return (
    <AppShell>
      <div className="p-6">
        <PageHeader
          title="Data Integrity"
          description="Invariant checks across stock balances, the movements ledger, reservations, and purchase orders"
          actions={
            <button
              onClick={() => runCheck()}
              disabled={loading || running}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
              {running ? 'Checking…' : 'Run check'}
            </button>
          }
        />

        {/* Summary chips */}
        {report && !loading && (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {allClear ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 text-sm font-semibold text-green-700 bg-green-100 border border-green-300 rounded-full">
                <ShieldCheck className="h-4 w-4" /> All clear
              </span>
            ) : (
              <>
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm font-semibold rounded-full border ${
                    errors > 0
                      ? 'text-red-700 bg-red-100 border-red-300'
                      : 'text-muted-foreground bg-muted border-transparent'
                  }`}
                >
                  <XCircle className="h-4 w-4" />
                  {errors} error{errors === 1 ? '' : 's'}
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm font-semibold rounded-full border ${
                    warnings > 0
                      ? 'text-amber-700 bg-amber-100 border-amber-300'
                      : 'text-muted-foreground bg-muted border-transparent'
                  }`}
                >
                  <AlertTriangle className="h-4 w-4" />
                  {warnings} warning{warnings === 1 ? '' : 's'}
                </span>
              </>
            )}
            <span className="text-xs text-muted-foreground ml-1">
              Checked {new Date(report.generated_at).toLocaleString()}
            </span>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="mt-12 flex flex-col items-center justify-center text-muted-foreground">
            <RefreshCw className="h-8 w-8 animate-spin" />
            <p className="mt-3 text-sm">Running integrity checks…</p>
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            <div className="flex items-center gap-2 font-medium">
              <XCircle className="h-5 w-5" /> Integrity check failed
            </div>
            <p className="mt-1 text-sm">{error}</p>
            <button
              onClick={() => runCheck()}
              className="mt-3 px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded"
            >
              Try again
            </button>
          </div>
        )}

        {/* Healthy state */}
        {!loading && !error && allClear && (
          <div className="mt-8 flex flex-col items-center justify-center text-center py-16 bg-green-50 border border-green-200 rounded-lg">
            <ShieldCheck className="h-14 w-14 text-green-600" />
            <h2 className="mt-4 text-xl font-semibold text-green-800">
              All invariants hold — balances match the ledger.
            </h2>
            <p className="mt-2 text-sm text-green-700 max-w-md">
              Every stock balance reconciles with posted movements, reservations are
              consistent, and purchase orders agree with their lines. Nothing to fix.
            </p>
          </div>
        )}

        {/* Findings grouped by check */}
        {!loading && !error && report && !allClear && (
          <div className="mt-6 space-y-6">
            {[...grouped.entries()]
              .filter(([, findings]) => findings.length > 0)
              .map(([checkName, findings]) => (
                <div key={checkName} className="border rounded-lg overflow-hidden">
                  <div className="px-4 py-3 bg-muted/50 border-b">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{checkLabel(checkName)}</h3>
                        {CHECK_DESCRIPTIONS[checkName] && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {CHECK_DESCRIPTIONS[checkName]}
                          </p>
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {findings.length} finding{findings.length === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b">
                        <th className="px-4 py-2 font-medium w-28">Severity</th>
                        <th className="px-4 py-2 font-medium w-64">Entity</th>
                        <th className="px-4 py-2 font-medium w-48">Location</th>
                        <th className="px-4 py-2 font-medium">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {findings.map((f, i) => (
                        <tr key={i} className="border-b last:border-b-0 align-top">
                          <td className="px-4 py-3">
                            <SeverityBadge severity={f.severity} />
                          </td>
                          <td className="px-4 py-3">
                            <FindingSubject finding={f} />
                          </td>
                          <td className="px-4 py-3">
                            {f.location?.name || (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{f.detail}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
