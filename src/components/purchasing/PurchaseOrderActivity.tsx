'use client';

/**
 * Vendor-activity timeline for a purchase order.
 *
 * Shows AI-interpreted vendor replies: pending suggestions (with one-click
 * Apply / Dismiss) and the resolved/auto-applied history. "Check replies"
 * pulls fresh vendor emails via the Gmail sync.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Sparkles,
  Truck,
  CalendarClock,
  PackageX,
  DollarSign,
  Ban,
  MessageCircleQuestion,
  Mail,
} from 'lucide-react';

interface Suggestion {
  id: string;
  reply_id: string | null;
  event_type: string;
  confidence: number | null;
  summary: string | null;
  proposed_changes: Record<string, unknown>;
  status: 'suggested' | 'auto_applied' | 'applied' | 'dismissed';
  applied_at: string | null;
  created_at: string;
}

interface Reply {
  id: string;
  from_email: string | null;
  subject: string | null;
  snippet: string | null;
  summary: string | null;
  event_type: string | null;
  received_at: string | null;
  created_at: string;
}

const SYNC_API = '/api/integrations/google/sync-replies';
const APPLY_API = '/api/inventory/purchasing/po-suggestions/apply';

const EVENT_META: Record<string, { label: string; Icon: typeof Truck }> = {
  acknowledged: { label: 'Order confirmed', Icon: CheckCircle2 },
  shipped: { label: 'Shipped', Icon: Truck },
  delivery_update: { label: 'Delivery update', Icon: CalendarClock },
  delay: { label: 'Delay', Icon: CalendarClock },
  backordered: { label: 'Backordered', Icon: PackageX },
  price_change: { label: 'Price change', Icon: DollarSign },
  qty_change: { label: 'Quantity change', Icon: PackageX },
  cancelled: { label: 'Cancellation', Icon: Ban },
  question: { label: 'Vendor question', Icon: MessageCircleQuestion },
  other: { label: 'Vendor reply', Icon: Mail },
};

function changeSummary(c: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (typeof c.status === 'string') out.push(`Set status → ${c.status}`);
  if (typeof c.expected_delivery_date === 'string') out.push(`Expected delivery: ${c.expected_delivery_date}`);
  if (typeof c.external_order_number === 'string') out.push(`Vendor order #: ${c.external_order_number}`);
  if (typeof c.tracking_number === 'string') out.push(`Tracking: ${c.tracking_number}`);
  if (Array.isArray(c.items) && c.items.length) out.push(`Items: ${(c.items as string[]).join(', ')}`);
  return out;
}

export function PurchaseOrderActivity({ poId, onChanged }: { poId: string; onChanged?: () => void }) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/inventory/purchasing/po-activity?po_id=${poId}`);
      const json = await res.json();
      if (res.ok) {
        setSuggestions(json.data.suggestions || []);
        setReplies(json.data.replies || []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [poId]);

  useEffect(() => {
    load();
  }, [load]);

  const checkReplies = async () => {
    setSyncing(true);
    setNote('');
    try {
      const res = await fetch(SYNC_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || 'Sync failed');
      const d = json.data;
      setNote(
        d.new_replies > 0
          ? `${d.new_replies} new repl${d.new_replies === 1 ? 'y' : 'ies'} · ${d.auto_applied} auto-applied · ${d.suggested} to review`
          : 'No new replies.',
      );
      await load();
      onChanged?.();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const resolve = async (id: string, action: 'apply' | 'dismiss') => {
    setActing(id);
    try {
      const res = await fetch(APPLY_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ suggestion_id: id, action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || 'Action failed');
      await load();
      onChanged?.();
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setActing(null);
    }
  };

  const pending = suggestions.filter((s) => s.status === 'suggested');
  const history = suggestions.filter((s) => s.status !== 'suggested');

  return (
    <div className="border-t pt-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-purple-600" /> Vendor Activity
        </h4>
        <button
          onClick={checkReplies}
          disabled={syncing}
          className="px-2.5 py-1 border rounded-md hover:bg-gray-50 disabled:opacity-50 text-xs flex items-center gap-1.5"
        >
          <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} /> Check replies
        </button>
      </div>

      {note && <p className="text-xs text-muted-foreground mb-2">{note}</p>}

      {loading ? (
        <div className="p-3 bg-muted/30 rounded-lg animate-pulse h-12" />
      ) : (
        <div className="space-y-3">
          {/* Pending — needs human confirm */}
          {pending.length > 0 && (
            <div className="space-y-2">
              {pending.map((s) => {
                const meta = EVENT_META[s.event_type] ?? EVENT_META.other;
                const changes = changeSummary(s.proposed_changes);
                return (
                  <div key={s.id} className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <meta.Icon className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{meta.label}</div>
                        {s.summary && <div className="text-xs text-muted-foreground mt-0.5">{s.summary}</div>}
                        {changes.length > 0 && (
                          <ul className="text-xs text-amber-800 mt-1 list-disc list-inside">
                            {changes.map((c, i) => (
                              <li key={i}>{c}</li>
                            ))}
                          </ul>
                        )}
                        <ConfidenceTag confidence={s.confidence} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      {changes.length > 0 && (
                        <button
                          onClick={() => resolve(s.id, 'apply')}
                          disabled={acting === s.id}
                          className="px-2.5 py-1 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-xs flex items-center gap-1"
                        >
                          {acting === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                          Apply
                        </button>
                      )}
                      <button
                        onClick={() => resolve(s.id, 'dismiss')}
                        disabled={acting === s.id}
                        className="px-2.5 py-1 border rounded-md hover:bg-gray-50 disabled:opacity-50 text-xs flex items-center gap-1"
                      >
                        <XCircle className="h-3 w-3" /> Dismiss
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Resolved / auto-applied history */}
          {history.map((s) => {
            const meta = EVENT_META[s.event_type] ?? EVENT_META.other;
            const changes = changeSummary(s.proposed_changes);
            return (
              <div key={s.id} className="p-3 bg-muted/30 rounded-lg">
                <div className="flex items-start gap-2">
                  <meta.Icon className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{meta.label}</span>
                      <StatusTag status={s.status} />
                    </div>
                    {s.summary && <div className="text-xs text-muted-foreground mt-0.5">{s.summary}</div>}
                    {changes.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-1">{changes.join(' · ')}</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Raw replies with no extracted action */}
          {suggestions.length === 0 && replies.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              No vendor replies yet. Replies are checked automatically in the background; “Check
              replies” forces an immediate refresh.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ConfidenceTag({ confidence }: { confidence: number | null }) {
  if (confidence == null) return null;
  const pct = Math.round(confidence * 100);
  return <span className="inline-block text-[10px] text-muted-foreground mt-1">AI confidence {pct}%</span>;
}

function StatusTag({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    auto_applied: { label: 'Auto-applied', cls: 'bg-green-100 text-green-800 border-green-300' },
    applied: { label: 'Applied', cls: 'bg-green-100 text-green-800 border-green-300' },
    dismissed: { label: 'Dismissed', cls: 'bg-gray-100 text-gray-600 border-gray-300' },
  };
  const m = map[status] ?? map.dismissed;
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${m.cls}`}>{m.label}</span>;
}
