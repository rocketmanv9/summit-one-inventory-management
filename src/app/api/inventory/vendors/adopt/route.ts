import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getGVAdminClient } from '@/lib/vendors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const BodySchema = z.object({ catalogVendorIds: z.array(z.string().uuid()).min(1).max(50) });

// Adopt one or more GV catalog vendors into the tenant's OWN operational vendor
// table (supply_chain.vendors) + contacts/addresses — copy-on-write from the
// shared catalog. This is the unified path: the GV side is a browse catalog,
// the tenant's real vendors live in supply_chain.
export const POST = createSessionWriteRoute(async ({ ctx, body, log, supabase, idempotencyKey }) => {
  const { catalogVendorIds } = body as z.infer<typeof BodySchema>;
  const gv = getGVAdminClient();
  const sc = (supabase as any).schema('supply_chain');

  // 1) Read catalog vendors (+ their contacts/addresses) from GV.
  const { data: catalogVendors, error: catErr } = await gv
    .from('vendor_catalog')
    .select('id, name, default_vendor_type_id, metadata')
    .in('id', catalogVendorIds)
    .eq('is_active', true);
  if (catErr) { log.error('adopt.catalog_fetch_failed', { error: catErr.message }); throw AppError.internal(catErr.message); }
  if (!catalogVendors || catalogVendors.length === 0) throw AppError.notFound('No active catalog vendors found');

  const catIds = catalogVendors.map((v: any) => v.id);
  const [{ data: catContacts }, { data: catAddresses }] = await Promise.all([
    gv.from('vendor_catalog_contacts').select('*').in('catalog_vendor_id', catIds),
    gv.from('vendor_catalog_addresses').select('*').in('catalog_vendor_id', catIds),
  ]);

  // 2) Skip names that already exist as active supply_chain vendors.
  const { data: existing } = await sc.from('vendors').select('name').eq('active', true);
  const existingNames = new Set((existing || []).map((v: any) => (v.name || '').toLowerCase()));

  const adopted: any[] = [];
  let skipped = 0;
  let i = 0;
  for (const cv of catalogVendors) {
    if (existingNames.has((cv.name || '').toLowerCase())) { skipped++; continue; }

    const { data: vendorRow, error: vErr } = await sc.from('vendors')
      .insert({
        tenant_id: ctx.tenantId,
        name: cv.name,
        vendor_type_term_id: cv.default_vendor_type_id ?? null,
        active: true,
        last_event_id: `${idempotencyKey}-v${i}`,
      })
      .select('id, name, last_event_id')
      .single();
    if (vErr) { log.error('adopt.vendor_insert_failed', { error: vErr.message, name: cv.name }); throw AppError.internal(vErr.message); }

    const myContacts = (catContacts || []).filter((c: any) => c.catalog_vendor_id === cv.id);
    if (myContacts.length > 0) {
      await sc.from('vendor_contacts').insert(myContacts.map((c: any, j: number) => ({
        tenant_id: ctx.tenantId, vendor_id: vendorRow.id,
        is_primary: c.is_primary ?? false, name: c.name ?? null, email: c.email ?? null, phone: c.phone ?? null, title: c.title ?? null,
        last_event_id: `${idempotencyKey}-v${i}-c${j}`,
      })));
    }
    const myAddrs = (catAddresses || []).filter((a: any) => a.catalog_vendor_id === cv.id);
    if (myAddrs.length > 0) {
      await sc.from('vendor_addresses').insert(myAddrs.map((a: any, j: number) => ({
        tenant_id: ctx.tenantId, vendor_id: vendorRow.id,
        address_type: a.address_type ?? 'general', label: a.label ?? null, street1: a.street1 ?? null, street2: a.street2 ?? null,
        city: a.city ?? null, state: a.state ?? null, zip: a.zip ?? null, country: a.country ?? null,
        last_event_id: `${idempotencyKey}-v${i}-a${j}`,
      })));
    }

    adopted.push(vendorRow);
    existingNames.add((cv.name || '').toLowerCase());
    i++;
  }

  // trigger_vendor_events on supply_chain.vendors emits vendor.created per insert,
  // so the route returns events: [] to avoid double-emitting.
  return {
    data: { adopted, skipped, message: `Adopted ${adopted.length} vendor(s)${skipped ? `, skipped ${skipped} already present` : ''}` },
    status: 201,
    events: [],
  };
}, { bodySchema: BodySchema, emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/vendors/adopt' });
