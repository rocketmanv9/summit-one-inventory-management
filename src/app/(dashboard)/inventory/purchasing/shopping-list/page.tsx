'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import { CapabilityGate } from '@/components/access/CapabilityGate';
import { PageHeader } from '@/components/ui/PageHeader';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { useUOMLabelMap } from '@/hooks/useGVTerms';
import { HowItWorksCard, HowThisWorksButton, useHowItWorks } from '@/components/ui/HowItWorksCard';
import { resizeImage, validateImageFile } from '@/lib/image-utils';
import { AppError } from '@rocketmanv9/chassis/errors';
import {
  ShoppingCart, Store, AlertTriangle, Search, ClipboardPaste, Check,
  Camera, Upload, ImagePlus, Loader2, X, Sparkles,
} from 'lucide-react';

// ── Item 04 (snap-and-buy): "Snap a list" — photo-first shopping list ─────────
// Photograph a crew member's handwritten supply list and buy it: the /extract
// route reads the photo into qty+text lines with per-line confidence, the
// existing /suggest matcher maps them to the catalog and prices vendors, you fix
// what the AI wasn't sure about in ONE review table, and /draft turns it into
// vendor-grouped draft POs. Manual add / paste-a-list survive as small secondary
// paths. The list is ephemeral (client state) — nothing persisted.

interface CatalogItem {
  id: string;
  name: string;
  sku?: string | null;
  uom_term_id?: string | null;
}

interface VendorOption {
  vendor_id: string;
  vendor_name: string | null;
  unit_cost: number | null;
  is_preferred: boolean;
}

interface SuggestItem {
  catalog_item_id: string;
  name: string | null;
  sku: string | null;
  uom_term_id: string | null;
  qty: number;
  options: VendorOption[];
  recommended_vendor_id: string | null;
  last_paid: { unit_cost: number; date: string | null; vendor_name: string | null } | null;
  has_vendor: boolean;
}

interface CatalogMatch {
  query: string;
  qty: number;
  catalog_item_id: string | null;
  name: string | null;
  sku: string | null;
  uom_term_id: string | null;
  match_kind: 'exact_sku' | 'exact_name' | 'fuzzy' | 'none';
  score: number;
}

interface SuggestResponse {
  matches: CatalogMatch[];
  items: SuggestItem[];
  split: {
    recommended: { vendor_count: number };
    consolidated: { vendor_count: number; buckets: Array<{ vendor_id: string; catalog_item_ids: string[] }> } | null;
    consolidation_note: string;
  };
}

/** One reviewable line: what was written (or typed), what it matched, who to buy it from. */
interface ReviewLine {
  key: string;
  source: 'photo' | 'manual' | 'paste';
  qty: number;
  /** The item as written/extracted — kept editable so bad reads are fixable. */
  text: string;
  /** Extraction confidence 0–100 for photo lines; null for typed/pasted lines. */
  confidence: number | null;
  catalog_item_id: string | null;
  match_name: string | null;
  match_sku: string | null;
  uom_term_id: string | null;
  match_kind: CatalogMatch['match_kind'] | 'manual';
  chosen_vendor_id: string | null;
}

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Compose "qty text" so /suggest's parseListLine can't misread a size ("2x4") as a qty. */
const toQueryLine = (qty: number, text: string) => `${qty || 1} ${text.replace(/\s+/g, ' ').trim()}`;

function ConfidenceChip({ value }: { value: number }) {
  const tone =
    value >= 80 ? 'bg-green-100 text-green-700'
    : value >= 50 ? 'bg-amber-100 text-amber-700'
    : 'bg-red-100 text-red-700';
  const label = value >= 80 ? 'read' : value >= 50 ? 'check' : 'unsure';
  return (
    <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${tone}`} title="How confidently the AI read this line from the photo">
      {label} {value}%
    </span>
  );
}

export default function SnapAListPage() {
  const help = useHowItWorks('inventory-shopping-list-help');
  const uomLabels = useUOMLabelMap();

  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [lines, setLines] = useState<ReviewLine[]>([]);
  const [suggest, setSuggest] = useState<SuggestResponse | null>(null);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [result, setResult] = useState<{ po_count: number } | null>(null);
  const [error, setError] = useState('');

  // Photo pipeline state.
  const [extracting, setExtracting] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);
  const [photoNotice, setPhotoNotice] = useState<{ message: string; raw_text: string | null } | null>(null);
  const snapInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // Secondary paths.
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasting, setPasting] = useState(false);

  // Per-line fix-by-search popover.
  const [fixKey, setFixKey] = useState<string | null>(null);
  const [fixQuery, setFixQuery] = useState('');

  useEffect(() => {
    InventoryRPC.getCatalogItems({ active: true, exclude_variants: true })
      .then((data) => setCatalog((data as any[]).map((c) => ({ id: c.id, name: c.name, sku: c.sku, uom_term_id: c.uom_term_id }))))
      .catch(() => {});
  }, []);

  // ── Matching: free-text lines → catalog via the existing /suggest matcher ───

  const matchToCatalog = async (raw: Array<{ qty: number; text: string }>): Promise<CatalogMatch[]> => {
    const res = await fetch('/api/inventory/purchasing/shopping-list/suggest', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: raw.map((l) => toQueryLine(l.qty, l.text)).join('\n') }),
    });
    if (!res.ok) throw AppError.internal((await res.json().catch(() => ({})))?.error?.message || 'Could not match against the catalog');
    const { data } = await res.json();
    return (data as SuggestResponse).matches;
  };

  const buildLines = (
    raw: Array<{ qty: number; text: string; confidence: number | null }>,
    matches: CatalogMatch[],
    source: ReviewLine['source'],
  ): ReviewLine[] =>
    raw.map((l, i) => {
      const m = matches[i];
      const matched = m?.catalog_item_id ? m : null;
      return {
        key: crypto.randomUUID(),
        source,
        qty: l.qty || 1,
        text: l.text,
        confidence: l.confidence,
        catalog_item_id: matched?.catalog_item_id ?? null,
        match_name: matched?.name ?? null,
        match_sku: matched?.sku ?? null,
        uom_term_id: matched?.uom_term_id ?? null,
        match_kind: matched ? matched.match_kind : 'none',
        chosen_vendor_id: null,
      };
    });

  // ── Photo → /extract → matched review lines ─────────────────────────────────

  const handlePhoto = async (file: File | undefined | null) => {
    if (!file) return;
    const invalid = validateImageFile(file);
    if (invalid) { setError(invalid); return; }
    setExtracting(true);
    setError('');
    setPhotoNotice(null);
    setResult(null);
    try {
      const image_data = await resizeImage(file);
      const res = await fetch('/api/inventory/purchasing/shopping-list/extract', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error?.message || json?.error || 'Could not read the photo');
        return;
      }
      if (!json.configured || !json.legible || !(json.lines?.length > 0)) {
        setPhotoNotice({
          message: json.message || "Couldn't read a list in this photo — retake it flat, in good light.",
          raw_text: json.raw_text ?? null,
        });
        return;
      }
      const raw = (json.lines as Array<{ qty: number; text: string; confidence: number }>)
        .map((l) => ({ qty: l.qty, text: l.text, confidence: l.confidence }));
      const matches = await matchToCatalog(raw);
      setLines((prev) => [...prev, ...buildLines(raw, matches, 'photo')]);
      setPhotoCount((n) => n + 1);
    } catch (e: any) {
      setError(e.message || 'Could not read the photo');
    } finally {
      setExtracting(false);
      if (snapInputRef.current) snapInputRef.current.value = '';
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  };

  // ── Secondary paths: paste text / add from catalog ──────────────────────────

  const handlePaste = async () => {
    const rawLines = pasteText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (rawLines.length === 0) return;
    setPasting(true);
    setError('');
    try {
      // Let the server's parseListLine pull the qty out of each pasted line.
      const res = await fetch('/api/inventory/purchasing/shopping-list/suggest', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rawLines.join('\n') }),
      });
      if (!res.ok) { setError('Could not match the pasted list'); return; }
      const { data } = await res.json();
      const matches = (data as SuggestResponse).matches;
      setLines((prev) => [
        ...prev,
        ...buildLines(matches.map((m) => ({ qty: m.qty, text: m.query, confidence: null })), matches, 'paste'),
      ]);
      setPasteText('');
    } catch (e: any) {
      setError(e.message || 'Could not match the pasted list');
    } finally {
      setPasting(false);
    }
  };

  const addCatalogItem = (item: CatalogItem) => {
    setLines((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        source: 'manual',
        qty: 1,
        text: item.name,
        confidence: null,
        catalog_item_id: item.id,
        match_name: item.name,
        match_sku: item.sku ?? null,
        uom_term_id: item.uom_term_id ?? null,
        match_kind: 'manual',
        chosen_vendor_id: null,
      },
    ]);
    setSearch('');
    setShowSearch(false);
  };

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter((c) => c.name?.toLowerCase().includes(q) || c.sku?.toLowerCase().includes(q)).slice(0, 8);
  }, [search, catalog]);

  // ── Line edits ──────────────────────────────────────────────────────────────

  const patchLine = (key: string, patch: Partial<ReviewLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  // Editing the text re-matches that one line (debounced) — a fixed-up bad read
  // should find its catalog item without re-photographing anything.
  const rematchTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const onTextEdit = (key: string, text: string) => {
    patchLine(key, { text });
    const timers = rematchTimers.current;
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(async () => {
      const line = { qty: 1, text };
      if (!text.trim()) {
        patchLine(key, { catalog_item_id: null, match_name: null, match_sku: null, uom_term_id: null, match_kind: 'none' });
        return;
      }
      try {
        const [m] = await matchToCatalog([line]);
        patchLine(key, m?.catalog_item_id
          ? { catalog_item_id: m.catalog_item_id, match_name: m.name, match_sku: m.sku, uom_term_id: m.uom_term_id, match_kind: m.match_kind, chosen_vendor_id: null }
          : { catalog_item_id: null, match_name: null, match_sku: null, uom_term_id: null, match_kind: 'none', chosen_vendor_id: null });
      } catch { /* keep the current match on transient failures */ }
    }, 600));
  };
  useEffect(() => () => { for (const t of rematchTimers.current.values()) clearTimeout(t); }, []);

  const fixResults = useMemo(() => {
    const q = fixQuery.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter((c) => c.name?.toLowerCase().includes(q) || c.sku?.toLowerCase().includes(q)).slice(0, 6);
  }, [fixQuery, catalog]);

  const applyFix = (key: string, item: CatalogItem) => {
    patchLine(key, {
      catalog_item_id: item.id,
      match_name: item.name,
      match_sku: item.sku ?? null,
      uom_term_id: item.uom_term_id ?? null,
      match_kind: 'manual',
      chosen_vendor_id: null,
    });
    setFixKey(null);
    setFixQuery('');
  };

  // ── Vendor options: /suggest for the resolved set of catalog items ──────────

  const resolvedIdKey = useMemo(
    () => [...new Set(lines.map((l) => l.catalog_item_id).filter(Boolean))].sort().join(','),
    [lines],
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!resolvedIdKey) { setSuggest(null); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoadingSuggest(true);
      try {
        const byId = new Map<string, number>();
        for (const l of lines) if (l.catalog_item_id) byId.set(l.catalog_item_id, (byId.get(l.catalog_item_id) ?? 0) + (l.qty || 1));
        const res = await fetch('/api/inventory/purchasing/shopping-list/suggest', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [...byId.entries()].map(([catalog_item_id, qty]) => ({ catalog_item_id, qty })) }),
        });
        if (res.ok) setSuggest((await res.json()).data as SuggestResponse);
      } catch { /* vendor options just stay stale */ } finally {
        setLoadingSuggest(false);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedIdKey]);

  const suggestByItem = useMemo(() => new Map((suggest?.items ?? []).map((it) => [it.catalog_item_id, it])), [suggest]);

  const effectiveVendor = (line: ReviewLine): string | null => {
    if (!line.catalog_item_id) return null;
    if (line.chosen_vendor_id !== null) return line.chosen_vendor_id;
    return suggestByItem.get(line.catalog_item_id)?.recommended_vendor_id ?? null;
  };

  // Live split preview honoring qty + vendor overrides; unmatched lines land in
  // the "needs review" bucket — they draft as free text on the placeholder PO.
  const liveSplit = useMemo(() => {
    const byVendor = new Map<string | null, { name: string | null; items: number; subtotal: number; unpriced: boolean }>();
    for (const line of lines) {
      const it = line.catalog_item_id ? suggestByItem.get(line.catalog_item_id) : null;
      const vId = effectiveVendor(line);
      const opt = it?.options.find((o) => o.vendor_id === vId) ?? null;
      const b = byVendor.get(vId) ?? { name: opt?.vendor_name ?? null, items: 0, subtotal: 0, unpriced: false };
      b.items += 1;
      if (opt?.unit_cost != null) b.subtotal += opt.unit_cost * (line.qty || 1);
      else b.unpriced = true;
      if (opt?.vendor_name) b.name = opt.vendor_name;
      byVendor.set(vId, b);
    }
    const buckets = [...byVendor.entries()].sort((a, b) => b[1].items - a[1].items);
    const total = buckets.reduce((s, [, b]) => s + b.subtotal, 0);
    return { buckets, total, vendorCount: buckets.filter(([v]) => v !== null).length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, suggestByItem]);

  const applyConsolidated = () => {
    const con = suggest?.split.consolidated;
    if (!con) return;
    const vendorForItem = new Map<string, string>();
    for (const b of con.buckets) for (const id of b.catalog_item_ids) vendorForItem.set(id, b.vendor_id);
    setLines((prev) => prev.map((l) => ({
      ...l,
      chosen_vendor_id: l.catalog_item_id ? vendorForItem.get(l.catalog_item_id) ?? l.chosen_vendor_id : l.chosen_vendor_id,
    })));
  };

  // ── Draft POs ───────────────────────────────────────────────────────────────

  const draftableLines = useMemo(
    () => lines.filter((l) => l.catalog_item_id || l.text.trim()),
    [lines],
  );
  const unmatchedCount = draftableLines.filter((l) => !l.catalog_item_id).length;
  const lowConfidenceCount = lines.filter((l) => l.confidence !== null && l.confidence < 50).length;

  const draftPOs = async () => {
    setDrafting(true);
    setError('');
    setResult(null);
    try {
      const payload = {
        lines: draftableLines.map((l) => {
          if (!l.catalog_item_id) return { text: l.text.trim(), qty: l.qty || 1 };
          const it = suggestByItem.get(l.catalog_item_id);
          const vId = effectiveVendor(l);
          const opt = it?.options.find((o) => o.vendor_id === vId) ?? null;
          return { catalog_item_id: l.catalog_item_id, qty: l.qty || 1, vendor_id: vId, unit_cost: opt?.unit_cost ?? null };
        }),
      };
      const res = await fetch('/api/inventory/purchasing/shopping-list/draft', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({})))?.error?.message || 'Could not draft POs');
        return;
      }
      const { data } = await res.json();
      setResult({ po_count: (data.purchase_orders ?? []).length });
      setLines([]);
      setSuggest(null);
      setPhotoCount(0);
      setPhotoNotice(null);
    } catch (e: any) {
      setError(e.message || 'Could not draft POs');
    } finally {
      setDrafting(false);
    }
  };

  const hasLines = lines.length > 0;

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Snap a List"
          description="Take a photo of a handwritten supply list — the AI reads it, matches it to the catalog, and one tap drafts the POs."
          actions={!help.show ? <HowThisWorksButton onClick={help.open} /> : undefined}
        />

        {help.show && (
          <HowItWorksCard
            title="How snap-a-list works"
            onDismiss={help.dismiss}
            steps={[
              { title: 'Snap the list', body: 'Photograph the crew member’s handwritten list (or upload a photo). The AI reads it into quantity + item lines and tells you how sure it is about each one — messy lines are flagged, never silently guessed.' },
              { title: 'Review the read', body: 'Every line is editable. Fixing the text re-matches it to the catalog automatically; unmatched lines get a "find in catalog" search. Lists longer than a page? Snap the next page and it appends.' },
              { title: 'Pick vendors', body: 'Matched items show their vendor options with prices, best one preselected, plus a whole-list split and a "fewest vendors" alternative when it barely costs more.' },
              { title: 'Draft the POs', body: 'One tap creates draft purchase orders grouped by vendor. Lines with no catalog match go on a placeholder draft exactly as written, so nothing on the paper list is lost. Everything flows through the normal approval process.' },
            ]}
            glossary={[
              { Icon: Camera, term: 'Confidence', blurb: 'how sure the AI is it read a handwritten line correctly — low ones deserve a look' },
              { Icon: Store, term: 'Vendor split', blurb: 'how the list divides across vendors — one draft PO per vendor' },
              { Icon: AlertTriangle, term: 'No catalog match', blurb: 'drafted as written on a placeholder PO to sort out before approving' },
            ]}
          />
        )}

        {result && (
          <div className="rounded-lg border border-green-300 bg-green-50 p-4">
            <div className="flex items-center gap-2 font-medium text-green-900">
              <Check className="h-5 w-5" />
              Drafted {result.po_count} purchase order{result.po_count === 1 ? '' : 's'} grouped by vendor.
            </div>
            <div className="mt-1 text-sm text-green-800">
              They&apos;re in{' '}
              <Link href="/inventory/purchasing" className="font-semibold underline">Purchase Orders</Link>{' '}
              as drafts — review, price-check, and send from there.
            </div>
          </div>
        )}

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {/* Hidden photo inputs: "snap" opens the camera on phones, "upload" the picker. */}
        <input ref={snapInputRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => handlePhoto(e.target.files?.[0])} />
        <input ref={uploadInputRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => handlePhoto(e.target.files?.[0])} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {/* ── Hero: snap or upload ─────────────────────────────────────── */}
            {!hasLines ? (
              <div className="rounded-lg border-2 border-dashed border-primary/40 bg-white p-8 text-center">
                {extracting ? (
                  <div className="flex flex-col items-center gap-3 py-6">
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    <div className="font-medium">Reading the list…</div>
                    <div className="text-sm text-muted-foreground">Transcribing the handwriting and matching it to your catalog.</div>
                  </div>
                ) : (
                  <>
                    <Camera className="mx-auto h-12 w-12 text-primary" />
                    <h2 className="mt-3 text-lg font-semibold">Snap or upload the list</h2>
                    <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                      Photograph the handwritten supply list a crew member handed you. The AI reads every line,
                      flags what it&apos;s unsure about, and matches items to the catalog.
                    </p>
                    <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                      <button
                        onClick={() => snapInputRef.current?.click()}
                        className="flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        <Camera className="h-4 w-4" /> Snap a photo
                      </button>
                      <button
                        onClick={() => uploadInputRef.current?.click()}
                        className="flex items-center gap-2 rounded-md border border-primary px-5 py-2.5 font-medium text-primary hover:bg-primary/10"
                      >
                        <Upload className="h-4 w-4" /> Upload a photo
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-lg border bg-white px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Camera className="h-4 w-4" />
                  {photoCount > 0
                    ? <>{photoCount} photo{photoCount === 1 ? '' : 's'} read — lists spanning pages? Add the next one.</>
                    : <>Add a photo of a handwritten list and its lines append below.</>}
                </div>
                <button
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={extracting}
                  className="flex shrink-0 items-center gap-1.5 rounded-md border border-primary px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                >
                  {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                  {extracting ? 'Reading…' : 'Add another photo'}
                </button>
              </div>
            )}

            {/* Honest illegible-photo message */}
            {photoNotice && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
                <div className="flex items-start gap-2 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <div className="font-medium">{photoNotice.message}</div>
                    {photoNotice.raw_text && (
                      <div className="mt-1 text-xs text-amber-800">What the AI saw: “{photoNotice.raw_text}”</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── Review table ─────────────────────────────────────────────── */}
            {hasLines && (
              <div className="rounded-lg border bg-white">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div className="text-sm font-semibold text-gray-700">
                    Review the list ({lines.length} line{lines.length === 1 ? '' : 's'})
                    {loadingSuggest && <span className="ml-2 text-xs font-normal text-muted-foreground">pricing vendors…</span>}
                  </div>
                  {lowConfidenceCount > 0 && (
                    <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      {lowConfidenceCount} line{lowConfidenceCount === 1 ? '' : 's'} the AI wasn&apos;t sure about
                    </span>
                  )}
                </div>
                <div className="divide-y">
                  {lines.map((line) => {
                    const it = line.catalog_item_id ? suggestByItem.get(line.catalog_item_id) : null;
                    const uom = line.uom_term_id ? (uomLabels[line.uom_term_id] ?? '') : '';
                    const chosen = effectiveVendor(line);
                    return (
                      <div key={line.key} className="p-4">
                        <div className="flex items-start gap-2">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={line.qty}
                            onChange={(e) => patchLine(line.key, { qty: Number(e.target.value) })}
                            className="w-16 shrink-0 rounded-md border px-2 py-1.5 text-right text-sm"
                            aria-label="Quantity"
                          />
                          <div className="min-w-0 flex-1">
                            <input
                              value={line.text}
                              onChange={(e) => onTextEdit(line.key, e.target.value)}
                              className="w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                              aria-label="Item as written"
                            />
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                              {line.confidence !== null && <ConfidenceChip value={line.confidence} />}
                              {line.catalog_item_id ? (
                                <>
                                  <span className="font-medium text-green-700">→ {line.match_name}</span>
                                  {line.match_sku && <span className="font-mono text-muted-foreground">{line.match_sku}</span>}
                                  {uom && <span className="text-muted-foreground">{uom}</span>}
                                  {line.match_kind === 'fuzzy' && (
                                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">fuzzy · confirm</span>
                                  )}
                                  {it?.last_paid && (
                                    <span className="text-muted-foreground">
                                      last paid {money(it.last_paid.unit_cost)}{it.last_paid.vendor_name ? ` · ${it.last_paid.vendor_name}` : ''}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">
                                  <AlertTriangle className="h-3 w-3" /> no catalog match — drafts as written
                                </span>
                              )}
                              <button
                                onClick={() => { setFixKey(fixKey === line.key ? null : line.key); setFixQuery(''); }}
                                className="flex items-center gap-1 rounded border border-gray-300 px-1.5 py-0.5 text-gray-600 hover:bg-gray-50"
                              >
                                <Search className="h-3 w-3" /> {line.catalog_item_id ? 'change item' : 'find in catalog'}
                              </button>
                            </div>

                            {/* Fix-by-search */}
                            {fixKey === line.key && (
                              <div className="relative mt-2">
                                <input
                                  autoFocus
                                  value={fixQuery}
                                  onChange={(e) => setFixQuery(e.target.value)}
                                  placeholder="Search the catalog by name or SKU…"
                                  className="w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                                {fixResults.length > 0 && (
                                  <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-white shadow-lg">
                                    {fixResults.map((c) => (
                                      <button
                                        key={c.id}
                                        onClick={() => applyFix(line.key, c)}
                                        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-gray-50"
                                      >
                                        <span className="font-medium">{c.name}</span>
                                        {c.sku && <span className="font-mono text-xs text-muted-foreground">{c.sku}</span>}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Vendor options for matched lines */}
                            {line.catalog_item_id && it && (
                              <div className="mt-2">
                                {it.options.length === 0 ? (
                                  <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                    <span>
                                      No vendor on file — goes on a placeholder draft to assign later.{' '}
                                      <Link href="/inventory/vendor-items" className="font-semibold underline">Add a vendor →</Link>
                                    </span>
                                  </div>
                                ) : (
                                  <div className="flex flex-wrap gap-1.5">
                                    {it.options.map((opt) => {
                                      const active = chosen === opt.vendor_id;
                                      const isRec = it.recommended_vendor_id === opt.vendor_id;
                                      return (
                                        <button
                                          key={opt.vendor_id}
                                          onClick={() => patchLine(line.key, { chosen_vendor_id: opt.vendor_id })}
                                          className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                                            active ? 'border-primary bg-primary/10 text-primary' : 'border-gray-200 hover:bg-gray-50'
                                          }`}
                                        >
                                          <span className="font-medium">{opt.vendor_name || 'Vendor'}</span>
                                          <span className="text-muted-foreground">{opt.unit_cost != null ? money(opt.unit_cost) : 'no price'}</span>
                                          {opt.is_preferred && <span className="rounded bg-blue-100 px-1 text-blue-700">preferred</span>}
                                          {isRec && !opt.is_preferred && <span className="rounded bg-green-100 px-1 text-green-700">best</span>}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          <button onClick={() => removeLine(line.key)} className="shrink-0 rounded p-1 text-red-500 hover:bg-red-50 hover:text-red-700" aria-label="Remove line">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Secondary paths: type or paste (demoted) ─────────────────── */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <details className="rounded-lg border bg-white p-3">
                <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-500">
                  <Search className="h-3.5 w-3.5" /> Add an item manually
                </summary>
                <div className="relative mt-2">
                  <input
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setShowSearch(true); }}
                    onFocus={() => setShowSearch(true)}
                    placeholder="Search the catalog by name or SKU…"
                    className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  {showSearch && searchResults.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-white shadow-lg">
                      {searchResults.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => addCatalogItem(c)}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
                        >
                          <span className="font-medium">{c.name}</span>
                          {c.sku && <span className="font-mono text-xs text-muted-foreground">{c.sku}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </details>

              <details className="rounded-lg border bg-white p-3">
                <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-gray-500">
                  <ClipboardPaste className="h-3.5 w-3.5" /> Paste a typed list
                </summary>
                <div className="mt-2 space-y-2">
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    rows={4}
                    placeholder={'One item per line, e.g.\n5 crackfill boxes\n2 tack coat'}
                    className="w-full rounded-md border px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    onClick={handlePaste}
                    disabled={pasting || !pasteText.trim()}
                    className="rounded-md border border-primary px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                  >
                    {pasting ? 'Matching…' : 'Add to the list'}
                  </button>
                </div>
              </details>
            </div>
          </div>

          {/* ── Right: the split + act ───────────────────────────────────── */}
          <div className="space-y-4">
            <div className="sticky top-4 rounded-lg border bg-white p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                <Store className="h-4 w-4" /> Vendor split
              </div>

              {!hasLines ? (
                <p className="mt-3 text-sm text-muted-foreground">Snap a list to see who to buy it from.</p>
              ) : (
                <>
                  <div className="mt-3 space-y-2">
                    {liveSplit.buckets.map(([vId, b]) => (
                      <div key={vId ?? 'none'} className="rounded-md border bg-gray-50 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">
                            {vId === null ? (
                              <span className="flex items-center gap-1 text-amber-700">
                                <AlertTriangle className="h-3.5 w-3.5" /> Needs review
                              </span>
                            ) : (
                              b.name || 'Vendor'
                            )}
                          </span>
                          <span className="text-sm font-semibold">
                            {b.unpriced && b.subtotal === 0 ? '—' : money(b.subtotal)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          covers {b.items} line{b.items === 1 ? '' : 's'}
                          {b.unpriced && b.subtotal > 0 ? ' · some unpriced' : ''}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t pt-3">
                    <span className="text-sm text-muted-foreground">
                      {liveSplit.vendorCount} vendor{liveSplit.vendorCount === 1 ? '' : 's'}
                    </span>
                    <span className="text-lg font-bold">{money(liveSplit.total)}</span>
                  </div>

                  {suggest?.split.consolidated && suggest.split.consolidated.vendor_count < suggest.split.recommended.vendor_count && (
                    <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3">
                      <div className="text-xs text-blue-900">{suggest.split.consolidation_note}</div>
                      <button
                        onClick={applyConsolidated}
                        className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-blue-300 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
                      >
                        <Sparkles className="h-3.5 w-3.5" /> Use fewest vendors ({suggest.split.consolidated.vendor_count})
                      </button>
                    </div>
                  )}

                  {unmatchedCount > 0 && (
                    <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>
                        {unmatchedCount} line{unmatchedCount === 1 ? '' : 's'} with no catalog match will draft AS WRITTEN on a
                        placeholder PO — sort them out before approving.
                      </span>
                    </div>
                  )}

                  <CapabilityGate capability="purchase_orders.manage">
                    <button
                      onClick={draftPOs}
                      disabled={drafting || draftableLines.length === 0}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      <ShoppingCart className="h-4 w-4" />
                      {drafting ? 'Drafting…' : `Draft ${liveSplit.buckets.length} PO${liveSplit.buckets.length === 1 ? '' : 's'}`}
                    </button>
                  </CapabilityGate>
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    Drafts only — nothing is ordered automatically.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
