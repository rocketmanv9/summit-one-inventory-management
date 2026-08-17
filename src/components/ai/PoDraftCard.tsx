'use client';

/**
 * PoDraftCard — Isabelle's interactive Draft-PO card (sprint item 03).
 *
 * Renders the item-02 `draft_po_preview` payload right in the chat: vendor,
 * editable lines (qty + unit cost), per-line advisory chips, PO-level warnings,
 * a live-recomputed estimated total, delivery location + needed-by, and one big
 * "Create PO" button. Tapping Create POSTs to the EXISTING write bridge
 * (/api/ai/execute-action, action: 'create_po') — no new PO route. On success
 * the card collapses to an honest status line ("PO 26-0032 created — awaiting
 * approval") with a link to the purchasing surface.
 *
 * Item 04 owns the GV-catalog "Add & use" vendor flow — here we only surface the
 * pending-adopt tag and leave a clean (disabled) "Change vendor" seam.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ExternalLink,
  Loader2,
  PackageCheck,
  ShoppingCart,
  Truck,
} from 'lucide-react';
import type { AiPoDraftDisplay } from '@/lib/ai/types';
import type {
  Advisory,
  DraftPoPreviewLine,
  PriceBasis,
} from '@/lib/ai/draft-po-preview';
import { InventoryRPC } from '@/lib/rpc/inventory';

interface PoDraftCardProps {
  data: AiPoDraftDisplay;
}

interface EditableLine {
  catalog_item_id: string | null;
  item_description: string | null;
  name: string;
  qty: number;
  uom_label: string;
  unit_cost: number | null;
  price_basis: PriceBasis;
  advisories: Advisory[];
}

interface LocationOption {
  id: string;
  name: string;
}

const BASIS_LABEL: Record<PriceBasis, string> = {
  fixed: 'list price',
  market: 'market price',
  estimated: 'estimated',
  unknown: 'no price yet',
};

function currency(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Compact colored chip for a per-line advisory. */
function AdvisoryChip({ advisory }: { advisory: Advisory }) {
  const styles: Record<Advisory['kind'], string> = {
    on_hand: 'bg-sky-50 text-sky-700 border-sky-200',
    surplus_elsewhere: 'bg-violet-50 text-violet-700 border-violet-200',
    open_po: 'bg-amber-50 text-amber-700 border-amber-200',
    min_order: 'bg-orange-50 text-orange-700 border-orange-200',
  };
  const icon: Record<Advisory['kind'], React.ReactNode> = {
    on_hand: <Boxes className="w-3 h-3" />,
    surplus_elsewhere: <Boxes className="w-3 h-3" />,
    open_po: <AlertTriangle className="w-3 h-3" />,
    min_order: <AlertTriangle className="w-3 h-3" />,
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles[advisory.kind]}`}
    >
      {icon[advisory.kind]}
      {advisory.text}
    </span>
  );
}

export function PoDraftCard({ data }: PoDraftCardProps) {
  const preview = data.preview;

  // ── Editable line state (qty + unit cost) ─────────────────────────────
  const [lines, setLines] = useState<EditableLine[]>(() =>
    (preview.lines || []).map((l: DraftPoPreviewLine) => ({
      catalog_item_id: l.catalog_item_id,
      item_description: l.item_description,
      name: l.name,
      qty: l.qty,
      uom_label: l.uom_label,
      unit_cost: l.unit_cost,
      price_basis: l.price_basis,
      advisories: l.advisories,
    })),
  );

  const [deliveryLocationId, setDeliveryLocationId] = useState<string | null>(
    preview.delivery_location_id,
  );
  const [neededByDate, setNeededByDate] = useState<string>(
    preview.needed_by_date || '',
  );
  const [locations, setLocations] = useState<LocationOption[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    po_number: string | null;
    po_id: string | null;
    status: string | null;
  } | null>(null);

  // ── Load delivery locations for the select ────────────────────────────
  useEffect(() => {
    let cancelled = false;
    InventoryRPC.getLocations({ active: true })
      .then((rows) => {
        if (cancelled) return;
        const opts = (rows || []).map((r: any) => ({ id: r.id, name: r.name }));
        setLocations(opts);
        // If the preview didn't pin a delivery location, default to the first.
        setDeliveryLocationId((cur) => cur || (opts[0]?.id ?? null));
      })
      .catch(() => {
        /* Non-fatal — the buyer can still create without a pinned location. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Live totals ───────────────────────────────────────────────────────
  const { estimatedTotal, unpricedCount } = useMemo(() => {
    let total = 0;
    let unpriced = 0;
    for (const l of lines) {
      if (l.unit_cost != null && Number.isFinite(l.unit_cost)) {
        total += l.unit_cost * (Number.isFinite(l.qty) ? l.qty : 0);
      } else {
        unpriced += 1;
      }
    }
    return { estimatedTotal: total, unpricedCount: unpriced };
  }, [lines]);

  const updateLine = (index: number, patch: Partial<EditableLine>) => {
    setLines((prev) =>
      prev.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    );
  };

  const vendor = preview.vendor;
  const vendorMissing = !vendor.vendor_id;

  // ── Create PO via the existing write bridge ───────────────────────────
  const handleCreate = async () => {
    if (submitting || result) return;
    setError(null);

    if (!vendor.vendor_id) {
      setError(
        vendor.pending_adopt
          ? "This vendor isn't on file yet — add them first (coming soon) before creating the PO."
          : 'Pick a vendor before creating this PO.',
      );
      return;
    }
    const orderable = lines.filter(
      (l) => l.catalog_item_id && Number.isFinite(l.qty) && l.qty > 0,
    );
    if (orderable.length === 0) {
      setError('Nothing to order — every line needs a resolved item and a quantity.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/ai/execute-action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-idempotency-key': `ai-create-po-${vendor.vendor_id}-${Date.now()}`,
        },
        credentials: 'include',
        body: JSON.stringify({
          action: 'create_po',
          vendor_id: vendor.vendor_id,
          delivery_location_id: deliveryLocationId || undefined,
          needed_by_date: neededByDate || undefined,
          cost_context: preview.cost_context || undefined,
          lines: orderable.map((l) => ({
            catalog_item_id: l.catalog_item_id,
            qty_ordered: l.qty,
            unit_cost: l.unit_cost ?? undefined,
            price_basis: l.price_basis,
          })),
          notes: 'Created via Isabelle draft-PO card',
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          json?.error?.message || json?.message || `Couldn't create the PO (${res.status}).`;
        setError(String(msg));
        setSubmitting(false);
        return;
      }

      const payload = json?.data ?? json;
      setResult({
        po_number: payload?.po_number ?? null,
        po_id: payload?.po_id ?? null,
        status: payload?.status ?? 'draft',
      });
    } catch (err: any) {
      setError(err?.message || 'Network error creating the PO.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Success (collapsed) state ─────────────────────────────────────────
  if (result) {
    const label = result.po_number ? `PO ${result.po_number}` : 'Purchase order';
    const status = result.status || 'draft';
    return (
      <div className="mt-2 rounded-lg border border-green-200 bg-green-50 p-4">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-green-800">
              {label} created ({status.replace(/_/g, ' ')})
            </div>
            <div className="mt-0.5 text-xs text-green-700">
              {status === 'draft' && 'Saved as a draft — review and send it when ready.'}
              {(status === 'awaiting_approval' || status === 'pending_approval') &&
                'Waiting on approval before it can be sent.'}
              {status === 'approved' && 'Approved and ready to send to the vendor.'}
            </div>
            <a
              href="/inventory/purchasing"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-green-700 underline decoration-green-300 hover:text-green-900"
            >
              Open purchasing
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ── Editable draft state ──────────────────────────────────────────────
  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-teal-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-teal-100 bg-gradient-to-br from-teal-50 to-white px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-teal-600">
            <ShoppingCart className="h-3.5 w-3.5" />
            Draft purchase order
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <span className="truncate text-base font-bold text-gray-900">
              {vendor.name || (vendor.pending_adopt ? 'Catalog vendor' : 'Pick a vendor')}
            </span>
            {vendor.code && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-mono text-gray-500">
                {vendor.code}
              </span>
            )}
            {vendor.pending_adopt ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                new — from catalog
              </span>
            ) : vendor.vendor_id ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                from your vendors
              </span>
            ) : null}
          </div>
        </div>
        {/* Item 04 seam: "Change vendor" — disabled stub until the Add & use flow lands. */}
        <button
          type="button"
          disabled
          title="Changing vendors comes with the catalog Add & use flow"
          className="shrink-0 cursor-not-allowed rounded-md border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-400"
        >
          Change vendor
        </button>
      </div>

      {/* Top-level warnings strip */}
      {preview.warnings && preview.warnings.length > 0 && (
        <div className="border-b border-amber-100 bg-amber-50 px-4 py-2">
          {preview.warnings.map((w, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 text-xs font-medium text-amber-800"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {w.text}
            </div>
          ))}
        </div>
      )}

      {/* Lines */}
      <div className="divide-y divide-gray-100">
        {lines.map((line, i) => (
          <div key={i} className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-gray-900">
                  {line.name}
                </div>
                {!line.catalog_item_id && (
                  <div className="mt-0.5 text-[11px] font-medium text-orange-600">
                    not matched to a catalog item
                  </div>
                )}
              </div>
              <div className="text-right text-sm font-semibold text-gray-900">
                {line.unit_cost != null
                  ? currency(line.unit_cost * (Number.isFinite(line.qty) ? line.qty : 0))
                  : '—'}
              </div>
            </div>

            {/* Editable qty + unit cost */}
            <div className="mt-2 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                  Qty ({line.uom_label})
                </span>
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={Number.isFinite(line.qty) ? line.qty : ''}
                  onChange={(e) =>
                    updateLine(i, { qty: e.target.value === '' ? 0 : Number(e.target.value) })
                  }
                  className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-300"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                  Unit cost
                </span>
                <div className="flex items-center rounded-md border border-gray-300 focus-within:border-teal-400 focus-within:ring-1 focus-within:ring-teal-300">
                  <span className="pl-2 text-sm text-gray-400">$</span>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={line.unit_cost != null ? line.unit_cost : ''}
                    placeholder="0.00"
                    onChange={(e) =>
                      updateLine(i, {
                        unit_cost: e.target.value === '' ? null : Number(e.target.value),
                        // Editing the cost by hand makes it a fixed value.
                        price_basis: e.target.value === '' ? 'unknown' : 'fixed',
                      })
                    }
                    className="w-24 rounded-md px-1 py-1 text-sm focus:outline-none"
                  />
                </div>
              </label>
              <span className="mb-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">
                {BASIS_LABEL[line.price_basis]}
              </span>
            </div>

            {/* Per-line advisory chips */}
            {line.advisories && line.advisories.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {line.advisories.map((a, ai) => (
                  <AdvisoryChip key={ai} advisory={a} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
        {/* Delivery + needed-by */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-gray-400">
              <Truck className="h-3 w-3" /> Deliver to
            </span>
            <select
              value={deliveryLocationId || ''}
              onChange={(e) => setDeliveryLocationId(e.target.value || null)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-300"
            >
              {locations.length === 0 && <option value="">Default location</option>}
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
              Needed by
            </span>
            <input
              type="date"
              value={neededByDate}
              onChange={(e) => setNeededByDate(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-300"
            />
          </label>
        </div>

        {/* Estimated total */}
        <div className="mt-3 flex items-baseline justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Estimated total
          </span>
          <span className="text-xl font-bold text-gray-900">
            {currency(estimatedTotal)}
          </span>
        </div>
        {unpricedCount > 0 && (
          <div className="mt-1 text-right text-[11px] text-gray-500">
            {unpricedCount} unpriced line{unpricedCount === 1 ? '' : 's'} not in the total
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-3 flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {vendorMissing && !error && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {vendor.pending_adopt
              ? "This vendor isn't on file yet — the catalog Add & use step is coming soon."
              : 'No vendor selected yet.'}
          </div>
        )}

        {/* Create PO */}
        <button
          type="button"
          onClick={handleCreate}
          disabled={submitting || vendorMissing}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating PO…
            </>
          ) : (
            <>
              <PackageCheck className="h-4 w-4" />
              Create PO
            </>
          )}
        </button>
      </div>
    </div>
  );
}
