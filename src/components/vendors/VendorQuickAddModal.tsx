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
import { AlertCircle, AlertTriangle, Globe, Loader2, Mail, MapPin, Phone, Search, Sparkles, X } from 'lucide-react';
import { useVendorTypeTerms } from '@/hooks/useGVTerms';
import {
  createVendorFromDraft,
  addDraftToExistingVendor,
  checkVendorMatches,
  type VendorDraft,
  type VendorMatchResult,
} from '@/lib/vendor-draft';
import { discoverVendors, type VendorCandidate } from '@/lib/ai/client';
import { VendorMatchCard } from '@/components/vendors/VendorMatchCard';

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
  /** "Use existing vendor" from the duplicate gate — navigate to / select it. */
  onUseExisting?: (vendor: { id: string; name: string }) => void;
}

interface QuickForm {
  name: string;
  code: string;
  vendor_type_term_id: string;
  website: string;
  description: string;
  city: string;
  state: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
}

const EMPTY_FORM: QuickForm = {
  name: '', code: '', vendor_type_term_id: '', website: '', description: '', city: '', state: '',
  contact_name: '', contact_email: '', contact_phone: '',
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

export function VendorQuickAddModal({ open, onClose, onSuccess, onReview, existingNames = [], onUseExisting }: VendorQuickAddModalProps) {
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
  // Duplicate gate: matches for the vendor being reviewed, whether we're still
  // checking, and whether the user has explicitly chosen "create new anyway".
  const [matches, setMatches] = useState<VendorMatchResult[]>([]);
  const [strongThreshold, setStrongThreshold] = useState(72);
  const [matchChecking, setMatchChecking] = useState(false);
  const [forceCreate, setForceCreate] = useState(false);
  // False when the server said the conflict can't be forced (exact-name 409) —
  // hides the "create anyway" escape hatch for that case.
  const [canForce, setCanForce] = useState(true);
  const [attachingTo, setAttachingTo] = useState<string | null>(null);
  // Results phase: best existing-vendor match per candidate index, so we can flag
  // "Already in your vendors" even when the name differs but the address matches.
  const [candidateMatches, setCandidateMatches] = useState<Record<number, VendorMatchResult>>({});

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
    setMatches([]);
    setMatchChecking(false);
    setForceCreate(false);
    setCanForce(true);
    setAttachingTo(null);
    setCandidateMatches({});
  }, [open]);

  /**
   * Annotate discovery/email candidates with their best existing-vendor match so
   * the user sees "Already in your vendors" (name OR address) before picking.
   * Fire-and-forget; failures just leave a candidate un-annotated.
   */
  async function annotateCandidates(list: VendorCandidate[]) {
    const entries = await Promise.all(list.map(async (c, i) => {
      const domain = domainFromWebsite(c.website) || (c.email ? c.email.split('@')[1] : null);
      const res = await checkVendorMatches({
        name: c.name,
        street1: c.street1 ?? null,
        city: c.city ?? null,
        state: c.state ?? null,
        zip: c.zip ?? null,
        website: c.website ?? null,
        email: c.email ?? null,
        domain,
        phone: c.phone ?? null,
      });
      const best = res.matches.find((m) => m.confidence >= res.strongThreshold);
      return best ? ([i, best] as const) : null;
    }));
    const map: Record<number, VendorMatchResult> = {};
    for (const e of entries) if (e) map[e[0]] = e[1];
    setCandidateMatches(map);
  }

  // Whenever we land on (or edit within) the review phase, re-check for existing
  // vendors this candidate might duplicate. All four add paths funnel here, so
  // this is the single client-side gate. Debounced so typing in the form doesn't
  // hammer the endpoint. Any strong match forces an explicit override to save.
  const reviewName = phase === 'review' ? form.name.trim() : '';
  useEffect(() => {
    if (phase !== 'review' || reviewName.length < 2) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    setMatchChecking(true);
    const t = setTimeout(async () => {
      const domain = domainFromWebsite(form.website)
        || (form.contact_email.includes('@') ? form.contact_email.split('@')[1] : null);
      const res = await checkVendorMatches({
        name: reviewName,
        street1: extras?.street1 ?? null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        zip: extras?.zip ?? null,
        website: form.website.trim() || null,
        email: form.contact_email.trim() || null,
        domain: domain,
        phone: form.contact_phone.trim() || extras?.phone || null,
      });
      if (cancelled) return;
      setMatches(res.matches);
      setStrongThreshold(res.strongThreshold);
      setMatchChecking(false);
      // Editing the candidate invalidates a prior "create anyway" decision
      // (and any server verdict that the conflict couldn't be forced).
      setForceCreate(false);
      setCanForce(true);
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reviewName, form.city, form.state, form.website, form.contact_email, form.contact_phone, extras]);

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
        ...EMPTY_FORM,
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
      setCandidateMatches({});
      setPhase('results');
      if (found.length === 0) {
        setError('No matches found — try a broader description or a different area.');
      } else {
        void annotateCandidates(found);
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
      setCandidateMatches({});
      setPhase('results');
      if ((json.results || []).length > 0) {
        void annotateCandidates(json.results);
      }
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
      contact_name: (c as any).contact_name || '',
      contact_email: c.email || '',
      contact_phone: c.phone || '',
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
      // The PERSON: whole email + name + phone (Grant 2026-08-04) — creates a
      // real primary contact on save. Sender domains derive from it silently.
      contact:
        form.contact_name.trim() || form.contact_email.trim() || form.contact_phone.trim()
          ? {
              name: form.contact_name.trim() || undefined,
              email: form.contact_email.trim() || undefined,
              phone: form.contact_phone.trim() || undefined,
            }
          : undefined,
      email_domains: (() => {
        const derived = [
          ...domains,
          form.contact_email.includes('@') ? form.contact_email.split('@')[1] : null,
          domainFromWebsite(form.website),
        ].filter(Boolean) as string[];
        return derived.length > 0 ? [...new Set(derived)] : undefined;
      })(),
    };
  }

  // Strong (blocking) matches vs. low-confidence hints. A strong match blocks
  // confirm until the user explicitly chooses "create new anyway".
  const strongMatches = matches.filter((m) => m.confidence >= strongThreshold);
  const hintMatches = matches.filter((m) => m.confidence < strongThreshold);
  const blockedByMatch = strongMatches.length > 0 && !forceCreate;

  async function handleSave() {
    if (form.name.trim().length < 2) {
      setError('Vendor name is required (at least 2 characters).');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // forceCreate is only ever true after the user clicked "Create new anyway"
      // on the warning, so it flows to the server guard as force:true.
      const created = await createVendorFromDraft({ ...buildDraft(), force: forceCreate || undefined });
      onSuccess(created);
    } catch (err: any) {
      // Server-side duplicate gate (409): never a dead end. The guard attaches
      // its matches to the error details — surface them as the same match cards
      // so the user can pick "use existing", attach a branch, or force-create.
      const serverMatches = err?.details?.matches;
      if (Array.isArray(serverMatches) && serverMatches.length > 0) {
        setMatches(serverMatches as VendorMatchResult[]);
        setForceCreate(false);
        setCanForce(err?.details?.forceable !== false);
        setError(err?.message || 'This looks like an existing vendor — resolve the match below.');
      } else {
        setError(err?.message || 'Failed to save vendor.');
      }
    } finally {
      setSaving(false);
    }
  }

  /** "Use existing vendor" — don't create anything; hand the match to the parent. */
  function handleUseExisting(match: VendorMatchResult) {
    onUseExisting?.({ id: match.vendor_id, name: match.vendor_name });
  }

  /** "Add as new address/branch" — attach this draft to the matched vendor. */
  async function handleAttachToExisting(match: VendorMatchResult) {
    setAttachingTo(match.vendor_id);
    setError(null);
    try {
      const result = await addDraftToExistingVendor(match.vendor_id, match.vendor_name, buildDraft());
      onSuccess(result);
    } catch (err: any) {
      setError(err?.message || 'Failed to add branch to the existing vendor.');
    } finally {
      setAttachingTo(null);
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
              const match = candidateMatches[i];
              const already = !!match || existingSet.has(normalizeName(c.name));
              const matchLabel = match
                ? `Already in your vendors — ${match.vendor_name}`
                : 'Already in your vendors';
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
                      <span
                        className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700"
                        title={match?.reasons?.join(' · ')}
                      >
                        {matchLabel}
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

            {matchChecking && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Checking for existing vendors…
              </p>
            )}

            {/* Strong duplicates — red/prominent cards; block confirm until resolved. */}
            {strongMatches.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-red-700">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  This looks like {strongMatches.length === 1 ? 'a vendor' : 'vendors'} you already have
                </p>
                {strongMatches.map((m) => (
                  <VendorMatchCard
                    key={m.vendor_id}
                    match={m}
                    strong
                    onUseExisting={handleUseExisting}
                    onAttach={handleAttachToExisting}
                    attachingTo={attachingTo}
                    disabled={saving || attachingTo !== null}
                  />
                ))}
                {!canForce ? (
                  <p className="text-xs text-muted-foreground">
                    A vendor with this exact name already exists — use it, or change the name to create a separate vendor.
                  </p>
                ) : !forceCreate ? (
                  <button
                    type="button"
                    onClick={() => setForceCreate(true)}
                    disabled={saving || attachingTo !== null}
                    className="w-full pt-0.5 text-xs font-medium text-red-600 hover:text-red-700 underline disabled:opacity-50"
                  >
                    No — these are different companies. Create a new vendor anyway.
                  </button>
                ) : (
                  <div className="flex items-center justify-between gap-2 rounded-md bg-red-50 px-2.5 py-1.5">
                    <span className="text-xs font-medium text-red-700">
                      Creating a new vendor despite the match{strongMatches.length === 1 ? '' : 'es'}.
                    </span>
                    <button
                      type="button"
                      onClick={() => setForceCreate(false)}
                      className="text-xs font-medium text-muted-foreground hover:text-foreground underline"
                    >
                      Undo
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Low-confidence — subtle cards, passive hint, does not block. */}
            {hintMatches.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Similar {hintMatches.length === 1 ? 'vendor' : 'vendors'} already in your list —
                  double-check this isn&apos;t a duplicate:
                </p>
                {hintMatches.map((m) => (
                  <VendorMatchCard
                    key={m.vendor_id}
                    match={m}
                    strong={false}
                    onUseExisting={handleUseExisting}
                    disabled={saving || attachingTo !== null}
                  />
                ))}
              </div>
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
              <Label>Contact person</Label>
              <div className="grid grid-cols-2 gap-3">
                <Input value={form.contact_name}
                  onChange={(e) => setField('contact_name', e.target.value)}
                  placeholder="Name" disabled={saving} />
                <Input value={form.contact_phone}
                  onChange={(e) => setField('contact_phone', e.target.value)}
                  placeholder="Phone" disabled={saving} />
              </div>
              <Input value={form.contact_email}
                onChange={(e) => setField('contact_email', e.target.value)}
                placeholder="person@vendor.com" type="email" disabled={saving} />
              <p className="text-xs text-muted-foreground">
                Saved as the vendor&apos;s primary contact. Their email domain is matched
                automatically so this vendor&apos;s emails power AI item suggestions.
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
              <Button
                type="button"
                onClick={handleSave}
                disabled={saving || attachingTo !== null || form.name.trim().length < 2 || blockedByMatch}
                title={blockedByMatch ? 'Resolve the duplicate match above first' : undefined}
              >
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {saving ? 'Saving…' : forceCreate ? 'Create New Vendor' : 'Add Vendor'}
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
