'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
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
import { AlertCircle, Loader2, Search, MapPin, Plus, Trash2 } from 'lucide-react';
import { searchVendorOnline } from '@/lib/ai/client';
import type { VendorDraft } from '@/lib/vendor-draft';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { geocodeStructured } from '@/lib/geocode';
import { useVendorTypeTerms } from '@/hooks/useGVTerms';
import { AppError } from '@rocketmanv9/chassis/errors';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

/** Minimal shape accepted in edit mode. The vendors-page row and the
 *  SupplyChainRPC vendor row both satisfy this (extra fields are ignored —
 *  the modal re-fetches the full graph on open). */
export interface VendorLike {
  id: string;
  name: string;
  code?: string | null;
  last_event_id?: string | null;
}

interface VendorModalProps {
  open: boolean;
  onClose: () => void;
  /** Fired after a successful save. Receives the vendor id + name so callers can
   *  auto-select without a re-query race. */
  onSuccess: (result: { id: string; name: string }) => void;
  /** Pre-fill the name (triggers AI search automatically) in create mode. */
  initialName?: string;
  /** Pre-fill the full form from a structured draft (create mode). Takes
   *  precedence over `initialName` and skips the automatic online search —
   *  used by the "Review & edit" path of the vendor discovery flow. */
  initialDraft?: VendorDraft | null;
  /** Pass a vendor to enter edit mode. */
  vendor?: VendorLike | null;
}

type VendorCodeSettings = {
  vendor_code_strategy: 'manual' | 'sequential' | 'hybrid' | 'import';
  vendor_code_required: boolean;
  vendor_code_case: 'upper' | 'lower' | 'preserve';
  vendor_code_min_length: number | null;
  vendor_code_max_length: number | null;
  vendor_code_prefix: string | null;
  vendor_code_suffix: string | null;
  vendor_code_allowed_chars: string | null;
  vendor_code_regex: string | null;
  vendor_code_user_editable: boolean;
  vendor_code_immutable_after_use: boolean;
  vendor_code_sequence_padding: number | null;
  vendor_code_next_seq: number | null;
};

/** One editable location row. `id` is set for rows already persisted in
 *  supply_chain.vendor_addresses. */
interface AddressDraft {
  id?: string;
  address_type: 'billing' | 'shipping' | 'general';
  label: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
}

/** One editable contact row. `id` is set for rows already persisted in
 *  supply_chain.vendor_contacts. */
interface ContactDraft {
  id?: string;
  name: string;
  email: string;
  phone: string;
  title: string;
  is_primary: boolean;
}

interface BasicsState {
  name: string;
  code: string;
  vendor_type_term_id: string;
  payment_terms: string;
  lead_time_days: string;
  notes: string;
}

function emptyBasics(): BasicsState {
  return { name: '', code: '', vendor_type_term_id: '', payment_terms: 'NET30', lead_time_days: '', notes: '' };
}

function emptyAddress(): AddressDraft {
  return {
    address_type: 'general', label: '', street1: '', street2: '',
    city: '', state: '', zip: '', country: '', latitude: null, longitude: null,
  };
}

function emptyContact(): ContactDraft {
  return { name: '', email: '', phone: '', title: '', is_primary: false };
}

function addressHasContent(a: AddressDraft): boolean {
  return !!(a.street1.trim() || a.city.trim() || a.state.trim() || a.zip.trim() || a.label.trim());
}

function contactHasContent(c: ContactDraft): boolean {
  return !!(c.name.trim() || c.email.trim() || c.phone.trim() || c.title.trim());
}

const SELECT_CLS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function VendorModal({ open, onClose, onSuccess, initialName, initialDraft, vendor }: VendorModalProps) {
  const isEdit = !!vendor;
  // AMAZON-BIZ (and other integration-managed) vendors own their identity via the
  // integration — keep the code field locked so edits don't break the link.
  const isIntegrationVendor = vendor?.code === 'AMAZON-BIZ';

  const [basics, setBasics] = useState<BasicsState>(emptyBasics);
  const [addresses, setAddresses] = useState<AddressDraft[]>([emptyAddress()]);
  const [contacts, setContacts] = useState<ContactDraft[]>([]);
  const [removedAddressIds, setRemovedAddressIds] = useState<string[]>([]);
  const [removedContactIds, setRemovedContactIds] = useState<string[]>([]);
  // OCC token for edit saves — kept fresh from the GET detail load.
  const [lastEventId, setLastEventId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [savingMsg, setSavingMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codeSettings, setCodeSettings] = useState<VendorCodeSettings | null>(null);

  const { terms: vendorTypeTerms, loading: vendorTypeLoading } = useVendorTypeTerms();

  /* ---- Vendor code helpers (lifted from AddVendorModal) ---- */

  const normalizeVendorCode = useCallback((value: string) => {
    if (!codeSettings) return value;
    if (codeSettings.vendor_code_case === 'upper') return value.toUpperCase();
    if (codeSettings.vendor_code_case === 'lower') return value.toLowerCase();
    return value;
  }, [codeSettings]);

  const vendorCodeHelp = useMemo(() => {
    if (!codeSettings) return null;
    if (codeSettings.vendor_code_strategy === 'sequential') return 'Leave blank to auto-generate a sequential vendor code.';
    if (codeSettings.vendor_code_strategy === 'hybrid') return 'Leave blank to auto-generate or enter a custom code.';
    if (codeSettings.vendor_code_strategy === 'import') return 'Codes are expected from imports; use this only when needed.';
    return 'Enter a vendor code that matches your tenant rules.';
  }, [codeSettings]);

  const vendorCodeRules = useMemo(() => {
    if (!codeSettings) return [] as string[];
    const rules: string[] = [];
    if (codeSettings.vendor_code_prefix) rules.push(`Prefix: ${codeSettings.vendor_code_prefix}`);
    if (codeSettings.vendor_code_suffix) rules.push(`Suffix: ${codeSettings.vendor_code_suffix}`);
    if (codeSettings.vendor_code_min_length || codeSettings.vendor_code_max_length) {
      rules.push(`Length: ${codeSettings.vendor_code_min_length ?? '1'}-${codeSettings.vendor_code_max_length ?? '∞'}`);
    }
    if (codeSettings.vendor_code_allowed_chars) rules.push(`Allowed: ${codeSettings.vendor_code_allowed_chars}`);
    if (codeSettings.vendor_code_regex) rules.push(`Regex: ${codeSettings.vendor_code_regex}`);
    if (codeSettings.vendor_code_case !== 'preserve') rules.push(`Case: ${codeSettings.vendor_code_case}`);
    return rules;
  }, [codeSettings]);

  const nextSequentialCode = useMemo(() => {
    if (!codeSettings) return null;
    if (codeSettings.vendor_code_next_seq === null || codeSettings.vendor_code_next_seq === undefined) return null;
    const padding = Math.max(1, codeSettings.vendor_code_sequence_padding ?? 4);
    const core = (codeSettings.vendor_code_next_seq + 1).toString().padStart(padding, '0');
    return normalizeVendorCode(`${codeSettings.vendor_code_prefix || ''}${core}${codeSettings.vendor_code_suffix || ''}`);
  }, [codeSettings, normalizeVendorCode]);

  const validateVendorCode = useCallback((value: string): string[] => {
    if (!codeSettings) return [];
    const code = value.trim();
    const errors: string[] = [];
    if (!code) {
      if (codeSettings.vendor_code_required && codeSettings.vendor_code_strategy === 'manual') {
        errors.push('Vendor code is required.');
      }
      return errors;
    }
    if (codeSettings.vendor_code_min_length && code.length < codeSettings.vendor_code_min_length) {
      errors.push(`Vendor code must be at least ${codeSettings.vendor_code_min_length} characters.`);
    }
    if (codeSettings.vendor_code_max_length && code.length > codeSettings.vendor_code_max_length) {
      errors.push(`Vendor code must be at most ${codeSettings.vendor_code_max_length} characters.`);
    }
    if (codeSettings.vendor_code_prefix && !code.startsWith(codeSettings.vendor_code_prefix)) {
      errors.push(`Vendor code must start with ${codeSettings.vendor_code_prefix}.`);
    }
    if (codeSettings.vendor_code_suffix && !code.endsWith(codeSettings.vendor_code_suffix)) {
      errors.push(`Vendor code must end with ${codeSettings.vendor_code_suffix}.`);
    }
    if (codeSettings.vendor_code_allowed_chars) {
      try {
        if (!new RegExp(`^[${codeSettings.vendor_code_allowed_chars}]+$`).test(code)) {
          errors.push('Vendor code contains invalid characters.');
        }
      } catch { errors.push('Vendor code rules are misconfigured.'); }
    }
    if (codeSettings.vendor_code_regex) {
      try {
        if (!new RegExp(codeSettings.vendor_code_regex).test(code)) errors.push('Vendor code does not match required format.');
      } catch { errors.push('Vendor code regex is invalid.'); }
    }
    return errors;
  }, [codeSettings]);

  const isCodeDisabled =
    isIntegrationVendor ||
    codeSettings?.vendor_code_strategy === 'sequential' ||
    (isEdit && codeSettings?.vendor_code_user_editable === false);

  /* ---- Load tenant code settings on open ---- */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await SupplyChainRPC.getTenantSettings();
        if (cancelled) return;
        setCodeSettings({
          vendor_code_strategy: s.vendor_code_strategy,
          vendor_code_required: s.vendor_code_required,
          vendor_code_case: s.vendor_code_case,
          vendor_code_min_length: s.vendor_code_min_length,
          vendor_code_max_length: s.vendor_code_max_length,
          vendor_code_prefix: s.vendor_code_prefix,
          vendor_code_suffix: s.vendor_code_suffix,
          vendor_code_allowed_chars: s.vendor_code_allowed_chars,
          vendor_code_regex: s.vendor_code_regex,
          vendor_code_user_editable: s.vendor_code_user_editable,
          vendor_code_immutable_after_use: s.vendor_code_immutable_after_use,
          vendor_code_sequence_padding: s.vendor_code_sequence_padding,
          vendor_code_next_seq: s.vendor_code_next_seq,
        });
      } catch (err) {
        console.error('Error fetching vendor code settings:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  /* ---- Seed form on open (edit: GET full graph; create: empty/AI search) ---- */
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSearchDone(false);
    setSubmitting(false);
    setSavingMsg(null);
    setRemovedAddressIds([]);
    setRemovedContactIds([]);

    if (isEdit && vendor) {
      setLoading(true);
      let cancelled = false;
      (async () => {
        try {
          const res = await fetch(`/api/inventory/vendors/${vendor.id}`);
          if (!res.ok) throw AppError.internal('Failed to load vendor');
          const { data } = await res.json();
          if (cancelled || !data) return;
          setBasics({
            name: data.name || '',
            code: data.code || '',
            vendor_type_term_id: data.vendor_type_term_id || data.vendor_type_id || '',
            payment_terms: data.payment_terms || 'NET30',
            lead_time_days: data.lead_time_days != null ? String(data.lead_time_days) : '',
            notes: data.notes || '',
          });
          setLastEventId(data.last_event_id ?? null);
          const addrs: AddressDraft[] = (data.addresses || []).map((a: any) => ({
            id: a.id,
            address_type: a.address_type || 'general',
            label: a.label || '', street1: a.street1 || '', street2: a.street2 || '',
            city: a.city || '', state: a.state || '', zip: a.zip || '', country: a.country || '',
            latitude: a.latitude ?? null, longitude: a.longitude ?? null,
          }));
          setAddresses(addrs.length ? addrs : [emptyAddress()]);
          const cons: ContactDraft[] = (data.contacts || []).map((c: any) => ({
            id: c.id, name: c.name || '', email: c.email || '', phone: c.phone || '',
            title: c.title || '', is_primary: !!c.is_primary,
          }));
          setContacts(cons);
        } catch (err) {
          console.error('Error loading vendor:', err);
          if (!cancelled) setError('Failed to load this vendor. Please close and retry.');
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }

    // Create mode
    if (initialDraft) {
      // Prefilled from discovery — populate directly, skip the online search.
      setBasics({
        ...emptyBasics(),
        name: initialDraft.name || '',
        code: initialDraft.code ? normalizeVendorCode(initialDraft.code) : '',
        vendor_type_term_id: initialDraft.vendor_type_term_id || '',
        payment_terms: initialDraft.payment_terms || 'NET30',
        lead_time_days: initialDraft.lead_time_days || '',
        notes: [initialDraft.notes, initialDraft.website ? `Website: ${initialDraft.website}` : '']
          .filter(Boolean)
          .join('\n'),
      });
      const a = initialDraft.address;
      setAddresses([
        a && (a.street1 || a.city || a.state || a.zip)
          ? {
              ...emptyAddress(),
              street1: a.street1 || '', street2: a.street2 || '',
              city: a.city || '', state: a.state || '',
              zip: a.zip || '', country: a.country || '',
            }
          : emptyAddress(),
      ]);
      const c = initialDraft.contact;
      setContacts(
        c && (c.name || c.email || c.phone)
          ? [{ ...emptyContact(), name: c.name || '', email: c.email || '', phone: c.phone || '', title: c.title || '', is_primary: true }]
          : [],
      );
      setLastEventId(null);
      setSearchDone(false);
    } else {
      setBasics({ ...emptyBasics(), name: initialName || '' });
      setAddresses([emptyAddress()]);
      setContacts([]);
      setLastEventId(null);
      if (initialName) runSearch(initialName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vendor, isEdit, initialName, initialDraft]);

  /* ---- AI online search (create mode only) ---- */
  async function runSearch(name: string) {
    setSearching(true);
    setSearchDone(false);
    try {
      const result = await searchVendorOnline(name);
      if (result.found && result.vendor) {
        const v = result.vendor;
        setBasics((prev) => ({
          ...prev,
          name: v.name || prev.name,
          code: v.code ? normalizeVendorCode(v.code) : prev.code,
          notes: [prev.notes, v.website ? `Website: ${v.website}` : '']
            .filter(Boolean).join(prev.notes ? '\n' : ''),
        }));
        if (v.contact_name || v.contact_email || v.contact_phone) {
          setContacts((prev) => (prev.length ? prev : [{
            ...emptyContact(),
            name: v.contact_name || '', email: v.contact_email || '', phone: v.contact_phone || '',
            is_primary: true,
          }]));
        }
        if (v.address) {
          setAddresses((prev) => {
            const first = prev[0];
            if (first && addressHasContent(first)) return prev;
            return [{ ...emptyAddress(), street1: v.address || '' }, ...prev.slice(1)];
          });
        }
      }
    } catch {
      // Search failure is non-fatal
    } finally {
      setSearching(false);
      setSearchDone(true);
    }
  }

  /* ---- Address row handlers ---- */
  const updateAddress = (idx: number, patch: Partial<AddressDraft>) =>
    setAddresses((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));

  const removeAddress = (idx: number) =>
    setAddresses((prev) => {
      const target = prev[idx];
      if (target.id) setRemovedAddressIds((r) => [...r, target.id!]);
      const next = prev.filter((_, i) => i !== idx);
      return next.length ? next : [emptyAddress()];
    });

  /* ---- Contact row handlers ---- */
  const updateContact = (idx: number, patch: Partial<ContactDraft>) =>
    setContacts((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));

  const setPrimaryContact = (idx: number) =>
    setContacts((prev) => prev.map((c, i) => ({ ...c, is_primary: i === idx })));

  const removeContact = (idx: number) =>
    setContacts((prev) => {
      const target = prev[idx];
      if (target.id) setRemovedContactIds((r) => [...r, target.id!]);
      return prev.filter((_, i) => i !== idx);
    });

  function setBasic(field: keyof BasicsState, value: string) {
    setBasics((prev) => ({ ...prev, [field]: value }));
    if (error) setError(null);
  }

  /* ---- Save ---- */

  // POST/PATCH/DELETE a sub-resource with a fresh idempotency key per call.
  const subFetch = (url: string, method: string, body?: unknown) =>
    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  const addrBody = (a: AddressDraft) => ({
    address_type: a.address_type, label: a.label.trim() || null,
    street1: a.street1.trim() || null, street2: a.street2.trim() || null,
    city: a.city.trim() || null, state: a.state.trim() || null,
    zip: a.zip.trim() || null, country: a.country.trim() || null,
    latitude: a.latitude, longitude: a.longitude,
  });

  const contactBody = (c: ContactDraft) => ({
    name: c.name.trim() || null, email: c.email.trim() || null,
    phone: c.phone.trim() || null, title: c.title.trim() || null, is_primary: c.is_primary,
  });

  async function handleSave() {
    const name = basics.name.trim();
    if (name.length < 2) { setError('Vendor name is required (at least 2 characters).'); return; }

    const codeErrors = validateVendorCode(basics.code);
    if (codeErrors.length) { setError(codeErrors.join(' ')); return; }

    setSubmitting(true);
    setError(null);

    try {
      // 1. Geocode filled addresses lacking coords (sequential — Nominatim is rate-limited).
      //    geocodeStructured falls back from street → city/ZIP → ZIP so an address
      //    Nominatim can't resolve at street precision still gets a usable coordinate.
      //    The server address routes re-geocode as a safety net if any stay null.
      const filled = addresses.filter(addressHasContent);
      if (filled.some((a) => a.latitude == null || a.longitude == null)) setSavingMsg('Geocoding addresses…');
      for (const a of filled) {
        if (a.latitude == null || a.longitude == null) {
          const geo = await geocodeStructured(a);
          if (geo) { a.latitude = geo.latitude; a.longitude = geo.longitude; }
        }
      }

      // 2. Primary location → denormalized vendor address (keeps the ops globe pin alive).
      const primaryAddr = filled[0] || null;
      // Primary contact → denormalized vendor contact (used for PO emails).
      const filledContacts = contacts.filter(contactHasContent);
      const primaryContact = filledContacts.find((c) => c.is_primary) || filledContacts[0] || null;

      const payload = {
        name,
        code: basics.code.trim() || undefined,
        vendor_type_term_id: basics.vendor_type_term_id || null,
        payment_terms: basics.payment_terms || undefined,
        lead_time_days: basics.lead_time_days ? parseInt(basics.lead_time_days, 10) : null,
        notes: basics.notes.trim() || null,
        contact_name: primaryContact?.name.trim() || null,
        contact_email: primaryContact?.email.trim() || null,
        contact_phone: primaryContact?.phone.trim() || null,
        address_line_1: primaryAddr?.street1.trim() || null,
        city: primaryAddr?.city.trim() || null,
        state: primaryAddr?.state.trim() || null,
        postal_code: primaryAddr?.zip.trim() || null,
        latitude: primaryAddr?.latitude ?? null,
        longitude: primaryAddr?.longitude ?? null,
      };

      // 3. Vendor-row write (exactly one).
      setSavingMsg('Saving vendor…');
      let vendorId: string;
      if (isEdit && vendor) {
        if (!lastEventId) throw AppError.badRequest('Vendor changed since it was opened. Please close and retry.');
        await SupplyChainRPC.updateVendor(vendor.id, payload as any, lastEventId);
        vendorId = vendor.id;
      } else {
        const created = await SupplyChainRPC.createVendor(payload as any);
        vendorId = created.id;
      }

      // 4. Address diff: delete removed, PATCH existing, POST new.
      setSavingMsg('Saving locations…');
      for (const id of removedAddressIds) {
        await subFetch(`/api/inventory/vendors/${vendorId}/addresses/${id}`, 'DELETE');
      }
      for (const a of filled) {
        if (a.id) await subFetch(`/api/inventory/vendors/${vendorId}/addresses/${a.id}`, 'PATCH', addrBody(a));
        else await subFetch(`/api/inventory/vendors/${vendorId}/addresses`, 'POST', addrBody(a));
      }

      // 5. Contact diff.
      setSavingMsg('Saving contacts…');
      for (const id of removedContactIds) {
        await subFetch(`/api/inventory/vendors/${vendorId}/contacts/${id}`, 'DELETE');
      }
      for (const c of filledContacts) {
        if (c.id) await subFetch(`/api/inventory/vendors/${vendorId}/contacts/${c.id}`, 'PATCH', contactBody(c));
        else await subFetch(`/api/inventory/vendors/${vendorId}/contacts`, 'POST', contactBody(c));
      }

      onSuccess({ id: vendorId, name });
    } catch (err: any) {
      setError(err?.message || 'Failed to save vendor.');
    } finally {
      setSubmitting(false);
      setSavingMsg(null);
    }
  }

  /* ---- Render ---- */

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Vendor' : 'Add Vendor'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update vendor details, locations, and contacts.'
              : 'Enter vendor details below. Fields found online are pre-filled.'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading vendor…
          </div>
        ) : (
        <div className="space-y-4 py-2">
          {searching && (
            <Alert>
              <Search className="h-4 w-4" />
              <AlertDescription className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Searching for vendor details online…
              </AlertDescription>
            </Alert>
          )}
          {!searching && searchDone && !isEdit && (
            <Alert className="border-green-200 bg-green-50">
              <Search className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                Search complete — fields below have been pre-filled with any details found.
              </AlertDescription>
            </Alert>
          )}

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="vendor-name">Vendor Name *</Label>
            <div className="flex gap-2">
              <Input
                id="vendor-name"
                value={basics.name}
                onChange={(e) => setBasic('name', e.target.value)}
                placeholder="e.g. Acme Corporation"
                disabled={submitting}
                autoFocus
                className="flex-1"
              />
              {!isEdit && !searching && basics.name.trim().length >= 2 && (
                <Button type="button" variant="outline" size="icon" disabled={submitting}
                  onClick={() => runSearch(basics.name.trim())} title="Search online for vendor details">
                  <Search className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Code */}
          <div className="space-y-2">
            <Label htmlFor="vendor-code">Vendor Code</Label>
            <Input
              id="vendor-code"
              value={basics.code}
              onChange={(e) => setBasic('code', normalizeVendorCode(e.target.value))}
              placeholder={codeSettings?.vendor_code_strategy === 'sequential' ? 'Auto-generated' : 'e.g. ACME'}
              disabled={submitting || isCodeDisabled}
              className="font-mono"
            />
            {isIntegrationVendor ? (
              <p className="text-xs text-amber-600">Integration-managed vendor — code is locked.</p>
            ) : (
              <>
                {vendorCodeHelp && <p className="text-xs text-muted-foreground">{vendorCodeHelp}</p>}
                {nextSequentialCode && codeSettings?.vendor_code_strategy === 'sequential' && (
                  <p className="text-xs text-muted-foreground">Next code: <span className="font-mono">{nextSequentialCode}</span></p>
                )}
                {vendorCodeRules.length > 0 && (
                  <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                    <div className="font-medium text-gray-700">Code rules</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {vendorCodeRules.map((rule) => (
                        <span key={rule} className="rounded-full border border-gray-200 bg-white px-2 py-0.5">{rule}</span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Vendor Type */}
          <div className="space-y-2">
            <Label htmlFor="vendor-type">Vendor Type</Label>
            <select id="vendor-type" value={basics.vendor_type_term_id}
              onChange={(e) => setBasic('vendor_type_term_id', e.target.value)}
              className={SELECT_CLS} disabled={submitting}>
              <option value="">-- Select type --</option>
              {vendorTypeLoading ? <option disabled>Loading…</option> :
                vendorTypeTerms.map((t) => <option key={t.term_id} value={t.term_id}>{t.label}</option>)}
            </select>
          </div>

          {/* Locations */}
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Locations</h4>
              <Button type="button" variant="ghost" size="sm" disabled={submitting}
                onClick={() => setAddresses((prev) => [...prev, emptyAddress()])}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add location
              </Button>
            </div>
            {addresses.map((a, idx) => (
              <div key={a.id || `new-addr-${idx}`} className="border rounded-md p-3 space-y-2 bg-muted/30">
                <div className="flex items-center gap-2">
                  <select value={a.address_type}
                    onChange={(e) => updateAddress(idx, { address_type: e.target.value as AddressDraft['address_type'] })}
                    className="h-8 rounded-md border border-input bg-white px-2 text-sm" disabled={submitting}>
                    <option value="general">General</option>
                    <option value="billing">Billing</option>
                    <option value="shipping">Shipping</option>
                  </select>
                  <Input value={a.label} onChange={(e) => updateAddress(idx, { label: e.target.value })}
                    placeholder="Label (e.g. East Yard)" className="h-8 flex-1" disabled={submitting} />
                  {(addresses.length > 1 || a.id) && (
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-600"
                      onClick={() => removeAddress(idx)} disabled={submitting} title="Remove location">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <Input value={a.street1} placeholder="Street address" disabled={submitting}
                  onChange={(e) => updateAddress(idx, { street1: e.target.value, latitude: null, longitude: null })} />
                <div className="grid grid-cols-3 gap-2">
                  <Input value={a.city} placeholder="City" disabled={submitting}
                    onChange={(e) => updateAddress(idx, { city: e.target.value, latitude: null, longitude: null })} />
                  <Input value={a.state} placeholder="State" disabled={submitting}
                    onChange={(e) => updateAddress(idx, { state: e.target.value, latitude: null, longitude: null })} />
                  <Input value={a.zip} placeholder="ZIP" disabled={submitting}
                    onChange={(e) => updateAddress(idx, { zip: e.target.value, latitude: null, longitude: null })} />
                </div>
                {a.latitude != null && a.longitude != null && (
                  <p className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {a.latitude.toFixed(5)}, {a.longitude.toFixed(5)}
                  </p>
                )}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Addresses are geocoded on save to power the locations map and closest-location suggestions on purchase orders.
            </p>
          </div>

          {/* Contacts */}
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Contacts</h4>
              <Button type="button" variant="ghost" size="sm" disabled={submitting}
                onClick={() => setContacts((prev) => [...prev, { ...emptyContact(), is_primary: prev.length === 0 }])}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add contact
              </Button>
            </div>
            {contacts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No contacts yet. The primary contact&apos;s email is where purchase orders are sent.
              </p>
            ) : contacts.map((c, idx) => (
              <div key={c.id || `new-contact-${idx}`} className="border rounded-md p-3 space-y-2 bg-muted/30">
                <div className="flex items-center gap-2">
                  <Input value={c.name} onChange={(e) => updateContact(idx, { name: e.target.value })}
                    placeholder="Contact name" className="h-8 flex-1" disabled={submitting} />
                  <Input value={c.title} onChange={(e) => updateContact(idx, { title: e.target.value })}
                    placeholder="Title" className="h-8 w-32" disabled={submitting} />
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-600"
                    onClick={() => removeContact(idx)} disabled={submitting} title="Remove contact">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input type="email" value={c.email} onChange={(e) => updateContact(idx, { email: e.target.value })}
                    placeholder="email@vendor.com" disabled={submitting} />
                  <Input type="tel" value={c.phone} onChange={(e) => updateContact(idx, { phone: e.target.value })}
                    placeholder="(555) 123-4567" disabled={submitting} />
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="radio" name="primary-contact" checked={c.is_primary}
                    onChange={() => setPrimaryContact(idx)} disabled={submitting}
                    className="h-3.5 w-3.5 text-primary focus:ring-primary" />
                  Primary contact (purchase orders are emailed here)
                </label>
              </div>
            ))}
          </div>

          {/* Terms */}
          <div className="space-y-3 border-t pt-4">
            <h4 className="text-sm font-medium">Terms</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="vendor-payment-terms">Payment Terms</Label>
                <select id="vendor-payment-terms" value={basics.payment_terms}
                  onChange={(e) => setBasic('payment_terms', e.target.value)} className={SELECT_CLS} disabled={submitting}>
                  <option value="NET15">Net 15</option>
                  <option value="NET30">Net 30</option>
                  <option value="NET45">Net 45</option>
                  <option value="NET60">Net 60</option>
                  <option value="COD">COD</option>
                  <option value="PREPAID">Prepaid</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendor-lead-time">Lead Time (Days)</Label>
                <Input id="vendor-lead-time" type="number" value={basics.lead_time_days}
                  onChange={(e) => setBasic('lead_time_days', e.target.value)} placeholder="e.g. 14" disabled={submitting} />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="vendor-notes">Notes</Label>
            <textarea id="vendor-notes" value={basics.notes}
              onChange={(e) => setBasic('notes', e.target.value)} rows={2}
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              placeholder="Internal notes about this vendor…" disabled={submitting} />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="button" onClick={handleSave} disabled={submitting || searching || loading}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {submitting ? (savingMsg || 'Saving…') : isEdit ? 'Save Changes' : 'Create Vendor'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
