'use client';

/**
 * AI Item Suggestions — the "you should track this" review queue.
 *
 * The daily scanner (plus the Scan Now button) mines connected Gmail accounts
 * for purchase emails, extracts products not yet in the catalog, and queues
 * them here. Accept opens the item wizard pre-filled (name auto-runs the AI
 * suggest); Dismiss suppresses the item from future scans.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { apiWrite } from '@/lib/api-client';
import { HowItWorksCard, HowThisWorksButton, useHowItWorks } from '@/components/ui/HowItWorksCard';
import { Sparkles, Mail, RefreshCw, Plus, X, ExternalLink } from 'lucide-react';

interface Suggestion {
  id: string;
  item_name: string;
  item_description: string | null;
  quantity: number | null;
  unit_cost: number | null;
  currency: string | null;
  confidence: number;
  rationale: string | null;
  occurrences: number;
  vendor_id: string | null;
  vendor_name: string | null;
  email_subject: string | null;
  email_from: string | null;
  email_date: string | null;
  last_seen_at: string;
}

export default function ItemSuggestionsPage() {
  const help = useHowItWorks('inventory-item-suggestions-help');
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchSuggestions = useCallback(async () => {
    try {
      const res = await fetch('/api/inventory/item-suggestions');
      const { data } = await res.json();
      setSuggestions(data?.suggestions || []);
    } catch {
      setError('Failed to load suggestions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSuggestions(); }, [fetchSuggestions]);

  const handleScan = async () => {
    setScanning(true);
    setScanMessage('');
    setError('');
    try {
      const res = await apiWrite('/api/inventory/item-suggestions/scan', { method: 'POST', body: {} });
      const { data } = await res.json();
      if (!res.ok) {
        setError('Scan failed. Try again.');
        return;
      }
      if (data?.skippedNoConnection) {
        setScanMessage('No connected Gmail account — connect one in Settings → Integrations first.');
      } else if (data?.skippedNoOpenAI) {
        setScanMessage('AI is not configured on this environment.');
      } else {
        setScanMessage(
          `Scanned ${data?.messagesScanned ?? 0} email${data?.messagesScanned === 1 ? '' : 's'} — ` +
          `${data?.suggestionsCreated ?? 0} new suggestion${data?.suggestionsCreated === 1 ? '' : 's'}.`
        );
      }
      await fetchSuggestions();
    } catch {
      setError('Scan failed. Try again.');
    } finally {
      setScanning(false);
    }
  };

  const handleResolve = async (s: Suggestion, action: 'accept' | 'dismiss') => {
    setBusyId(s.id);
    setError('');
    try {
      const res = await apiWrite(`/api/inventory/item-suggestions/${s.id}/resolve`, {
        method: 'POST',
        body: { action },
      });
      if (!res.ok) {
        setError('Failed to update suggestion.');
        return;
      }
      if (action === 'accept') {
        // Hand off to the wizard pre-filled; name triggers the AI auto-fill.
        const p = new URLSearchParams();
        p.set('name', s.item_name);
        if (s.item_description) p.set('description', s.item_description);
        if (s.vendor_id) p.set('vendor_id', s.vendor_id);
        if (s.unit_cost != null) p.set('unit_cost', String(s.unit_cost));
        router.push(`/inventory/items/new?${p.toString()}`);
        return;
      }
      setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
    } catch {
      setError('Failed to update suggestion.');
    } finally {
      setBusyId(null);
    }
  };

  const confidenceBadge = (c: number) => {
    const pct = Math.round(c * 100);
    const cls = c >= 0.8
      ? 'bg-green-100 text-green-800'
      : c >= 0.6 ? 'bg-yellow-100 text-yellow-800' : 'bg-muted text-muted-foreground';
    return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{pct}% match</span>;
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="AI Item Suggestions"
          description="Products spotted in your email that aren't tracked in inventory yet."
          actions={
            <>
              {!help.show && <HowThisWorksButton onClick={help.open} />}
              <button
                onClick={handleScan}
                disabled={scanning}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${scanning ? 'animate-spin' : ''}`} />
                {scanning ? 'Scanning…' : 'Scan now'}
              </button>
            </>
          }
        />

        {help.show && (
          <HowItWorksCard
            title="How AI item suggestions work"
            onDismiss={help.dismiss}
            steps={[
              { title: 'We read your purchase email', body: 'Connected Gmail accounts (Settings → Integrations) are scanned daily for order confirmations, receipts, and invoices — plus on demand with Scan Now.' },
              { title: 'AI finds untracked products', body: 'Each email is checked for physical products you buy but don’t track in inventory yet. Services, subscriptions, and junk mail are ignored.' },
              { title: 'You decide', body: 'Accept opens the item wizard pre-filled with the name, vendor, and cost — AI fills in category, SKU, and unit of measure. Dismiss and the item is never suggested again.' },
              { title: 'Repeats rise to the top', body: 'If the same product keeps showing up in your email, its "seen ×" count climbs — a strong hint it belongs in inventory.' },
            ]}
            glossary={[
              { Icon: Sparkles, term: 'Confidence', blurb: 'how sure the AI is this is a real, trackable product purchase' },
              { Icon: Mail, term: 'Source email', blurb: 'the message the suggestion came from — subject and date shown on each card' },
              { Icon: Plus, term: 'Accept', blurb: 'marks accepted and drops you into the Add Item wizard, pre-filled' },
            ]}
          />
        )}

        {scanMessage && (
          <div className="rounded-lg border bg-card px-4 py-3 text-sm">{scanMessage}</div>
        )}
        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : suggestions.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card px-6 py-16 text-center">
            <Sparkles className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="font-medium">No suggestions right now</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              The AI scans your connected email daily for order confirmations and receipts,
              and suggests products you buy but don&apos;t track yet. Hit &quot;Scan now&quot; to check
              immediately, or connect a Gmail account under Settings → Integrations.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {suggestions.map((s) => (
              <div key={s.id} className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{s.item_name}</p>
                      {confidenceBadge(s.confidence)}
                      {s.occurrences > 1 && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          seen {s.occurrences}×
                        </span>
                      )}
                    </div>
                    {s.item_description && (
                      <p className="mt-1 text-sm text-muted-foreground">{s.item_description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {s.vendor_name && <span>Vendor: <span className="text-foreground">{s.vendor_name}</span></span>}
                      {s.unit_cost != null && <span>Unit cost: <span className="text-foreground">${Number(s.unit_cost).toLocaleString()}</span></span>}
                      {s.quantity != null && <span>Qty seen: <span className="text-foreground">{s.quantity}</span></span>}
                    </div>
                    {s.rationale && (
                      <p className="mt-2 text-xs italic text-muted-foreground">“{s.rationale}”</p>
                    )}
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Mail className="h-3.5 w-3.5" />
                      <span className="truncate">
                        {s.email_subject || '(no subject)'}
                        {s.email_date ? ` — ${new Date(s.email_date).toLocaleDateString()}` : ''}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => handleResolve(s, 'accept')}
                      disabled={busyId === s.id}
                      className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      <Plus className="h-4 w-4" />
                      Add to inventory
                      <ExternalLink className="h-3 w-3 opacity-70" />
                    </button>
                    <button
                      onClick={() => handleResolve(s, 'dismiss')}
                      disabled={busyId === s.id}
                      className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
