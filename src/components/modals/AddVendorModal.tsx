'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import { AlertCircle, Loader2, Search, MapPin } from 'lucide-react';
import { searchVendorOnline } from '@/lib/ai/client';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { geocodeAddress } from '@/lib/geocode';
import { useVendorTypeTerms } from '@/hooks/useGVTerms';
import { AppError } from '@rocketmanv9/chassis/errors';
import type { Database } from 'types/supabase';

type Vendor = Database['supply_chain']['Tables']['vendors']['Row'];

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

interface AddVendorModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (vendorName: string) => void;
  /** Pre-fill the name field (triggers AI search automatically) */
  initialName?: string;
  /** Pass a vendor to enter edit mode */
  vendor?: Vendor;
}

interface VendorFormState {
  name: string;
  code: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  payment_terms: string;
  lead_time_days: string;
  notes: string;
  vendor_type_term_id: string;
  address_line_1: string;
  city: string;
  state: string;
  postal_code: string;
  latitude: string;
  longitude: string;
}

const emptyForm: VendorFormState = {
  name: '',
  code: '',
  contact_name: '',
  contact_email: '',
  contact_phone: '',
  payment_terms: 'NET30',
  lead_time_days: '',
  notes: '',
  vendor_type_term_id: '',
  address_line_1: '',
  city: '',
  state: '',
  postal_code: '',
  latitude: '',
  longitude: '',
};

export function AddVendorModal({ open, onClose, onSuccess, initialName, vendor }: AddVendorModalProps) {
  const isEdit = !!vendor;
  const [form, setForm] = useState<VendorFormState>(emptyForm);
  const [searching, setSearching] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchDone, setSearchDone] = useState(false);
  const [codeSettings, setCodeSettings] = useState<VendorCodeSettings | null>(null);
  const { terms: vendorTypeTerms, loading: vendorTypeLoading } = useVendorTypeTerms();
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGeocodedAddress = useRef('');

  const autoGeocodeVendor = useCallback(() => {
    // Debounce: wait 600ms after last blur before geocoding
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    geocodeTimer.current = setTimeout(async () => {
      const parts = [form.address_line_1, form.city, form.state, form.postal_code].filter(Boolean);
      const fullAddress = parts.join(', ').trim();
      if (!fullAddress || fullAddress === lastGeocodedAddress.current) return;
      // Skip if coordinates already populated
      if (form.latitude && form.longitude) return;

      lastGeocodedAddress.current = fullAddress;
      setGeocoding(true);
      try {
        const result = await geocodeAddress(fullAddress);
        if (result) {
          setForm((prev) => ({
            ...prev,
            latitude: result.latitude.toString(),
            longitude: result.longitude.toString(),
          }));
        }
      } catch {
        // Silent fail on auto-geocode
      } finally {
        setGeocoding(false);
      }
    }, 600);
  }, [form.address_line_1, form.city, form.state, form.postal_code, form.latitude, form.longitude]);

  // Load vendor code settings on mount
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const settings = await SupplyChainRPC.getTenantSettings();
        setCodeSettings({
          vendor_code_strategy: settings.vendor_code_strategy,
          vendor_code_required: settings.vendor_code_required,
          vendor_code_case: settings.vendor_code_case,
          vendor_code_min_length: settings.vendor_code_min_length,
          vendor_code_max_length: settings.vendor_code_max_length,
          vendor_code_prefix: settings.vendor_code_prefix,
          vendor_code_suffix: settings.vendor_code_suffix,
          vendor_code_allowed_chars: settings.vendor_code_allowed_chars,
          vendor_code_regex: settings.vendor_code_regex,
          vendor_code_user_editable: settings.vendor_code_user_editable,
          vendor_code_immutable_after_use: settings.vendor_code_immutable_after_use,
          vendor_code_sequence_padding: settings.vendor_code_sequence_padding,
          vendor_code_next_seq: settings.vendor_code_next_seq,
        });
      } catch (err) {
        console.error('Error fetching vendor code settings:', err);
      }
    };

    if (open) {
      fetchSettings();
    }
  }, [open]);

  // Reset form when modal opens
  useEffect(() => {
    if (!open) return;

    setError(null);
    setSearchDone(false);
    setSubmitting(false);

    if (isEdit && vendor) {
      setForm({
        name: vendor.name || '',
        code: vendor.code || '',
        contact_name: vendor.contact_name || '',
        contact_email: vendor.contact_email || '',
        contact_phone: vendor.contact_phone || '',
        payment_terms: vendor.payment_terms || 'NET30',
        lead_time_days: vendor.lead_time_days?.toString() || '',
        notes: vendor.notes || '',
        vendor_type_term_id: (vendor as any).vendor_type_term_id || '',
        address_line_1: (vendor as any).address_line_1 || '',
        city: (vendor as any).city || '',
        state: (vendor as any).state || '',
        postal_code: (vendor as any).postal_code || '',
        latitude: (vendor as any).latitude?.toString() || '',
        longitude: (vendor as any).longitude?.toString() || '',
      });
    } else if (initialName) {
      setForm({ ...emptyForm, name: initialName });
      runSearch(initialName);
    } else {
      setForm(emptyForm);
    }
  }, [open, initialName, vendor, isEdit]);

  // Vendor code helpers
  const normalizeVendorCode = (value: string) => {
    if (!codeSettings) return value;
    if (codeSettings.vendor_code_case === 'upper') return value.toUpperCase();
    if (codeSettings.vendor_code_case === 'lower') return value.toLowerCase();
    return value;
  };

  const vendorCodeHelp = useMemo(() => {
    if (!codeSettings) return null;
    if (codeSettings.vendor_code_strategy === 'sequential') {
      return 'Leave blank to auto-generate a sequential vendor code.';
    }
    if (codeSettings.vendor_code_strategy === 'hybrid') {
      return 'Leave blank to auto-generate or enter a custom code.';
    }
    if (codeSettings.vendor_code_strategy === 'import') {
      return 'Codes are expected from imports; use this only when needed.';
    }
    return 'Enter a vendor code that matches your tenant rules.';
  }, [codeSettings]);

  const vendorCodeRules = useMemo(() => {
    if (!codeSettings) return [] as string[];
    const rules: string[] = [];
    if (codeSettings.vendor_code_prefix) rules.push(`Prefix: ${codeSettings.vendor_code_prefix}`);
    if (codeSettings.vendor_code_suffix) rules.push(`Suffix: ${codeSettings.vendor_code_suffix}`);
    if (codeSettings.vendor_code_min_length || codeSettings.vendor_code_max_length) {
      rules.push(`Length: ${codeSettings.vendor_code_min_length ?? '1'}-${codeSettings.vendor_code_max_length ?? '\u221e'}`);
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
    const nextSeq = codeSettings.vendor_code_next_seq + 1;
    const core = nextSeq.toString().padStart(padding, '0');
    const prefix = codeSettings.vendor_code_prefix || '';
    const suffix = codeSettings.vendor_code_suffix || '';
    return normalizeVendorCode(`${prefix}${core}${suffix}`);
  }, [codeSettings, normalizeVendorCode]);

  const validateVendorCode = (value: string) => {
    if (!codeSettings) return [] as string[];
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
        const pattern = new RegExp(`^[${codeSettings.vendor_code_allowed_chars}]+$`);
        if (!pattern.test(code)) errors.push('Vendor code contains invalid characters.');
      } catch {
        errors.push('Vendor code rules are misconfigured.');
      }
    }
    if (codeSettings.vendor_code_regex) {
      try {
        const regex = new RegExp(codeSettings.vendor_code_regex);
        if (!regex.test(code)) errors.push('Vendor code does not match required format.');
      } catch {
        errors.push('Vendor code regex is invalid.');
      }
    }
    return errors;
  };

  const sequentialPreviewErrors = useMemo(() => {
    if (!nextSequentialCode || codeSettings?.vendor_code_strategy !== 'sequential') return [] as string[];
    return validateVendorCode(nextSequentialCode);
  }, [nextSequentialCode, codeSettings]);

  // AI search
  async function runSearch(name: string) {
    setSearching(true);
    setSearchDone(false);
    try {
      const result = await searchVendorOnline(name);
      if (result.found && result.vendor) {
        const v = result.vendor;

        // Build notes from extra fields the DB doesn't have dedicated columns for
        const extraInfo: string[] = [];
        if (v.address) extraInfo.push(`Address: ${v.address}`);
        if (v.website) extraInfo.push(`Website: ${v.website}`);

        setForm((prev) => ({
          ...prev,
          name: v.name || prev.name,
          code: v.code ? normalizeVendorCode(v.code) : prev.code,
          contact_name: v.contact_name || prev.contact_name,
          contact_email: v.contact_email || prev.contact_email,
          contact_phone: v.contact_phone || prev.contact_phone,
          notes: extraInfo.length > 0
            ? (prev.notes ? `${prev.notes}\n${extraInfo.join('\n')}` : extraInfo.join('\n'))
            : prev.notes,
        }));
      }
    } catch {
      // Search failure is non-fatal
    } finally {
      setSearching(false);
      setSearchDone(true);
    }
  }

  function handleChange(field: keyof VendorFormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (error) setError(null);
  }

  async function handleSubmit() {
    const trimmedName = form.name.trim();
    if (!trimmedName || trimmedName.length < 2) {
      setError('Vendor name is required (at least 2 characters).');
      return;
    }

    // Validate vendor code
    const codeErrors = validateVendorCode(form.code || '');
    if (codeErrors.length > 0) {
      setError(codeErrors.join(' '));
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        name: trimmedName,
        code: form.code.trim() || undefined,
        contact_name: form.contact_name.trim() || undefined,
        contact_email: form.contact_email.trim() || undefined,
        contact_phone: form.contact_phone.trim() || undefined,
        payment_terms: form.payment_terms || undefined,
        lead_time_days: form.lead_time_days ? parseInt(form.lead_time_days) : null,
        notes: form.notes.trim() || undefined,
        vendor_type_term_id: form.vendor_type_term_id || null,
        address_line_1: form.address_line_1.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        postal_code: form.postal_code.trim() || null,
        latitude: form.latitude ? parseFloat(form.latitude) : null,
        longitude: form.longitude ? parseFloat(form.longitude) : null,
      };

      if (isEdit && vendor) {
        if (!vendor.last_event_id) {
          throw AppError.badRequest('Missing last_event_id for this vendor. Please refresh and try again.');
        }
        await SupplyChainRPC.updateVendor(vendor.id, payload, vendor.last_event_id);
      } else {
        await SupplyChainRPC.createVendor(payload);
      }

      onSuccess(trimmedName);
    } catch (err: any) {
      setError(err.message || 'Failed to save vendor.');
    } finally {
      setSubmitting(false);
    }
  }

  const isCodeDisabled =
    codeSettings?.vendor_code_strategy === 'sequential' ||
    (isEdit && codeSettings?.vendor_code_user_editable === false);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Vendor' : 'Add Vendor'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update vendor details below.'
              : 'Enter vendor details below. Fields found online are pre-filled.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Searching indicator */}
          {searching && (
            <Alert>
              <Search className="h-4 w-4" />
              <AlertDescription className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching for vendor details online...
              </AlertDescription>
            </Alert>
          )}

          {/* Search complete indicator */}
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
                value={form.name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('name', e.target.value)}
                placeholder="e.g. Acme Corporation"
                disabled={submitting}
                autoFocus
                className="flex-1"
              />
              {!isEdit && !searching && form.name.trim().length >= 2 && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => runSearch(form.name.trim())}
                  disabled={submitting}
                  title="Search online for vendor details"
                >
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
              value={form.code}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                handleChange('code', normalizeVendorCode(e.target.value))
              }
              placeholder={
                codeSettings?.vendor_code_strategy === 'sequential'
                  ? 'Auto-generated'
                  : 'e.g. ACME'
              }
              disabled={submitting || isCodeDisabled}
              className="font-mono"
            />
            {vendorCodeHelp && (
              <p className="text-xs text-muted-foreground">{vendorCodeHelp}</p>
            )}
            {nextSequentialCode && codeSettings?.vendor_code_strategy === 'sequential' && (
              <p className="text-xs text-muted-foreground">
                Next code: <span className="font-mono">{nextSequentialCode}</span>
              </p>
            )}
            {sequentialPreviewErrors.length > 0 && (
              <p className="text-xs text-amber-600">
                Current rules would reject the preview: {sequentialPreviewErrors.join(' ')}
              </p>
            )}
            {vendorCodeRules.length > 0 && (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                <div className="font-medium text-gray-700">Code rules</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {vendorCodeRules.map((rule) => (
                    <span key={rule} className="rounded-full border border-gray-200 bg-white px-2 py-0.5">
                      {rule}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {isEdit && codeSettings?.vendor_code_user_editable === false && (
              <p className="text-xs text-amber-600">Vendor code editing is disabled by tenant settings.</p>
            )}
          </div>

          {/* Vendor Type */}
          <div className="space-y-2">
            <Label htmlFor="vendor-type">Vendor Type</Label>
            <select
              id="vendor-type"
              value={form.vendor_type_term_id}
              onChange={(e) => handleChange('vendor_type_term_id', e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              disabled={submitting}
            >
              <option value="">-- Select type --</option>
              {vendorTypeLoading ? (
                <option disabled>Loading...</option>
              ) : (
                vendorTypeTerms.map((t) => (
                  <option key={t.term_id} value={t.term_id}>{t.label}</option>
                ))
              )}
            </select>
          </div>

          {/* Contact Information */}
          <div className="space-y-3 border-t pt-4">
            <h4 className="text-sm font-medium">Contact Information</h4>

            <div className="space-y-2">
              <Label htmlFor="vendor-contact-name">Contact Name</Label>
              <Input
                id="vendor-contact-name"
                value={form.contact_name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('contact_name', e.target.value)}
                placeholder="e.g. Jane Smith"
                disabled={submitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="vendor-contact-email">Contact Email</Label>
              <Input
                id="vendor-contact-email"
                type="email"
                value={form.contact_email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('contact_email', e.target.value)}
                placeholder="e.g. jane@acme.com"
                disabled={submitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="vendor-contact-phone">Contact Phone</Label>
              <Input
                id="vendor-contact-phone"
                type="tel"
                value={form.contact_phone}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('contact_phone', e.target.value)}
                placeholder="e.g. (555) 123-4567"
                disabled={submitting}
              />
            </div>
          </div>

          {/* Address & Geocoding */}
          <div className="space-y-3 border-t pt-4">
            <h4 className="text-sm font-medium">Address</h4>

            <div className="space-y-2">
              <Label htmlFor="vendor-address">Street Address</Label>
              <Input
                id="vendor-address"
                value={form.address_line_1}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('address_line_1', e.target.value)}
                onBlur={autoGeocodeVendor}
                placeholder="e.g. 123 Main St"
                disabled={submitting}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-2">
                <Label htmlFor="vendor-city">City</Label>
                <Input
                  id="vendor-city"
                  value={form.city}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('city', e.target.value)}
                  onBlur={autoGeocodeVendor}
                  placeholder="City"
                  disabled={submitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendor-state">State</Label>
                <Input
                  id="vendor-state"
                  value={form.state}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('state', e.target.value)}
                  onBlur={autoGeocodeVendor}
                  placeholder="WA"
                  disabled={submitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendor-postal">ZIP</Label>
                <Input
                  id="vendor-postal"
                  value={form.postal_code}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('postal_code', e.target.value)}
                  onBlur={autoGeocodeVendor}
                  placeholder="98001"
                  disabled={submitting}
                />
              </div>
            </div>

            {geocoding && (
              <p className="text-xs text-muted-foreground animate-pulse flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Geocoding address...
              </p>
            )}

            {!geocoding && (form.latitude || form.longitude) && (
              <p className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {form.latitude}, {form.longitude}
              </p>
            )}
          </div>

          {/* Terms */}
          <div className="space-y-3 border-t pt-4">
            <h4 className="text-sm font-medium">Terms</h4>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="vendor-payment-terms">Payment Terms</Label>
                <select
                  id="vendor-payment-terms"
                  value={form.payment_terms}
                  onChange={(e) => handleChange('payment_terms', e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={submitting}
                >
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
                <Input
                  id="vendor-lead-time"
                  type="number"
                  value={form.lead_time_days}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('lead_time_days', e.target.value)}
                  placeholder="e.g. 14"
                  disabled={submitting}
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="vendor-notes">Notes</Label>
            <textarea
              id="vendor-notes"
              value={form.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              rows={2}
              placeholder="Internal notes about this vendor..."
              disabled={submitting}
            />
          </div>

          {/* Error */}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting || searching}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? 'Update Vendor' : 'Create Vendor'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
