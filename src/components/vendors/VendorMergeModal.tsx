'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Loader2, ArrowRight, CheckCircle2 } from 'lucide-react';
import { AppError } from '@rocketmanv9/chassis/errors';
import { apiErrorMessage, errMessage } from '@/lib/client-errors';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

/** Minimal vendor shape the picker needs. */
export interface MergeCandidateVendor {
  id: string;
  name: string;
  code?: string | null;
  is_active: boolean;
}

interface MergePreview {
  items_move: number;
  items_skip: number;
  contacts_move: number;
  contacts_skip: number;
  addresses_move: number;
  addresses_skip: number;
  domains_move: number;
  domains_skip: number;
  pos_move: number;
  perf_events_move: number;
  perf_metrics_move: number;
  target_vendor_name: string;
}

interface VendorMergeModalProps {
  open: boolean;
  /** The duplicate being retired (the source of the merge). */
  source: MergeCandidateVendor | null;
  /** All of the tenant's vendors — the picker lists the active ones minus self. */
  vendors: MergeCandidateVendor[];
  onClose: () => void;
  /** Fired after a successful merge with the surviving vendor's id + name. */
  onMerged: (result: { targetId: string; targetName: string }) => void;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

// "1 contact, 1 address (1 duplicate will be skipped), 0 items, 0 POs"
function summarize(p: MergePreview): { label: string; move: number; skip: number }[] {
  const line = (
    label: string,
    move: number,
    skip: number,
  ) => ({ label, move, skip });
  return [
    line('contact', p.contacts_move, p.contacts_skip),
    line('address', p.addresses_move, p.addresses_skip),
    line('item', p.items_move, p.items_skip),
    line('email domain', p.domains_move, p.domains_skip),
    line('purchase order', p.pos_move, 0),
  ];
}

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Merge a duplicate vendor into the real one. Admin-gated at the call site
 * (vendors.manage). Flow: pick the surviving vendor → we preview what will move
 * (re-pointed vs. skipped-as-duplicate) → confirm → the merge re-points
 * everything, deactivates the duplicate, and records where it went.
 */
export function VendorMergeModal({ open, source, vendors, onClose, onMerged }: VendorMergeModalProps) {
  const [targetId, setTargetId] = useState('');
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ targetName: string } | null>(null);

  // Active vendors other than the source, sorted by name.
  const targetOptions = useMemo(
    () =>
      vendors
        .filter((v) => v.is_active && v.id !== source?.id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [vendors, source?.id],
  );

  // Reset when (re)opened for a new source.
  useEffect(() => {
    if (open) {
      setTargetId('');
      setPreview(null);
      setError('');
      setDone(null);
      setMerging(false);
      setLoadingPreview(false);
    }
  }, [open, source?.id]);

  // Fetch the preview whenever a target is chosen.
  useEffect(() => {
    if (!open || !source || !targetId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    setError('');
    (async () => {
      try {
        const res = await fetch(`/api/inventory/vendors/${source.id}/merge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({ target_vendor_id: targetId, preview: true }),
        });
        if (!res.ok) throw AppError.internal(await apiErrorMessage(res, 'Failed to preview merge'));
        const json = await res.json();
        if (!cancelled) setPreview(json.data as MergePreview);
      } catch (err) {
        if (!cancelled) {
          setPreview(null);
          setError(errMessage(err, 'Failed to preview merge'));
        }
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, source, targetId]);

  const targetName = useMemo(
    () => targetOptions.find((v) => v.id === targetId)?.name || '',
    [targetOptions, targetId],
  );

  const handleMerge = async () => {
    if (!source || !targetId) return;
    setMerging(true);
    setError('');
    try {
      const res = await fetch(`/api/inventory/vendors/${source.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ target_vendor_id: targetId }),
      });
      if (!res.ok) throw AppError.internal(await apiErrorMessage(res, 'Failed to merge vendor'));
      const json = await res.json();
      setDone({ targetName: json.data?.target_vendor_name || targetName });
    } catch (err) {
      setError(errMessage(err, 'Failed to merge vendor'));
    } finally {
      setMerging(false);
    }
  };

  const summaryLines = preview ? summarize(preview) : [];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !merging) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge vendor</DialogTitle>
          <DialogDescription>
            {done
              ? 'The duplicate has been merged.'
              : source
                ? `Fold "${source.name}" into another vendor. Everything it owns moves to the vendor you pick, and this duplicate is deactivated.`
                : ''}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-md bg-emerald-50 border border-emerald-200">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
              <div className="text-sm text-emerald-900">
                <p className="font-medium">Merged into {done.targetName}</p>
                <p className="mt-0.5 text-emerald-800">
                  &quot;{source?.name}&quot; is now inactive and points at the surviving vendor. Its
                  contacts, addresses, items, and history now live on {done.targetName}.
                </p>
              </div>
            </div>
            <DialogFooter>
              <button
                type="button"
                onClick={() => onMerged({ targetId, targetName: done.targetName })}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
              >
                View {done.targetName}
              </button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Direction indicator */}
            <div className="flex items-center gap-2 text-sm">
              <span className="px-2 py-1 rounded bg-red-50 text-red-700 font-medium truncate max-w-[45%]">
                {source?.name}
              </span>
              <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 font-medium truncate max-w-[45%]">
                {targetName || 'choose a vendor…'}
              </span>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Merge into</label>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                disabled={merging}
                className="w-full border rounded-md px-3 py-2 text-sm bg-background disabled:opacity-50"
              >
                <option value="">Select the vendor to keep…</option>
                {targetOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}{v.code ? ` (${v.code})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Preview of what will move */}
            {targetId && (
              <div className="rounded-md border p-3 bg-muted/20">
                {loadingPreview ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking what will move…
                  </div>
                ) : preview ? (
                  <div className="space-y-1.5 text-sm">
                    <p className="font-medium text-foreground">What will move</p>
                    <ul className="space-y-1">
                      {summaryLines.map((l) => (
                        <li key={l.label} className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">
                            {pluralize(l.move, l.label)}
                            {l.skip > 0 && (
                              <span className="text-amber-700">
                                {' '}({l.skip} duplicate{l.skip === 1 ? '' : 's'} will be skipped)
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="pt-1 text-xs text-muted-foreground">
                      Duplicates already on {preview.target_vendor_name} are left untouched — the
                      survivor keeps its own contacts, pricing, and addresses.
                    </p>
                  </div>
                ) : null}
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <button
                type="button"
                onClick={onClose}
                disabled={merging}
                className="px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleMerge}
                disabled={merging || !targetId || loadingPreview}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {merging && <Loader2 className="h-4 w-4 animate-spin" />}
                {merging ? 'Merging…' : 'Merge vendor'}
              </button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
