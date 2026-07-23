'use client';

/**
 * VendorQuickAddModal — the "stupid easy" front door for vendor onboarding.
 *
 * Type a vendor name (or paste their website), hit the sparkle button, and AI
 * fills in the whole record: canonical name, code, website, sender email
 * domains, vendor type, description, and HQ city/state. Review, one save.
 *
 * Saving goes through the same path as the discovery flow
 * (createVendorFromDraft → POST /api/inventory/vendors), which also upserts
 * the suggested email domains into supply_chain.vendor_email_domains so the
 * email → item-suggestions scanner can match this vendor. "Open full form"
 * hands the prefilled draft to the existing VendorModal for the detailed path.
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Loader2, Sparkles, X } from 'lucide-react';
import { useVendorTypeTerms } from '@/hooks/useGVTerms';
import { createVendorFromDraft, type VendorDraft } from '@/lib/vendor-draft';

interface VendorSuggestion {
  name: string;
  code: string;
  website: string | null;
  email_domains: string[];
  vendor_type_term_id: string | null;
  vendor_type_label: string | null;
  description: string;
  city: string | null;
  state: string | null;
}

interface VendorQuickAddModalProps {
  open: boolean;
  onClose: () => void;
  /** Fired after a successful save with the new vendor's id + name. */
  onSuccess: (result: { id: string; name: string }) => void;
  /** "Open full form" — hand the prefilled draft to the detailed VendorModal. */
  onReview: (draft: VendorDraft) => void;
}

interface QuickForm {
  name: string;
  code: string;
  vendor_type_term_id: string;
  website: string;
  description: string;
  city: string;
  state: string;
}

const EMPTY_FORM: QuickForm = {
  name: '', code: '', vendor_type_term_id: '', website: '', description: '', city: '', state: '',
};

const SELECT_CLS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export function VendorQuickAddModal({ open, onClose, onSuccess, onReview }: VendorQuickAddModalProps) {
  const [phase, setPhase] = useState<'input' | 'review'>('input');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiFilled, setAiFilled] = useState(false);
  const [form, setForm] = useState<QuickForm>(EMPTY_FORM);
  const [domains, setDomains] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { terms: vendorTypeTerms, loading: vendorTypeLoading } = useVendorTypeTerms();

  // Reset everything each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setPhase('input');
    setQuery('');
    setLoading(false);
    setAiFilled(false);
    setForm(EMPTY_FORM);
    setDomains([]);
    setNewDomain('');
    setSaving(false);
    setError(null);
  }, [open]);

  function setField(field: keyof QuickForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError(null);
  }

  /* ---- AI suggest ---- */

  async function handleSuggest() {
    const input = query.trim();
    if (input.length < 2 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/vendor-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name_or_url: input }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'AI suggestion failed' }));
        setError(err.error || 'AI suggestion failed');
        return;
      }
      const { suggestion } = (await res.json()) as { suggestion: VendorSuggestion };
      setForm({
        name: suggestion.name || input,
        code: suggestion.code || '',
        vendor_type_term_id: suggestion.vendor_type_term_id || '',
        website: suggestion.website || '',
        description: suggestion.description || '',
        city: suggestion.city || '',
        state: suggestion.state || '',
      });
      setDomains(suggestion.email_domains || []);
      setAiFilled(true);
      setPhase('review');
    } catch {
      setError('Failed to get AI suggestions. Try again.');
    } finally {
      setLoading(false);
    }
  }

  /** Skip AI (or after an AI failure): go to review with just the typed name. */
  function continueManually() {
    const input = query.trim();
    if (input.length < 2) return;
    setForm({ ...EMPTY_FORM, name: input });
    setDomains([]);
    setAiFilled(false);
    setError(null);
    setPhase('review');
  }

  /* ---- Email domain chips ---- */

  function addDomain() {
    const d = newDomain.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
    if (!d) return;
    if (!domains.includes(d)) setDomains((prev) => [...prev, d]);
    setNewDomain('');
  }

  function removeDomain(domain: string) {
    setDomains((prev) => prev.filter((d) => d !== domain));
  }

  /* ---- Save (shared path with the discovery flow) ---- */

  function buildDraft(): VendorDraft {
    const hasAddr = !!(form.city.trim() || form.state.trim());
    return {
      name: form.name.trim(),
      code: form.code.trim() || undefined,
      vendor_type_term_id: form.vendor_type_term_id || undefined,
      notes: form.description.trim() || undefined,
      website: form.website.trim() || undefined,
      address: hasAddr ? { city: form.city.trim(), state: form.state.trim() } : undefined,
      email_domains: domains.length > 0 ? domains : undefined,
    };
  }

  async function handleSave() {
    if (form.name.trim().length < 2) {
      setError('Vendor name is required (at least 2 characters).');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await createVendorFromDraft(buildDraft());
      onSuccess(created);
    } catch (err: any) {
      setError(err?.message || 'Failed to save vendor.');
    } finally {
      setSaving(false);
    }
  }

  /* ---- Render ---- */

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && !saving) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" /> Quick Add Vendor
          </DialogTitle>
          <DialogDescription>
            {phase === 'input'
              ? 'Type a vendor name or paste their website — AI fills in the rest.'
              : 'Review the AI-filled details, then save. One click and you’re done.'}
          </DialogDescription>
        </DialogHeader>

        {phase === 'input' ? (
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label htmlFor="quick-vendor-query">Vendor name or website</Label>
              <div className="flex gap-2">
                <Input
                  id="quick-vendor-query"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); if (error) setError(null); }}
                  placeholder="e.g. Grainger, or https://fastenal.com"
                  autoFocus
                  disabled={loading}
                  className="flex-1"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && query.trim().length >= 2) {
                      e.preventDefault();
                      handleSuggest();
                    }
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  onClick={handleSuggest}
                  disabled={query.trim().length < 2 || loading}
                  title="AI auto-fill vendor details"
                  className="shrink-0"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                </Button>
              </div>
              {loading && (
                <p className="text-xs text-muted-foreground animate-pulse">
                  Looking up vendor details…
                </p>
              )}
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {query.trim().length >= 2 && !loading && (
              <button
                type="button"
                onClick={continueManually}
                className="text-xs font-medium text-muted-foreground hover:text-foreground underline"
              >
                Skip AI — fill in details myself
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {aiFilled && (
              <Alert className="border-purple-200 bg-purple-50/60">
                <Sparkles className="h-4 w-4 text-purple-500" />
                <AlertDescription className="text-purple-900">
                  Details filled in by AI. Review and adjust as needed.
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="quick-vendor-name">Vendor Name *</Label>
              <Input
                id="quick-vendor-name"
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="quick-vendor-code">Vendor Code</Label>
                <Input
                  id="quick-vendor-code"
                  value={form.code}
                  onChange={(e) => setField('code', e.target.value.toUpperCase())}
                  placeholder="e.g. GRAING"
                  className="font-mono"
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quick-vendor-type">Vendor Type</Label>
                <select
                  id="quick-vendor-type"
                  value={form.vendor_type_term_id}
                  onChange={(e) => setField('vendor_type_term_id', e.target.value)}
                  className={SELECT_CLS}
                  disabled={saving}
                >
                  <option value="">-- Select type --</option>
                  {vendorTypeLoading ? <option disabled>Loading…</option> :
                    vendorTypeTerms.map((t) => <option key={t.term_id} value={t.term_id}>{t.label}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quick-vendor-website">Website</Label>
              <Input
                id="quick-vendor-website"
                value={form.website}
                onChange={(e) => setField('website', e.target.value)}
                placeholder="https://vendor.com"
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label>Email Domains</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {domains.map((d) => (
                  <span
                    key={d}
                    className="inline-flex items-center gap-1 rounded-full bg-purple-50 border border-purple-200 px-2 py-0.5 text-xs font-mono text-purple-800"
                  >
                    {d}
                    <button
                      type="button"
                      onClick={() => removeDomain(d)}
                      disabled={saving}
                      className="text-purple-400 hover:text-purple-700"
                      aria-label={`Remove ${d}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <Input
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDomain(); } }}
                  onBlur={addDomain}
                  placeholder="add domain…"
                  className="h-7 w-36 text-xs"
                  disabled={saving}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Emails from these domains are matched to this vendor — they power AI item
                suggestions from order confirmations and receipts.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quick-vendor-desc">Description</Label>
              <textarea
                id="quick-vendor-desc"
                value={form.description}
                onChange={(e) => setField('description', e.target.value)}
                rows={2}
                className="flex min-h-[52px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="What do they supply?"
                disabled={saving}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="quick-vendor-city">City</Label>
                <Input id="quick-vendor-city" value={form.city}
                  onChange={(e) => setField('city', e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quick-vendor-state">State</Label>
                <Input id="quick-vendor-state" value={form.state}
                  onChange={(e) => setField('state', e.target.value)} disabled={saving} />
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {phase === 'review' ? (
            <>
              <button
                type="button"
                onClick={() => onReview(buildDraft())}
                disabled={saving}
                className="mr-auto text-xs font-medium text-muted-foreground hover:text-foreground underline disabled:opacity-50"
              >
                Open full form (contacts, terms, items…)
              </button>
              <Button type="button" variant="ghost" onClick={() => setPhase('input')} disabled={saving}>
                Back
              </Button>
              <Button type="button" onClick={handleSave} disabled={saving || form.name.trim().length < 2}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {saving ? 'Saving…' : 'Add Vendor'}
              </Button>
            </>
          ) : (
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
