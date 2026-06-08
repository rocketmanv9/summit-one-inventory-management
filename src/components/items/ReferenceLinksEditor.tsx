'use client';

import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { normalizeHref, type ReferenceLink } from '@/lib/items/reference-links';

/**
 * Add / edit / remove reference links on an item. Controlled — the parent owns
 * the `links` array and persistence. Used by the item detail page and the
 * new-item wizard.
 */
export function ReferenceLinksEditor({
  links,
  onChange,
  disabled,
}: {
  links: ReferenceLink[];
  onChange: (links: ReferenceLink[]) => void;
  disabled?: boolean;
}) {
  const update = (i: number, patch: Partial<ReferenceLink>) =>
    onChange(links.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const remove = (i: number) => onChange(links.filter((_, idx) => idx !== i));
  const add = () => onChange([...links, { label: '', url: '' }]);

  return (
    <div className="space-y-2">
      {links.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No links yet. Add a product page, spec sheet, or supplier URL.
        </p>
      )}

      {links.map((link, i) => {
        const href = normalizeHref(link.url);
        return (
          <div key={i} className="flex items-start gap-2">
            <input
              type="text"
              value={link.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="Label (e.g., Home Depot)"
              disabled={disabled}
              className="w-1/3 rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
            <input
              type="url"
              value={link.url}
              onChange={(e) => update(i, { url: e.target.value })}
              placeholder="https://..."
              disabled={disabled}
              className="flex-1 rounded-md border px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
            <a
              href={href || undefined}
              target="_blank"
              rel="noopener noreferrer"
              title="Open link in new tab"
              aria-disabled={!href}
              className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors ${
                href ? 'hover:bg-muted' : 'pointer-events-none opacity-30'
              }`}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={disabled}
              title="Remove link"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={add}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 disabled:opacity-50"
      >
        <Plus className="h-4 w-4" /> Add link
      </button>
    </div>
  );
}
