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
 * Item 04 wires the "Change / find vendor" affordance: a compact three-tier
 * VendorPicker (your vendors / GV catalog "Add & use" / web discover) that,
 * after adopting or creating a vendor, re-runs draft_po_preview against the now-
 * real vendor so pricing + advisories refresh in place.
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
  DraftPoPreviewResult,
  PriceBasis,
} from '@/lib/ai/draft-po-preview';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { VendorPicker, type PickedVendor } from './VendorPicker';

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
  // The live preview — starts as the item-02 payload item 03 rendered, but a
  // vendor swap (item 04) re-runs draft_po_preview and replaces it in place so
  // pricing + advisories refresh against the newly adopted/created vendor.
  const [preview, setPreview] = useState<DraftPoPreviewResult>(data.preview);

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

  // ── Vendor picker + re-preview (item 04) ──────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false);
  const [repreviewing, setRepreviewing] = useState(false);
  // A one-line status Isabelle-style narration after a vendor swap.
  const [vendorNote, setVendorNote] = useState<string | null>(null);

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

  // Anchor item for the picker's catalog/web tiers — the first resolved line
  // (catalog_item_id preferred, else its name as free text).
  const anchorItemRef = useMemo(() => {
    const first = lines.find((l) => l.catalog_item_id) || lines[0];
    return first ? first.catalog_item_id || first.name : null;
  }, [lines]);

  // Re-run draft_po_preview against a newly chosen/adopted/created vendor so the
  // whole card (prices, basis, advisories, warnings, total) refreshes honestly.
  const applyVendor = async (picked: PickedVendor) => {
    setPickerOpen(false);
    setError(null);
    setRepreviewing(true);
    setVendorNote(`Added ${picked.name} and rebuilding your draft…`);
    try {
      const body = {
        vendor_id: picked.vendor_id,
        delivery_location_id: deliveryLocationId || undefined,
        needed_by_date: neededByDate || undefined,
        cost_context: preview.cost_context || undefined,
        // Rebuild from the current (possibly edited) lines. A catalog/new vendor
        // usually has no vendor_items yet → price_basis 'unknown', handled below.
        lines: lines
          .map((l) => ({
            item_ref: l.catalog_item_id || l.name,
            qty: Number.isFinite(l.qty) && l.qty > 0 ? l.qty : 1,
          }))
          .filter((l) => l.item_ref),
      };
      const res = await fetch('/api/ai/draft-po-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      const next: DraftPoPreviewResult | undefined = json?.data;
      if (!res.ok || !next) {
        // Re-preview failed — keep the current card but point the vendor at the
        // picked one so Create still works, and surface the hiccup.
        setPreview((cur) => ({
          ...cur,
          vendor: { ...cur.vendor, vendor_id: picked.vendor_id, name: picked.name, code: picked.code, pending_adopt: false, catalog_vendor_id: null },
        }));
        setVendorNote(`Added ${picked.name}. Couldn't refresh pricing — you can still create the PO.`);
        return;
      }
      setPreview(next);
      // Re-sync the editable rows to the refreshed preview (new prices/basis).
      setLines(
        (next.lines || []).map((l: DraftPoPreviewLine) => ({
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
      if (next.delivery_location_id) setDeliveryLocationId(next.delivery_location_id);
      setVendorNote(`Added ${picked.name} and rebuilt your draft.`);
    } catch (err: any) {
      setPreview((cur) => ({
        ...cur,
        vendor: { ...cur.vendor, vendor_id: picked.vendor_id, name: picked.name, code: picked.code, pending_adopt: false, catalog_vendor_id: null },
      }));
      setVendorNote(`Added ${picked.name}. Couldn't refresh pricing — you can still create the PO.`);
    } finally {
      setRepreviewing(false);
    }
  };

  // ── Create PO via the existing write bridge ───────────────────────────
  const handleCreate = async () => {
    if (submitting || result) return;
    setError(null);

    if (!vendor.vendor_id) {
      setError(
        vendor.pending_adopt
          ? 'This vendor isn\'t on file yet — tap "Find vendor" to add them, then create the PO.'
          : 'Pick a vendor before creating this PO.',
      );
      setPickerOpen(true);
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
        {/* Item 04: open the three-tier vendor picker (your vendors / catalog / web). */}
        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          disabled={repreviewing}
          className="shrink-0 rounded-md border border-teal-300 bg-white px-2 py-1 text-[11px] font-medium text-teal-700 transition-colors hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {vendor.vendor_id ? 'Change vendor' : 'Find vendor'}
        </button>
      </div>

      {/* Vendor picker (item 04) */}
      {pickerOpen && (
        <div className="border-b border-gray-100 px-4 pb-3 pt-1">
          <VendorPicker
            itemRef={anchorItemRef}
            locationId={deliveryLocationId}
            currentVendorId={vendor.vendor_id}
            onPick={applyVendor}
            onClose={() => setPickerOpen(false)}
          />
        </div>
      )}

      {/* Vendor-swap narration + re-preview spinner */}
      {(vendorNote || repreviewing) && (
        <div className="flex items-center gap-2 border-b border-teal-100 bg-teal-50 px-4 py-2 text-xs font-medium text-teal-800">
          {repreviewing && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
          {vendorNote}
        </div>
      )}

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
          <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <span>
              {vendor.pending_adopt
                ? `${vendor.name || 'This catalog vendor'} isn't on file yet — add them to build the draft.`
                : 'No vendor on file for these items yet.'}
            </span>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-700"
            >
              {vendor.pending_adopt ? 'Add & use' : 'Find vendor'}
            </button>
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
