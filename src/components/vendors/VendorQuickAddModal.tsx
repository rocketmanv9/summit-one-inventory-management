'use client';

/**
 * VendorQuickAddModal — the single AI front door for vendor onboarding.
 *
 * One input, two paths:
 *  - Know the vendor? Type the name (or paste their website), hit the sparkle
 *    button, and AI fills in the whole record: canonical name, code, website,
 *    sender email domains, vendor type, description, and HQ city/state.
 *  - Don't know who sells it? Describe what you need ("crack sealant supplier
 *    near Portland") and "Search the web" returns real candidate businesses —
 *    pick one and it loads into the same review form.
 *
 * Saving goes through createVendorFromDraft → POST /api/inventory/vendors,
 * which also upserts the suggested email domains into
 * supply_chain.vendor_email_domains so the email → item-suggestions scanner
 * can match this vendor. "Open full form" hands the prefilled draft to the
 * existing VendorModal for the detailed path.
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
import { AlertCircle, Globe, Loader2, Mail, MapPin, Phone, Search, Sparkles, X } from 'lucide-react';
import { useVendorTypeTerms } from '@/hooks/useGVTerms';
import { createVendorFromDraft, type VendorDraft } from '@/lib/vendor-draft';
import { discoverVendors, type VendorCandidate } from '@/lib/ai/client';

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
  /** Existing vendor names — flags web-search candidates you already have. */
  existingNames?: string[];
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

/** Loose name normalization for "already in your vendors" matching. */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** "https://www.fastenal.com/x" → "fastenal.com" (for email-domain prefill). */
function domainFromWebsite(website: string | undefined): string | null {
  if (!website) return null;
  const d = website.trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#\s]/)[0];
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d) ? d : null;
}

const SEARCH_EXAMPLES = [
  'auto parts vendor near Portland',
  'asphalt sealcoat supplier near Salem OR',
  'equipment rental in Beaverton',
];

export function VendorQuickAddModal({ open, onClose, onSuccess, onReview, existingNames = [] }: VendorQuickAddModalProps) {
  const [phase, setPhase] = useState<'input' | 'results' | 'review'>('input');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiFilled, setAiFilled] = useState(false);
  const [form, setForm] = useState<QuickForm>(EMPTY_FORM);
  const [domains, setDomains] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Web-search path: candidate list + extra fields (street/zip/phone/email)
  // from the picked candidate that the quick form doesn't show but the draft keeps.
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<VendorCandidate[]>([]);
  const [extras, setExtras] = useState<Pick<VendorCandidate, 'street1' | 'zip' | 'phone' | 'email'> | null>(null);

  const { terms: vendorTypeTerms, loading: vendorTypeLoading } = useVendorTypeTerms();
  const existingSet = new Set(existingNames.map(normalizeName));

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
    setSearching(false);
    setCandidates([]);
    setExtras(null);
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
    setExtras(null);
    setError(null);
    setPhase('review');
  }

  /* ---- Web search ("I don't know who sells this") ---- */

  async function handleWebSearch() {
    const input = query.trim();
    if (input.length < 2 || searching) return;
    setSearching(true);
    setError(null);
    try {
      const found = await discoverVendors(input);
      setCandidates(found);
      setPhase('results');
      if (found.length === 0) {
        setError('No matches found — try a broader description or a different area.');
      }
    } catch {
      setError('Web search failed. Try again.');
    } finally {
      setSearching(false);
    }
  }

  /* ---- Gmail search ("we already email this company") ---- */

  const [mailSearching, setMailSearching] = useState(false);
  async function handleEmailSearch() {
    const input = query.trim();
    if (input.length < 2 || mailSearching) return;
    setMailSearching(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/vendor-from-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ query: input }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Email search failed.');
        return;
      }
      setCandidates(json.results || []);
      setPhase('results');
      if ((json.results || []).length === 0) {
        setError(
          json.searched > 0
            ? `Found ${json.searched} email(s) but couldn't extract a vendor — try the exact company name.`
            : 'Nothing in your email matches — try the web search instead.'
        );
      }
    } catch {
      setError('Email search failed. Try again.');
    } finally {
      setMailSearching(false);
    }
  }

  /** Load a web-search candidate into the review form (quick-add flow from here). */
  function pickCandidate(c: VendorCandidate) {
    const domain = domainFromWebsite(c.website) || (c.email ? c.email.split('@')[1] : null);
    setForm({
      name: c.name,
      code: c.code || '',
      vendor_type_term_id: '',
      website: c.website || '',
      description: c.category || '',
      city: c.city || '',
      state: c.state || '',
    });
    setDomains(domain ? [domain] : []);
    setExtras({ street1: c.street1, zip: c.zip, phone: c.phone, email: c.email });
    setAiFilled(true);
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
    const hasAddr = !!(form.city.trim() || form.state.trim() || extras?.street1);
    return {
      name: form.name.trim(),
      code: form.code.trim() || undefined,
      vendor_type_term_id: form.vendor_type_term_id || undefined,
      notes: form.description.trim() || undefined,
      website: form.website.trim() || undefined,
      address: hasAddr
        ? { street1: extras?.street1, city: form.city.trim(), state: form.state.trim(), zip: extras?.zip }
        : undefined,
      // Street/zip/phone/email ride along from a picked web-search candidate.
      contact: extras?.phone || extras?.email ? { phone: extras.phone, email: extras.email } : undefined,
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
      <DialogContent className={`${phase === 'results' ? 'max-w-xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" /> Quick Add Vendor
          </DialogTitle>
          <DialogDescription>
            {phase === 'input'
              ? 'Type a vendor name or website and AI fills in the rest — or describe what you need and search the web for suppliers.'
              : phase === 'results'
                ? 'Pick a supplier to load into the form — details fill in automatically.'
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

            {/* Don't know who sells it? Same input, web-search path. */}
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleWebSearch}
                disabled={query.trim().length < 2 || loading || searching || mailSearching}
              >
                {searching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" />}
                {searching ? 'Searching the web…' : 'Search the web for suppliers'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleEmailSearch}
                disabled={query.trim().length < 2 || loading || searching || mailSearching}
                title="Searches your connected Gmail for this company and pulls their contact details from real correspondence"
              >
                {mailSearching ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Mail className="h-4 w-4 mr-2" />}
                {mailSearching ? 'Searching your email…' : 'Find them in my email'}
              </Button>
              {query.trim().length < 2 && (
                <div className="flex flex-wrap gap-1.5">
                  {SEARCH_EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => setQuery(ex)}
                      className="rounded-full border px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              )}
            </div>

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
        ) : phase === 'results' ? (
          <div className="space-y-2 py-2">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {candidates.map((c, i) => {
              const already = existingSet.has(normalizeName(c.name));
              const addr = [c.street1, [c.city, c.state].filter(Boolean).join(', '), c.zip].filter(Boolean).join(' · ');
              return (
                <button
                  key={`${c.name}-${i}`}
                  type="button"
                  onClick={() => pickCandidate(c)}
                  className="w-full rounded-lg border p-3 text-left transition-colors hover:border-purple-400 hover:bg-purple-50/40"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{c.name}</span>
                    {c.category && <span className="text-xs text-muted-foreground">{c.category}</span>}
                    {already && (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        Already in your vendors
                      </span>
                    )}
                    <span className="ml-auto text-xs font-medium text-purple-600">Use</span>
                  </div>
                  <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {addr && <p className="flex items-center gap-1.5"><MapPin className="h-3 w-3 shrink-0" /> {addr}</p>}
                    {c.phone && <p className="flex items-center gap-1.5"><Phone className="h-3 w-3 shrink-0" /> {c.phone}</p>}
                    {c.website && <p className="flex items-center gap-1.5"><Globe className="h-3 w-3 shrink-0" /> {c.website}</p>}
                  </div>
                </button>
              );
            })}
            {candidates.length > 0 && (
              <p className="pt-1 text-center text-[11px] text-muted-foreground">
                Results come from a web search and may be incomplete — review after picking.
              </p>
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
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPhase(candidates.length > 0 ? 'results' : 'input')}
                disabled={saving}
              >
                Back
              </Button>
              <Button type="button" onClick={handleSave} disabled={saving || form.name.trim().length < 2}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {saving ? 'Saving…' : 'Add Vendor'}
              </Button>
            </>
          ) : phase === 'results' ? (
            <Button type="button" variant="ghost" onClick={() => setPhase('input')}>
              Back
            </Button>
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
