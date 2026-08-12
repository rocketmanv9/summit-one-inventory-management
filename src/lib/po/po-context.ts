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

  /**
   * Label for the delivery block on the PDF/email: 'SHIP TO' for a delivery PO
   * (delivery_method 'ship'), 'PICKUP AT' for a will-call pickup.
   */
  deliveryLabel: 'SHIP TO' | 'PICKUP AT';
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

/** A tenant location's raw address columns, as loaded from inventory.locations. */
interface LocationAddressRow {
  id?: string;
  parent_location_id?: string | null;
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  shipping_address?: string | null;
  address?: string | null;
}

/** Format one location row's own address, or null if it carries no usable address. */
function locationOwnAddress(loc: LocationAddressRow): string | null {
  return (
    formatAddress({
      street1: loc.address_line_1,
      street2: loc.address_line_2,
      city: loc.city,
      state: loc.state,
      zip: loc.postal_code,
    }) ||
    // Fall back to the free-text shipping/address fields; treat blank/whitespace
    // as absent (sub-bins store address='' rather than NULL).
    (loc.shipping_address?.trim() || loc.address?.trim() || null)
  );
}

/**
 * Resolve a tenant location's street address, inheriting from its parent when
 * the location carries no address of its own (Grant's rule: sub-bins like
 * "Portland Shed" show their parent yard's address). Walks up
 * parent_location_id defensively (bounded hops, cycle-guarded). Returns the
 * chosen location's own name plus the first non-empty address found up the
 * chain — so the name line stays the sub-bin while the address is inherited.
 *
 * Shared by the PDF/email loader and (via the create-page preview API) the
 * create-UI address preview, so both render byte-identical resolution.
 */
export async function resolveLocationAddress(
  admin: AdminClient,
  tenantId: string,
  locationId: string,
): Promise<{ name: string | null; address: string | null }> {
  const inv = admin.schema('inventory');
  const SELECT =
    'id, name, parent_location_id, address_line_1, address_line_2, city, state, postal_code, shipping_address, address';

  const { data: loc, error } = await inv
    .from('locations')
    .select(SELECT)
    .eq('id', locationId)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('resolveLocationAddress: location lookup failed', error.message);
    return { name: null, address: null };
  }
  if (!loc) return { name: null, address: null };

  const name = loc.name ?? null;
  let address = locationOwnAddress(loc);

  // Walk up the parent chain until we find an address (or run out of parents).
  // Bounded + cycle-guarded so a mis-parented location can never loop forever.
  const seen = new Set<string>([loc.id]);
  let parentId: string | null = loc.parent_location_id ?? null;
  let hops = 0;
  while (!address && parentId && hops < 5 && !seen.has(parentId)) {
    seen.add(parentId);
    hops += 1;
    const { data: parent } = await inv
      .from('locations')
      .select(SELECT)
      .eq('id', parentId)
      .limit(1)
      .maybeSingle();
    if (!parent) break;
    address = locationOwnAddress(parent);
    parentId = parent.parent_location_id ?? null;
  }

  return { name, address };
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
      'id, po_number, status, vendor_id, vendor_name_snapshot, delivery_method, delivery_location_id, pickup_location_id, order_date, needed_by_date, notes',
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
  // The vendor's will-call/pickup location, used when this PO is a pickup with
  // no tenant will-call location chosen. Prefers an address_type 'pickup' row,
  // then falls back to the vendor's first address on file.
  let vendorPickup: { name: string | null; address: string | null } | null = null;
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
      const { data: addrs } = await sc
        .from('vendor_addresses')
        .select('address_type, label, street1, street2, city, state, zip')
        .eq('vendor_id', po.vendor_id)
        .eq('tenant_id', tenantId)
        .order('address_type')
        .limit(50);
      const rows = addrs ?? [];
      if (rows.length > 0) {
        vendorAddress = formatAddress(rows[0]);
        // Pickup source: a 'pickup'-typed address wins, else the first on file.
        const pickupRow = rows.find((a: any) => a.address_type === 'pickup') ?? rows[0];
        vendorPickup = {
          name: pickupRow.label?.trim() || vendorName,
          address: formatAddress(pickupRow),
        };
      }
    } catch {
      // table may not exist in this environment
    }
  }

  // Delivery block — 'ship' renders SHIP TO with the delivery location's
  // address; 'pickup' renders PICKUP AT with either a chosen tenant will-call
  // location or the vendor's pickup address. Both location lookups resolve the
  // street address from the parent when the chosen location has none of its own
  // (sub-bins inherit the parent yard's address).
  const isPickup = po.delivery_method === 'pickup';
  const deliveryLabel: 'SHIP TO' | 'PICKUP AT' = isPickup ? 'PICKUP AT' : 'SHIP TO';
  let shipToName: string | null = null;
  let shipToAddress: string | null = null;

  if (isPickup) {
    if (po.pickup_location_id) {
      // On-site will-call at one of the tenant's own locations.
      const resolved = await resolveLocationAddress(admin, tenantId, po.pickup_location_id);
      shipToName = resolved.name;
      shipToAddress = resolved.address;
    } else if (vendorPickup) {
      // Pickup straight from the vendor's counter/plant.
      shipToName = vendorPickup.name;
      shipToAddress = vendorPickup.address;
    }
  } else if (po.delivery_location_id) {
    const resolved = await resolveLocationAddress(admin, tenantId, po.delivery_location_id);
    shipToName = resolved.name;
    shipToAddress = resolved.address;
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
    deliveryLabel,
    shipToName,
    shipToAddress,
    company,
    lines,
    subtotal,
    total: subtotal,
    allPriced,
  };
}
