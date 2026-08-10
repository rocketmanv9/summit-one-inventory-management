'use client';

/**
 * Purchase links — configurable external purchase catalog (sprint item 04,
 * Grant 2026-08-10).
 *
 * Grant's intent: "estimators should have a link to business cards in canva…
 * these tasks need to be configurable… estimators are only allowed to purchase
 * certain things." Admins define links here and gate each to a set of HR
 * position titles; the mobile quick action (item 05) only shows a user the links
 * their position allows (server-filtered by /external-purchase-links/mine).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, Plus, Pencil, Trash2, X, Users } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { apiWrite } from '@/lib/api-client';
import { useViewAs } from '@/lib/view-as';

interface PurchaseLink {
  id: string;
  name: string;
  description: string | null;
  url: string;
  category: string | null;
  vendor_id: string | null;
  allowed_positions: string[];
  requires_po: boolean;
  monthly_limit: number | null;
  icon: string | null;
  active: boolean;
  sort_order: number;
  last_event_id: string | null;
}

type FormState = {
  name: string;
  description: string;
  url: string;
  category: string;
  allowed_positions: string[];
  requires_po: boolean;
  monthly_limit: string;
  sort_order: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  url: '',
  category: '',
  allowed_positions: [],
  requires_po: true,
  monthly_limit: '',
  sort_order: '0',
};

export default function PurchaseLinksPage() {
  const { positions, isAdmin } = useViewAs();
  const [links, setLinks] = useState<PurchaseLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState<PurchaseLink | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState('');

  const positionTitles = useMemo(() => {
    const titles = new Set(positions.map((p) => p.title).filter(Boolean));
    return Array.from(titles).sort((a, b) => a.localeCompare(b));
  }, [positions]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/inventory/external-purchase-links', { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Request failed (${res.status})`);
      setLinks((json.data ?? []) as PurchaseLink[]);
    } catch (e: any) {
      setError(e?.message || 'Failed to load purchase links.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditing(null);
    setCreating(true);
    setFormErr('');
  };

  const openEdit = (link: PurchaseLink) => {
    setForm({
      name: link.name,
      description: link.description ?? '',
      url: link.url,
      category: link.category ?? '',
      allowed_positions: link.allowed_positions ?? [],
      requires_po: link.requires_po,
      monthly_limit: link.monthly_limit != null ? String(link.monthly_limit) : '',
      sort_order: String(link.sort_order ?? 0),
    });
    setEditing(link);
    setCreating(false);
    setFormErr('');
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
    setFormErr('');
  };

  const togglePosition = (title: string) => {
    setForm((prev) => {
      const has = prev.allowed_positions.includes(title);
      return {
        ...prev,
        allowed_positions: has
          ? prev.allowed_positions.filter((t) => t !== title)
          : [...prev.allowed_positions, title],
      };
    });
  };

  const addFreeTextPosition = (raw: string) => {
    const title = raw.trim();
    if (!title) return;
    setForm((prev) =>
      prev.allowed_positions.includes(title)
        ? prev
        : { ...prev, allowed_positions: [...prev.allowed_positions, title] },
    );
  };

  const save = async () => {
    if (!form.name.trim()) { setFormErr('Name is required.'); return; }
    if (!form.url.trim()) { setFormErr('URL is required.'); return; }
    setSaving(true);
    setFormErr('');
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        url: form.url.trim(),
        category: form.category.trim() || null,
        allowed_positions: form.allowed_positions,
        requires_po: form.requires_po,
        monthly_limit: form.monthly_limit.trim() ? Number(form.monthly_limit) : null,
        sort_order: Number(form.sort_order) || 0,
      };
      const res = editing
        ? await apiWrite(`/api/inventory/external-purchase-links/${editing.id}`, { method: 'PATCH', body: payload })
        : await apiWrite('/api/inventory/external-purchase-links', { method: 'POST', body: payload });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Save failed (${res.status})`);
      closeForm();
      await load();
    } catch (e: any) {
      setFormErr(e?.message || 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (link: PurchaseLink) => {
    if (!confirm(`Deactivate "${link.name}"? It will stop appearing as a quick action.`)) return;
    try {
      const res = await apiWrite(`/api/inventory/external-purchase-links/${link.id}`, { method: 'DELETE', body: {} });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Failed (${res.status})`);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Could not deactivate.');
    }
  };

  const activeLinks = links.filter((l) => l.active);
  const inactiveLinks = links.filter((l) => !l.active);

  return (
    <AppShell>
      <PageHeader
        title="Purchase links"
        description="Outside sites your team is allowed to buy from — gated by position."
      />

      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm text-blue-900">
          Define the outside sites a role is allowed to buy from — for example{' '}
          <strong>Business cards on Canva</strong> for Estimators. Each link shows up as a quick
          action <strong>only for the positions you pick here</strong>. Leave positions empty to
          keep a link admin-only.
        </p>
      </div>

      {!isAdmin && (
        <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <p className="text-sm text-yellow-800">
            Only administrators can add or edit purchase links.
          </p>
        </div>
      )}

      <div className="max-w-4xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Links</h3>
          {isAdmin && (
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> New link
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-16 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading purchase links…
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
        ) : (
          <div className="space-y-3">
            {activeLinks.length === 0 && (
              <p className="rounded-md border border-dashed bg-gray-50 p-6 text-center text-sm text-gray-500">
                No purchase links yet. {isAdmin ? 'Add one to give a position a guided outside-purchase quick action.' : ''}
              </p>
            )}
            {activeLinks.map((link) => (
              <LinkRow key={link.id} link={link} isAdmin={isAdmin} onEdit={openEdit} onDeactivate={deactivate} />
            ))}

            {inactiveLinks.length > 0 && (
              <>
                <h4 className="pt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">Inactive</h4>
                {inactiveLinks.map((link) => (
                  <LinkRow key={link.id} link={link} isAdmin={isAdmin} onEdit={openEdit} onDeactivate={deactivate} />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {(creating || editing) && isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{editing ? 'Edit link' : 'New purchase link'}</h3>
              <button onClick={closeForm} className="rounded p-1 text-gray-400 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <Field label="Name">
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Business cards"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </Field>
              <Field label="URL">
                <input
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://www.canva.com"
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Category">
                  <input
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    placeholder="Marketing"
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                </Field>
                <Field label="Monthly limit (soft)">
                  <input
                    value={form.monthly_limit}
                    onChange={(e) => setForm({ ...form, monthly_limit: e.target.value })}
                    placeholder="Optional"
                    inputMode="decimal"
                    className="w-full rounded-md border px-3 py-2 text-sm"
                  />
                </Field>
              </div>
              <Field label="Description">
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  className="w-full rounded-md border px-3 py-2 text-sm"
                />
              </Field>

              <Field label="Positions allowed (empty = admins only)">
                <div className="rounded-md border p-2">
                  <div className="flex flex-wrap gap-1.5">
                    {positionTitles.map((title) => {
                      const on = form.allowed_positions.includes(title);
                      return (
                        <button
                          key={title}
                          type="button"
                          onClick={() => togglePosition(title)}
                          className={`rounded-full border px-2.5 py-1 text-xs ${
                            on ? 'border-primary bg-primary/10 text-primary' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {title}
                        </button>
                      );
                    })}
                  </div>
                  {/* Free-text escape hatch for titles not in the roster list. */}
                  <FreeTextAdd onAdd={addFreeTextPosition} />
                  {form.allowed_positions.filter((t) => !positionTitles.includes(t)).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {form.allowed_positions
                        .filter((t) => !positionTitles.includes(t))
                        .map((t) => (
                          <span
                            key={t}
                            className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-xs text-primary"
                          >
                            {t}
                            <button type="button" onClick={() => togglePosition(t)}>
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              </Field>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.requires_po}
                  onChange={(e) => setForm({ ...form, requires_po: e.target.checked })}
                />
                Completing a purchase drafts an internal PO
              </label>

              {formErr && <p className="text-sm text-red-700">{formErr}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={closeForm} disabled={saving} className="rounded-md border px-4 py-2 text-sm">
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {editing ? 'Save changes' : 'Create link'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function LinkRow({
  link,
  isAdmin,
  onEdit,
  onDeactivate,
}: {
  link: PurchaseLink;
  isAdmin: boolean;
  onEdit: (l: PurchaseLink) => void;
  onDeactivate: (l: PurchaseLink) => void;
}) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-4 ${link.active ? '' : 'opacity-60'}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <ExternalLink className="h-4 w-4 flex-shrink-0 text-gray-400" />
          <span className="font-medium">{link.name}</span>
          {link.category && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">{link.category}</span>
          )}
          {link.requires_po && (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">drafts PO</span>
          )}
        </div>
        <div className="mt-1 truncate text-xs text-gray-500">{link.url}</div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-gray-500">
          <Users className="h-3 w-3" />
          {link.allowed_positions.length === 0 ? (
            <span className="text-amber-700">Admins only</span>
          ) : (
            <span>{link.allowed_positions.join(', ')}</span>
          )}
        </div>
      </div>
      {isAdmin && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit(link)}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
          {link.active && (
            <button
              onClick={() => onDeactivate(link)}
              className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-3 w-3" /> Deactivate
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  );
}

function FreeTextAdd({ onAdd }: { onAdd: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onAdd(value);
            setValue('');
          }
        }}
        placeholder="Add another title…"
        className="flex-1 rounded-md border px-2 py-1 text-xs"
      />
      <button
        type="button"
        onClick={() => { onAdd(value); setValue(''); }}
        className="rounded-md border px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
      >
        Add
      </button>
    </div>
  );
}
