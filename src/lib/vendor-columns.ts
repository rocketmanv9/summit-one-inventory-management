// Writable columns on supply_chain.vendors. Used by the vendor routes to drop
// GV-shaped fields the Vendors UI may send that don't exist here (e.g.
// account_number, description, is_custom, tags) so an insert/update can't fail
// on an unknown column.
export const VENDOR_COLUMNS = new Set<string>([
  'name', 'code', 'contact_name', 'contact_email', 'contact_phone', 'payment_terms', 'notes', 'active',
  'lead_time_days', 'po_required', 'default_delivery_method', 'default_payment_method', 'po_email',
  'po_instructions', 'requires_po_in_subject', 'min_order_amount', 'freight_terms', 'ordering_mode',
  'accepts_net_terms', 'requires_external_order_number', 'portal_url', 'phone_number', 'notes_for_buyers',
  'vendor_type_term_id', 'latitude', 'longitude', 'address_line_1', 'city', 'state', 'postal_code', 'country',
]);

export function pickVendorColumns(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) if (VENDOR_COLUMNS.has(k)) out[k] = v;
  return out;
}
