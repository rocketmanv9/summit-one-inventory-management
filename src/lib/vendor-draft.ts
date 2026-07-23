/**
 * Vendor draft — a structured, partially-filled vendor used to pre-populate the
 * VendorModal (review-and-edit) or to create a vendor in one click from the
 * online discovery flow.
 *
 * `createVendorFromDraft` mirrors the create path of VendorModal.handleSave:
 * geocode the address, write the vendor row with the primary address/contact
 * denormalized, then POST the address + contact sub-resources.
 */

import { AppError } from '@rocketmanv9/chassis/errors';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { geocodeStructured } from '@/lib/geocode';

export interface VendorDraftAddress {
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface VendorDraftContact {
  name?: string;
  email?: string;
  phone?: string;
  title?: string;
}

export interface VendorDraft {
  name: string;
  code?: string;
  vendor_type_term_id?: string;
  payment_terms?: string;
  lead_time_days?: string;
  notes?: string;
  website?: string;
  address?: VendorDraftAddress;
  contact?: VendorDraftContact;
  /** Known sender domains (e.g. from the AI quick-add suggest) — upserted into
   *  supply_chain.vendor_email_domains so the email → item-suggestions scanner
   *  can match this vendor. */
  email_domains?: string[];
}

export function draftHasAddress(a?: VendorDraftAddress): boolean {
  return !!a && !!(a.street1?.trim() || a.city?.trim() || a.state?.trim() || a.zip?.trim());
}

export function draftHasContact(c?: VendorDraftContact): boolean {
  return !!c && !!(c.name?.trim() || c.email?.trim() || c.phone?.trim() || c.title?.trim());
}

// POST/PATCH/DELETE a sub-resource with a fresh idempotency key per call —
// matches the subFetch helper in VendorModal.
const subFetch = (url: string, method: string, body?: unknown) =>
  fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

/**
 * Create a vendor from a draft in one round of writes (vendor row + address +
 * contact). Geocodes the address up front so the denormalized vendor row and
 * the vendor_addresses row both carry coordinates for the ops map / proximity.
 */
export async function createVendorFromDraft(draft: VendorDraft): Promise<{ id: string; name: string }> {
  const name = draft.name.trim();
  if (name.length < 2) throw AppError.badRequest('Vendor name is required (at least 2 characters).');

  const addr = draftHasAddress(draft.address) ? draft.address! : null;
  let latitude: number | null = null;
  let longitude: number | null = null;
  if (addr) {
    // geocodeStructured cascades street → city/ZIP → ZIP; the address POST route
    // re-geocodes as a safety net if this stays null.
    const geo = await geocodeStructured({
      street1: addr.street1,
      street2: addr.street2,
      city: addr.city,
      state: addr.state,
      zip: addr.zip,
      country: addr.country,
    });
    if (geo) {
      latitude = geo.latitude;
      longitude = geo.longitude;
    }
  }

  const contact = draftHasContact(draft.contact) ? draft.contact! : null;
  const notes =
    [draft.notes?.trim(), draft.website?.trim() ? `Website: ${draft.website.trim()}` : '']
      .filter(Boolean)
      .join('\n') || null;

  const emailDomains = (draft.email_domains || []).map((d) => d.trim().toLowerCase()).filter(Boolean);

  const payload: Record<string, unknown> = {
    name,
    code: draft.code?.trim() || undefined,
    vendor_type_term_id: draft.vendor_type_term_id || null,
    payment_terms: draft.payment_terms || undefined,
    lead_time_days: draft.lead_time_days ? parseInt(draft.lead_time_days, 10) : null,
    notes,
    portal_url: draft.website?.trim() || null,
    email_domains: emailDomains.length > 0 ? emailDomains : undefined,
    contact_name: contact?.name?.trim() || null,
    contact_email: contact?.email?.trim() || null,
    contact_phone: contact?.phone?.trim() || null,
    address_line_1: addr?.street1?.trim() || null,
    city: addr?.city?.trim() || null,
    state: addr?.state?.trim() || null,
    postal_code: addr?.zip?.trim() || null,
    latitude,
    longitude,
  };

  const created = await SupplyChainRPC.createVendor(payload as any);
  const vendorId = created.id;

  if (addr) {
    await subFetch(`/api/inventory/vendors/${vendorId}/addresses`, 'POST', {
      address_type: 'general',
      label: null,
      street1: addr.street1?.trim() || null,
      street2: addr.street2?.trim() || null,
      city: addr.city?.trim() || null,
      state: addr.state?.trim() || null,
      zip: addr.zip?.trim() || null,
      country: addr.country?.trim() || null,
      latitude,
      longitude,
    });
  }

  if (contact) {
    await subFetch(`/api/inventory/vendors/${vendorId}/contacts`, 'POST', {
      name: contact.name?.trim() || null,
      email: contact.email?.trim() || null,
      phone: contact.phone?.trim() || null,
      title: contact.title?.trim() || null,
      is_primary: true,
    });
  }

  return { id: vendorId, name };
}
