/**
 * Construction-Friendly Purchase Order Types
 * 
 * Supports:
 * - Non-catalog items (free-text descriptions)
 * - Flexible delivery methods (ship or pickup)
 * - Cost tracking (job, yard, overhead)
 * - Unknown/estimated pricing
 * - Approximate quantities
 */

export type DeliveryMethod = 'ship' | 'pickup';
export type CostContext = 'job' | 'yard' | 'overhead';
export type PriceBasis = 'fixed' | 'estimated' | 'market' | 'unknown';
export type PaymentMethod = 'invoice' | 'card' | 'cod' | 'account';

/**
 * How orders are placed with this vendor
 * Drives UI hints and workflow guidance, not hard validation
 */
export type OrderingMode = 
  | 'email_po'              // Traditional: PO emailed to vendor
  | 'portal_with_po_ref'    // Portal ordering (Uline, Grainger) - PO # referenced during checkout
  | 'phone_with_po_ref'     // Phone ordering - PO # referenced verbally
  | 'card_only_internal_po' // Card payment (Home Depot, Amazon) - PO is internal only
  | 'pickup_only'           // In-person pickup - PO is authorization
  | 'mixed';                // Vendor supports multiple methods

export type OrderPlacementMethod = 'portal' | 'email' | 'phone' | 'in_person' | 'other';

export type POStatus = 
  | 'draft' 
  | 'awaiting_approval' 
  | 'approved' 
  | 'placed' 
  | 'acknowledged'
  | 'partially_received' 
  | 'fully_received' 
  | 'cancelled' 
  | 'closed';

export type POLineStatus = 
  | 'open' 
  | 'partially_received' 
  | 'fully_received' 
  | 'cancelled';

// =====================================================
// VENDOR CONFIGURATION
// =====================================================

export interface VendorConfiguration {
  id: string;
  tenant_id: string;
  name: string;
  code?: string;
  contact_name?: string;
  contact_email?: string;
  // Ordering Mode Configuration (NEW)
  ordering_mode: OrderingMode;
  accepts_net_terms: boolean;
  requires_external_order_number: boolean;
  portal_url?: string;
  phone_number?: string;
  notes_for_buyers?: string;
  
  notes?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Vendor ordering guidance (from view)
 */
export interface VendorOrderingGuidance {
  vendor_id: string;
  tenant_id: string;
  vendor_name: string;
  ordering_mode: OrderingMode;
  po_required: boolean;
  accepts_net_terms: boolean;
  default_payment_method?: PaymentMethod;
  portal_url?: string;
  phone_number?: string;
  po_email?: string;
  notes_for_buyers?: string;
  requires_external_order_number: boolean;
  requires_po_in_subject: boolean;
  ordering_instructions: string;
  payment_guidance: string;
  receiving_notes: string;
}

// =====================================================
// VENDOR CONFIGURATION (from vendor table)
// =====================================================

export interface VendorConfiguration {
  vendor_id: string;
  vendor_name: string;
  
  // Ordering Mode
  ordering_mode: OrderingMode;
  portal_url?: string;
  phone_number?: string;
  notes_for_buyers?: string;
  requires_external_order_number: boolean;
  accepts_net_terms: boolean;
  
  // PO Configuration
  po_required: boolean;
  default_delivery_method?: DeliveryMethod | 'varies';
  default_payment_method?: PaymentMethod;
  po_email?: string;
  po_instructions?: string;
  requires_po_in_subject: boolean;
  min_order_amount?: number;
  freight_terms?: string;
  
  notes?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// =====================================================
// PURCHASE ORDER
// =====================================================

export interface PurchaseOrder {
  id: string;
  tenant_id: string;
  po_number: string;
  
  // Vendor & Delivery
  vendor_id?: string;
  vendor_location_id?: string; // Legacy - deprecated in favor of vendor_id
  delivery_method: DeliveryMethod;
  delivery_location_id?: string;
  pickup_location_id?: string;
  
  // Dates & Status
  order_date: string;
  needed_by_date?: string;
  expected_delivery_date?: string;
  status: POStatus;
  
  // Cost Context
  cost_context: CostContext;
  job_id?: string;
  max_authorized_spend?: number;
  
  // Vendor Details
  vendor_quote_ref?: string;
  notes?: string;
  attachments?: POAttachment[];
  
  // Approval & Audit
  created_by_user_id?: string;
  approved_by_user_id?: string;
  approved_at?: string;
  sent_at?: string;
  sent_by_user_id?: string;
  
  // External Order Tracking (for portal/phone/card vendors)
  external_order_number?: string;
  ordered_at?: string;
  ordered_by_user_id?: string;
  order_placement_method?: OrderPlacementMethod;
  order_placement_notes?: string;
  
  created_at: string;
  updated_at: string;
  updated_by?: string;
  last_event_id: string;
}

export interface POAttachment {
  url: string;
  filename: string;
  type?: 'quote' | 'screenshot' | 'email' | 'other';
  uploaded_at?: string;
  uploaded_by?: string;
}

// =====================================================
// PURCHASE ORDER LINE
// =====================================================

export interface PurchaseOrderLine {
  id: string;
  tenant_id: string;
  po_id: string;
  line_number: number;
  
  // Item Reference (catalog OR free-text)
  catalog_item_id?: string;
  item_description?: string;
  item_vendor_sku?: string;
  uom_term_id?: string;

  // Quantities
  qty_ordered: number;
  qty_received: number;
  is_approximate_qty: boolean;
  
  // Pricing
  price_basis: PriceBasis;
  unit_cost?: number;
  estimated_unit_cost?: number;
  
  // Status & Notes
  status: POLineStatus;
  line_notes?: string;
  notes?: string; // Alias for compatibility
  
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
  last_event_id: string;
}

// =====================================================
// CREATE PO REQUEST
// =====================================================

export interface CreatePORequest {
  // Required Core Fields
  vendor_id: string;
  po_number: string;
  delivery_method: DeliveryMethod;
  needed_by_date: string;
  cost_context: CostContext;
  lines: CreatePOLineInput[];
  
  // Conditional Required
  job_id?: string; // Required if cost_context = 'job'
  delivery_location_id?: string; // Required if delivery_method = 'ship'
  pickup_location_id?: string; // Required if delivery_method = 'pickup'
  max_authorized_spend?: number; // Required if any line has unknown pricing
  
  // Optional Advanced
  vendor_quote_ref?: string;
  notes?: string;
  attachments?: POAttachment[];
  expected_delivery_date?: string;
}

export interface CreatePOLineInput {
  // Item Reference (one required)
  catalog_item_id?: string;
  item_description?: string;
  
  // Required
  qty_ordered: number;
  uom_term_id?: string; // Required if non-catalog
  
  // Optional
  item_vendor_sku?: string;
  is_approximate_qty?: boolean;
  price_basis?: PriceBasis;
  unit_cost?: number;
  estimated_unit_cost?: number;
  line_notes?: string;
}

// =====================================================
// CREATE PO RESPONSE
// =====================================================

export interface CreatePOResponse {
  success: boolean;
  po_id: string;
  po_number: string;
  line_count: number;
  status: POStatus;
  estimated_total_cost: number;
  has_unknown_pricing: boolean;
  event_id: string;
}

// =====================================================
// PO WITH DETAILS (for display)
// =====================================================

export interface PurchaseOrderWithDetails extends PurchaseOrder {
  vendor?: VendorConfiguration;
  lines?: PurchaseOrderLine[];
  delivery_location?: {
    id: string;
    name: string;
    type: string;
  };
  pickup_location?: {
    id: string;
    name: string;
    type: string;
  };
  job?: {
    id: string;
    name: string;
    code: string;
  };
  created_by?: {
    id: string;
    name: string;
    email: string;
  };
}

// =====================================================
// VENDOR DEFAULTS (for form initialization)
// =====================================================

export interface VendorDefaults {
  vendor_id: string;
  vendor_name: string;
  default_delivery_method?: DeliveryMethod | 'varies';
  default_payment_method?: PaymentMethod;
  po_email?: string;
  po_instructions?: string;
  requires_po_in_subject: boolean;
  min_order_amount?: number;
  freight_terms?: string;
  lead_time_days?: number;
  ordering_mode?: OrderingMode;
}

// =====================================================
// FORM STATE (for Create PO Modal)
// =====================================================

export interface CreatePOFormState {
  // Core Fields
  vendor_id: string;
  po_number: string;
  delivery_method: DeliveryMethod;
  needed_by_date: string;
  cost_context: CostContext;
  job_id?: string;
  
  // Advanced Fields (collapsed by default)
  delivery_location_id?: string;
  pickup_location_id?: string;
  vendor_quote_ref?: string;
  notes?: string;
  attachments: POAttachment[];
  expected_delivery_date?: string;
  max_authorized_spend?: number;
  
  // Line Items
  lines: CreatePOLineInput[];
}

// =====================================================
// VALIDATION HELPERS
// =====================================================

export interface POValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePOForm(form: CreatePOFormState): POValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Required fields
  if (!form.vendor_id) errors.push('Vendor is required');
  if (!form.po_number) errors.push('PO number is required');
  if (!form.delivery_method) errors.push('Delivery method is required');
  if (!form.needed_by_date) errors.push('Needed by date is required');
  if (!form.cost_context) errors.push('Cost context is required');
  
  // Conditional requirements
  if (form.delivery_method === 'ship' && !form.delivery_location_id) {
    errors.push('Delivery location is required when vendor ships');
  }
  if (form.delivery_method === 'pickup' && !form.pickup_location_id) {
    errors.push('Pickup location is required for customer pickup');
  }
  if (form.cost_context === 'job' && !form.job_id) {
    errors.push('Job is required when cost context is Job');
  }
  
  // Line items
  if (form.lines.length === 0) {
    errors.push('At least one line item is required');
  }
  
  let hasUnknownPricing = false;
  form.lines.forEach((line, index) => {
    // Must have either catalog item or description
    if (!line.catalog_item_id && !line.item_description) {
      errors.push(`Line ${index + 1}: Item or description is required`);
    }
    
    // Non-catalog items need UOM
    if (!line.catalog_item_id && !line.uom_term_id) {
      errors.push(`Line ${index + 1}: Unit of measure is required for non-catalog items`);
    }
    
    // Quantity required
    if (!line.qty_ordered || line.qty_ordered <= 0) {
      errors.push(`Line ${index + 1}: Quantity must be greater than 0`);
    }
    
    // Check for unknown pricing
    if (!line.unit_cost && !line.estimated_unit_cost) {
      hasUnknownPricing = true;
    }
  });
  
  // Spend authorization
  if (hasUnknownPricing && !form.max_authorized_spend) {
    errors.push('Max authorized spend is required when pricing is unknown');
  }
  
  // Warnings
  if (hasUnknownPricing) {
    warnings.push('Some line items have unknown pricing - actual cost may vary');
  }
  
  const hasApproximateQty = form.lines.some(l => l.is_approximate_qty);
  if (hasApproximateQty) {
    warnings.push('Some quantities are approximate - actual quantity will be determined at receipt');
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

export function calculateLineTotal(line: CreatePOLineInput | PurchaseOrderLine): number | null {
  const price = 'unit_cost' in line && line.unit_cost !== undefined
    ? line.unit_cost
    : 'estimated_unit_cost' in line && line.estimated_unit_cost !== undefined
    ? line.estimated_unit_cost
    : null;
    
  if (price === null) return null;
  return line.qty_ordered * price;
}

export function calculatePOTotal(lines: (CreatePOLineInput | PurchaseOrderLine)[]): {
  total: number | null;
  hasUnknownPricing: boolean;
} {
  let total = 0;
  let hasUnknownPricing = false;
  
  for (const line of lines) {
    const lineTotal = calculateLineTotal(line);
    if (lineTotal === null) {
      hasUnknownPricing = true;
    } else {
      total += lineTotal;
    }
  }
  
  return { total: hasUnknownPricing ? null : total, hasUnknownPricing };
}

// =====================================================
// ORDERING MODE HELPERS
// =====================================================

export function getOrderingModeLabel(mode: OrderingMode): string {
  switch (mode) {
    case 'email_po': return 'Email PO';
    case 'portal_with_po_ref': return 'Portal (w/ PO Ref)';
    case 'phone_with_po_ref': return 'Phone (w/ PO Ref)';
    case 'card_only_internal_po': return 'Card Only (Internal PO)';
    case 'pickup_only': return 'Pickup Only';
    case 'mixed': return 'Mixed Methods';
    default: return mode;
  }
}

export function getOrderingModeDescription(mode: OrderingMode): string {
  switch (mode) {
    case 'email_po': 
      return 'PO is emailed directly to vendor';
    case 'portal_with_po_ref': 
      return 'Order placed in vendor portal, PO # referenced during checkout';
    case 'phone_with_po_ref': 
      return 'Order placed by phone, PO # referenced verbally';
    case 'card_only_internal_po': 
      return 'Vendor never sees PO - internal tracking only';
    case 'pickup_only': 
      return 'Material picked up in person, PO is authorization';
    case 'mixed': 
      return 'Vendor supports multiple ordering methods';
    default: 
      return '';
  }
}

export function getOrderingModeIcon(mode: OrderingMode): string {
  switch (mode) {
    case 'email_po': return '📧';
    case 'portal_with_po_ref': return '🌐';
    case 'phone_with_po_ref': return '📞';
    case 'card_only_internal_po': return '💳';
    case 'pickup_only': return '🚚';
    case 'mixed': return '🔀';
    default: return '📋';
  }
}

export function shouldShowSendPOButton(mode: OrderingMode): boolean {
  return mode === 'email_po' || mode === 'mixed';
}

export function shouldShowExternalOrderTracking(mode: OrderingMode): boolean {
  return mode === 'portal_with_po_ref' || 
         mode === 'phone_with_po_ref' || 
         mode === 'card_only_internal_po' ||
         mode === 'mixed';
}

export function getPlacementMethodLabel(method: OrderPlacementMethod): string {
  switch (method) {
    case 'portal': return 'Portal';
    case 'email': return 'Email';
    case 'phone': return 'Phone';
    case 'in_person': return 'In Person';
    case 'other': return 'Other';
    default: return method;
  }
}

// =====================================================
// STATUS HELPERS
// =====================================================

export function getStatusBadgeColor(status: POStatus): string {
  switch (status) {
    case 'draft': return 'gray';
    case 'awaiting_approval': return 'yellow';
    case 'approved': return 'blue';
    case 'placed': return 'indigo';
    case 'acknowledged': return 'purple';
    case 'partially_received': return 'orange';
    case 'fully_received': return 'green';
    case 'cancelled': return 'red';
    case 'closed': return 'slate';
    default: return 'gray';
  }
}

export function getStatusLabel(status: POStatus): string {
  switch (status) {
    case 'awaiting_approval': return 'Awaiting Approval';
    case 'partially_received': return 'Partially Received';
    case 'fully_received': return 'Fully Received';
    default: return status.charAt(0).toUpperCase() + status.slice(1);
  }
}


