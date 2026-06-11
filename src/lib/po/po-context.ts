/**
 * Reusable loader that assembles everything needed to email / PDF a purchase
 * order: header, vendor, ship-to, bill-to (company), and priced line items.
 *
 * Used by the PO email service (Gmail + Resend) and the PDF generator so both
 * render from the exact same data.
 */
import { getGVClient } from '@/lib/gv';
import { AppError } from '@rocketmanv9/chassis/errors';

type AdminClient = any;

export interface POContextLine {
  lineNumber: number;
  description: string;
  sku: string | null;
  quantity: number;
  uom: string | null;
  unitPrice: number | null;
  extended: number | null;
}

export interface CompanyProfile {
  name: string;
  email: string | null;
  address: string | null;
}

export interface POContext {
  poId: string;
  poNumber: string;
  status: string | null;
  orderDate: string | null;
  neededBy: string | null;
  notes: string | null;

  vendorName: string;
  vendorEmail: string | null;
  vendorContactName: string | null;
  vendorAddress: string | null;

  shipToName: string | null;
  shipToAddress: string | null;

  company: CompanyProfile;

  lines: POContextLine[];
  subtotal: number;
  total: number;
  allPriced: boolean;
}

/** Best-effort tenant/company profile for the Bill-To block and signature. */
export async function getCompanyProfile(admin: AdminClient, tenantId: string): Promise<CompanyProfile> {
  const fallbackName = process.env.COMPANY_NAME || 'Summit One';
  const fallbackEmail = process.env.ORDER_EMAIL_FROM || null;
  const fallbackAddress = process.env.COMPANY_ADDRESS || null;

  // Try a tenants table if the deployment has one; never fail the PO over it.
  try {
    const { data } = await admin
      .schema('provisioning')
      .from('tenants')
      .select('name, billing_email, address')
      .eq('id', tenantId)
      .limit(1)
      .maybeSingle();
    if (data) {
      return {
        name: data.name || fallbackName,
        email: data.billing_email || fallbackEmail,
        address: data.address || fallbackAddress,
      };
    }
  } catch {
    // table may not exist — fall through to env defaults
  }
  return { name: fallbackName, email: fallbackEmail, address: fallbackAddress };
}

function formatAddress(parts: {
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string | null {
  const line1 = [parts.street1, parts.street2].filter(Boolean).join(', ');
  const line2 = [parts.city, parts.state, parts.zip].filter(Boolean).join(' ');
  const out = [line1, line2].filter(Boolean).join('\n');
  return out || null;
}

export async function loadPOContext(
  admin: AdminClient,
  tenantId: string,
  poId: string,
): Promise<POContext> {
  const sc = admin.schema('supply_chain');
  const inv = admin.schema('inventory');

  const { data: po, error: poErr } = await sc
    .from('purchase_orders')
    .select(
      'id, po_number, status, vendor_id, vendor_name_snapshot, delivery_location_id, order_date, needed_by_date, notes',
    )
    .eq('id', poId)
    .eq('tenant_id', tenantId)
    .limit(1)
    .single();
  if (poErr || !po) throw AppError.notFound('Purchase order not found.');

  // Vendor + address
  let vendorName = po.vendor_name_snapshot || 'Vendor';
  let vendorEmail: string | null = null;
  let vendorContactName: string | null = null;
  let vendorAddress: string | null = null;
  if (po.vendor_id) {
    const { data: vendor } = await sc
      .from('vendors')
      .select('name, po_email, contact_email, contact_name')
      .eq('id', po.vendor_id)
      .limit(1)
      .maybeSingle();
    if (vendor) {
      vendorName = po.vendor_name_snapshot || vendor.name || vendorName;
      vendorEmail = vendor.po_email || vendor.contact_email || null;
      vendorContactName = vendor.contact_name || null;
    }
    // Optional richer vendor address (multi-address table added recently).
    try {
      const { data: addr } = await sc
        .from('vendor_addresses')
        .select('street1, street2, city, state, zip')
        .eq('vendor_id', po.vendor_id)
        .eq('tenant_id', tenantId)
        .limit(1)
        .maybeSingle();
      if (addr) vendorAddress = formatAddress(addr);
    } catch {
      // table may not exist in this environment
    }
  }

  // Ship-to location
  let shipToName: string | null = null;
  let shipToAddress: string | null = null;
  if (po.delivery_location_id) {
    // NOTE: the structured columns are address_line_1 / address_line_2 (underscore
    // before the digit). An earlier select used address_line1 / address_line2,
    // which made PostgREST reject the whole query — silently blanking the entire
    // Ship-To block (name included) on every PO PDF and email.
    const { data: loc, error: locErr } = await inv
      .from('locations')
      .select('name, address_line_1, address_line_2, city, state, postal_code, shipping_address, address')
      .eq('id', po.delivery_location_id)
      .limit(1)
      .maybeSingle();
    if (locErr) {
      // Don't kill the PO over a ship-to lookup, but make the failure visible.
      console.error('loadPOContext: ship-to location lookup failed', locErr.message);
    }
    if (loc) {
      shipToName = loc.name ?? null;
      shipToAddress =
        formatAddress({
          street1: loc.address_line_1,
          street2: loc.address_line_2,
          city: loc.city,
          state: loc.state,
          zip: loc.postal_code,
        }) ||
        // Fall back to the free-text shipping/address fields if the structured
        // ones aren't populated for this location.
        (loc.shipping_address?.trim() || loc.address?.trim() || null);
    }
  }

  // Lines
  const { data: rawLines, error: lineErr } = await sc
    .from('purchase_order_lines')
    .select('line_number, catalog_item_id, item_description, item_vendor_sku, qty_ordered, unit_cost, estimated_unit_cost, uom_term_id')
    .eq('po_id', poId)
    .order('line_number');
  // A bad select here silently drops every line from the PDF/email — surface it.
  if (lineErr) throw AppError.internal(`Failed to load PO lines: ${lineErr.message}`);
  const lineRows = rawLines || [];

  // Resolve catalog item names/SKUs
  const itemIds = [...new Set(lineRows.map((l: any) => l.catalog_item_id).filter(Boolean))];
  const itemMap: Record<string, { name: string; sku: string }> = {};
  if (itemIds.length > 0) {
    const { data: items } = await inv.from('catalog_items').select('id, name, sku').in('id', itemIds).limit(500);
    for (const it of items || []) itemMap[it.id] = { name: it.name, sku: it.sku };
  }

  // UOM labels (best-effort)
  let uomMap: Record<string, string> = {};
  try {
    const raw = await getGVClient().buildLabelMap(tenantId, 'uom');
    uomMap = raw instanceof Map ? Object.fromEntries(raw) : (raw as Record<string, string>);
  } catch {
    uomMap = {};
  }

  const lines: POContextLine[] = lineRows.map((l: any) => {
    const item = l.catalog_item_id ? itemMap[l.catalog_item_id] : null;
    const description = item ? item.name : l.item_description || 'Item';
    const sku = item?.sku ?? l.item_vendor_sku ?? null;
    const quantity = Number(l.qty_ordered) || 0;
    const unitPrice =
      l.unit_cost != null ? Number(l.unit_cost) : l.estimated_unit_cost != null ? Number(l.estimated_unit_cost) : null;
    const uom = l.uom_term_id ? uomMap[l.uom_term_id] ?? null : null;
    return {
      lineNumber: l.line_number ?? 0,
      description,
      sku,
      quantity,
      uom,
      unitPrice,
      extended: unitPrice != null ? unitPrice * quantity : null,
    };
  });

  const subtotal = lines.reduce((sum, l) => sum + (l.extended ?? 0), 0);
  const allPriced = lines.length > 0 && lines.every((l) => l.unitPrice != null);
  const company = await getCompanyProfile(admin, tenantId);

  return {
    poId: po.id,
    poNumber: po.po_number,
    status: po.status ?? null,
    orderDate: po.order_date ?? null,
    neededBy: po.needed_by_date ?? null,
    notes: po.notes ?? null,
    vendorName,
    vendorEmail,
    vendorContactName,
    vendorAddress,
    shipToName,
    shipToAddress,
    company,
    lines,
    subtotal,
    total: subtotal,
    allPriced,
  };
}
