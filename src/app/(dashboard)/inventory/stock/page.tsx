'use client';

// The single Inventory page: catalog + stock balances merged into one
// item-centric, search-first grid. Each row is an item with its quantities;
// expanding a row shows per-location (and per-variant) balances, recent
// activity, and a 6-month usage sparkline. Quick-add creates an item +
// initial stock in one small form (rpc_wizard_create_item); the full wizard
// at /inventory/items/new remains for variants/vendors/barcodes/assets.
//
// URL params: ?q=<search> pre-fills the search box, ?filter=low|out
// pre-selects the status chip (dashboard widgets and Isabelle link here).

import { AppError } from '@rocketmanv9/chassis/errors';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { HowItWorksCard, HowThisWorksButton, useHowItWorks } from '@/components/ui/HowItWorksCard';
import { Boxes, ClipboardList, PackageCheck, AlertTriangle } from 'lucide-react';
import { StatusChip } from '@/components/ui/StatusChip';
import { CategoryModal } from '@/components/modals/CategoryModal';
import { BarcodeLabelDialog, type BarcodeLabelItem } from '@/components/modals/BarcodeLabelDialog';
import { BarcodeScannerOverlay } from '@/components/mobile/BarcodeScannerOverlay';
import { AdjustStockModal } from '@/components/inventory/AdjustStockModal';
import { EntityImageThumbnail } from '@/components/ui/EntityImageThumbnail';
import { useEntityImages } from '@/hooks/useEntityImages';
import { useUOMTerms, useUOMLabelMap } from '@/hooks/useGVTerms';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { createBrowserAuthedClient } from '@/supabase/client';
import { errMessage } from '@/lib/client-errors';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Item {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  category_id: string | null;
  uom_term_id: string | null;
  tracking_mode: string;
  reorder_point: number | null;
  active: boolean | null;
  is_parent?: boolean | null;
  parent_item_id?: string | null;
  variant_attributes?: Record<string, string> | null;
  variant_dimensions?: string[] | null;
  variant_options?: Record<string, string[]> | null;
  last_event_id: string | null;
  item_categories?: { name: string } | null;
}

interface Balance {
  catalog_item_id: string;
  location_id: string;
  qty_on_hand: number;
  qty_reserved: number;
  qty_available: number;
  locations?: { name: string } | null;
}

interface ItemRow {
  item: Item;
  /** The item itself plus its variant children. */
  memberIds: string[];
  balances: Balance[];
  onHand: number;
  reserved: number;
  available: number;
  locationCount: number;
  status: 'out' | 'low' | 'ok';
}

interface Movement {
  movement_type: string;
  qty: number;
  created_at: string;
}

type StatusFilter = 'all' | 'low' | 'out';

const variantLabel = (item: Item): string =>
  item.variant_attributes ? Object.values(item.variant_attributes).join(' / ') : '';

// ── Usage sparkline ───────────────────────────────────────────────────────────

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const w = 8;
  return (
    <svg width={values.length * (w + 2)} height={28} className="inline-block align-middle">
      {values.map((v, i) => {
        const h = Math.max(2, Math.round((v / max) * 26));
        return (
          <rect
            key={i}
            x={i * (w + 2)}
            y={28 - h}
            width={w}
            height={h}
            rx={1.5}
            className={v > 0 ? 'fill-primary/70' : 'fill-muted-foreground/20'}
          />
        );
      })}
    </svg>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const help = useHowItWorks('inventory-stock-help');
  const router = useRouter();
  const uomLabels = useUOMLabelMap();
  const { terms: uomTerms } = useUOMTerms();

  const [items, setItems] = useState<Item[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [movementsByItem, setMovementsByItem] = useState<Record<string, Movement[] | 'loading' | 'error'>>({});
  // catalog_item_id → usage_qty per month (oldest → newest), fetched once, lazily.
  const [usageByItem, setUsageByItem] = useState<Record<string, number[]> | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [labelDialog, setLabelDialog] = useState<BarcodeLabelItem[] | null>(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);

  const [imageRefreshKey, setImageRefreshKey] = useState(0);
  const topLevelIds = useMemo(
    () => items.filter((i) => !i.parent_item_id).map((i) => i.id),
    [items]
  );
  const { imageMap } = useEntityImages('catalog_item', topLevelIds, imageRefreshKey);

  // ── Quick add ──
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAdd, setQuickAdd] = useState({
    name: '',
    category_id: '',
    uom_term_id: '',
    location_id: '',
    qty: '',
    reorder_point: '',
  });
  const [quickAddSaving, setQuickAddSaving] = useState(false);
  const [quickAddError, setQuickAddError] = useState('');

  // ── Adjust stock (same flow as the old Stock Balances page) ──
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustForm, setAdjustForm] = useState({
    catalog_item_id: '',
    variant_item_id: '',
    location_id: '',
    new_qty: '',
    reason: '',
    notes: '',
    override_reason: '',
  });
  const [adjustError, setAdjustError] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [guardrailBlock, setGuardrailBlock] = useState<{
    code: string;
    message: string;
    details?: Record<string, any>;
    action?: string;
  } | null>(null);

  // ── Data loading ──────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [itemData, balanceData, cats, locs] = await Promise.all([
        InventoryRPC.getCatalogItems({ exclude_variants: false }),
        InventoryRPC.getStockBalances({}),
        InventoryRPC.getItemCategories(),
        InventoryRPC.getLocations({ active: true }),
      ]);
      setItems((itemData || []) as unknown as Item[]);
      setBalances((balanceData || []) as unknown as Balance[]);
      setCategories((cats || []).map((c: any) => ({ id: c.id, name: c.name })));
      setLocations((locs || []).map((l: any) => ({ id: l.id, name: l.name })));
    } catch (error) {
      console.error('Error loading inventory:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Read ?q= and ?filter= from the URL once on mount (widgets/chat deep-link).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    const filter = params.get('filter');
    if (q) setSearch(q);
    if (filter === 'low' || filter === 'out') setStatusFilter(filter);
    searchRef.current?.focus();
  }, []);

  // Lazy one-shot usage fetch the first time any row expands.
  useEffect(() => {
    if (!expandedId || usageByItem !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/inventory/usage-trends?months=6');
        if (!res.ok) throw AppError.internal(`Usage fetch failed: HTTP ${res.status}`);
        const body = await res.json();
        if (cancelled) return;
        const months = Array.from(
          new Set<string>((body.data || []).map((r: any) => r.month))
        ).sort();
        const monthIndex = new Map(months.map((m, i) => [m, i]));
        const map: Record<string, number[]> = {};
        for (const r of body.data || []) {
          if (!map[r.catalog_item_id]) map[r.catalog_item_id] = Array(months.length).fill(0);
          const idx = monthIndex.get(r.month);
          if (idx !== undefined) {
            map[r.catalog_item_id][idx] += Math.abs(Number(r.usage_qty) || 0);
          }
        }
        setUsageByItem(map);
      } catch {
        if (!cancelled) setUsageByItem({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expandedId, usageByItem]);

  // ── Row assembly ──────────────────────────────────────────────────────────

  const rows: ItemRow[] = useMemo(() => {
    const childrenByParent = new Map<string, Item[]>();
    for (const item of items) {
      if (item.parent_item_id) {
        const list = childrenByParent.get(item.parent_item_id) || [];
        list.push(item);
        childrenByParent.set(item.parent_item_id, list);
      }
    }
    const balancesByItem = new Map<string, Balance[]>();
    for (const b of balances) {
      const list = balancesByItem.get(b.catalog_item_id) || [];
      list.push(b);
      balancesByItem.set(b.catalog_item_id, list);
    }

    return items
      .filter((i) => !i.parent_item_id)
      .map((item) => {
        const memberIds = [item.id, ...(childrenByParent.get(item.id) || []).map((c) => c.id)];
        const itemBalances = memberIds.flatMap((id) => balancesByItem.get(id) || []);
        const onHand = itemBalances.reduce((s, b) => s + (Number(b.qty_on_hand) || 0), 0);
        const reserved = itemBalances.reduce((s, b) => s + (Number(b.qty_reserved) || 0), 0);
        const available = itemBalances.reduce((s, b) => s + (Number(b.qty_available) || 0), 0);
        const locationCount = new Set(itemBalances.map((b) => b.location_id)).size;
        const status: ItemRow['status'] =
          onHand <= 0
            ? 'out'
            : item.reorder_point != null && onHand <= item.reorder_point
              ? 'low'
              : 'ok';
        return { item, memberIds, balances: itemBalances, onHand, reserved, available, locationCount, status };
      });
  }, [items, balances]);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (!showInactive && row.item.active === false) return false;
      if (q) {
        const members = row.memberIds.map((id) => itemById.get(id)).filter(Boolean) as Item[];
        const hit = members.some(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            m.sku.toLowerCase().includes(q) ||
            (m.description || '').toLowerCase().includes(q)
        );
        if (!hit) return false;
      }
      if (categoryFilter && row.item.category_id !== categoryFilter) return false;
      if (statusFilter === 'low' && row.status === 'ok') return false;
      if (statusFilter === 'out' && row.status !== 'out') return false;
      if (locationFilter && !row.balances.some((b) => b.location_id === locationFilter && Number(b.qty_on_hand) > 0)) {
        return false;
      }
      return true;
    });
  }, [rows, itemById, search, categoryFilter, statusFilter, locationFilter, showInactive]);

  // ── Row expansion: recent movements ───────────────────────────────────────

  const toggleExpand = (row: ItemRow) => {
    const next = expandedId === row.item.id ? null : row.item.id;
    setExpandedId(next);
    if (next && !movementsByItem[next]) {
      setMovementsByItem((prev) => ({ ...prev, [next]: 'loading' }));
      const supabase = createBrowserAuthedClient().schema('inventory');
      supabase
        .from('stock_movements')
        .select('movement_type, quantity_delta, occurred_at')
        .in('catalog_item_id', row.memberIds)
        .order('occurred_at', { ascending: false })
        .limit(8)
        .then(({ data, error }) => {
          setMovementsByItem((prev) => ({
            ...prev,
            [next]: error
              ? 'error'
              : (data || []).map((m: any) => ({
                  movement_type: m.movement_type,
                  qty: m.quantity_delta,
                  created_at: m.occurred_at,
                })),
          }));
        });
    }
  };

  // ── Quick add ─────────────────────────────────────────────────────────────

  const openQuickAdd = (prefillName?: string) => {
    setQuickAddError('');
    setQuickAdd({
      name: prefillName ?? '',
      category_id: categories[0]?.id ?? '',
      uom_term_id: uomTerms.find((t) => t.label?.toUpperCase() === 'EA')?.term_id ?? uomTerms[0]?.term_id ?? '',
      location_id: locations[0]?.id ?? '',
      qty: '',
      reorder_point: '',
    });
    setQuickAddOpen(true);
  };

  const submitQuickAdd = async () => {
    setQuickAddError('');
    if (!quickAdd.name.trim()) {
      setQuickAddError('Give the item a name.');
      return;
    }
    if (!quickAdd.category_id) {
      setQuickAddError('Pick a category.');
      return;
    }
    const qty = quickAdd.qty === '' ? null : Number(quickAdd.qty);
    if (qty !== null && (!Number.isFinite(qty) || qty < 0)) {
      setQuickAddError('Quantity must be a positive number.');
      return;
    }
    setQuickAddSaving(true);
    try {
      const result = await InventoryRPC.wizardCreateItem({
        name: quickAdd.name.trim(),
        category_id: quickAdd.category_id,
        uom_term_id: quickAdd.uom_term_id || null,
        tracking_mode: 'stock',
        reorder_point: quickAdd.reorder_point === '' ? null : Number(quickAdd.reorder_point),
        location_id: qty !== null && qty > 0 ? quickAdd.location_id || null : null,
        initial_qty: qty !== null && qty > 0 ? qty : null,
        idempotency_key: crypto.randomUUID(),
      });
      setQuickAddOpen(false);
      setSearch('');
      setStatusFilter('all');
      setCategoryFilter('');
      await fetchAll();
      setExpandedId(result.item_id);
      setImageRefreshKey((k) => k + 1);
    } catch (error: any) {
      setQuickAddError(errMessage(error, 'Failed to add item'));
    } finally {
      setQuickAddSaving(false);
    }
  };

  // ── Adjust stock ──────────────────────────────────────────────────────────

  const adjustableItems = useMemo(
    () =>
      items
        .filter((i) => !i.parent_item_id && i.tracking_mode !== 'serialized' && i.active !== false)
        .map((i) => ({
          id: i.id,
          name: i.name,
          sku: i.sku,
          is_parent: i.is_parent ?? false,
          variant_dimensions: i.variant_dimensions ?? null,
          variant_options: i.variant_options ?? null,
        })),
    [items]
  );

  const openAdjustModal = (itemId?: string, locationId?: string, currentQty?: number) => {
    setAdjustError('');
    setGuardrailBlock(null);
    setAdjustForm({
      catalog_item_id: itemId ?? '',
      variant_item_id: '',
      location_id: locationId ?? '',
      new_qty: currentQty !== undefined ? String(currentQty) : '',
      reason: currentQty !== undefined && currentQty <= 0 ? 'count_variance' : '',
      notes: '',
      override_reason: '',
    });
    setShowAdjustModal(true);
  };

  const submitAdjustment = async () => {
    setAdjustError('');
    setGuardrailBlock(null);
    if (!adjustForm.catalog_item_id || !adjustForm.location_id) {
      setAdjustError('Select an item and location.');
      return;
    }
    const selected = adjustableItems.find((i) => i.id === adjustForm.catalog_item_id);
    const targetItemId = selected?.is_parent ? adjustForm.variant_item_id : adjustForm.catalog_item_id;
    if (selected?.is_parent && !targetItemId) {
      setAdjustError('Select which variant to adjust.');
      return;
    }
    const qty = Number(adjustForm.new_qty);
    if (!Number.isFinite(qty)) {
      setAdjustError('Enter a valid quantity.');
      return;
    }
    if (!adjustForm.reason) {
      setAdjustError('Select a reason for this adjustment.');
      return;
    }

    setAdjustSaving(true);
    try {
      const result = await InventoryRPC.adjustInventory({
        catalog_item_id: targetItemId,
        location_id: adjustForm.location_id,
        new_qty: qty,
        reason: adjustForm.reason as 'count_variance' | 'damage' | 'theft' | 'expiration' | 'other',
        notes: adjustForm.notes,
        override_reason: adjustForm.override_reason || undefined,
      });

      if (!result.success && result.error) {
        setGuardrailBlock(result.error);
        return;
      }
      if (result.override_logged) {
        alert('Adjustment saved. Override has been logged for audit.');
      }

      setShowAdjustModal(false);
      setGuardrailBlock(null);
      setMovementsByItem({});
      await fetchAll();
    } catch (error: any) {
      setAdjustError(error?.message || 'Failed to adjust inventory.');
    } finally {
      setAdjustSaving(false);
    }
  };

  // ── Misc actions ──────────────────────────────────────────────────────────

  const handleScanResult = (decodedText: string) => {
    let code = decodedText;
    try {
      const url = new URL(decodedText);
      const codeParam = url.searchParams.get('code');
      if (codeParam) code = codeParam;
    } catch {
      // Not a URL, use as-is
    }
    const match = items.find((item) => item.sku.toLowerCase() === code.toLowerCase());
    if (match) {
      setScannerOpen(false);
      const rootId = match.parent_item_id ?? match.id;
      setSearch('');
      setExpandedId(rootId);
      const el = document.getElementById(`inv-row-${rootId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      alert(`No item found matching: ${code}`);
    }
  };

  const printFilteredLabels = () => {
    const labels: BarcodeLabelItem[] = filteredRows
      .filter((r) => (r.item as any).barcode || r.item.sku)
      .map((r) => ({ code: (((r.item as any).barcode || r.item.sku) as string), label: r.item.name, kind: 'stock' as const }));
    if (labels.length === 0) {
      alert('No items with a barcode/SKU in the current view.');
      return;
    }
    setMenuOpen(false);
    setLabelDialog(labels);
  };

  const lowCount = rows.filter((r) => r.status === 'low' && r.item.active !== false).length;
  const outCount = rows.filter((r) => r.status === 'out' && r.item.active !== false).length;

  const statusChips: Array<{ key: StatusFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'low', label: `Low stock${lowCount ? ` (${lowCount})` : ''}` },
    { key: 'out', label: `Out (${outCount})` },
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppShell>
      <div className="space-y-4">
        <PageHeader
          title="Inventory"
          description="Everything in one place: search an item to see what you have and where. Expand a row for per-location balances, recent activity, and usage."
          actions={
            <div className="flex gap-3 items-center">
              {!help.show && <HowThisWorksButton onClick={help.open} />}
              <button
                onClick={() => setScannerOpen(true)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
              >
                Scan
              </button>
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="px-3 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors"
                  title="More actions"
                >
                  ⋯
                </button>
                {menuOpen && (
                  <div
                    className="absolute right-0 mt-1 w-56 rounded-md border bg-card shadow-lg z-20 py-1 text-sm"
                    onMouseLeave={() => setMenuOpen(false)}
                  >
                    <button onClick={printFilteredLabels} className="w-full text-left px-3 py-2 hover:bg-muted/50">
                      Print labels for current view
                    </button>
                    <button
                      onClick={() => { setMenuOpen(false); router.push('/inventory/items/new'); }}
                      className="w-full text-left px-3 py-2 hover:bg-muted/50"
                    >
                      Full item wizard (variants, vendors…)
                    </button>
                    <button
                      onClick={() => { setMenuOpen(false); router.push('/inventory/categories'); }}
                      className="w-full text-left px-3 py-2 hover:bg-muted/50"
                    >
                      Manage categories
                    </button>
                    <button
                      onClick={() => { setMenuOpen(false); router.push('/inventory/locations'); }}
                      className="w-full text-left px-3 py-2 hover:bg-muted/50"
                    >
                      Manage locations
                    </button>
                    <button
                      onClick={() => { setMenuOpen(false); setShowInactive((v) => !v); }}
                      className="w-full text-left px-3 py-2 hover:bg-muted/50"
                    >
                      {showInactive ? 'Hide inactive items' : 'Show inactive items'}
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={() => openQuickAdd()}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                + Add Item
              </button>
            </div>
          }
        />

        {help.show && (
          <HowItWorksCard
            title="How inventory works"
            onDismiss={help.dismiss}
            steps={[
              { title: 'Search first', body: 'Type a name, SKU, or description in the big box. Narrow further with the status chips, category chips, or the location dropdown.' },
              { title: 'Expand a row', body: 'Click any item to see its per-location (and per-variant) balances, recent movements, and a 6-month usage sparkline.' },
              { title: 'Add & adjust', body: '+ Add Item quick-creates an item with a starting count. The Adjust button on any balance sets a new counted quantity — guardrailed and fully audited.' },
              { title: 'Stay ahead', body: 'Give items a reorder point so they flag as Low stock. Scan finds an item instantly by barcode or SKU, and the ⋯ menu prints labels for the current view.' },
            ]}
            legend={[
              { badge: <StatusChip status="In Stock" />, text: 'on hand is above the reorder point' },
              { badge: <StatusChip status="Low Stock" />, text: 'on hand is at or below the reorder point' },
              { badge: <StatusChip status="Stockout" />, text: 'nothing on hand anywhere' },
            ]}
            glossary={[
              { Icon: Boxes, term: 'On hand', blurb: 'physical quantity in stock, summed across every location' },
              { Icon: ClipboardList, term: 'Reserved', blurb: 'quantity already allocated to jobs or reservations — not free to use' },
              { Icon: PackageCheck, term: 'Available', blurb: 'on hand minus reserved — what you can actually promise' },
              { Icon: AlertTriangle, term: 'Reorder point', blurb: 'the threshold that flips an item to Low stock so you reorder in time' },
            ]}
          />
        )}

        {/* Answer box */}
        <input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search items — name, SKU, or description…"
          className="w-full px-4 py-3 text-lg rounded-lg border bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
        />

        {/* Filter chips */}
        <div className="flex flex-wrap items-center gap-2">
          {statusChips.map((chip) => (
            <button
              key={chip.key}
              onClick={() => setStatusFilter(chip.key)}
              className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                statusFilter === chip.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card hover:bg-muted/50'
              }`}
            >
              {chip.label}
            </button>
          ))}
          <span className="mx-1 text-muted-foreground">·</span>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategoryFilter(categoryFilter === cat.id ? '' : cat.id)}
              className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                categoryFilter === cat.id
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-card hover:bg-muted/50'
              }`}
            >
              {cat.name}
            </button>
          ))}
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="ml-auto px-3 py-1.5 rounded-md border bg-card text-sm"
          >
            <option value="">All locations</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                In stock at: {loc.name}
              </option>
            ))}
          </select>
        </div>

        {/* Grid */}
        <div className="rounded-lg border bg-card divide-y">
          <div className="hidden md:grid grid-cols-[2.5rem_1fr_8rem_6rem_6rem_6rem_7rem_2rem] gap-3 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            <span />
            <span>Item</span>
            <span>Category</span>
            <span className="text-right" title="Physical quantity across all locations">On Hand</span>
            <span className="text-right" title="Allocated to jobs/reservations">Reserved</span>
            <span className="text-right" title="On hand minus reserved">Available</span>
            <span>Status</span>
            <span />
          </div>

          {loading ? (
            <div className="p-8 text-center text-muted-foreground animate-pulse">Loading inventory…</div>
          ) : filteredRows.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-muted-foreground">
                {search.trim() ? <>No items match “{search.trim()}”.</> : 'No items yet.'}
              </p>
              <button
                onClick={() => openQuickAdd(search.trim() || undefined)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                + Quick-add {search.trim() ? `“${search.trim()}”` : 'an item'}
              </button>
            </div>
          ) : (
            filteredRows.map((row) => {
              const expanded = expandedId === row.item.id;
              const movements = movementsByItem[row.item.id];
              const usage =
                usageByItem === null
                  ? null
                  : row.memberIds.reduce<number[]>((acc, id) => {
                      const series = usageByItem[id];
                      if (!series) return acc;
                      if (acc.length === 0) return [...series];
                      return acc.map((v, i) => v + (series[i] || 0));
                    }, []);
              return (
                <div key={row.item.id} id={`inv-row-${row.item.id}`}>
                  <button
                    onClick={() => toggleExpand(row)}
                    className={`w-full grid grid-cols-[2.5rem_1fr_7rem_2rem] md:grid-cols-[2.5rem_1fr_8rem_6rem_6rem_6rem_7rem_2rem] gap-3 px-4 py-3 items-center text-left hover:bg-muted/30 transition-colors ${
                      expanded ? 'bg-muted/20' : ''
                    }`}
                  >
                    <EntityImageThumbnail url={imageMap[row.item.id]} alt={row.item.name} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium truncate ${row.item.active === false ? 'line-through text-muted-foreground' : ''}`}>
                          {row.item.name}
                        </span>
                        {row.item.is_parent && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700">
                            Variants
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono truncate">
                        {row.item.sku}
                        {row.locationCount > 0 && (
                          <span className="font-sans"> · {row.locationCount} location{row.locationCount === 1 ? '' : 's'}</span>
                        )}
                        {row.item.uom_term_id && (
                          <span className="font-sans"> · {uomLabels[row.item.uom_term_id] || ''}</span>
                        )}
                      </div>
                    </div>
                    <span className="hidden md:block text-sm text-muted-foreground truncate">
                      {row.item.item_categories?.name || '—'}
                    </span>
                    <span className={`hidden md:block text-right font-mono ${row.onHand <= 0 ? 'text-red-600 font-semibold' : ''}`}>
                      {row.onHand.toLocaleString()}
                    </span>
                    <span className="hidden md:block text-right font-mono text-muted-foreground">
                      {row.reserved.toLocaleString()}
                    </span>
                    <span className={`hidden md:block text-right font-mono ${row.available <= 0 ? 'text-red-600 font-semibold' : 'text-green-600'}`}>
                      {row.available.toLocaleString()}
                    </span>
                    <span className="md:col-span-1 justify-self-start">
                      {row.status === 'out' ? (
                        <StatusChip status="Stockout" />
                      ) : row.status === 'low' ? (
                        <StatusChip status="Low Stock" />
                      ) : (
                        <StatusChip status="In Stock" />
                      )}
                    </span>
                    <span className="text-muted-foreground text-sm justify-self-end">{expanded ? '▾' : '▸'}</span>
                  </button>

                  {expanded && (
                    <div className="px-4 pb-4 pt-1 bg-muted/10 space-y-4">
                      {/* Per-location / per-variant balances */}
                      <div className="rounded-md border bg-card divide-y">
                        {row.balances.length === 0 ? (
                          <div className="flex items-center justify-between px-3 py-2 text-sm">
                            <span className="text-muted-foreground">No stock recorded yet.</span>
                            <button
                              onClick={() => openAdjustModal(row.item.id)}
                              className="px-3 py-1.5 text-sm bg-orange-100 text-orange-800 rounded hover:bg-orange-200 transition-colors"
                            >
                              Set a count
                            </button>
                          </div>
                        ) : (
                          row.balances.map((b) => {
                            const member = itemById.get(b.catalog_item_id);
                            const vLabel = member && member.id !== row.item.id ? variantLabel(member) : '';
                            return (
                              <div
                                key={`${b.catalog_item_id}-${b.location_id}`}
                                className="grid grid-cols-[1fr_5rem_5rem_5rem_auto] gap-3 items-center px-3 py-2 text-sm"
                              >
                                <span className="truncate">
                                  {b.locations?.name || 'Unknown location'}
                                  {vLabel && <span className="ml-2 text-xs text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded">{vLabel}</span>}
                                </span>
                                <span className={`text-right font-mono ${Number(b.qty_on_hand) <= 0 ? 'text-red-600' : ''}`}>
                                  {Number(b.qty_on_hand).toLocaleString()}
                                </span>
                                <span className="text-right font-mono text-muted-foreground">
                                  {Number(b.qty_reserved).toLocaleString()}
                                </span>
                                <span className="text-right font-mono text-green-600">
                                  {Number(b.qty_available).toLocaleString()}
                                </span>
                                <button
                                  onClick={() =>
                                    openAdjustModal(
                                      member?.parent_item_id ? member.parent_item_id : b.catalog_item_id,
                                      b.location_id,
                                      Number(b.qty_on_hand)
                                    )
                                  }
                                  className="px-2.5 py-1 text-xs bg-orange-100 text-orange-800 rounded hover:bg-orange-200 transition-colors"
                                >
                                  Adjust
                                </button>
                              </div>
                            );
                          })
                        )}
                        {row.balances.length > 0 && (
                          <div className="grid grid-cols-[1fr_5rem_5rem_5rem_auto] gap-3 items-center px-3 py-2 text-xs text-muted-foreground">
                            <span className="uppercase tracking-wide">Location · On hand · Reserved · Available</span>
                            <span className="col-span-3" />
                            <button
                              onClick={() => openAdjustModal(row.item.id)}
                              className="text-orange-700 hover:underline"
                            >
                              + another location
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="grid md:grid-cols-2 gap-4">
                        {/* Recent activity */}
                        <div>
                          <h4 className="text-sm font-medium mb-2">Recent activity</h4>
                          {movements === 'loading' || movements === undefined ? (
                            <div className="animate-pulse space-y-1">
                              {[1, 2, 3].map((i) => (
                                <div key={i} className="h-8 bg-muted rounded" />
                              ))}
                            </div>
                          ) : movements === 'error' ? (
                            <p className="text-sm text-red-600">Couldn&apos;t load recent activity.</p>
                          ) : movements.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No movements yet.</p>
                          ) : (
                            <div className="space-y-1">
                              {movements.map((m, idx) => (
                                <div key={idx} className="flex items-center justify-between px-2 py-1 bg-card border rounded text-sm">
                                  <span className="capitalize">{m.movement_type}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {new Date(m.created_at).toLocaleDateString()}
                                  </span>
                                  <span className={`font-mono ${m.qty >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                    {m.qty >= 0 ? '+' : ''}
                                    {m.qty}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Usage + links */}
                        <div className="space-y-3">
                          <div>
                            <h4 className="text-sm font-medium mb-2">Usage, last 6 months</h4>
                            {usage === null ? (
                              <div className="h-7 w-24 bg-muted rounded animate-pulse" />
                            ) : usage.length === 0 || usage.every((v) => v === 0) ? (
                              <p className="text-sm text-muted-foreground">No usage recorded.</p>
                            ) : (
                              <div className="flex items-center gap-3">
                                <Sparkline values={usage} />
                                <span className="text-sm text-muted-foreground">
                                  {usage.reduce((a, b) => a + b, 0).toLocaleString()} used
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="flex gap-3 text-sm">
                            <button
                              onClick={() => router.push(`/inventory/items/${row.item.id}`)}
                              className="text-primary hover:underline"
                            >
                              Open item (edit, barcodes, vendors) →
                            </button>
                            <button
                              onClick={() => router.push(`/inventory/movements?item=${row.item.id}`)}
                              className="text-muted-foreground hover:underline"
                            >
                              Full history →
                            </button>
                          </div>
                          {row.item.reorder_point != null && (
                            <p className="text-xs text-muted-foreground">
                              Reorder point: {row.item.reorder_point.toLocaleString()}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {!loading && filteredRows.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {filteredRows.length} of {rows.length} items shown
          </p>
        )}
      </div>

      {/* Quick add */}
      {quickAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !quickAddSaving && setQuickAddOpen(false)}>
          <div className="w-full max-w-md rounded-lg bg-card border shadow-xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">Quick add item</h3>
              <button onClick={() => setQuickAddOpen(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Name</label>
                <input
                  autoFocus
                  value={quickAdd.name}
                  onChange={(e) => setQuickAdd((p) => ({ ...p, name: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitQuickAdd(); }}
                  className="mt-1 w-full px-3 py-2 rounded-md border bg-background"
                  placeholder="e.g. Hard Hats"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Category</label>
                  <select
                    value={quickAdd.category_id}
                    onChange={(e) => {
                      if (e.target.value === '__new__') {
                        setShowCategoryModal(true);
                      } else {
                        setQuickAdd((p) => ({ ...p, category_id: e.target.value }));
                      }
                    }}
                    className="mt-1 w-full px-3 py-2 rounded-md border bg-background"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    <option value="__new__">+ New category…</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Unit</label>
                  <select
                    value={quickAdd.uom_term_id}
                    onChange={(e) => setQuickAdd((p) => ({ ...p, uom_term_id: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 rounded-md border bg-background"
                  >
                    {uomTerms.map((t) => (
                      <option key={t.term_id} value={t.term_id}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Location</label>
                  <select
                    value={quickAdd.location_id}
                    onChange={(e) => setQuickAdd((p) => ({ ...p, location_id: e.target.value }))}
                    className="mt-1 w-full px-3 py-2 rounded-md border bg-background"
                  >
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Qty on hand</label>
                  <input
                    type="number"
                    min="0"
                    value={quickAdd.qty}
                    onChange={(e) => setQuickAdd((p) => ({ ...p, qty: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitQuickAdd(); }}
                    className="mt-1 w-full px-3 py-2 rounded-md border bg-background"
                    placeholder="0"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Reorder point <span className="text-muted-foreground font-normal">(optional — flags the item as low stock)</span></label>
                <input
                  type="number"
                  min="0"
                  value={quickAdd.reorder_point}
                  onChange={(e) => setQuickAdd((p) => ({ ...p, reorder_point: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-md border bg-background"
                  placeholder="—"
                />
              </div>
            </div>

            {quickAddError && <p className="text-sm text-red-600">{quickAddError}</p>}

            <div className="flex items-center justify-between pt-1">
              <button
                onClick={() => { setQuickAddOpen(false); router.push('/inventory/items/new'); }}
                className="text-sm text-muted-foreground hover:underline"
              >
                Need variants, vendors, barcodes? Full wizard →
              </button>
              <button
                onClick={submitQuickAdd}
                disabled={quickAddSaving}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {quickAddSaving ? 'Adding…' : 'Add item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAdjustModal && (
        <AdjustStockModal
          form={adjustForm}
          items={adjustableItems}
          locations={locations}
          saving={adjustSaving}
          error={adjustError}
          guardrailBlock={guardrailBlock}
          onClose={() => { setShowAdjustModal(false); setGuardrailBlock(null); }}
          onChange={(next) => { setAdjustForm((prev) => ({ ...prev, ...next })); setGuardrailBlock(null); }}
          onSubmit={submitAdjustment}
          onBatchComplete={async (allSucceeded) => {
            setMovementsByItem({});
            await fetchAll();
            if (allSucceeded) {
              setShowAdjustModal(false);
              setGuardrailBlock(null);
            }
          }}
        />
      )}

      <BarcodeScannerOverlay
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleScanResult}
      />

      <CategoryModal
        open={showCategoryModal}
        onClose={() => setShowCategoryModal(false)}
        onSuccess={async () => {
          setShowCategoryModal(false);
          try {
            const cats = await InventoryRPC.getItemCategories();
            const sorted = [...cats].sort(
              (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            );
            setCategories(cats.map((c: any) => ({ id: c.id, name: c.name })));
            if (sorted[0]) setQuickAdd((p) => ({ ...p, category_id: sorted[0].id }));
          } catch {
            // category created; list refreshes on next load
          }
        }}
      />

      {labelDialog && (
        <BarcodeLabelDialog
          items={labelDialog}
          entityType="item"
          onClose={() => setLabelDialog(null)}
        />
      )}
    </AppShell>
  );
}
