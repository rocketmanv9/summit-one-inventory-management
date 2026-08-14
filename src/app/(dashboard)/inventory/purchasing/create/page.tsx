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
import { POEmailPreviewModal } from '@/components/modals/POEmailPreviewModal';
import { useOrderContext, formatHint, computeFlags } from '@/components/purchasing/useOrderContext';
import { AmazonLinkPaste, type AmazonApplyPayload } from '@/components/purchasing/AmazonLinkPaste';
import { Plus, AlertCircle, Check, Package, MapPin, Tag, PackageCheck, ArrowLeftRight, ClipboardList, X, Mail, Loader2, Link2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActiveLocation } from '@/lib/active-location';

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
  const { defaultLocationId, activeLocation, locations: activeLocations } = useActiveLocation();
  // "Request quote": order quantities with no prices — the vendor fills them
  // in. Lines post with price_basis 'unknown', which blocks auto-approve, so
  // the PO lands as a draft awaiting the vendor's pricing.
  const [requestQuote, setRequestQuote] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [pageLocations, setPageLocations] = useState<Location[]>([]);
  // Fall back to the app-wide active-location list so the delivery-location
  // dropdown (and its active-location default) still populate even if this
  // page's own bulk load fails partway. Preferred-vendor niceties only apply
  // to the page's richer rows, which is fine — the fallback rows just deliver.
  const locations: Location[] = pageLocations.length > 0
    ? pageLocations
    : activeLocations.map((l) => ({ id: l.id, name: l.name, location_type: l.location_type_name ? { name: l.location_type_name } : null }));
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  // Names of items auto-added to the vendor's catalog on this save — shown as a
  // small confirmation so the order-any-item side effect is visible, not silent.
  const [linkedItemNames, setLinkedItemNames] = useState<string[]>([]);
  // Fleet shop-request → PO handoff (item 16 fleet half). Set only when the page
  // was opened with ?source=fleet_shop_request&source_ref=<fleet request id>.
  // Non-fleet prefills leave this null so their path is byte-for-byte unchanged.
  // On draft-create we post the drafted PO's number back to fleet so the shop
  // request's "PO drafting…" chip flips to the real number.
  const [fleetSourceRef, setFleetSourceRef] = useState<string | null>(null);
  // Nearest of the selected vendor's locations to the chosen delivery location.
  const [nearest, setNearest] = useState<{
    label: string | null; city: string | null; state: string | null; distance_mi: number | null;
  } | null>(null);
  // Resolved delivery/pickup address shown under the picker — the exact block
  // the vendor sees on the PDF/email. For a tenant location it walks up to the
  // parent's address when the location has none of its own (sub-bin inheritance),
  // resolved server-side via the shared resolveLocationAddress helper.
  const [addressPreview, setAddressPreview] = useState<{ name: string | null; address: string | null } | null>(null);

  // No po_number or expected-delivery inputs: the system generates PO numbers,
  // and a delivery date isn't knowable at order time — it gets set on the PO
  // later (vendor confirmation / shipment).
  const [form, setForm] = useState({
    vendor_id: '',
    vendor_address_id: '', // '' = company-wide default pricing
    // 'ship' → delivered to a tenant location; 'pickup' → will-call. Schema
    // default is 'ship'.
    delivery_method: 'ship' as 'ship' | 'pickup',
    delivery_location_id: '',
    // For pickup: '' means pick up from the vendor's address; a location id means
    // an on-site will-call at one of the tenant's own locations.
    pickup_location_id: '',
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
        setPageLocations((prev) => prev.map((l) =>
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
  // Also the source of the pickup address when a PO is picked up from the vendor.
  const [vendorBranches, setVendorBranches] = useState<
    Array<{
      id: string; label: string | null; address_type?: string | null;
      street1?: string | null; street2?: string | null;
      city: string | null; state: string | null; zip?: string | null;
    }>
  >([]);

  const [lines, setLines] = useState<POLine[]>([
    { catalog_item_id: '', qty_ordered: 0, unit_cost: 0 },
  ]);

  // "Preview email" saves the order as a draft (POs persist as drafts before
  // send) and opens the read-only vendor-email preview. We remember the draft's
  // id and a signature of the exact form/lines it was saved from, so a follow-up
  // "Create Purchase Order" reuses that draft instead of creating a duplicate.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSaving, setPreviewSaving] = useState(false);
  const [draftPo, setDraftPo] = useState<{ id: string; number: string | null; sig: string } | null>(null);

  // Price hints (last paid / catalog list) + the best-vendor suggestion for the
  // prefill. Qty-first entry keeps unit cost tucked away, so each line tracks
  // whether the (optional) price field is being shown.
  const { hints, suggestedVendor, fetchContext } = useOrderContext();
  const [showPriceFor, setShowPriceFor] = useState<Record<number, boolean>>({});
  // Smart flags (already on hand / surplus elsewhere / on order) are advisory
  // and per-line dismissible — keyed by line index + flag kind.
  const [dismissedFlags, setDismissedFlags] = useState<Record<string, boolean>>({});

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

  // Re-pull the vendor's items after something links a NEW one mid-compose
  // (paste-an-Amazon-link). Without this the just-mapped item stays absent from
  // the punchout picker until a page reload. Failures are silent — the line is
  // already filled; this only refreshes the picker/"Carried" badges.
  const refreshVendorItems = async () => {
    if (!form.vendor_id) return;
    try {
      setVendorItemRows(await SupplyChainRPC.getVendorItemsWithCatalog(form.vendor_id));
    } catch {
      /* picker stays as-is */
    }
  };

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

  // The set of catalog-item IDs the selected vendor already carries — drives
  // the "Carried" badge in the all-catalog picker and the auto-link decision on
  // save (an item NOT in this set gets linked to the vendor when the PO saves).
  const vendorItemIdSet = useMemo(
    () => new Set(vendorItemRows.map((r) => r.catalog_item_id)),
    [vendorItemRows],
  );

  // Full-catalog picker list for "All items" mode: every active parent/standalone
  // catalog item (the same `items` already loaded for enrichment). Non-punchout
  // only — punchout keeps its vendor-linked-only picker.
  const allPickerItems = useMemo(
    () =>
      items.map((i) => ({
        id: i.id,
        name: i.name,
        sku: i.sku,
        description: i.description ?? null,
        uom_term_id: i.uom_term_id ?? null,
        is_parent: i.is_parent,
      })),
    [items],
  );

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Belt-and-suspenders: if the active location resolves *after* loadData ran
  // (it loads async), seed the delivery location from it — but only while the
  // field is still blank, so we never overwrite a URL param or a user's pick.
  const deliverySeeded = useRef(false);
  useEffect(() => {
    if (deliverySeeded.current) return;
    if (!defaultLocationId) return;
    if (form.delivery_location_id) { deliverySeeded.current = true; return; }
    if (!locations.some((l) => l.id === defaultLocationId)) return;
    deliverySeeded.current = true;
    setForm((prev) => (prev.delivery_location_id ? prev : { ...prev, delivery_location_id: defaultLocationId }));
  }, [defaultLocationId, locations, form.delivery_location_id]);

  // Load price hints for every catalog item currently on a line, plus the
  // best-vendor suggestion for the chosen delivery location. Batched + cached
  // in the hook, so this fires cheaply as lines and location change.
  const lineItemIdsKey = lines.map((l) => l.catalog_item_id).filter(Boolean).sort().join(',');
  useEffect(() => {
    const ids = lines.map((l) => l.catalog_item_id).filter(Boolean);
    if (ids.length === 0) return;
    fetchContext(ids, form.delivery_location_id || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineItemIdsKey, form.delivery_location_id]);

  // Apply the suggested vendor to the prefill — but only while no vendor is
  // chosen yet, so it never clobbers a user's (or a ?vendor= param's) pick. The
  // per-yard preferred-vendor effect above still wins once a location is set;
  // this covers the "arrived via order-more, no location preference" case.
  const vendorSuggested = useRef(false);
  useEffect(() => {
    if (vendorSuggested.current) return;
    if (!suggestedVendor) return;
    if (form.vendor_id) { vendorSuggested.current = true; return; }
    if (!vendors.some((v) => v.id === suggestedVendor.vendor_id)) return;
    vendorSuggested.current = true;
    setForm((prev) => (prev.vendor_id ? prev : { ...prev, vendor_id: suggestedVendor.vendor_id, vendor_address_id: '' }));
  }, [suggestedVendor, vendors, form.vendor_id]);

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

  // The vendor's pickup address = an address_type 'pickup' row if present, else
  // the vendor's first address on file. Mirrors the server (po-context) so the
  // UI preview matches the PDF for a vendor-pickup PO.
  const vendorPickupBranch = useMemo(() => {
    if (vendorBranches.length === 0) return null;
    return vendorBranches.find((b) => b.address_type === 'pickup') ?? vendorBranches[0];
  }, [vendorBranches]);

  const formatBranchAddress = (b: {
    street1?: string | null; street2?: string | null; city: string | null; state: string | null; zip?: string | null;
  } | null): string | null => {
    if (!b) return null;
    const line1 = [b.street1, b.street2].filter(Boolean).join(', ');
    const line2 = [b.city, b.state, b.zip].filter(Boolean).join(' ');
    return [line1, line2].filter(Boolean).join('\n') || null;
  };

  // Resolve the address shown under the delivery/pickup picker. Delivery and
  // on-site pickup resolve the tenant location server-side (parent inheritance);
  // vendor pickup uses the vendor's own address, formatted client-side.
  useEffect(() => {
    let cancelled = false;
    const locId =
      form.delivery_method === 'ship'
        ? form.delivery_location_id
        : form.pickup_location_id;

    // Vendor pickup (no tenant will-call location chosen): show the vendor addr.
    if (form.delivery_method === 'pickup' && !form.pickup_location_id) {
      setAddressPreview(
        vendorPickupBranch
          ? {
              name: vendorPickupBranch.label?.split(' (')[0] || selectedVendor?.name || null,
              address: formatBranchAddress(vendorPickupBranch),
            }
          : null,
      );
      return;
    }

    if (!locId) { setAddressPreview(null); return; }
    (async () => {
      try {
        const res = await fetch(`/api/inventory/locations/${locId}/resolved-address`);
        if (!res.ok) { if (!cancelled) setAddressPreview(null); return; }
        const json = await res.json();
        if (!cancelled) setAddressPreview(json.data ?? null);
      } catch {
        if (!cancelled) setAddressPreview(null);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.delivery_method, form.delivery_location_id, form.pickup_location_id, vendorPickupBranch]);

  const loadData = async () => {
    try {
      // Settle each load independently: a single failing source (e.g. the
      // catalog-items query 500ing on an environment missing a column) must not
      // blank the whole form — vendor + delivery-location entry should still
      // work, and the item picker just shows "no items". Mirrors the existing
      // locations fallback below.
      const [vendorsRes, locationsRes, itemsRes] = await Promise.allSettled([
        SupplyChainRPC.getVendors(),
        InventoryRPC.getLocations({ active: true }),
        InventoryRPC.getCatalogItems({ active: true }),
      ]);
      const vendorsData = vendorsRes.status === 'fulfilled' ? vendorsRes.value : [];
      const locationsData = locationsRes.status === 'fulfilled' ? locationsRes.value : [];
      const itemsData = itemsRes.status === 'fulfilled' ? itemsRes.value : [];
      setVendors(vendorsData);
      setPageLocations(locationsData);
      setItems(itemsData);

      // Surface a soft warning when a source failed, but keep the form usable.
      const failed = [
        vendorsRes.status === 'rejected' ? 'vendors' : null,
        locationsRes.status === 'rejected' ? 'locations' : null,
        itemsRes.status === 'rejected' ? 'items' : null,
      ].filter(Boolean);
      if (failed.length > 0) {
        setError(`Some data could not be loaded (${failed.join(', ')}). You can still fill in what did load.`);
      }

      // Prefill from query params (e.g. the "Create PO"/"Reorder" buttons on the
      // alerts and item pages pass item_id, qty, location_id, and vendor).
      const sp = new URLSearchParams(window.location.search);
      const itemId = sp.get('item_id');
      const qty = sp.get('qty');
      const locId = sp.get('location_id');
      const vendorParam = sp.get('vendor');

      // Delivery location defaults to: an explicit ?location_id= (from an
      // alert/reorder link), else the app-wide active location, else blank.
      // Editing it here is local to this PO — it never changes the active location.
      const seededLocation =
        locId && locationsData.some((l) => l.id === locId)
          ? locId
          : defaultLocationId && locationsData.some((l) => l.id === defaultLocationId)
            ? defaultLocationId
            : '';

      setForm((prev) => ({
        ...prev,
        delivery_location_id: seededLocation || prev.delivery_location_id,
        vendor_id:
          (vendorParam &&
            (vendorsData.find((v) => v.id === vendorParam) ??
              vendorsData.find((v) => v.code === vendorParam))?.id) ||
          prev.vendor_id,
      }));

      if (itemId && itemsData.some((i) => i.id === itemId)) {
        setLines([{ catalog_item_id: itemId, qty_ordered: qty ? parseFloat(qty) || 0 : 0, unit_cost: 0 }]);
      }

      // Fleet shop-request handoff (item 16). Guarded on source so the item_id /
      // reorder prefill above is untouched for every other caller. Fleet redirects
      // to ?source=fleet_shop_request&source_ref=<uuid>&notes=<text>&location_id=
      // <inv-loc>&lines=<base64 JSON of [{desc, qty}]>. location_id is already
      // consumed by the seededLocation logic above — we only add lines + notes here.
      if (sp.get('source') === 'fleet_shop_request') {
        const sourceRef = sp.get('source_ref');
        if (sourceRef) setFleetSourceRef(sourceRef);

        const linesParam = sp.get('lines');
        if (linesParam) {
          try {
            const parsed = JSON.parse(atob(linesParam)) as Array<{ desc?: string; qty?: number }>;
            const seeded: POLine[] = parsed
              .filter((l) => l && typeof l.desc === 'string' && l.desc.trim())
              .map((l) => ({
                catalog_item_id: '',
                free_text: true,
                item_description: l.desc!.trim(),
                qty_ordered: typeof l.qty === 'number' && l.qty > 0 ? l.qty : 1,
                unit_cost: 0,
              }));
            // Only replace the default empty line when we actually decoded lines —
            // a malformed/empty payload leaves the normal blank editor in place.
            if (seeded.length > 0) setLines(seeded);
          } catch {
            // Malformed base64/JSON: fall back to the blank editor. The notes below
            // and the source-ref post-back still apply so the request can be filled
            // in by hand and still stamped back to fleet on create.
          }
        }

        const notes = sp.get('notes');
        if (notes) setForm((prev) => ({ ...prev, notes: notes || prev.notes }));
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

  // ── Paste an Amazon link (item 05) ─────────────────────────────────────────
  // Which line has the paste panel open, and the one-line receipt shown on a
  // line after a link was applied (so the buyer can see WHAT just happened).
  const [amazonLineIndex, setAmazonLineIndex] = useState<number | null>(null);
  const [amazonNotes, setAmazonNotes] = useState<Record<number, string>>({});

  // A one-off Amazon line still needs a unit to post. Amazon sells "each", so
  // default it there when GV has that term — the buyer can still change it.
  const eachUomTermId = useMemo(
    () => uomTerms.find((t) => /^(each|ea|eaches)$/i.test(t.label.trim()))?.term_id ?? '',
    [uomTerms],
  );

  const applyAmazonResult = (index: number, payload: AmazonApplyPayload) => {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        const next: POLine = { ...l };
        if (payload.catalogItemId) {
          // Mapped to a real catalog item — this becomes an ordinary priced line.
          next.catalog_item_id = payload.catalogItemId;
          next.free_text = false;
          next.item_description = undefined;
          next.uom_term_id = undefined;
        } else {
          // One-off: description + cost only. No catalog row is invented.
          next.free_text = true;
          next.catalog_item_id = '';
          next.item_description = payload.description;
          next.uom_term_id = l.uom_term_id || eachUomTermId || undefined;
        }
        if (payload.unitCost != null && payload.unitCost > 0) next.unit_cost = payload.unitCost;
        if (!(next.qty_ordered > 0)) next.qty_ordered = 1;
        return next;
      }),
    );

    if (payload.catalogItemId) {
      // Drop any half-finished parent/variant selection on this line.
      setLineParentIds((prev) => {
        const nextIds = { ...prev };
        delete nextIds[index];
        return nextIds;
      });
      // The mapping created a vendor_items row — pull it in so the picker and
      // the "Carried" badge agree with reality.
      void refreshVendorItems();
    }
    if (payload.unitCost != null && payload.unitCost > 0) {
      setShowPriceFor((prev) => ({ ...prev, [index]: true }));
    }
    setAmazonNotes((prev) => ({
      ...prev,
      [index]: payload.mapped
        ? `Mapped to ASIN ${payload.asin}${payload.unitCost != null ? ` at $${payload.unitCost.toFixed(2)}` : ' (enter the price yourself)'}.`
        : `One-off Amazon line — ASIN ${payload.asin} was NOT saved as a mapping.`,
    }));
    setAmazonLineIndex(null);
  };

  const calculateTotal = () => {
    return lines.reduce((sum, line) => sum + line.qty_ordered * line.unit_cost, 0);
  };

  // Shared validation + line normalization, used by both create and preview so
  // the drafted PO the preview renders is byte-for-byte what create would post.
  // Throws AppError on invalid input (caller sets the error banner).
  const buildValidLines = () => {
    if (!form.vendor_id) {
      throw AppError.badRequest('Please select a vendor');
    }
    if (form.delivery_method === 'ship' && !form.delivery_location_id) {
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
    return validLines;
  };

  // Create PO using RPC. Two ways a line ends up unpriced (basis 'unknown',
  // which blocks auto-approve so the PO waits for real numbers): the global
  // "request pricing" toggle, or — with qty-first entry — simply leaving a
  // line's optional cost blank. A positive cost posts as 'fixed'.
  const createDraftPO = async (validLines: POLine[]) =>
    SupplyChainRPC.createPurchaseOrder({
      vendor_id: form.vendor_id,
      vendor_address_id: form.vendor_address_id || undefined,
      delivery_method: form.delivery_method,
      // Delivery persists the drop-off location; pickup persists the (optional)
      // tenant will-call location — a blank pickup location means picking up
      // from the vendor's own address.
      delivery_location_id: form.delivery_method === 'ship' ? form.delivery_location_id : undefined,
      pickup_location_id: form.delivery_method === 'pickup' ? (form.pickup_location_id || undefined) : undefined,
      lines: validLines.map((l) => {
        const unpriced = requestQuote || !(l.unit_cost > 0);
        return {
          catalog_item_id: l.free_text ? undefined : l.catalog_item_id,
          item_description: l.free_text ? l.item_description?.trim() : undefined,
          uom_term_id: l.free_text ? l.uom_term_id : undefined,
          qty_ordered: l.qty_ordered,
          unit_cost: unpriced ? undefined : l.unit_cost,
          price_basis: unpriced ? ('unknown' as const) : ('fixed' as const),
        };
      }),
      notes: form.notes || undefined,
    });

  // Order-any-item: after the PO saves, link any catalog item on it that this
  // vendor doesn't already carry, seeding the vendor's price from the line's
  // entered cost (null if left blank — being orderable is the point). Idempotent
  // (the route upserts on the natural key), company-wide (vendor_address_id null),
  // never preferred. Punchout vendors are excluded — they stay catalog-only.
  // Best-effort: a link failure must not fail the just-created PO.
  const autoLinkVendorItems = async (validLines: POLine[]) => {
    if (isPunchoutVendor || !form.vendor_id) return;
    const seen = new Set<string>();
    const toLink = validLines.filter((l) => {
      if (l.free_text || !l.catalog_item_id) return false;
      if (vendorItemIdSet.has(l.catalog_item_id)) return false;
      if (seen.has(l.catalog_item_id)) return false;
      seen.add(l.catalog_item_id);
      return true;
    });
    if (toLink.length === 0) return;

    const linkedNames: string[] = [];
    for (const l of toLink) {
      try {
        await SupplyChainRPC.createVendorItem({
          vendor_id: form.vendor_id,
          catalog_item_id: l.catalog_item_id,
          vendor_sku: '',
          vendor_address_id: null,
          unit_cost: l.unit_cost > 0 ? l.unit_cost : null,
          is_preferred: false,
        });
        const name = items.find((i) => i.id === l.catalog_item_id)?.name;
        linkedNames.push(name || 'Item');
      } catch {
        // Non-fatal: the PO is already saved. The link can be added later on the
        // vendor's Items page; we just skip the confirmation for this one.
      }
    }
    if (linkedNames.length > 0) setLinkedItemNames(linkedNames);
  };

  // Signature of the exact inputs a draft was saved from — lets a saved-draft
  // preview be reused by Create (and invalidates it the moment anything changes).
  const orderSignature = useMemo(
    () => JSON.stringify({ v: form.vendor_id, a: form.vendor_address_id, m: form.delivery_method, d: form.delivery_location_id, p: form.pickup_location_id, n: form.notes, q: requestQuote, lines }),
    [form.vendor_id, form.vendor_address_id, form.delivery_method, form.delivery_location_id, form.pickup_location_id, form.notes, requestQuote, lines],
  );
  // A previously saved draft is only reusable if the order is unchanged since.
  const reusableDraft = draftPo && draftPo.sig === orderSignature ? draftPo : null;

  // "Preview email": save the order as a draft (or reuse the matching one) and
  // open the read-only vendor-email preview. Never sends. Not offered for
  // punchout vendors (Amazon supplies pricing and there is no vendor email).
  const handlePreview = async () => {
    setError('');
    if (previewSaving) return;
    if (reusableDraft) { setPreviewOpen(true); return; }
    setPreviewSaving(true);
    try {
      const validLines = buildValidLines();
      const result = await createDraftPO(validLines);
      if (!result?.po_id) throw AppError.internal('Could not save the draft to preview.');
      setDraftPo({ id: result.po_id, number: result.po_number ?? null, sig: orderSignature });
      setPreviewOpen(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPreviewSaving(false);
    }
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
      const validLines = buildValidLines();

      // Reuse the draft the preview already saved (when the order is unchanged),
      // otherwise create it now. Punchout always creates fresh — it needs the
      // punchout handoff below, which the preview path never runs.
      const result = !isPunchoutVendor && reusableDraft
        ? { po_id: reusableDraft.id, po_number: reusableDraft.number }
        : await createDraftPO(validLines);

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

      // Non-punchout drafts: make every ordered item orderable from this vendor
      // going forward by linking any it doesn't already carry (price-seeded).
      // Runs before the redirect so the confirmation shows; best-effort inside.
      if (result?.po_id) {
        await autoLinkVendorItems(validLines);
      }

      // Fleet shop-request post-back: if this PO came from a fleet shop request
      // (source=fleet_shop_request), tell fleet the draft's number so its board
      // chip flips from "PO drafting…" to the real number. Best-effort — the PO
      // is already saved; a failed post-back must never fail the create.
      if (result?.po_id && fleetSourceRef) {
        try {
          await fetch('/api/fleet-callback/shop-request-po', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Idempotency-Key': crypto.randomUUID(),
            },
            body: JSON.stringify({
              source_ref: fleetSourceRef,
              po_id: result.po_id,
              po_number: result.po_number ?? null,
            }),
          });
        } catch {
          // Non-fatal: the draft exists; the chip flip can be retried later.
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
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-2">
            <Check className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
            <div className="text-green-800">
              <div>Purchase Order created successfully! Redirecting...</div>
              {linkedItemNames.length > 0 && (
                <div className="mt-1 text-sm text-green-700">
                  Added {linkedItemNames.length === 1
                    ? `${linkedItemNames[0]} to ${selectedVendor?.name || 'the vendor'}'s catalog`
                    : `${linkedItemNames.length} items to ${selectedVendor?.name || 'the vendor'}'s catalog`} — orderable from them next time.
                </div>
              )}
            </div>
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
                {/* Delivery vs Pickup — the vendor either ships to a yard or the
                    crew picks it up. Drives the SHIP TO / PICKUP AT block on the
                    PO. Defaults to Delivery (schema default 'ship'). */}
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Fulfillment *
                </label>
                <div className="mb-3 inline-flex rounded-md border border-gray-300 p-0.5 bg-gray-50">
                  {(['ship', 'pickup'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, delivery_method: m }))}
                      className={`px-4 py-1.5 text-sm font-medium rounded transition-colors ${
                        form.delivery_method === m
                          ? 'bg-white text-blue-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {m === 'ship' ? 'Delivery' : 'Pickup'}
                    </button>
                  ))}
                </div>

                {form.delivery_method === 'ship' ? (
                  <>
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
                    {activeLocation && form.delivery_location_id === activeLocation.id ? (
                      <p className="mt-1 flex items-center gap-1 text-xs text-primary">
                        <MapPin className="h-3 w-3" />
                        Defaulted to your active location ({activeLocation.name}). Change it here without affecting the rest of the app.
                      </p>
                    ) : activeLocation ? (
                      <p className="mt-1 text-xs text-gray-500">
                        Your active location is {activeLocation.name} — delivering elsewhere on this PO won&apos;t change it.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Pickup Location
                    </label>
                    <select
                      value={form.pickup_location_id}
                      onChange={(e) => setForm({ ...form, pickup_location_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">
                        {vendorPickupBranch
                          ? `Pick up from ${selectedVendor?.name || 'the vendor'}`
                          : selectedVendor
                            ? `${selectedVendor.name} (no address on file)`
                            : 'Pick up from the vendor'}
                      </option>
                      {locations.map((loc) => (
                        <option key={loc.id} value={loc.id}>
                          Will-call at {loc.name} ({loc.location_type?.name || 'Location'})
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      Leave on the vendor to pick up at their counter/plant, or choose one of your locations for on-site will-call.
                    </p>
                  </>
                )}

                {/* Resolved address preview — exactly what the vendor sees on the
                    PDF/email. Sub-bins show their parent yard's inherited address. */}
                {(addressPreview?.name || addressPreview?.address) && (
                  <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
                    <div className="mb-0.5 font-semibold uppercase tracking-wide text-gray-500">
                      {form.delivery_method === 'ship' ? 'Ship to' : 'Pickup at'}
                    </div>
                    {addressPreview.name && <div className="font-medium text-gray-800">{addressPreview.name}</div>}
                    {addressPreview.address ? (
                      addressPreview.address.split('\n').map((ln, i) => (
                        <div key={i} className="text-gray-600">{ln}</div>
                      ))
                    ) : (
                      <div className="text-amber-600">No address on file — add one so the vendor knows where to go.</div>
                    )}
                  </div>
                )}
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
                // Show the cost field once asked for, or when the line already
                // carries a price (e.g. the picker prefilled the vendor's cost).
                const priceShown = !!showPriceFor[index] || line.unit_cost > 0;
                // Honest price hint for this line's item (last paid / catalog / none).
                const hint = formatHint(hints[line.catalog_item_id], {
                  selectedVendorName: selectedVendor?.name ?? null,
                });
                // Smart flags: don't buy what the company already has. Advisory
                // only — never blocks submit. Free-text lines have no item to
                // flag. Filter out any the user dismissed on this line.
                const smartFlags = line.free_text || !line.catalog_item_id
                  ? []
                  : computeFlags(hints[line.catalog_item_id], {
                      destinationLocationId: form.delivery_location_id || null,
                      qtyOrdered: line.qty_ordered,
                    }).filter((f) => !dismissedFlags[`${index}:${f.kind}`]);
                // Paste-an-Amazon-link (item 05) is offered when the vendor IS
                // Amazon, or when this line's item has no mapping to the chosen
                // vendor yet — exactly the moments a buyer would otherwise have
                // to detour to Settings → Integrations.
                const amazonOffered =
                  isPunchoutVendor ||
                  (!line.free_text && !!line.catalog_item_id && !vendorItemIdSet.has(line.catalog_item_id));

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

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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

                          {/* No Amazon mapping yet? Paste the product link right here. */}
                          {amazonOffered && (
                            <button
                              type="button"
                              onClick={() => setAmazonLineIndex(amazonLineIndex === index ? null : index)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 underline hover:text-orange-900"
                            >
                              <Link2 className="h-3 w-3" />
                              {amazonLineIndex === index ? 'Hide Amazon link' : 'Paste Amazon link'}
                            </button>
                          )}
                        </div>

                        {amazonLineIndex === index && (
                          <AmazonLinkPaste
                            catalogItemId={line.free_text ? null : line.catalog_item_id || null}
                            catalogItemLabel={displayItem ? `${displayItem.name} (${displayItem.sku})` : null}
                            catalogItems={items.map((i) => ({ id: i.id, name: i.name, sku: i.sku }))}
                            onApply={(payload) => applyAmazonResult(index, payload)}
                            onClose={() => setAmazonLineIndex(null)}
                          />
                        )}

                        {amazonNotes[index] && (
                          <div className="flex items-start gap-1.5 rounded border border-orange-200 bg-orange-50 px-2 py-1 text-xs text-orange-800">
                            <Link2 className="mt-0.5 h-3 w-3 shrink-0" />
                            <span className="flex-1">{amazonNotes[index]}</span>
                            <button
                              type="button"
                              onClick={() => setAmazonNotes((prev) => {
                                const next = { ...prev };
                                delete next[index];
                                return next;
                              })}
                              className="font-medium text-orange-600 hover:text-orange-900"
                              aria-label="Dismiss Amazon note"
                            >
                              ×
                            </button>
                          </div>
                        )}

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

                      {/* Qty leads. Unit cost is optional and de-emphasized —
                          it only appears once the person asks for it (or the
                          line already has a price). Blank cost is fine: the line
                          posts unpriced (request-pricing). */}
                      <div className="w-28">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Qty</label>
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
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div className="w-32">
                        {requestQuote ? (
                          <>
                            <label className="block text-xs font-medium text-gray-400 mb-1">Unit cost</label>
                            <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-700 text-center">
                              Vendor quotes
                            </div>
                          </>
                        ) : priceShown ? (
                          <>
                            <label className="block text-xs font-medium text-gray-400 mb-1">
                              Unit cost <span className="font-normal">(optional)</span>
                            </label>
                            <input
                              type="number"
                              value={line.unit_cost || ''}
                              onChange={(e) =>
                                updateLine(index, 'unit_cost', parseFloat(e.target.value) || 0)
                              }
                              placeholder="Leave blank to ask vendor"
                              min="0"
                              step="0.01"
                              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </>
                        ) : (
                          <>
                            <label className="block text-xs font-medium text-gray-400 mb-1">&nbsp;</label>
                            <button
                              type="button"
                              onClick={() => setShowPriceFor((prev) => ({ ...prev, [index]: true }))}
                              className="w-full px-3 py-2 border border-dashed border-gray-300 rounded-md text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600"
                            >
                              + Add price
                            </button>
                          </>
                        )}
                      </div>

                      <div className="w-28">
                        <label className="block text-xs font-medium text-gray-400 mb-1">Line total</label>
                        <div className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-md text-sm font-medium text-right">
                          {requestQuote || !(line.unit_cost > 0) ? '—' : `$${lineTotal.toFixed(2)}`}
                        </div>
                      </div>

                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          className="mt-6 px-3 py-2 text-red-600 hover:text-red-800"
                        >
                          ×
                        </button>
                      )}
                    </div>

                    {/* Unit-of-measure + honest price hint sit under the line. */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      {selectedItem && (
                        <span className="text-gray-600">
                          Unit: {uomLabels[selectedItem.uom_term_id || ''] || selectedItem.uom_term_id || 'N/A'}
                        </span>
                      )}
                      {!requestQuote && (
                        line.free_text ? (
                          <span className="inline-flex items-center gap-1 text-gray-400">
                            <Tag className="h-3 w-3" /> Custom line — no history
                          </span>
                        ) : line.catalog_item_id ? (
                          <span className="inline-flex items-center gap-1 text-gray-500">
                            <Tag className="h-3 w-3 text-gray-400" />
                            {hint.text}
                            {hint.price != null && (
                              <button
                                type="button"
                                onClick={() => {
                                  setShowPriceFor((prev) => ({ ...prev, [index]: true }));
                                  updateLine(index, 'unit_cost', hint.price!);
                                }}
                                className="font-medium text-blue-600 hover:underline"
                              >
                                Use this price
                              </button>
                            )}
                          </span>
                        ) : null
                      )}
                    </div>

                    {/* Smart flags: already-on-hand / surplus-elsewhere / on-order.
                        Advisory, compact, dismissible — never block submit. */}
                    {smartFlags.length > 0 && (
                      <div className="space-y-1">
                        {smartFlags.map((flag) => {
                          const tone =
                            flag.kind === 'on_hand'
                              ? 'border-amber-200 bg-amber-50 text-amber-800'
                              : flag.kind === 'surplus'
                                ? 'border-blue-200 bg-blue-50 text-blue-800'
                                : 'border-violet-200 bg-violet-50 text-violet-800';
                          const Icon =
                            flag.kind === 'on_hand' ? PackageCheck
                              : flag.kind === 'surplus' ? ArrowLeftRight
                                : ClipboardList;
                          return (
                            <div
                              key={flag.kind}
                              className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs ${tone}`}
                            >
                              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span className="flex-1">{flag.text}</span>
                              {flag.kind === 'surplus' && flag.transfer && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const params = new URLSearchParams({
                                      create: '1',
                                      from: flag.transfer!.fromLocationId,
                                      to: flag.transfer!.toLocationId,
                                      item: line.catalog_item_id,
                                      qty: String(flag.transfer!.qty),
                                    });
                                    router.push(`/inventory/transfers?${params.toString()}`);
                                  }}
                                  className="shrink-0 font-medium text-blue-700 hover:underline"
                                >
                                  Start transfer
                                </button>
                              )}
                              {flag.kind === 'on_order' && flag.poId && (
                                <a
                                  href={`/inventory/purchasing?po=${flag.poId}`}
                                  className="shrink-0 font-medium text-violet-700 hover:underline"
                                >
                                  View PO
                                </a>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setDismissedFlags((prev) => ({ ...prev, [`${index}:${flag.kind}`]: true }))
                                }
                                className="shrink-0 opacity-60 hover:opacity-100"
                                aria-label="Dismiss"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          );
                        })}
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

          {/* Preview the vendor email before creating — email vendors only.
              Punchout vendors order through Amazon, so there's no vendor email
              to preview; the note above explains the Amazon handoff. */}
          {!isPunchoutVendor && (
            <div>
              <button
                type="button"
                onClick={handlePreview}
                disabled={previewSaving || submitting}
                className="inline-flex items-center gap-2 text-sm font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {previewSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {previewSaving ? 'Saving draft…' : 'Preview vendor email'}
              </button>
              <p className="mt-1 text-xs text-gray-500">
                See exactly what the vendor will receive (email + PDF). Saves this order as a draft — nothing is sent.
              </p>
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

      <POEmailPreviewModal
        open={previewOpen}
        poId={reusableDraft?.id ?? draftPo?.id ?? null}
        onClose={() => setPreviewOpen(false)}
      />

      <ItemPickerModal
        open={pickerLineIndex !== null}
        onClose={() => setPickerLineIndex(null)}
        items={pickerItems}
        imageMap={imageMap}
        uomLabels={uomLabels}
        enableAllMode={!isPunchoutVendor}
        allItems={allPickerItems}
        vendorItemIds={vendorItemRows.map((r) => r.catalog_item_id)}
        vendorName={selectedVendor?.name ?? null}
        emptyMessage={
          !form.vendor_id
            ? 'Choose a vendor above to see the items they supply.'
            : isPunchoutVendor
              ? 'This vendor has no linked items yet. Add them on the vendor’s Items page.'
              : 'This vendor has no linked items yet — switch to “All items” to order anything, and it’ll be added to their catalog.'
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
