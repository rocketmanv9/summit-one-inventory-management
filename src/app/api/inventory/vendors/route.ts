import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { pickVendorColumns } from '@/lib/vendor-columns';
import { assertCapability } from '@/lib/access-server';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Optional AI-suggested sender domains attached to a vendor create (quick add).
// The email → item-suggestions scanner matches inbound mail to vendors via
// supply_chain.vendor_email_domains, so capturing these at onboarding matters.
const EmailDomainsSchema = z.array(z.string()).max(10).optional();

const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
  'aol.com', 'icloud.com', 'me.com', 'live.com',
]);

/** Normalize to bare lowercase domains; drop freemail/invalid; dedupe; cap 5. */
function sanitizeEmailDomains(domains: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const raw of domains ?? []) {
    let d = raw.trim().toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .replace(/^www\./, '');
    d = d.split(/[/?#\s]/)[0] || '';
    if (d.includes('@')) d = d.split('@')[1] || '';
    if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d)) continue;
    if (FREEMAIL_DOMAINS.has(d)) continue;
    out.add(d);
    if (out.size >= 5) break;
  }
  return [...out];
}

/** Upsert sender domains for a vendor. Non-fatal — the vendor row is already
 *  written, so a failure here logs instead of failing (and re-running) the save. */
async function upsertVendorEmailDomains(
  sc: any,
  log: { error: (msg: string, meta?: Record<string, unknown>) => void },
  tenantId: string,
  vendorId: string,
  domains: string[],
) {
  if (domains.length === 0) return;
  const rows = domains.map((domain) => ({
    tenant_id: tenantId,
    vendor_id: vendorId,
    domain,
    source: 'ai_suggest',
    is_active: true,
  }));
  const { error } = await sc
    .from('vendor_email_domains')
    .upsert(rows, { onConflict: 'tenant_id,vendor_id,domain' });
  if (error) log.error('vendor.email_domains_upsert_failed', { error: error.message, vendor_id: vendorId });
}

// List the tenant's operational (supply_chain) vendors with their contacts and
// addresses. This is the single tenant vendor store used by items/POs.
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const activeOnly = new URL(req.url).searchParams.get('active_only') !== 'false';
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });
  const sc = (supabase as any).schema('supply_chain');

  let q = sc.from('vendors').select('*').order('name').limit(500);
  if (activeOnly) q = q.eq('active', true);
  const { data: vendors, error } = await q;
  if (error) { log.error('vendors.list_failed', { error: error.message }); throw AppError.internal(error.message); }

  const ids = (vendors || []).map((v: any) => v.id);
  const contactsByVendor: Record<string, any[]> = {};
  const addressesByVendor: Record<string, any[]> = {};
  if (ids.length > 0) {
    const [{ data: contacts }, { data: addresses }] = await Promise.all([
      sc.from('vendor_contacts').select('*').in('vendor_id', ids).order('is_primary', { ascending: false }),
      sc.from('vendor_addresses').select('*').in('vendor_id', ids).order('address_type'),
    ]);
    for (const c of contacts || []) (contactsByVendor[c.vendor_id] ||= []).push(c);
    for (const a of addresses || []) (addressesByVendor[a.vendor_id] ||= []).push(a);
  }

  const data = (vendors || []).map((v: any) => ({
    ...v,
    // GV-style aliases so the Vendors UI renders unchanged.
    is_active: !!v.active,
    is_custom: true,
    vendor_type_id: v.vendor_type_term_id ?? null,
    description: v.notes ?? null,
    contacts: contactsByVendor[v.id] || [],
    addresses: addressesByVendor[v.id] || [],
  }));
  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

// Create a supply_chain vendor, or restore an inactive one with the same name
// (the prior SupplyChainRPC.createVendor behavior, now server-side).
// trigger_vendor_events owns outbox emission; tenant_id must be set explicitly —
// auto_inject_tenant_id() refuses to inject under the service-role client.
export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  await assertCapability(supabase, { tenantId: ctx.tenantId!, userId: ctx.userId! }, 'vendors.manage');
  const body = await req.json();
  const { id: _id, created_at, tenant_id, last_event_id: _lei,
          contacts: _c, addresses: _a, vendor_type_id, is_active, description,
          email_domains, ...rest } = body ?? {};
  const emailDomains = sanitizeEmailDomains(EmailDomainsSchema.parse(email_domains ?? undefined));
  const raw: Record<string, any> = { ...rest };
  // Accept GV-style field names from the Vendors UI.
  if (vendor_type_id !== undefined) raw.vendor_type_term_id = vendor_type_id;
  if (is_active !== undefined) raw.active = is_active;
  if (description !== undefined && raw.notes === undefined) raw.notes = description;
  if (!raw.name) throw AppError.badRequest('Missing vendor name');
  // Keep only real supply_chain.vendors columns (drops account_number, etc.).
  const fields = pickVendorColumns(raw);

  const sc = (supabase as any).schema('supply_chain');

  const { data: existing, error: existingError } = await sc
    .from('vendors')
    .select('id, last_event_id, active')
    .eq('name', fields.name)
    .maybeSingle();

  if (existingError) {
    log.error('vendor.exists_check_failed', { error: existingError.message });
    throw AppError.internal(existingError.message);
  }

  if (existing?.active) {
    throw AppError.conflict('A vendor with this name already exists. Edit the existing vendor or choose a different name.');
  }

  // Inactive vendor with the same name → reactivate it (OCC).
  if (existing && !existing.active) {
    let q = sc.from('vendors')
      .update({ ...fields, active: true, last_event_id: idempotencyKey })
      .eq('id', existing.id);
    if (existing.last_event_id) q = q.eq('last_event_id', existing.last_event_id);

    const { data: restored, error: restoreError } = await q.select('id, last_event_id').single();
    if (restoreError) {
      log.error('vendor.restore_failed', { error: restoreError.message });
      throw AppError.internal(restoreError.message);
    }
    await upsertVendorEmailDomains(sc, log, ctx.tenantId!, restored.id, emailDomains);
    return { data: restored, status: 200, events: [] };
  }

  const { data, error } = await sc.from('vendors')
    .insert({ ...fields, tenant_id: ctx.tenantId, last_event_id: idempotencyKey })
    .select('id, last_event_id')
    .single();

  if (error) {
    log.error('vendor.create_failed', { error: error.message });
    throw AppError.internal(error.message);
  }
  await upsertVendorEmailDomains(sc, log, ctx.tenantId!, data.id, emailDomains);
  return { data, status: 201, events: [] };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/vendors' });
