// GV is a separate Supabase project; chassis client factories target the app DB only.
// We must use createClient directly with GV_SUPABASE_URL + GV_SUPABASE_ANON_KEY to
// connect to the GV project for catalog reads and vendor RPCs.
// eslint-disable-next-line no-restricted-imports
import { createClient } from '@supabase/supabase-js';
import { createVendorCatalogClient, createTenantVendorClient } from '@rocketmanv9/chassis/vendors';
import { AppError } from '@rocketmanv9/chassis/errors';
import type { VendorCatalogClient, TenantVendorClient } from '@rocketmanv9/chassis/vendors';

/**
 * Lazy singleton catalog client for browsing the platform vendor catalog.
 * Uses 30s cache — safe to call from any route handler.
 */
let _catalogClient: VendorCatalogClient | null = null;

export function getCatalogClient(): VendorCatalogClient {
  if (!_catalogClient) {
    _catalogClient = createVendorCatalogClient({ cacheTtlMs: 30_000 });
  }
  return _catalogClient;
}

/**
 * Build a plain GV Supabase client (no RLS context) for use as the
 * adminClient in adopt/submission flows that need to read catalog tables.
 */
export function getGVAdminClient() {
  const url = process.env.GV_SUPABASE_URL;
  const key = process.env.GV_SUPABASE_ANON_KEY;
  if (!url || !key) throw AppError.internal('GV_SUPABASE_URL / GV_SUPABASE_ANON_KEY not set');
  return createClient(url, key);
}

/**
 * Create a tenant-scoped vendor client for CRUD operations.
 * Sets RLS context so create, update, adopt, and submission methods work.
 * Passes an adminClient for adopt flows that need catalog-level reads.
 */
export async function getTenantVendorClient(tenantId: string): Promise<TenantVendorClient> {
  return createTenantVendorClient(tenantId, {
    cacheTtlMs: 30_000,
    adminClient: getGVAdminClient(),
  });
}

/**
 * Adopt one or more GV catalog vendors into the tenant's OWN operational vendor
 * store (`supply_chain.vendors` + contacts/addresses) via copy-on-write.
 *
 * This is the single source of truth for "Add & use a catalog vendor". The
 * chassis tenant SDK's `.adopt()` targets `public.vendors` on the GV project,
 * which does NOT exist there — the real tenant vendor store is inventory's
 * `supply_chain.vendors`. Both the inventory adopt route and the Isabelle
 * `adopt_catalog_vendor` tool call this helper so they stay in lockstep.
 *
 * @param sc  A `supabase.schema('supply_chain')` builder (tenant service client).
 * @param tenantId  The adopting tenant.
 * @param catalogVendorIds  GV `vendor_catalog.id`s to copy in.
 * @param idempotencyKey  Seed for per-row `last_event_id` uniqueness.
 */
export async function adoptCatalogVendorsIntoSupplyChain(
  sc: any,
  tenantId: string,
  catalogVendorIds: string[],
  idempotencyKey: string,
): Promise<{ adopted: Array<{ id: string; name: string }>; skipped: number; message: string }> {
  const gv = getGVAdminClient();

  // 1) Read catalog vendors from GV. Contacts/addresses are NOT separate tables
  //    on GV — the catalog carries `website`, a `contact` jsonb, and a `metadata`
  //    jsonb (which also holds `website`, and may hold phone/email/address). We
  //    copy whatever detail is present into the tenant's own vendor row + child
  //    tables.
  const { data: catalogVendors, error: catErr } = await gv
    .from('vendor_catalog')
    .select('id, name, default_vendor_type_id, website, contact, metadata')
    .in('id', catalogVendorIds)
    .eq('is_active', true);
  if (catErr) throw AppError.internal(catErr.message);
  if (!catalogVendors || catalogVendors.length === 0) throw AppError.notFound('No active catalog vendors found');

  // 2) Skip names that already exist as active supply_chain vendors.
  const { data: existing } = await sc.from('vendors').select('name').eq('active', true);
  const existingNames = new Set((existing || []).map((v: any) => (v.name || '').toLowerCase()));

  const str = (v: any): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

  const adopted: Array<{ id: string; name: string }> = [];
  let skipped = 0;
  let i = 0;
  for (const cv of catalogVendors as any[]) {
    if (existingNames.has((cv.name || '').toLowerCase())) { skipped++; continue; }

    const contact = (cv.contact && typeof cv.contact === 'object') ? cv.contact : {};
    const meta = (cv.metadata && typeof cv.metadata === 'object') ? cv.metadata : {};
    const website = str(cv.website) ?? str(meta.website);
    const email = str(contact.email) ?? str(meta.email);
    const phone = str(contact.phone) ?? str(meta.phone);
    const contactName = str(contact.name) ?? str(contact.contact_name);
    const addr = (meta.address && typeof meta.address === 'object') ? meta.address
      : (contact.address && typeof contact.address === 'object') ? contact.address : null;

    const { data: vendorRow, error: vErr } = await sc.from('vendors')
      .insert({
        tenant_id: tenantId,
        name: cv.name,
        vendor_type_term_id: cv.default_vendor_type_id ?? null,
        active: true,
        portal_url: website,
        phone_number: phone,
        contact_email: email,
        contact_phone: phone,
        contact_name: contactName,
        last_event_id: `${idempotencyKey}-v${i}`,
      })
      .select('id, name, last_event_id')
      .single();
    if (vErr) throw AppError.internal(vErr.message);

    // Copy a primary contact when the catalog carries any contact detail.
    if (email || phone || contactName) {
      await sc.from('vendor_contacts').insert([{
        tenant_id: tenantId, vendor_id: vendorRow.id,
        is_primary: true, name: contactName, email, phone, title: null,
        last_event_id: `${idempotencyKey}-v${i}-c0`,
      }]);
    }

    // Copy an address when the catalog metadata/contact carries one.
    if (addr) {
      await sc.from('vendor_addresses').insert([{
        tenant_id: tenantId, vendor_id: vendorRow.id,
        address_type: str(addr.address_type) ?? 'general', label: str(addr.label),
        street1: str(addr.street1) ?? str(addr.street) ?? str(addr.line1),
        street2: str(addr.street2) ?? str(addr.line2),
        city: str(addr.city), state: str(addr.state), zip: str(addr.zip) ?? str(addr.postal_code),
        country: str(addr.country),
        last_event_id: `${idempotencyKey}-v${i}-a0`,
      }]);
    }

    adopted.push({ id: vendorRow.id, name: vendorRow.name });
    existingNames.add((cv.name || '').toLowerCase());
    i++;
  }

  return {
    adopted,
    skipped,
    message: `Adopted ${adopted.length} vendor(s)${skipped ? `, skipped ${skipped} already present` : ''}`,
  };
}

/**
 * Create a custom vendor via the GV `rpc_gv_create_vendor` SECURITY DEFINER RPC.
 *
 * Why not the SDK `create()`? The tenant SDK sets `app.current_tenant_id` with a
 * separate `set_claim` request, but GV's PostgREST pools connections — the next
 * request (the INSERT) can land on a different connection without the GUC, so the
 * tenant-scoped RLS WITH CHECK fails ("new row violates row-level security policy").
 * Only the anon key is available for GV, so we can't use a service-role bypass.
 * The RPC sets context + inserts in ONE request/transaction, which is reliable.
 */
export async function createCustomVendor(
  tenantId: string,
  input: { name: string; vendor_type_id: string; account_number?: string; payment_terms?: string; notes?: string },
) {
  const client = getGVAdminClient();
  const { data, error } = await client.rpc('rpc_gv_create_vendor', {
    p_tenant_id: tenantId,
    p_name: input.name,
    p_vendor_type_id: input.vendor_type_id,
    p_account_number: input.account_number ?? null,
    p_payment_terms: input.payment_terms ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) {
    if (error.code === '23505') throw AppError.conflict('Vendor with this name already exists for your tenant');
    if (error.code === '23503') throw AppError.badRequest('Invalid vendor type');
    throw AppError.internal(error.message || 'Failed to create vendor');
  }
  return data;
}
