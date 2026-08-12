'use client';

/**
 * Unified lifecycle timeline for a purchase order.
 *
 * Merges the PO's milestones, procurement events, vendor activity, shipments,
 * receipts, and collected documents into one ordered stream — so the whole
 * story of a purchase (request → order → approval → shipping → tracking →
 * delivery → receiving → invoice → reconciliation → warranty) lives in one place.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  FilePlus2, ShoppingCart, BadgeCheck, Truck, MapPin, PackageCheck, ReceiptText,
  FileText, ShieldCheck, Scale, Activity, ChevronDown, ChevronRight,
} from 'lucide-react';

interface TimelineEntry {
  id: string;
  stage: string;
  title: string;
  detail: string | null;
  at: string | null;
}

const STAGE_META: Record<string, { Icon: typeof Truck; cls: string }> = {
  request: { Icon: FilePlus2, cls: 'text-slate-500' },
  order: { Icon: ShoppingCart, cls: 'text-indigo-600' },
  approval: { Icon: BadgeCheck, cls: 'text-emerald-600' },
  shipping: { Icon: Truck, cls: 'text-blue-600' },
  tracking: { Icon: MapPin, cls: 'text-blue-600' },
  delivery: { Icon: MapPin, cls: 'text-cyan-600' },
  receiving: { Icon: PackageCheck, cls: 'text-green-600' },
  receipt: { Icon: ReceiptText, cls: 'text-emerald-600' },
  invoice: { Icon: FileText, cls: 'text-purple-600' },
  reconciliation: { Icon: Scale, cls: 'text-amber-600' },
  warranty: { Icon: ShieldCheck, cls: 'text-slate-600' },
  activity: { Icon: Activity, cls: 'text-muted-foreground' },
};

const fmt = (at: string | null) => (at ? new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

export function PurchaseTimeline({ poId }: { poId: string }) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/inventory/purchasing/po-timeline?po_id=${poId}`);
      const json = await res.json();
      if (res.ok) setEntries(json.data || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [poId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="border-t pt-4">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between mb-3">
        <h4 className="font-medium flex items-center gap-1.5">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Timeline
        </h4>
        {entries.length > 0 && <span className="text-xs text-muted-foreground">{entries.length} events</span>}
      </button>

      {open && (
        loading ? (
          <div className="p-3 bg-muted/30 rounded-lg animate-pulse h-12" />
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No lifecycle events yet.</p>
        ) : (
          <ol className="relative border-l border-muted ml-2 space-y-3">
            {entries.map((e) => {
              const meta = STAGE_META[e.stage] ?? STAGE_META.activity;
              return (
                <li key={e.id} className="ml-4">
                  <span className="absolute -left-[9px] flex h-4 w-4 items-center justify-center rounded-full bg-white">
                    <meta.Icon className={`h-4 w-4 ${meta.cls}`} />
                  </span>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{e.title}</span>
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">{fmt(e.at)}</span>
                  </div>
                  {e.detail && <div className="text-xs text-muted-foreground">{e.detail}</div>}
                </li>
              );
            })}
          </ol>
        )
      )}
    </div>
  );
}
