-- =====================================================
-- Configure Vendor Ordering Modes - Quick Reference
-- =====================================================
--
-- Use these templates to configure your vendors with
-- appropriate ordering modes based on their capabilities.
--
-- Run these in your local Supabase DB after editing
-- vendor names and values.

-- =====================================================
-- PORTAL VENDORS (Uline, Grainger, White Cap, etc.)
-- =====================================================
-- These vendors require ordering through their portals,
-- but you reference the PO # during checkout.

UPDATE supply_chain.vendors
SET 
  ordering_mode = 'portal_with_po_ref',
  portal_url = 'https://www.uline.com',
  accepts_net_terms = true,
  requires_external_order_number = true,
  notes_for_buyers = 'Log in to Uline portal. Add items to cart. Enter PO # in Reference field at checkout. Account required.'
WHERE name ILIKE '%uline%'
  AND tenant_id = auth.tenant_id(); -- Replace with your tenant ID in production

UPDATE supply_chain.vendors
SET 
  ordering_mode = 'portal_with_po_ref',
  portal_url = 'https://www.grainger.com',
  accepts_net_terms = true,
  requires_external_order_number = true,
  notes_for_buyers = 'Order via Grainger.com. Reference PO # in order notes. Save Grainger order # for receiving.'
WHERE name ILIKE '%grainger%'
  AND tenant_id = auth.tenant_id();

UPDATE supply_chain.vendors
SET 
  ordering_mode = 'portal_with_po_ref',
  portal_url = 'https://www.whitecap.com',
  accepts_net_terms = true,
  requires_external_order_number = true,
  notes_for_buyers = 'Order online. Enter PO # in PO Number field. White Cap will send order confirmation email.'
WHERE name ILIKE '%white cap%'
  AND tenant_id = auth.tenant_id();

-- =====================================================
-- CARD-ONLY VENDORS (Retail, Amazon, etc.)
-- =====================================================
-- These vendors don't accept POs - purchases are made
-- with company card. PO is for internal authorization only.

UPDATE supply_chain.vendors
SET 
  ordering_mode = 'card_only_internal_po',
  portal_url = 'https://www.homedepot.com',
  accepts_net_terms = false,
  default_payment_method = 'card',
  requires_external_order_number = false,
  notes_for_buyers = 'Use company card. PO is for internal tracking only. Attach receipt when receiving.'
WHERE name ILIKE '%home depot%'
  AND tenant_id = auth.tenant_id();

UPDATE supply_chain.vendors
SET 
  ordering_mode = 'card_only_internal_po',
  portal_url = 'https://www.amazon.com',
  accepts_net_terms = false,
  default_payment_method = 'card',
  requires_external_order_number = false,
  notes_for_buyers = 'Order with business Amazon account. Use company card. Save order # from confirmation email.'
WHERE name ILIKE '%amazon%'
  AND tenant_id = auth.tenant_id();

-- =====================================================
-- PHONE ORDERING VENDORS
-- =====================================================
-- These vendors prefer phone orders. You'll reference
-- the PO # verbally during the call.

UPDATE supply_chain.vendors
SET 
  ordering_mode = 'phone_with_po_ref',
  phone_number = '1-800-EXAMPLE',
  accepts_net_terms = true,
  requires_external_order_number = false,
  notes_for_buyers = 'Call to place order. Provide PO # and account info. Request confirmation number.'
WHERE name ILIKE '%local supplier%'
  AND tenant_id = auth.tenant_id();

-- =====================================================
-- PICKUP-ONLY VENDORS (Quarries, Local Suppliers)
-- =====================================================
-- Materials are picked up in person. May need to
-- present printed PO or just reference PO # verbally.

UPDATE supply_chain.vendors
SET 
  ordering_mode = 'pickup_only',
  accepts_net_terms = true,
  requires_external_order_number = false,
  notes_for_buyers = 'Print PO and bring to pickup location. Materials loaded upon arrival.'
WHERE name ILIKE '%quarry%'
  AND tenant_id = auth.tenant_id();

-- =====================================================
-- TRADITIONAL EMAIL PO VENDORS
-- =====================================================
-- These vendors accept emailed POs (default mode).
-- No changes needed if already configured.

UPDATE supply_chain.vendors
SET 
  ordering_mode = 'email_po',
  accepts_net_terms = true,
  requires_external_order_number = false,
  notes_for_buyers = 'Email PO. Vendor will confirm receipt and provide delivery estimate.'
WHERE name ILIKE '%traditional supplier%'
  AND tenant_id = auth.tenant_id();

-- =====================================================
-- MIXED MODE VENDORS
-- =====================================================
-- These vendors support multiple ordering methods.
-- User will choose at time of order placement.

UPDATE supply_chain.vendors
SET 
  ordering_mode = 'mixed',
  portal_url = 'https://www.vendor.com',
  phone_number = '1-800-VENDOR',
  po_email = 'orders@vendor.com',
  accepts_net_terms = true,
  requires_external_order_number = false,
  notes_for_buyers = 'Can order via portal, phone, or email. Choose method when placing order.'
WHERE name ILIKE '%flexible vendor%'
  AND tenant_id = auth.tenant_id();

-- =====================================================
-- VERIFY CONFIGURATIONS
-- =====================================================

-- See all vendor ordering configurations
SELECT 
  v.name,
  v.ordering_mode,
  v.portal_url,
  v.phone_number,
  v.accepts_net_terms,
  v.requires_external_order_number,
  v.notes_for_buyers
FROM supply_chain.vendors v
WHERE v.tenant_id = auth.tenant_id()
ORDER BY v.name;

-- Test the ordering guidance view
SELECT 
  v.name,
  g.ordering_instructions,
  g.payment_guidance,
  g.receiving_notes
FROM supply_chain.vendors v
JOIN supply_chain.v_vendor_ordering_guidance g ON g.vendor_id = v.id
WHERE v.tenant_id = auth.tenant_id()
LIMIT 5;

-- =====================================================
-- EXAMPLE: Create test PO and mark as ordered
-- =====================================================

/*
-- 1. Create PO (via app UI or RPC)
SELECT supply_chain.rpc_create_purchase_order(
  p_vendor_id := 'uuid-here',
  p_po_number := 'PO-2026-TEST',
  p_delivery_method := 'ship',
  p_lines := jsonb_build_array(
    jsonb_build_object(
      'item_description', 'Test Item',
      'qty_ordered', 10
    )
  )
);

-- 2. Mark as ordered (portal example)
SELECT supply_chain.rpc_mark_po_ordered(
  p_po_id := 'po-uuid-here',
  p_external_order_number := 'ULINE-12345678',
  p_order_placement_method := 'portal',
  p_order_placement_notes := 'Ordered via Uline.com. Used company account.'
);

-- 3. Optional: Send PO email (if vendor accepts email POs)
SELECT supply_chain.rpc_send_po_email(
  p_po_id := 'po-uuid-here',
  p_recipient_email := 'orders@vendor.com'
);
*/
