'use client';

/**
 * ItemNotFoundCard — the procure playbook's no-dead-end grace (sprint item 05).
 *
 * When a buyer asks for something that isn't in the catalog yet
 * ("I need 10 wheelstops"), recommend_vendor_for_item comes back resolved:false
 * and Isabelle renders this inline instead of stopping. One tap on
 * "Add & keep going" fires an add-and-continue message; the LLM playbook then
 * runs add_item → recommend_vendor_for_item → draft_po_preview so the user goes
 * straight from "it doesn't exist" to a reviewable Draft-PO card without ever
 * navigating to the items page. There's also a "Not now" out.
 */

import { PackagePlus, X } from 'lucide-react';
import type { AiItemNotFoundDisplay } from '@/lib/ai/types';

interface ItemNotFoundCardProps {
  data: AiItemNotFoundDisplay;
  /** Sends a follow-up user message into the chat (reuses the playbook). */
  onSend?: (message: string) => void;
  disabled?: boolean;
}

export function ItemNotFoundCard({ data, onSend, disabled }: ItemNotFoundCardProps) {
  const name = (data.itemName || data.itemRef || 'that item').trim();
  const qty = data.qty && data.qty > 0 ? data.qty : undefined;

  // The add-and-continue message the playbook already knows how to run. Keeping
  // the quantity in the sentence means the eventual draft PO defaults to it.
  const continueMsg = qty
    ? `Yes — add "${name}" to the catalog, then find a vendor and draft a PO for ${qty}.`
    : `Yes — add "${name}" to the catalog, then find a vendor and draft a PO.`;

  return (
    <div className="mt-2 max-w-md rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 rounded-lg bg-amber-100 p-1.5 text-amber-700">
          <PackagePlus className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-800">
            &ldquo;{name}&rdquo; isn&rsquo;t in your catalog yet
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            I can add it and carry right on — pick a vendor and draft the PO
            {qty ? ` for ${qty}` : ''}.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onSend?.(continueMsg)}
              disabled={disabled || !onSend}
              className="inline-flex items-center gap-1.5 rounded-full bg-teal-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
            >
              <PackagePlus className="h-3.5 w-3.5" />
              Add &amp; keep going
            </button>
            <button
              type="button"
              onClick={() => onSend?.('Not now — skip it.')}
              disabled={disabled || !onSend}
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
