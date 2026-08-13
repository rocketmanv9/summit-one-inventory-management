'use client';

/**
 * Buyable-thing setup wizard (item 03, snap-and-buy sprint) — create AND edit
 * re-enter the same flow:
 *
 *   1. Name it          — what is this thing people can buy?
 *   2. Items            — per item, HOW it's fulfilled: catalog (normal PO
 *                         drafting), a pinned vendor item, or an external link
 *                         (with per-person URLs managed inline — the Canva-per-
 *                         estimator case — incl. bulk paste).
 *   3. Who can buy      — position multi-select with live member counts.
 *   4. Preview as       — the group is SAVED, then rendered exactly as a chosen
 *                         position sees it via /buyable-groups/preview (the same
 *                         server path /mine runs). Done.
 *
 * Data contract = item 02's routes: /buyable-groups (POST/PATCH with fulfillment
 * fields) + /buyable-groups/person-links CRUD. Person links are staged locally
 * and applied AFTER the group save (new items only get their group_item_id then).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardPaste,
  Eye,
  Link2,
  Loader2,
  Plus,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';

import { apiWrite } from '@/lib/api-client';
import { ItemPickerModal, type PickerItem } from '@/components/purchasing/ItemPickerModal';
import {
  KIND_META,
  KindBadge,
  money,
  type FulfillmentKind,
  type OverviewGroup,
} from './fulfillment';

// ── Types ────────────────────────────────────────────────────────────────────

interface WizardItem {
  group_item_id?: string;
  catalog_item_id: string;
  name: string | null;
  sku: string | null;
  uom_term_id: string | null;
  default_qty: number;
  preferred_vendor_id: string | null;
  fulfillment_kind: FulfillmentKind;
  external_url: string;
  link_label: string;
  vendor_item_id: string | null;
}

interface VendorOption {
  vendor_id: string;
  vendor_name: string | null;
  unit_cost: number | null;
  is_preferred: boolean;
  vendor_item_id: string;
}

interface Person {
  hr_person_id: string;
  name: string;
  email: string | null;
  position_title: string | null;
}

/** A staged per-person link row (may or may not exist server-side yet). */
interface LinkRow {
  id?: string;
  hr_person_id: string;
  url: string;
  originalUrl?: string;
  person_name: string | null;
  person_email: string | null;
}

interface PreviewGroupData {
  group: { id: string; name: string; description: string | null };
  items: Array<{
    catalog_item_id: string;
    name: string | null;
    uom: string | null;
    default_qty: number;
    est_unit_cost: number | null;
    preferred_vendor_name: string | null;
    fulfillment?: {
      kind: FulfillmentKind;
      url: string | null;
      link_label: string | null;
      vendor: string | null;
      price: number | null;
      configured_for_caller: boolean;
    };
  }>;
}

export interface GroupWizardProps {
  open: boolean;
  /** null = create a new buyable thing. */
  group: OverviewGroup | null;
  catalog: PickerItem[];
  imageMap: Record<string, string>;
  uomLabels: Record<string, string>;
  positionTitles: string[];
  positionCounts: Record<string, number>;
  onClose: () => void;
  /** Fired after every successful save so the parent can refresh its overview. */
  onSaved: () => void;
}

const STEPS = ['Name it', 'Items & fulfillment', 'Who can buy', 'Preview'] as const;

async function readJson(res: Response): Promise<any> {
  return res.json().catch(() => ({}));
}

// ── Component ────────────────────────────────────────────────────────────────

export function GroupWizard({
  open,
  group,
  catalog,
  imageMap,
  uomLabels,
  positionTitles,
  positionCounts,
  onClose,
  onSaved,
}: GroupWizardProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [items, setItems] = useState<WizardItem[]>([]);
  const [allowedPositions, setAllowedPositions] = useState<string[]>([]);

  const [savedGroupId, setSavedGroupId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const [roster, setRoster] = useState<Person[]>([]);
  // Person links staged per CATALOG item id (new items have no group_item_id yet).
  const [links, setLinks] = useState<Record<string, LinkRow[]>>({});
  const [deletedLinkIds, setDeletedLinkIds] = useState<string[]>([]);

  const [vendorOptions, setVendorOptions] = useState<Record<string, VendorOption[]>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bulkFor, setBulkFor] = useState<string | null>(null);
  const [bulkText, setBulkText] = useState('');
  const [bulkNote, setBulkNote] = useState('');

  const [previewPosition, setPreviewPosition] = useState('');
  const [preview, setPreview] = useState<{ position: string; data: PreviewGroupData[] } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const personById = useMemo(() => new Map(roster.map((p) => [p.hr_person_id, p])), [roster]);

  // ── Init on open ───────────────────────────────────────────────────────────
  const initedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) { initedFor.current = null; return; }
    const key = group?.id ?? '__new__';
    if (initedFor.current === key) return;
    initedFor.current = key;

    setStep(0);
    setErr('');
    setSaving(false);
    setPreview(null);
    setDeletedLinkIds([]);
    setBulkFor(null);
    setBulkText('');
    setBulkNote('');

    if (group) {
      setName(group.name);
      setDescription(group.description ?? '');
      setActive(group.active);
      setAllowedPositions(group.allowed_positions ?? []);
      setSavedGroupId(group.id);
      setItems(
        group.items.map((it) => ({
          group_item_id: it.id,
          catalog_item_id: it.catalog_item_id,
          name: it.name,
          sku: it.sku,
          uom_term_id: it.uom_term_id,
          default_qty: it.default_qty,
          preferred_vendor_id: it.preferred_vendor_id,
          fulfillment_kind: it.fulfillment_kind,
          external_url: it.external_url ?? '',
          link_label: it.link_label ?? '',
          vendor_item_id: it.vendor_item_id,
        })),
      );
      setPreviewPosition(group.allowed_positions?.[0] ?? '');
    } else {
      setName('');
      setDescription('');
      setActive(true);
      setAllowedPositions([]);
      setSavedGroupId(null);
      setItems([]);
      setPreviewPosition('');
    }
    setLinks({});

    // Roster (person picker) + existing links for edit.
    const qs = group ? `group_id=${group.id}&include_people=1` : 'include_people=1';
    fetch(`/api/inventory/buyable-groups/person-links?${qs}`, { credentials: 'include' })
      .then(readJson)
      .then((j) => {
        setRoster((j.people ?? []) as Person[]);
        if (group && Array.isArray(j.data)) {
          const byCatalog: Record<string, LinkRow[]> = {};
          const catalogByGroupItem = new Map(group.items.map((it) => [it.id, it.catalog_item_id]));
          for (const l of j.data) {
            const catId = catalogByGroupItem.get(l.group_item_id);
            if (!catId) continue;
            if (!byCatalog[catId]) byCatalog[catId] = [];
            byCatalog[catId].push({
              id: l.id,
              hr_person_id: l.hr_person_id,
              url: l.url,
              originalUrl: l.url,
              person_name: l.person_name,
              person_email: l.person_email,
            });
          }
          setLinks(byCatalog);
        }
      })
      .catch(() => setRoster([]));

    if (group && group.items.length > 0) {
      void fetchVendorOptions(group.items.map((it) => it.catalog_item_id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group]);

  const fetchVendorOptions = useCallback(async (catalogItemIds: string[]) => {
    const ids = catalogItemIds.filter(Boolean);
    if (ids.length === 0) return;
    try {
      const res = await fetch(
        `/api/inventory/buyable-groups/vendor-options?catalog_item_ids=${ids.join(',')}`,
        { credentials: 'include' },
      );
      const j = await readJson(res);
      if (res.ok && j?.data) setVendorOptions((prev) => ({ ...prev, ...j.data }));
    } catch {
      // Dropdowns quietly degrade.
    }
  }, []);

  // ── Item mutations ─────────────────────────────────────────────────────────
  const addItem = (item: PickerItem) => {
    setItems((prev) => {
      if (prev.some((i) => i.catalog_item_id === item.id)) return prev;
      return [
        ...prev,
        {
          catalog_item_id: item.id,
          name: item.name,
          sku: item.sku,
          uom_term_id: item.uom_term_id,
          default_qty: 1,
          preferred_vendor_id: null,
          fulfillment_kind: 'catalog',
          external_url: '',
          link_label: '',
          vendor_item_id: null,
        },
      ];
    });
    void fetchVendorOptions([item.id]);
  };

  const patchItem = (catalogItemId: string, patch: Partial<WizardItem>) => {
    setItems((prev) => prev.map((i) => (i.catalog_item_id === catalogItemId ? { ...i, ...patch } : i)));
  };

  const removeItem = (catalogItemId: string) => {
    setItems((prev) => prev.filter((i) => i.catalog_item_id !== catalogItemId));
    setLinks((prev) => {
      const next = { ...prev };
      delete next[catalogItemId];
      return next;
    });
  };

  const moveItem = (index: number, dir: -1 | 1) => {
    setItems((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  // ── Person-link staging ────────────────────────────────────────────────────
  const addLinkRow = (catalogItemId: string, hrPersonId: string) => {
    const p = personById.get(hrPersonId);
    setLinks((prev) => {
      const rows = prev[catalogItemId] ?? [];
      if (rows.some((r) => r.hr_person_id === hrPersonId)) return prev;
      return {
        ...prev,
        [catalogItemId]: [
          ...rows,
          { hr_person_id: hrPersonId, url: '', person_name: p?.name ?? null, person_email: p?.email ?? null },
        ],
      };
    });
  };

  const setLinkUrl = (catalogItemId: string, hrPersonId: string, url: string) => {
    setLinks((prev) => ({
      ...prev,
      [catalogItemId]: (prev[catalogItemId] ?? []).map((r) => (r.hr_person_id === hrPersonId ? { ...r, url } : r)),
    }));
  };

  const removeLinkRow = (catalogItemId: string, hrPersonId: string) => {
    setLinks((prev) => {
      const rows = prev[catalogItemId] ?? [];
      const row = rows.find((r) => r.hr_person_id === hrPersonId);
      if (row?.id) setDeletedLinkIds((d) => (d.includes(row.id!) ? d : [...d, row.id!]));
      return { ...prev, [catalogItemId]: rows.filter((r) => r.hr_person_id !== hrPersonId) };
    });
  };

  /** Bulk paste: lines of `email-or-name  url` (any separator); URL detected by http(s). */
  const applyBulk = (catalogItemId: string) => {
    const lines = bulkText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let matched = 0;
    const misses: string[] = [];
    for (const line of lines) {
      const urlMatch = line.match(/https?:\/\/\S+/);
      if (!urlMatch) { misses.push(line); continue; }
      const url = urlMatch[0].replace(/[,;]+$/, '');
      const key = line.replace(urlMatch[0], '').replace(/[,;|\t]+/g, ' ').trim().toLowerCase();
      const person = key
        ? roster.find(
            (p) => p.email?.toLowerCase() === key || p.name.toLowerCase() === key,
          ) ?? roster.find((p) => key.length >= 3 && (p.email?.toLowerCase().startsWith(key) || p.name.toLowerCase().includes(key)))
        : undefined;
      if (!person) { misses.push(line); continue; }
      matched += 1;
      setLinks((prev) => {
        const rows = prev[catalogItemId] ?? [];
        const existing = rows.find((r) => r.hr_person_id === person.hr_person_id);
        return {
          ...prev,
          [catalogItemId]: existing
            ? rows.map((r) => (r.hr_person_id === person.hr_person_id ? { ...r, url } : r))
            : [...rows, { hr_person_id: person.hr_person_id, url, person_name: person.name, person_email: person.email }],
        };
      });
    }
    setBulkNote(`${matched} matched${misses.length > 0 ? `, ${misses.length} not recognized (match by email or full name)` : ''}`);
    if (misses.length === 0) { setBulkFor(null); setBulkText(''); }
  };

  // ── Validation & save ──────────────────────────────────────────────────────
  const validate = (): string | null => {
    if (!name.trim()) return 'Give it a name first.';
    for (const it of items) {
      if (it.fulfillment_kind === 'vendor_item' && !it.vendor_item_id) {
        return `"${it.name ?? 'An item'}" is set to a pinned vendor item — pick which vendor's item to pin.`;
      }
      if (it.fulfillment_kind === 'external_link') {
        const url = it.external_url.trim();
        if (url && !/^https?:\/\//i.test(url)) return `"${it.name ?? 'An item'}" has an invalid shared link URL (must start with http).`;
        for (const r of links[it.catalog_item_id] ?? []) {
          if (!r.url.trim() || !/^https?:\/\//i.test(r.url.trim())) {
            return `${r.person_name ?? 'A person'}'s link on "${it.name ?? 'an item'}" needs a full URL (https://…).`;
          }
        }
      }
    }
    return null;
  };

  const save = async (): Promise<boolean> => {
    const problem = validate();
    if (problem) { setErr(problem); return false; }
    setSaving(true);
    setErr('');
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        allowed_positions: allowedPositions,
        active,
        items: items.map((it, idx) => ({
          catalog_item_id: it.catalog_item_id,
          default_qty: Math.max(1, Math.round(it.default_qty || 1)),
          preferred_vendor_id: it.fulfillment_kind === 'catalog' ? it.preferred_vendor_id : null,
          sort_order: idx,
          fulfillment_kind: it.fulfillment_kind,
          external_url: it.fulfillment_kind === 'external_link' ? it.external_url.trim() || null : null,
          link_label: it.fulfillment_kind === 'external_link' ? it.link_label.trim() || null : null,
          vendor_item_id: it.fulfillment_kind === 'vendor_item' ? it.vendor_item_id : null,
        })),
      };

      const res = savedGroupId
        ? await apiWrite(`/api/inventory/buyable-groups/${savedGroupId}`, { method: 'PATCH', body: payload })
        : await apiWrite('/api/inventory/buyable-groups', { method: 'POST', body: payload });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json?.error?.message || `Save failed (${res.status})`);
      const groupId: string = savedGroupId ?? json?.data?.id;
      if (!groupId) throw new Error('Save succeeded but no group id came back.');
      setSavedGroupId(groupId);

      // Map catalog_item_id → group_item_id (new items only exist server-side now).
      const listRes = await fetch('/api/inventory/buyable-groups', { credentials: 'include' });
      const listJson = await readJson(listRes);
      if (!listRes.ok) throw new Error(listJson?.error?.message || 'Could not re-read the saved group.');
      const savedGroup = (listJson.data ?? []).find((g: any) => g.id === groupId);
      const groupItemIdByCatalog = new Map<string, string>(
        (savedGroup?.items ?? []).map((it: any) => [it.catalog_item_id, it.id]),
      );

      // Apply staged person-link changes (link items only).
      for (const linkId of deletedLinkIds) {
        const del = await apiWrite(`/api/inventory/buyable-groups/person-links/${linkId}`, { method: 'DELETE', body: {} });
        if (!del.ok && del.status !== 404) {
          const j = await readJson(del);
          throw new Error(j?.error?.message || 'Could not remove a person link.');
        }
      }
      setDeletedLinkIds([]);

      const nextLinks: Record<string, LinkRow[]> = {};
      for (const it of items) {
        const rows = links[it.catalog_item_id] ?? [];
        if (it.fulfillment_kind !== 'external_link' || rows.length === 0) {
          if (rows.length > 0) nextLinks[it.catalog_item_id] = rows;
          continue;
        }
        const groupItemId = groupItemIdByCatalog.get(it.catalog_item_id);
        if (!groupItemId) continue;
        const savedRows: LinkRow[] = [];
        for (const r of rows) {
          const url = r.url.trim();
          if (!r.id) {
            const post = await apiWrite('/api/inventory/buyable-groups/person-links', {
              method: 'POST',
              body: { group_item_id: groupItemId, hr_person_id: r.hr_person_id, url },
            });
            const j = await readJson(post);
            if (!post.ok) throw new Error(j?.error?.message || `Could not save ${r.person_name ?? 'a person'}'s link.`);
            savedRows.push({ ...r, id: j?.data?.id, originalUrl: url });
          } else if (url !== r.originalUrl) {
            const patch = await apiWrite(`/api/inventory/buyable-groups/person-links/${r.id}`, {
              method: 'PATCH',
              body: { url },
            });
            const j = await readJson(patch);
            if (!patch.ok) throw new Error(j?.error?.message || `Could not update ${r.person_name ?? 'a person'}'s link.`);
            savedRows.push({ ...r, originalUrl: url });
          } else {
            savedRows.push(r);
          }
        }
        nextLinks[it.catalog_item_id] = savedRows;
      }
      setLinks(nextLinks);

      onSaved();
      return true;
    } catch (e: any) {
      setErr(e?.message || 'Could not save. Try again.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  // ── Preview (step 4) ───────────────────────────────────────────────────────
  const loadPreview = useCallback(async (position: string) => {
    if (!position) { setPreview(null); return; }
    setPreviewLoading(true);
    try {
      const res = await fetch(
        `/api/inventory/buyable-groups/preview?position=${encodeURIComponent(position)}`,
        { credentials: 'include' },
      );
      const j = await readJson(res);
      if (!res.ok) throw new Error(j?.error?.message || `Preview failed (${res.status})`);
      setPreview({ position, data: (j.data ?? []) as PreviewGroupData[] });
    } catch (e: any) {
      setPreview(null);
      setErr(e?.message || 'Could not load the preview.');
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const goPreview = async () => {
    const ok = await save();
    if (!ok) return;
    const position = previewPosition || allowedPositions[0] || positionTitles[0] || '';
    setPreviewPosition(position);
    setStep(3);
    void loadPreview(position);
  };

  if (!open) return null;

  const sortedRoster = (allowed: string[]) =>
    [...roster].sort((a, b) => {
      const aIn = a.position_title != null && allowed.includes(a.position_title) ? 0 : 1;
      const bIn = b.position_title != null && allowed.includes(b.position_title) ? 0 : 1;
      if (aIn !== bIn) return aIn - bIn;
      return a.name.localeCompare(b.name);
    });

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        {/* Header + stepper */}
        <div className="border-b px-6 pb-3 pt-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-semibold">
              {group || savedGroupId ? 'Edit buyable thing' : 'New buyable thing'}
              {name.trim() && <span className="text-gray-400"> — {name.trim()}</span>}
            </h3>
            <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
          <ol className="flex items-center gap-1 text-xs">
            {STEPS.map((label, i) => {
              const done = i < step;
              const current = i === step;
              // Steps 1–3 are freely revisitable; preview only via Save & preview.
              const clickable = i < 3 && !saving;
              return (
                <li key={label} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3 w-3 text-gray-300" />}
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => clickable && setStep(i)}
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition-colors ${
                      current
                        ? 'bg-primary text-primary-foreground'
                        : done
                          ? 'bg-primary/10 text-primary hover:bg-primary/20'
                          : 'bg-gray-100 text-gray-500'
                    } ${clickable ? '' : 'cursor-default'}`}
                  >
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                      current ? 'bg-white/20' : done ? 'bg-primary/20' : 'bg-gray-200'
                    }`}>
                      {done ? <Check className="h-2.5 w-2.5" /> : i + 1}
                    </span>
                    {label}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {step === 0 && (
            <div className="mx-auto max-w-lg space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">What can people buy?</label>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Business cards, Estimator kit, Safety gear…"
                  className="w-full rounded-md border px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Describe it (optional)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="What it's for and anything buyers should know"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
              {!active && (
                <label className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                  This thing is currently deactivated — tick to reactivate it on save.
                </label>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Every item states exactly how it gets bought — <KindBadge kind="catalog" /> drafts a PO
                through normal vendor resolution, <KindBadge kind="vendor_item" /> pins one exact vendor
                &amp; price, <KindBadge kind="external_link" /> opens a website instead of drafting anything
                (with a personal URL per person if you add them).
              </p>

              {items.length === 0 && (
                <div className="rounded-md border border-dashed bg-gray-50 p-8 text-center text-sm text-gray-500">
                  Nothing to buy yet — add the first item from the catalog.
                </div>
              )}

              {items.map((it, idx) => (
                <ItemEditor
                  key={it.catalog_item_id}
                  item={it}
                  index={idx}
                  count={items.length}
                  uomLabels={uomLabels}
                  vendorOptions={vendorOptions[it.catalog_item_id] ?? []}
                  linkRows={links[it.catalog_item_id] ?? []}
                  roster={sortedRoster(allowedPositions)}
                  bulkOpen={bulkFor === it.catalog_item_id}
                  bulkText={bulkText}
                  bulkNote={bulkFor === it.catalog_item_id ? bulkNote : ''}
                  onPatch={(patch) => patchItem(it.catalog_item_id, patch)}
                  onRemove={() => removeItem(it.catalog_item_id)}
                  onMove={(dir) => moveItem(idx, dir)}
                  onAddPerson={(personId) => addLinkRow(it.catalog_item_id, personId)}
                  onSetLinkUrl={(personId, url) => setLinkUrl(it.catalog_item_id, personId, url)}
                  onRemovePerson={(personId) => removeLinkRow(it.catalog_item_id, personId)}
                  onToggleBulk={() => {
                    setBulkFor((cur) => (cur === it.catalog_item_id ? null : it.catalog_item_id));
                    setBulkText('');
                    setBulkNote('');
                  }}
                  onBulkText={setBulkText}
                  onApplyBulk={() => applyBulk(it.catalog_item_id)}
                />
              ))}

              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Plus className="h-4 w-4" /> Add item from catalog
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="mx-auto max-w-xl space-y-4">
              <p className="text-sm text-gray-600">
                Pick the positions that get <strong>{name.trim() || 'this thing'}</strong> as a buying
                quick action. Leave everything off to keep it admin-only.
              </p>
              <div className="flex flex-wrap gap-2">
                {positionTitles.map((title) => {
                  const on = allowedPositions.includes(title);
                  const count = positionCounts[title] ?? 0;
                  return (
                    <button
                      key={title}
                      type="button"
                      onClick={() =>
                        setAllowedPositions((prev) =>
                          on ? prev.filter((t) => t !== title) : [...prev, title],
                        )
                      }
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                        on
                          ? 'border-primary bg-primary/10 font-medium text-primary'
                          : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {on && <Check className="h-3.5 w-3.5" />}
                      {title}
                      <span className={`rounded-full px-1.5 text-[10px] ${on ? 'bg-primary/15' : 'bg-gray-100 text-gray-500'}`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="rounded-md border bg-gray-50 p-3 text-sm text-gray-600">
                {allowedPositions.length === 0 ? (
                  <span className="text-amber-700">Admins only — no position will see this in their buying flow.</span>
                ) : (
                  <>
                    <strong>
                      {allowedPositions.reduce((n, t) => n + (positionCounts[t] ?? 0), 0)} people
                    </strong>{' '}
                    across {allowedPositions.length} position{allowedPositions.length === 1 ? '' : 's'} will be able to buy this
                    (plus admins, who always can).
                  </>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Eye className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Saved. Now see it through someone&apos;s eyes:</span>
                <select
                  value={previewPosition}
                  onChange={(e) => { setPreviewPosition(e.target.value); void loadPreview(e.target.value); }}
                  className="rounded-md border px-3 py-1.5 text-sm"
                >
                  <option value="">Pick a position…</option>
                  {positionTitles.map((t) => (
                    <option key={t} value={t}>
                      {t}{allowedPositions.includes(t) ? ' ✓ allowed' : ''}
                    </option>
                  ))}
                </select>
                {previewLoading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
              </div>

              {!previewPosition ? (
                <p className="rounded-md border border-dashed bg-gray-50 p-6 text-sm text-gray-500">
                  Pick a position to render its live buying flow — the exact response their
                  &quot;Get stuff&quot; quick action serves.
                </p>
              ) : previewLoading ? null : !preview || preview.position !== previewPosition ? (
                <p className="text-sm text-gray-400">Preview unavailable.</p>
              ) : (
                <PreviewPane
                  preview={preview}
                  highlightGroupId={savedGroupId}
                  groupName={name.trim()}
                  isAllowed={allowedPositions.includes(previewPosition)}
                />
              )}

              <p className="text-xs text-gray-400">
                Link items show their shared fallback here — each person&apos;s personal URL resolves when
                THEY open the buying flow.
              </p>
            </div>
          )}

          {err && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{err}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t bg-gray-50/60 px-6 py-3">
          <div className="text-xs text-gray-400">
            {step === 1 && items.length === 0 && 'A thing with no items is invisible in the buying flow.'}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={saving} className="rounded-md border px-4 py-2 text-sm">
              {step === 3 ? 'Close' : 'Cancel'}
            </button>
            {step > 0 && step < 3 && (
              <button
                onClick={() => setStep(step - 1)}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-md border px-4 py-2 text-sm"
              >
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
            )}
            {step < 2 && (
              <button
                onClick={() => { setErr(''); setStep(step + 1); }}
                disabled={step === 0 && !name.trim()}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            )}
            {step === 2 && (
              <button
                onClick={goPreview}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save &amp; preview
              </button>
            )}
            {step === 3 && (
              <button
                onClick={onClose}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
              >
                <Check className="h-4 w-4" /> Done
              </button>
            )}
          </div>
        </div>
      </div>

      <ItemPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        items={catalog}
        imageMap={imageMap}
        uomLabels={uomLabels}
        selectedIds={items.map((i) => i.catalog_item_id)}
        emptyMessage="No catalog items available."
        onSelect={(item) => addItem(item)}
      />
    </div>
  );
}

// ── One item's editor row ────────────────────────────────────────────────────

function ItemEditor({
  item,
  index,
  count,
  uomLabels,
  vendorOptions,
  linkRows,
  roster,
  bulkOpen,
  bulkText,
  bulkNote,
  onPatch,
  onRemove,
  onMove,
  onAddPerson,
  onSetLinkUrl,
  onRemovePerson,
  onToggleBulk,
  onBulkText,
  onApplyBulk,
}: {
  item: WizardItem;
  index: number;
  count: number;
  uomLabels: Record<string, string>;
  vendorOptions: VendorOption[];
  linkRows: LinkRow[];
  roster: Person[];
  bulkOpen: boolean;
  bulkText: string;
  bulkNote: string;
  onPatch: (patch: Partial<WizardItem>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onAddPerson: (hrPersonId: string) => void;
  onSetLinkUrl: (hrPersonId: string, url: string) => void;
  onRemovePerson: (hrPersonId: string) => void;
  onToggleBulk: () => void;
  onBulkText: (text: string) => void;
  onApplyBulk: () => void;
}) {
  const [personPick, setPersonPick] = useState('');
  const availablePeople = roster.filter((p) => !linkRows.some((r) => r.hr_person_id === p.hr_person_id));

  const kindHelp: Record<FulfillmentKind, string> = {
    catalog: vendorOptions.length > 0
      ? 'Drafts a PO — preferred vendor first, else the cheapest known.'
      : 'Drafts as free text onto the "Guided Purchase" placeholder PO — a buyer assigns the real vendor before approval.',
    vendor_item: 'Always drafts against ONE exact vendor item — vendor and price are locked.',
    external_link: 'Opens a website instead of drafting a PO — add per-person URLs below (e.g. each estimator\'s own Canva file).',
  };

  return (
    <div className="rounded-lg border bg-white">
      {/* Row header */}
      <div className="flex items-center gap-2 border-b bg-gray-50/60 px-3 py-2">
        <div className="flex flex-col">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className="rounded p-0 text-gray-400 hover:text-gray-700 disabled:opacity-20" aria-label="Move up">
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={index === count - 1} className="rounded p-0 text-gray-400 hover:text-gray-700 disabled:opacity-20" aria-label="Move down">
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {item.name ?? item.catalog_item_id}
          {item.sku && <span className="ml-1.5 font-mono text-xs font-normal text-gray-400">{item.sku}</span>}
        </span>
        <label className="flex items-center gap-1 text-xs text-gray-500">
          qty
          <input
            type="number"
            min={1}
            value={item.default_qty}
            onChange={(e) => onPatch({ default_qty: Number(e.target.value) })}
            className="w-14 rounded border px-1.5 py-0.5 text-sm"
          />
          <span>{uomLabels[item.uom_term_id || ''] || ''}</span>
        </label>
        <button type="button" onClick={onRemove} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove item">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Fulfillment */}
      <div className="space-y-2.5 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-gray-500">How it&apos;s bought:</span>
          {(Object.keys(KIND_META) as FulfillmentKind[]).map((kind) => {
            const meta = KIND_META[kind];
            const on = item.fulfillment_kind === kind;
            return (
              <button
                key={kind}
                type="button"
                onClick={() => onPatch({ fulfillment_kind: kind })}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
                  on ? `${meta.chip} font-medium` : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                <meta.Icon className="h-3 w-3" /> {meta.label}
              </button>
            );
          })}
          <span className="ml-1 text-[11px] text-gray-400">{kindHelp[item.fulfillment_kind]}</span>
        </div>

        {item.fulfillment_kind === 'catalog' && vendorOptions.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-gray-600">
            Vendor
            <select
              value={item.preferred_vendor_id ?? ''}
              onChange={(e) => onPatch({ preferred_vendor_id: e.target.value || null })}
              className="rounded border bg-white px-2 py-1 text-xs"
            >
              <option value="">Auto (preferred, then cheapest)</option>
              {vendorOptions.map((o) => (
                <option key={o.vendor_id} value={o.vendor_id}>
                  {o.vendor_name ?? 'Vendor'}{o.unit_cost != null ? ` — ${money(o.unit_cost)}` : ''}{o.is_preferred ? ' ★' : ''}
                </option>
              ))}
              {item.preferred_vendor_id && !vendorOptions.some((o) => o.vendor_id === item.preferred_vendor_id) && (
                <option value={item.preferred_vendor_id}>Pinned vendor</option>
              )}
            </select>
          </label>
        )}

        {item.fulfillment_kind === 'vendor_item' && (
          vendorOptions.length === 0 ? (
            <p className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-700">
              No vendor carries this item yet — add it to a vendor first (Vendor Items), or use Catalog fulfillment.
            </p>
          ) : (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              Pin to
              <select
                value={item.vendor_item_id ?? ''}
                onChange={(e) => onPatch({ vendor_item_id: e.target.value || null })}
                className={`rounded border bg-white px-2 py-1 text-xs ${!item.vendor_item_id ? 'border-amber-400' : ''}`}
              >
                <option value="">Pick a vendor&apos;s item…</option>
                {vendorOptions.map((o) => (
                  <option key={o.vendor_item_id} value={o.vendor_item_id}>
                    {o.vendor_name ?? 'Vendor'}{o.unit_cost != null ? ` — ${money(o.unit_cost)}` : ''}{o.is_preferred ? ' ★' : ''}
                  </option>
                ))}
                {item.vendor_item_id && !vendorOptions.some((o) => o.vendor_item_id === item.vendor_item_id) && (
                  <option value={item.vendor_item_id}>Current pin (vendor item missing?)</option>
                )}
              </select>
            </label>
          )
        )}

        {item.fulfillment_kind === 'external_link' && (
          <div className="space-y-2 rounded-md border border-indigo-100 bg-indigo-50/40 p-2.5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="text-xs text-gray-600">
                Link label
                <input
                  value={item.link_label}
                  onChange={(e) => onPatch({ link_label: e.target.value })}
                  placeholder="Canva — business cards"
                  className="mt-0.5 w-full rounded border px-2 py-1 text-xs"
                />
              </label>
              <label className="text-xs text-gray-600">
                Shared fallback URL (optional)
                <input
                  value={item.external_url}
                  onChange={(e) => onPatch({ external_url: e.target.value })}
                  placeholder="https://… (used when someone has no personal link)"
                  className="mt-0.5 w-full rounded border px-2 py-1 text-xs"
                />
              </label>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-xs font-medium text-gray-600">
                <Link2 className="h-3 w-3" /> Personal links ({linkRows.length})
              </span>
              <button
                type="button"
                onClick={onToggleBulk}
                className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] text-gray-600 hover:bg-white"
              >
                <ClipboardPaste className="h-3 w-3" /> Bulk paste
              </button>
            </div>

            {bulkOpen && (
              <div className="space-y-1.5 rounded border bg-white p-2">
                <textarea
                  value={bulkText}
                  onChange={(e) => onBulkText(e.target.value)}
                  rows={3}
                  placeholder={'One per line: email (or full name) and URL, e.g.\nsarah@acme.com  https://canva.com/design/abc'}
                  className="w-full rounded border px-2 py-1 font-mono text-[11px]"
                />
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-400">{bulkNote}</span>
                  <button
                    type="button"
                    onClick={onApplyBulk}
                    disabled={!bulkText.trim()}
                    className="rounded bg-primary px-2.5 py-1 text-[11px] text-primary-foreground disabled:opacity-50"
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}

            {linkRows.map((r) => (
              <div key={r.hr_person_id} className="flex items-center gap-2 rounded border bg-white px-2 py-1.5">
                <span className="min-w-0 flex-shrink-0 text-xs font-medium text-gray-700" title={r.person_email ?? undefined}>
                  {r.person_name ?? r.person_email ?? 'Person'}
                </span>
                <input
                  value={r.url}
                  onChange={(e) => onSetLinkUrl(r.hr_person_id, e.target.value)}
                  placeholder="https://…"
                  className={`min-w-0 flex-1 rounded border px-2 py-1 text-xs ${!r.url.trim() ? 'border-amber-400' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => onRemovePerson(r.hr_person_id)}
                  className="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="Remove person link"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            <div className="flex items-center gap-2">
              <UserPlus className="h-3.5 w-3.5 text-gray-400" />
              <select
                value={personPick}
                onChange={(e) => {
                  const id = e.target.value;
                  setPersonPick('');
                  if (id) onAddPerson(id);
                }}
                className="min-w-0 flex-1 rounded border bg-white px-2 py-1 text-xs"
              >
                <option value="">Add a person&apos;s link… ({availablePeople.length} people)</option>
                {availablePeople.map((p) => (
                  <option key={p.hr_person_id} value={p.hr_person_id}>
                    {p.name}{p.position_title ? ` — ${p.position_title}` : ''}{p.email ? ` (${p.email})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Preview pane (step 4) ────────────────────────────────────────────────────

function PreviewPane({
  preview,
  highlightGroupId,
  groupName,
  isAllowed,
}: {
  preview: { position: string; data: PreviewGroupData[] };
  highlightGroupId: string | null;
  groupName: string;
  isAllowed: boolean;
}) {
  const containsGroup = preview.data.some((pg) => pg.group.id === highlightGroupId);

  return (
    <div className="space-y-3">
      {!containsGroup && (
        <div className={`rounded-md border p-3 text-sm ${isAllowed ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
          A <strong>{preview.position}</strong> does NOT see &quot;{groupName}&quot;
          {isAllowed
            ? ' — the position is allowed but the group has no items (or is inactive), so the buying flow hides it.'
            : ' — that position isn\'t in this thing\'s allowed list.'}
        </div>
      )}

      {preview.data.length === 0 ? (
        <p className="rounded-md border border-dashed bg-gray-50 p-6 text-sm text-gray-500">
          A {preview.position} sees an empty buying flow — no groups allow that position yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {preview.data.map((pg) => {
            const isThis = pg.group.id === highlightGroupId;
            return (
              <div
                key={pg.group.id}
                className={`rounded-lg border p-3 ${isThis ? 'border-primary ring-2 ring-primary/20' : 'bg-white'}`}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-800">{pg.group.name}</span>
                  {isThis && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">this one</span>
                  )}
                </div>
                {pg.group.description && <div className="mb-1.5 text-xs text-gray-500">{pg.group.description}</div>}
                <ul className="space-y-1">
                  {pg.items.map((it) => (
                    <li key={it.catalog_item_id} className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate text-gray-700">
                        {it.name ?? 'Item'}
                        <span className="text-gray-400"> × {it.default_qty}{it.uom ? ` ${it.uom}` : ''}</span>
                      </span>
                      {it.fulfillment?.kind === 'external_link' ? (
                        it.fulfillment.url ? (
                          <span className="flex-shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-600">
                            ↗ {it.fulfillment.link_label || 'External link'}
                          </span>
                        ) : (
                          <span
                            className="flex-shrink-0 rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-600"
                            title="No shared fallback URL — only people with a personal link can order this"
                          >
                            ↗ {it.fulfillment.link_label || 'Link'} · per-person
                          </span>
                        )
                      ) : it.fulfillment?.kind === 'vendor_item' && !it.fulfillment.configured_for_caller ? (
                        <span className="flex-shrink-0 rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-600">vendor pin missing</span>
                      ) : (
                        <span className="flex-shrink-0 text-gray-500">
                          {money(it.est_unit_cost) ?? '—'}
                          {it.preferred_vendor_name && <span className="text-gray-400"> · {it.preferred_vendor_name}</span>}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
