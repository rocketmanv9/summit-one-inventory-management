'use client';

import { AppError } from '@rocketmanv9/chassis/errors';

import { useState, useEffect, useMemo, useRef } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { useUOMLabelMap, useUOMTerms } from '@/hooks/useGVTerms';
import { useEntityImages } from '@/hooks/useEntityImages';
import { ItemPickerModal } from '@/components/purchasing/ItemPickerModal';
import { Plus, AlertCircle, Check, Package } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Vendor {
  id: string;
  name: string;
  code: string | null;
  ordering_mode?: string | null;
}

interface Location {
  id: string;
  name: string;
  location_type?: { name: string } | null;
  preferred_vendor_id?: string | null;
  last_event_id?: string | null;
}

interface CatalogItem {
  id: string;
  name: string;
  sku: string;
  description?: string | null;
  uom_term_id: string | null;
  is_parent?: boolean;
}

interface POLine {
  catalog_item_id: string;
  qty_ordered: number;
  unit_cost: number;
  /** Free-text line: no catalog item — describe what you want (needs a UOM). */
  free_text?: boolean;
  item_description?: string;
  uom_term_id?: string;
}

export default function CreatePurchaseOrderPage() {
  const router = useRouter();
  const uomLabels = useUOMLabelMap();
  const { terms: uomTerms } = useUOMTerms();
  // "Request quote": order quantities with no prices — the vendor fills them
  // in. Lines post with price_basis 'unknown', which blocks auto-approve, so
  // the PO lands as a draft awaiting the vendor's pricing.
  const [requestQuote, setRequestQuote] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  // Nearest of the selected vendor's locations to the chosen delivery location.
  const [nearest, setNearest] = useState<{
    label: string | null; city: string | null; state: string | null; distance_mi: number | null;
  } | null>(null);

  // No po_number or expected-delivery inputs: the system generates PO numbers,
  // and a delivery date isn't knowable at order time — it gets set on the PO
  // later (vendor confirmation / shipment).
  const [form, setForm] = useState({
    vendor_id: '',
    vendor_address_id: '', // '' = company-wide default pricing
    delivery_location_id: '',
    notes: '',
  });

  // Preferred vendor is per-yard: picking a delivery location defaults the
  // vendor to that yard's preferred one (only when no vendor is chosen yet —
  // never clobbers an explicit pick). Setting it is one click below.
  const deliveryLocation = locations.find((l) => l.id === form.delivery_location_id);
  const [savingPreferred, setSavingPreferred] = useState(false);
  useEffect(() => {
    if (!deliveryLocation?.preferred_vendor_id || form.vendor_id) return;
    if (vendors.some((v) => v.id === deliveryLocation.preferred_vendor_id)) {
      setForm((prev) => ({ ...prev, vendor_id: deliveryLocation.preferred_vendor_id!, vendor_address_id: '' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.delivery_location_id, locations, vendors]);

  const setPreferredForLocation = async () => {
    if (!deliveryLocation || !form.vendor_id || savingPreferred) return;
    setSavingPreferred(true);
    try {
      const res = await fetch(`/api/inventory/locations/${deliveryLocation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        credentials: 'include',
        body: JSON.stringify({
          preferred_vendor_id: form.vendor_id,
          expected_last_event_id: deliveryLocation.last_event_id,
        }),
      });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        setLocations((prev) => prev.map((l) =>
          l.id === deliveryLocation.id
            ? { ...l, preferred_vendor_id: form.vendor_id, last_event_id: json?.data?.last_event_id ?? l.last_event_id }
            : l
        ));
      }
    } finally {
      setSavingPreferred(false);
    }
  };

  // Punchout vendors (Amazon Business): "Create Purchase Order" becomes one
  // click that creates the PO, starts the punchout session, and opens Amazon —
  // no separate place-order step. Detected from the vendor's ordering_mode.
  const selectedVendor = vendors.find((v) => v.id === form.vendor_id);
  const isPunchoutVendor = selectedVendor?.ordering_mode === 'amazon_punchout';
  // Session email pre-fetched for the Amazon punchout session.
  const [sessionEmail, setSessionEmail] = useState('');
  useEffect(() => {
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((data) => {
        if (data?.authenticated && data.email) setSessionEmail(data.email);
      })
      .catch(() => {});
  }, []);

  // The selected vendor's branches/plants — lets the PO record which branch it
  // is priced against, and switches line prefills to branch-specific prices.
  const [vendorBranches, setVendorBranches] = useState<
    Array<{ id: string; label: string | null; city: string | null; state: string | null }>
  >([]);

  const [lines, setLines] = useState<POLine[]>([
    { catalog_item_id: '', qty_ordered: 0, unit_cost: 0 },
  ]);

  // Track parent selection per line + cached variants per parent
  const [lineParentIds, setLineParentIds] = useState<Record<number, string>>({});
  const [variantsByParent, setVariantsByParent] = useState<Record<string, CatalogItem[]>>({});

  // Card-based item picker: which line is currently choosing an item.
  const [pickerLineIndex, setPickerLineIndex] = useState<number | null>(null);
  const { imageMap } = useEntityImages('catalog_item', items.map((i) => i.id));

  // Items linked to the selected vendor (with that vendor's unit cost). The
  // picker only offers these — you can't order what the vendor doesn't carry.
  const [vendorItemRows, setVendorItemRows] = useState<
    Array<{
      catalog_item_id: string;
      unit_cost: number;
      vendor_address_id?: string | null;
      catalog_items?: { id: string; name: string; sku: string } | null;
    }>
  >([]);

  useEffect(() => {
    if (!form.vendor_id) {
      setVendorItemRows([]);
      return;
    }
    let cancelled = false;
    SupplyChainRPC.getVendorItemsWithCatalog(form.vendor_id)
      .then((rows) => {
        if (!cancelled) setVendorItemRows(rows);
      })
      .catch(() => {
        if (!cancelled) setVendorItemRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.vendor_id]);

  // Clear line items when the user switches from one vendor to another, so a
  // PO can't end up with items the new vendor doesn't carry. Guarded so the
  // initial vendor (incl. the URL-prefill flow) doesn't wipe a prefilled line.
  const prevVendorRef = useRef('');
  useEffect(() => {
    const prev = prevVendorRef.current;
    prevVendorRef.current = form.vendor_id;
    if (prev && form.vendor_id && prev !== form.vendor_id) {
      setLines([{ catalog_item_id: '', qty_ordered: 0, unit_cost: 0 }]);
      setLineParentIds({});
    }
  }, [form.vendor_id]);

  // Fetch the vendor's branches so the PO can be priced against one of them.
  useEffect(() => {
    if (!form.vendor_id) { setVendorBranches([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/inventory/vendors/${form.vendor_id}/addresses`);
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setVendorBranches(json.data || []);
      } catch {
        if (!cancelled) setVendorBranches([]);
      }
    })();
    return () => { cancelled = true; };
  }, [form.vendor_id]);

  // Vendor's price per catalog item — used to prefill a line's unit cost.
  // Company-default rows (vendor_address_id null) first, then rows for the
  // selected branch override them.
  const vendorCostByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of vendorItemRows) {
      if (r.unit_cost != null && r.vendor_address_id == null) m.set(r.catalog_item_id, Number(r.unit_cost));
    }
    if (form.vendor_address_id) {
      for (const r of vendorItemRows) {
        if (r.unit_cost != null && r.vendor_address_id === form.vendor_address_id) {
          m.set(r.catalog_item_id, Number(r.unit_cost));
        }
      }
    }
    return m;
  }, [vendorItemRows, form.vendor_address_id]);

  // Picker list = the vendor's items, enriched with description/uom/variant
  // info from the full catalog when available.
  const pickerItems = useMemo(() => {
    if (!form.vendor_id) return [];
    const fullById = new Map(items.map((i) => [i.id, i]));
    const seen = new Set<string>();
    return vendorItemRows
      // Drop orphaned mappings (catalog item deleted/missing) and de-dupe items
      // linked under multiple vendor SKUs — both show up as phantom/extra cards.
      .filter((r) => {
        if (!r.catalog_item_id || !r.catalog_items) return false;
        if (seen.has(r.catalog_item_id)) return false;
        seen.add(r.catalog_item_id);
        return true;
      })
      .map((r) => {
        const full = fullById.get(r.catalog_item_id);
        return {
          id: r.catalog_item_id,
          name: r.catalog_items!.name,
          sku: r.catalog_items!.sku,
          description: full?.description ?? null,
          uom_term_id: full?.uom_term_id ?? null,
          is_parent: full?.is_parent,
        };
      });
  }, [form.vendor_id, vendorItemRows, items]);

  useEffect(() => {
    loadData();
  }, []);

  // Suggest the vendor location closest to the delivery location once both are
  // chosen. Advisory only — purely informational, nothing is stored on the PO.
  useEffect(() => {
    const { vendor_id, delivery_location_id } = form;
    if (!vendor_id || !delivery_location_id) { setNearest(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/inventory/vendors/${vendor_id}/addresses?nearest_to=${delivery_location_id}`
        );
        if (!res.ok) return;
        const json = await res.json();
        const top = (json.data || [])[0] ?? null;
        if (!cancelled) setNearest(top);
      } catch {
        /* non-fatal — suggestion is optional */
      }
    })();
    return () => { cancelled = true; };
  }, [form.vendor_id, form.delivery_location_id]);

  const loadData = async () => {
    try {
      const [vendorsData, locationsData, itemsData] = await Promise.all([
        SupplyChainRPC.getVendors(),
        InventoryRPC.getLocations({ active: true }),
        InventoryRPC.getCatalogItems({ active: true }),
      ]);
      setVendors(vendorsData);
      setLocations(locationsData);
      setItems(itemsData);

      // Prefill from query params (e.g. the "Create PO"/"Reorder" buttons on the
      // alerts and item pages pass item_id, qty, location_id, and vendor).
      const sp = new URLSearchParams(window.location.search);
      const itemId = sp.get('item_id');
      const qty = sp.get('qty');
      const locId = sp.get('location_id');
      const vendorParam = sp.get('vendor');

      setForm((prev) => ({
        ...prev,
        delivery_location_id:
          locId && locationsData.some((l) => l.id === locId) ? locId : prev.delivery_location_id,
        vendor_id:
          (vendorParam &&
            (vendorsData.find((v) => v.id === vendorParam) ??
              vendorsData.find((v) => v.code === vendorParam))?.id) ||
          prev.vendor_id,
      }));

      if (itemId && itemsData.some((i) => i.id === itemId)) {
        setLines([{ catalog_item_id: itemId, qty_ordered: qty ? parseFloat(qty) || 0 : 0, unit_cost: 0 }]);
      }
    } catch (err: any) {
      setError(`Failed to load data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const loadVariants = async (parentId: string) => {
    if (variantsByParent[parentId]) return; // already cached
    try {
      const variants = await InventoryRPC.getCatalogItems({
        active: true,
        parent_item_id: parentId,
        exclude_variants: false,
      });
      setVariantsByParent(prev => ({ ...prev, [parentId]: variants }));
    } catch (err: any) {
      console.error('Failed to load variants:', err);
    }
  };

  const handleItemSelect = (index: number, itemId: string) => {
    const item = items.find(i => i.id === itemId);
    if (item?.is_parent) {
      // Parent selected — store parent selection, clear catalog_item_id until variant is chosen
      setLineParentIds(prev => ({ ...prev, [index]: itemId }));
      updateLine(index, 'catalog_item_id', '');
      loadVariants(itemId);
    } else {
      // Standalone item — set directly
      setLineParentIds(prev => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
      updateLine(index, 'catalog_item_id', itemId);
    }
  };

  const addLine = () => {
    setLines([...lines, { catalog_item_id: '', qty_ordered: 0, unit_cost: 0 }]);
  };

  const removeLine = (index: number) => {
    setLines(lines.filter((_, i) => i !== index));
  };

  const updateLine = (index: number, field: keyof POLine, value: any) => {
    // Functional update so back-to-back calls in one handler don't clobber
    // each other (e.g. toggling free_text + clearing catalog_item_id).
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  };

  const calculateTotal = () => {
    return lines.reduce((sum, line) => sum + line.qty_ordered * line.unit_cost, 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess(false);

    // Punchout vendors open Amazon in a new tab. The tab must be opened
    // synchronously inside the click gesture or popup blockers kill it.
    const amazonTab = isPunchoutVendor ? window.open('about:blank', '_blank') : null;

    try {
      // Validate
      if (!form.vendor_id) {
        throw AppError.badRequest('Please select a vendor');
      }

      if (!form.delivery_location_id) {
        throw AppError.badRequest('Please select a delivery location');
      }

      const validLines = lines.filter((line) =>
        line.qty_ordered > 0 &&
        (line.free_text
          ? !!line.item_description?.trim() && !!line.uom_term_id
          : !!line.catalog_item_id) &&
        (requestQuote || line.unit_cost >= 0)
      );

      if (validLines.length === 0) {
        const hasFreeTextMissingUom = lines.some(
          (l) => l.free_text && l.item_description?.trim() && !l.uom_term_id && l.qty_ordered > 0
        );
        throw AppError.badRequest(
          hasFreeTextMissingUom
            ? 'Pick a unit of measure for your typed-in item(s)'
            : 'Please add at least one line item — pick from the vendor’s items or type your own'
        );
      }

      // Create PO using RPC. Quote mode: no prices, basis 'unknown' — the
      // vendor prices it, and the PO stays a draft until then.
      const result = await SupplyChainRPC.createPurchaseOrder({
        vendor_id: form.vendor_id,
        vendor_address_id: form.vendor_address_id || undefined,
        delivery_location_id: form.delivery_location_id,
        lines: validLines.map((l) => ({
          catalog_item_id: l.free_text ? undefined : l.catalog_item_id,
          item_description: l.free_text ? l.item_description?.trim() : undefined,
          uom_term_id: l.free_text ? l.uom_term_id : undefined,
          qty_ordered: l.qty_ordered,
          unit_cost: requestQuote ? undefined : l.unit_cost,
          price_basis: requestQuote ? ('unknown' as const) : ('fixed' as const),
        })),
        notes: form.notes || undefined,
      });

      // Punchout needs ASIN-mapped catalog lines and Amazon supplies the
      // prices — quote mode and free-text lines take the normal draft path.
      if (isPunchoutVendor && result?.po_id && !requestQuote && validLines.every((l) => !l.free_text)) {
        // Pick it and go: start the Amazon punchout with this PO's items and
        // send the user straight to Amazon. The purchasing page resumes the
        // session (waiting → review → submit) via the query params.
        try {
          const resp = await fetch('/api/settings/integrations/amazon-business/punchout/start', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Idempotency-Key': crypto.randomUUID(),
            },
            body: JSON.stringify({
              user_email: sessionEmail,
              location_id: form.delivery_location_id,
              catalog_items: validLines.map((l) => ({
                catalog_item_id: l.catalog_item_id,
                quantity: Math.max(1, Math.round(l.qty_ordered)),
              })),
            }),
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({} as any));
            throw AppError.internal(err.error?.message || err.error || `Punchout start failed (${resp.status})`);
          }
          const punchout = await resp.json();
          if (amazonTab) {
            amazonTab.location.href = punchout.data.redirect_url;
          } else {
            window.open(punchout.data.redirect_url, '_blank');
          }
          router.push(
            `/inventory/purchasing?punchout=${punchout.data.punchout_order_id}&po=${result.po_id}`
          );
          return;
        } catch (punchoutErr: any) {
          // The PO exists — don't lose that fact in the error message.
          amazonTab?.close();
          setError(
            `PO ${result.po_number || ''} was created, but the Amazon punchout could not start: ${punchoutErr.message}. Open it on the Purchasing page to order.`
          );
          return;
        }
      }

      amazonTab?.close();
      setSuccess(true);
      setTimeout(() => {
        router.push('/inventory/purchasing');
      }, 2000);
    } catch (err: any) {
      amazonTab?.close();
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="p-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-64"></div>
            <div className="h-64 bg-gray-200 rounded"></div>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <PageHeader
            backHref="/inventory/purchasing"
            title="Create Purchase Order"
            description="Add the vendor, delivery location, and line items, then create the order."
          />
        </div>

        {/* Success Message */}
        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
            <Check className="h-5 w-5 text-green-600" />
            <span className="text-green-800">
              Purchase Order created successfully! Redirecting...
            </span>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <span className="text-red-800">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* PO Header */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h2 className="text-lg font-semibold mb-4">Purchase Order Information</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Vendor *
                </label>
                <select
                  value={form.vendor_id}
                  onChange={(e) => setForm({ ...form, vendor_id: e.target.value, vendor_address_id: '' })}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select vendor...</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name} ({vendor.code ?? 'No code'})
                      {deliveryLocation?.preferred_vendor_id === vendor.id ? ' ★' : ''}
                    </option>
                  ))}
                </select>
                {deliveryLocation && form.vendor_id && (
                  deliveryLocation.preferred_vendor_id === form.vendor_id ? (
                    <p className="mt-1 text-xs text-amber-700">
                      ★ Preferred vendor for {deliveryLocation.name}
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={setPreferredForLocation}
                      disabled={savingPreferred}
                      className="mt-1 text-xs font-medium text-primary hover:underline disabled:opacity-50"
                    >
                      {savingPreferred ? 'Saving…' : `☆ Set as preferred vendor for ${deliveryLocation.name}`}
                    </button>
                  )
                )}
                {form.vendor_id && vendorBranches.length > 0 && (
                  <>
                    <label className="block text-sm font-medium text-gray-700 mb-1 mt-2">
                      Vendor Branch / Plant
                    </label>
                    <select
                      value={form.vendor_address_id}
                      onChange={(e) => setForm({ ...form, vendor_address_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Any location (company default pricing)</option>
                      {vendorBranches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.label?.split(' (')[0] || [b.city, b.state].filter(Boolean).join(', ') || b.id}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      Line prices prefill from this branch when it has its own pricing; otherwise the company default applies.
                    </p>
                  </>
                )}
                {nearest && (
                  <p className="mt-1 text-xs text-gray-600">
                    {nearest.distance_mi != null ? (
                      <>
                        Closest location:{' '}
                        <span className="font-medium">
                          {nearest.label || [nearest.city, nearest.state].filter(Boolean).join(', ') || 'vendor address'}
                        </span>{' '}
                        — {nearest.distance_mi.toFixed(1)} mi from delivery location
                      </>
                    ) : (
                      'Closest location unavailable — vendor addresses are not geocoded yet.'
                    )}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Delivery Location *
                </label>
                <select
                  value={form.delivery_location_id}
                  onChange={(e) =>
                    setForm({ ...form, delivery_location_id: e.target.value })
                  }
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select location...</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name} ({loc.location_type?.name || 'Location'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  placeholder="Optional notes..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* PO Lines */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Line Items</h2>
              <div className="flex items-center gap-4">
                {!isPunchoutVendor && (
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={requestQuote}
                      onChange={(e) => setRequestQuote(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Request pricing from vendor
                  </label>
                )}
                <button
                  type="button"
                  onClick={addLine}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Line
                </button>
              </div>
            </div>

            {requestQuote && (
              <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                Quantities only — no prices. The PO is created as a draft asking the vendor to
                quote each line; enter their prices on the PO once they respond.
              </div>
            )}

            <div className="space-y-3">
              {lines.map((line, index) => {
                const parentId = lineParentIds[index];
                const selectedItem = parentId
                  ? (variantsByParent[parentId] || []).find(v => v.id === line.catalog_item_id)
                  : items.find((i) => i.id === line.catalog_item_id);
                const lineTotal = line.qty_ordered * line.unit_cost;
                // For parent lines show the parent (with its photo) until a variant is picked.
                const parentItem = parentId ? items.find((i) => i.id === parentId) : undefined;
                const displayItem = parentItem || selectedItem;
                const displayImageId = parentId || line.catalog_item_id;

                return (
                  <div key={index} className="space-y-2">
                    <div className="flex gap-3 items-start">
                      <div className="flex-1 space-y-2">
                        {line.free_text ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={line.item_description || ''}
                              onChange={(e) => updateLine(index, 'item_description', e.target.value)}
                              placeholder="Describe what you want (e.g. 3/4 minus crushed rock)"
                              className="flex-1 px-3 py-2 border border-amber-300 bg-amber-50/40 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500"
                            />
                            <select
                              value={line.uom_term_id || ''}
                              onChange={(e) => updateLine(index, 'uom_term_id', e.target.value)}
                              className="w-32 px-2 py-2 border border-amber-300 bg-amber-50/40 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                            >
                              <option value="">Unit…</option>
                              {uomTerms.map((t) => (
                                <option key={t.term_id} value={t.term_id}>{t.label}</option>
                              ))}
                            </select>
                          </div>
                        ) : (
                        <button
                          type="button"
                          onClick={() => setPickerLineIndex(index)}
                          className="flex w-full items-center gap-3 rounded-md border border-gray-300 px-3 py-2 text-left transition-colors hover:border-blue-500 hover:bg-blue-50/40 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {displayItem ? (
                            <>
                              {imageMap[displayImageId] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={imageMap[displayImageId]}
                                  alt={displayItem.name}
                                  className="h-10 w-10 shrink-0 rounded border border-gray-200 object-cover"
                                />
                              ) : (
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-50">
                                  <Package className="h-5 w-5 text-gray-300" />
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-gray-900">
                                  {displayItem.name}
                                  {parentItem && ' — choose variant'}
                                </div>
                                <div className="truncate font-mono text-xs text-gray-500">{displayItem.sku}</div>
                              </div>
                              <span className="text-xs font-medium text-blue-600">Change</span>
                            </>
                          ) : (
                            <>
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50">
                                <Package className="h-5 w-5 text-gray-300" />
                              </div>
                              <span className="flex-1 text-sm text-gray-500">Choose item…</span>
                              <span className="text-xs font-medium text-blue-600">Browse</span>
                            </>
                          )}
                        </button>
                        )}

                        {/* Escape hatch: order something that isn't in the vendor's items */}
                        <button
                          type="button"
                          onClick={() => {
                            updateLine(index, 'free_text', !line.free_text);
                            if (!line.free_text) updateLine(index, 'catalog_item_id', '');
                          }}
                          className="text-xs font-medium text-gray-500 hover:text-gray-700 underline"
                        >
                          {line.free_text ? 'Pick from vendor items instead' : 'Can’t find it? Type your own item'}
                        </button>

                        {/* Variant sub-dropdown for parent items */}
                        {!line.free_text && parentId && (
                          <select
                            value={line.catalog_item_id}
                            onChange={(e) => updateLine(index, 'catalog_item_id', e.target.value)}
                            required
                            className="w-full px-3 py-2 border border-violet-300 rounded-md bg-violet-50 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                          >
                            <option value="">Select variant...</option>
                            {(variantsByParent[parentId] || []).map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name} ({v.sku})
                              </option>
                            ))}
                            {!variantsByParent[parentId] && (
                              <option value="" disabled>Loading variants...</option>
                            )}
                          </select>
                        )}
                      </div>

                      <div className="w-24">
                        <input
                          type="number"
                          value={line.qty_ordered || ''}
                          onChange={(e) =>
                            updateLine(
                              index,
                              'qty_ordered',
                              parseFloat(e.target.value) || 0
                            )
                          }
                          placeholder="Qty"
                          min="0"
                          step="0.01"
                          required
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div className="w-32">
                        {requestQuote ? (
                          <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-700 text-center">
                            Vendor quotes
                          </div>
                        ) : (
                          <input
                            type="number"
                            value={line.unit_cost || ''}
                            onChange={(e) =>
                              updateLine(index, 'unit_cost', parseFloat(e.target.value) || 0)
                            }
                            placeholder="Unit Cost"
                            min="0"
                            step="0.01"
                            required
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        )}
                      </div>

                      <div className="w-32">
                        <div className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-md text-sm font-medium text-right">
                          {requestQuote ? '—' : `$${lineTotal.toFixed(2)}`}
                        </div>
                      </div>

                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          className="px-3 py-2 text-red-600 hover:text-red-800"
                        >
                          ×
                        </button>
                      )}
                    </div>

                    {selectedItem && (
                      <div className="ml-0 text-sm text-gray-600">
                        Unit: {uomLabels[selectedItem.uom_term_id || ''] || selectedItem.uom_term_id || 'N/A'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Total */}
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex justify-between items-center">
                <span className="text-lg font-semibold text-gray-900">Total:</span>
                <span className="text-2xl font-bold text-blue-600">
                  {requestQuote ? 'Pending quote' : `$${calculateTotal().toFixed(2)}`}
                </span>
              </div>
            </div>
          </div>

          {/* Punchout vendors: explain the one-click handoff */}
          {isPunchoutVendor && (
            <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-800">
              <span className="font-semibold">{selectedVendor?.name}</span> is an integration vendor —
              creating this PO opens Amazon with your items in the cart. Check out there, then return
              to Summit One to confirm the order.
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting
                ? isPunchoutVendor && !requestQuote ? 'Opening Amazon...' : 'Creating...'
                : isPunchoutVendor && !requestQuote ? 'Create & Shop on Amazon'
                : requestQuote ? 'Create & Request Pricing' : 'Create Purchase Order'}
            </button>
          </div>
        </form>
      </div>

      <ItemPickerModal
        open={pickerLineIndex !== null}
        onClose={() => setPickerLineIndex(null)}
        items={pickerItems}
        imageMap={imageMap}
        uomLabels={uomLabels}
        emptyMessage={
          !form.vendor_id
            ? 'Choose a vendor above to see the items they supply.'
            : 'This vendor has no linked items yet. Add them on the vendor’s Items page.'
        }
        selectedIds={[
          ...lines.map((l) => l.catalog_item_id).filter(Boolean),
          ...Object.values(lineParentIds).filter(Boolean),
        ]}
        onSelect={(item) => {
          if (pickerLineIndex !== null) {
            handleItemSelect(pickerLineIndex, item.id);
            const cost = vendorCostByItem.get(item.id);
            if (cost != null) updateLine(pickerLineIndex, 'unit_cost', cost);
          }
          setPickerLineIndex(null);
        }}
      />
    </AppShell>
  );
}
