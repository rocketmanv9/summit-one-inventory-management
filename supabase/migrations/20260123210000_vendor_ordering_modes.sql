-- =====================================================
-- VENDOR ORDERING MODES & DISTRIBUTOR SUPPORT
-- =====================================================
-- Purpose: Support real-world vendor ordering patterns where PO is
-- internal authorization but order placement varies by vendor.
-- 
-- Supports:
-- - Portal-based vendors (Uline, Grainger, White Cap, HD Supply)
-- - Email PO vendors (traditional)
-- - Phone/in-person ordering with PO reference
-- - Card-only vendors where PO is internal tracking only
-- 
-- Key Principle: PO is ALWAYS internal authorization.
-- How order is placed externally is vendor-specific.
-- =====================================================

-- =====================================================
-- 1. VENDOR ORDERING MODE ENUM
-- =====================================================

-- Create enum for ordering modes
CREATE TYPE supply_chain.ordering_mode AS ENUM (
    'email_po',              -- Traditional: PO emailed to vendor
    'portal_with_po_ref',    -- Portal ordering (Uline, Grainger) - PO # referenced during checkout
    'phone_with_po_ref',     -- Phone ordering - PO # referenced verbally
    'card_only_internal_po', -- Card payment (Home Depot, Amazon) - PO is internal only
    'pickup_only',           -- In-person pickup - PO is authorization
    'mixed'                  -- Vendor supports multiple methods
);

COMMENT ON TYPE supply_chain.ordering_mode IS 
'How orders are placed with this vendor. Drives UI hints and workflow guidance, not hard validation.';

-- =====================================================
-- 2. EXTEND VENDOR CONFIGURATION
-- =====================================================

-- Add ordering mode and related fields to vendors
ALTER TABLE supply_chain.vendors
ADD COLUMN IF NOT EXISTS ordering_mode supply_chain.ordering_mode DEFAULT 'email_po',
ADD COLUMN IF NOT EXISTS accepts_net_terms BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS requires_external_order_number BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS portal_url TEXT,
ADD COLUMN IF NOT EXISTS phone_number TEXT,
ADD COLUMN IF NOT EXISTS notes_for_buyers TEXT;

COMMENT ON COLUMN supply_chain.vendors.ordering_mode IS 'How to place orders with this vendor';
COMMENT ON COLUMN supply_chain.vendors.accepts_net_terms IS 'Whether vendor invoices on net terms (vs immediate card payment)';
COMMENT ON COLUMN supply_chain.vendors.requires_external_order_number IS 'Whether vendor requires their order number for receiving';
COMMENT ON COLUMN supply_chain.vendors.portal_url IS 'URL for vendor portal (if applicable)';
COMMENT ON COLUMN supply_chain.vendors.phone_number IS 'Phone number for orders';
COMMENT ON COLUMN supply_chain.vendors.notes_for_buyers IS 'Free-text guidance for buyers (e.g., "Enter PO # in comments field during checkout")';

-- Update existing po_instructions to be more specific
COMMENT ON COLUMN supply_chain.vendors.po_instructions IS 'Instructions for creating/submitting POs to this vendor';

-- =====================================================
-- 3. EXTERNAL ORDER TRACKING (OPTIONAL)
-- =====================================================

-- Add external order tracking to purchase_orders
ALTER TABLE supply_chain.purchase_orders
ADD COLUMN IF NOT EXISTS external_order_number TEXT,
ADD COLUMN IF NOT EXISTS ordered_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS ordered_by_user_id UUID,
ADD COLUMN IF NOT EXISTS order_placement_method TEXT CHECK (order_placement_method IN ('portal', 'email', 'phone', 'in_person', 'other')),
ADD COLUMN IF NOT EXISTS order_placement_notes TEXT;

COMMENT ON COLUMN supply_chain.purchase_orders.external_order_number IS 'Vendor-generated order number (from portal, confirmation email, etc)';
COMMENT ON COLUMN supply_chain.purchase_orders.ordered_at IS 'When order was placed with vendor (optional tracking)';
COMMENT ON COLUMN supply_chain.purchase_orders.ordered_by_user_id IS 'User who placed the external order';
COMMENT ON COLUMN supply_chain.purchase_orders.order_placement_method IS 'How order was placed with vendor (for traceability)';
COMMENT ON COLUMN supply_chain.purchase_orders.order_placement_notes IS 'Notes about order placement (cart total, confirmation, issues)';

-- Add index for external order number lookups
CREATE INDEX IF NOT EXISTS idx_purchase_orders_external_order_number 
ON supply_chain.purchase_orders(tenant_id, external_order_number) 
WHERE external_order_number IS NOT NULL;

-- =====================================================
-- 4. UPDATE PO STATUS WORKFLOW
-- =====================================================

-- Add new status for "ordered externally but not yet sent PO"
-- Note: This extends existing status enum
COMMENT ON COLUMN supply_chain.purchase_orders.status IS 
'PO lifecycle: 
  draft - Being created
  awaiting_approval - Needs authorization (optional)
  approved - Authorized, ready to order
  placed - Order placed with vendor (portal/phone/email)
  acknowledged - Vendor confirmed (optional)
  partially_received - Some items received
  fully_received - All items received
  cancelled - Cancelled before completion
  closed - Completed/archived';

-- =====================================================
-- 5. RPC: MARK PO AS ORDERED EXTERNALLY
-- =====================================================

-- Function to record external order placement
CREATE OR REPLACE FUNCTION supply_chain.rpc_mark_po_ordered(
    p_po_id UUID,
    p_external_order_number TEXT DEFAULT NULL,
    p_order_placement_method TEXT DEFAULT 'portal',
    p_order_placement_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO supply_chain, inventory, public
AS $$
DECLARE
    v_tenant_id UUID;
    v_user_id UUID;
    v_po RECORD;
    v_event_id UUID;
    v_result JSONB;
BEGIN
    -- Get tenant and user from auth context
    v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
    v_user_id := (auth.jwt() ->> 'user_id')::UUID;
    
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required - no tenant_id in JWT';
    END IF;
    
    -- Get PO and validate
    SELECT * INTO v_po
    FROM supply_chain.purchase_orders
    WHERE id = p_po_id
        AND tenant_id = v_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase order not found';
    END IF;
    
    -- Validate status allows ordering
    IF v_po.status NOT IN ('draft', 'approved') THEN
        RAISE EXCEPTION 'Cannot mark PO as ordered - status is %', v_po.status;
    END IF;
    
    -- Generate event ID
    v_event_id := gen_random_uuid();
    
    -- Update PO with external order details
    UPDATE supply_chain.purchase_orders
    SET 
        status = 'placed',
        external_order_number = p_external_order_number,
        ordered_at = NOW(),
        ordered_by_user_id = v_user_id,
        order_placement_method = p_order_placement_method,
        order_placement_notes = p_order_placement_notes,
        updated_at = NOW(),
        updated_by = v_user_id
    WHERE id = p_po_id;
    
    -- Emit event
    PERFORM inventory.publish_event(
        p_tenant_id := v_tenant_id,
        p_scope := 'supply_chain',
        p_event_name := 'purchase_order.ordered_externally',
        p_aggregate_type := 'purchase_order',
        p_aggregate_id := p_po_id,
        p_payload := jsonb_build_object(
            'po_id', p_po_id,
            'po_number', v_po.po_number,
            'external_order_number', p_external_order_number,
            'order_placement_method', p_order_placement_method,
            'vendor_id', v_po.vendor_id
        ),
        p_event_version := 1,
        p_metadata := jsonb_build_object(
            'ordered_by', v_user_id,
            'source', 'rpc_mark_po_ordered'
        )
    );
    
    -- Build result
    v_result := jsonb_build_object(
        'success', true,
        'po_id', p_po_id,
        'po_number', v_po.po_number,
        'status', 'placed',
        'external_order_number', p_external_order_number,
        'ordered_at', NOW(),
        'event_id', v_event_id
    );
    
    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION supply_chain.rpc_mark_po_ordered IS 
'Record that order was placed with vendor (portal/phone/email). 
PO remains the internal authorization regardless of how order was placed.';

GRANT EXECUTE ON FUNCTION supply_chain.rpc_mark_po_ordered TO authenticated;
GRANT EXECUTE ON FUNCTION supply_chain.rpc_mark_po_ordered TO service_role;

-- =====================================================
-- 6. RPC: SEND PO VIA EMAIL (SEPARATE FROM ORDERING)
-- =====================================================

-- Function to record PO email sending (different from ordering)
CREATE OR REPLACE FUNCTION supply_chain.rpc_send_po_email(
    p_po_id UUID,
    p_recipient_email TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO supply_chain, inventory, public
AS $$
DECLARE
    v_tenant_id UUID;
    v_user_id UUID;
    v_po RECORD;
    v_vendor RECORD;
    v_event_id UUID;
    v_result JSONB;
BEGIN
    -- Get tenant and user from auth context
    v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
    v_user_id := (auth.jwt() ->> 'user_id')::UUID;
    
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required - no tenant_id in JWT';
    END IF;
    
    -- Get PO and vendor
    SELECT po.* INTO v_po
    FROM supply_chain.purchase_orders po
    WHERE po.id = p_po_id
        AND po.tenant_id = v_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Purchase order not found';
    END IF;
    
    SELECT v.* INTO v_vendor
    FROM supply_chain.vendors v
    WHERE v.id = v_po.vendor_id;
    
    -- Determine recipient
    IF p_recipient_email IS NULL THEN
        p_recipient_email := COALESCE(v_vendor.po_email, v_vendor.contact_email);
    END IF;
    
    IF p_recipient_email IS NULL THEN
        RAISE EXCEPTION 'No email address available for vendor';
    END IF;
    
    -- Generate event ID
    v_event_id := gen_random_uuid();
    
    -- Update PO sent tracking
    UPDATE supply_chain.purchase_orders
    SET 
        sent_at = NOW(),
        sent_by_user_id = v_user_id,
        updated_at = NOW()
    WHERE id = p_po_id;
    
    -- Emit event (this would trigger email service)
    PERFORM inventory.publish_event(
        p_tenant_id := v_tenant_id,
        p_scope := 'supply_chain',
        p_event_name := 'purchase_order.sent',
        p_aggregate_type := 'purchase_order',
        p_aggregate_id := p_po_id,
        p_payload := jsonb_build_object(
            'po_id', p_po_id,
            'po_number', v_po.po_number,
            'recipient_email', p_recipient_email,
            'vendor_id', v_po.vendor_id,
            'vendor_name', v_vendor.name,
            'requires_po_in_subject', v_vendor.requires_po_in_subject
        ),
        p_event_version := 1,
        p_metadata := jsonb_build_object(
            'sent_by', v_user_id,
            'source', 'rpc_send_po_email'
        )
    );
    
    -- Build result
    v_result := jsonb_build_object(
        'success', true,
        'po_id', p_po_id,
        'po_number', v_po.po_number,
        'recipient_email', p_recipient_email,
        'sent_at', NOW(),
        'event_id', v_event_id
    );
    
    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION supply_chain.rpc_send_po_email IS 
'Send PO via email to vendor. 
Note: This is OPTIONAL and separate from order placement. 
Many vendors (portal-based) never receive the PO via email.';

GRANT EXECUTE ON FUNCTION supply_chain.rpc_send_po_email TO authenticated;
GRANT EXECUTE ON FUNCTION supply_chain.rpc_send_po_email TO service_role;

-- =====================================================
-- 7. VIEW: VENDOR ORDERING GUIDANCE
-- =====================================================

-- Create view to show vendor ordering instructions
CREATE OR REPLACE VIEW supply_chain.v_vendor_ordering_guidance AS
SELECT 
    v.id AS vendor_id,
    v.tenant_id,
    v.name AS vendor_name,
    v.ordering_mode,
    v.po_required,
    v.accepts_net_terms,
    v.default_payment_method,
    v.portal_url,
    v.phone_number,
    v.po_email,
    v.notes_for_buyers,
    v.requires_external_order_number,
    -- Generate helpful guidance text
    CASE v.ordering_mode
        WHEN 'email_po' THEN 
            'Email PO to: ' || COALESCE(v.po_email, v.contact_email, 'No email on file')
        WHEN 'portal_with_po_ref' THEN 
            'Order via portal: ' || COALESCE(v.portal_url, 'No portal URL on file') || 
            E'\nReference PO # during checkout'
        WHEN 'phone_with_po_ref' THEN 
            'Call: ' || COALESCE(v.phone_number, 'No phone on file') || 
            E'\nReference PO # when ordering'
        WHEN 'card_only_internal_po' THEN 
            'Order with company card. PO is for internal tracking only.'
        WHEN 'pickup_only' THEN 
            'In-person pickup. Bring PO or reference PO #.'
        WHEN 'mixed' THEN 
            'Multiple ordering methods available. See notes.'
        ELSE 'Contact vendor to place order'
    END AS ordering_instructions,
    -- Payment guidance
    CASE 
        WHEN v.accepts_net_terms THEN 'Invoice - ' || COALESCE(v.payment_terms, 'Net 30')
        ELSE 'Card payment required'
    END AS payment_guidance,
    -- Receiving notes
    CASE 
        WHEN v.requires_external_order_number THEN 
            'External order # required for receiving'
        ELSE 
            'Can receive with PO # or external order #'
    END AS receiving_notes
FROM supply_chain.vendors v
WHERE v.active = true;

COMMENT ON VIEW supply_chain.v_vendor_ordering_guidance IS 
'Provides ordering instructions and guidance per vendor based on their configuration.
Use this to drive UI hints and help users order correctly.';

-- =====================================================
-- 8. UPDATE EXISTING DATA
-- =====================================================

-- Set reasonable defaults for existing vendors
UPDATE supply_chain.vendors
SET 
    ordering_mode = 'email_po',
    accepts_net_terms = true
WHERE ordering_mode IS NULL;

-- =====================================================
-- 9. SEED EXAMPLE VENDOR CONFIGURATIONS
-- =====================================================

-- Add examples for common vendor types (only if not exists)
DO $$
DECLARE
    v_tenant_id UUID;
BEGIN
    -- Get a tenant ID (if any exist)
    SELECT tenant_id INTO v_tenant_id 
    FROM supply_chain.vendors 
    LIMIT 1;
    
    IF v_tenant_id IS NOT NULL THEN
        -- Example: Portal-based vendor (Uline/Grainger style)
        INSERT INTO supply_chain.vendors (
            tenant_id, name, code, ordering_mode, 
            portal_url, po_required, accepts_net_terms,
            notes_for_buyers, active
        ) VALUES (
            v_tenant_id,
            'Example Portal Vendor (Uline-style)',
            'PORTAL-DEMO',
            'portal_with_po_ref',
            'https://www.example-vendor.com',
            true,
            true,
            'Enter PO number in "Reference" field during checkout. Account required.',
            false  -- Inactive example
        ) ON CONFLICT DO NOTHING;
        
        -- Example: Card-only vendor (retail)
        INSERT INTO supply_chain.vendors (
            tenant_id, name, code, ordering_mode,
            po_required, accepts_net_terms, default_payment_method,
            notes_for_buyers, active
        ) VALUES (
            v_tenant_id,
            'Example Retail Vendor (HD-style)',
            'RETAIL-DEMO',
            'card_only_internal_po',
            false,
            false,
            'card',
            'Use company card. PO is for internal tracking. Attach receipt.',
            false  -- Inactive example
        ) ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- =====================================================
-- 10. DOCUMENTATION
-- =====================================================

COMMENT ON TABLE supply_chain.purchase_orders IS 
'Internal purchase order authorization and tracking.

KEY PRINCIPLE: PO is ALWAYS internal authorization, regardless of how order is placed externally.

Ordering Patterns:
- Email PO: Traditional vendors - PO emailed, vendor confirms
- Portal: Uline/Grainger - Order in portal, reference PO # during checkout
- Phone: Call vendor, reference PO # verbally
- Card Only: Home Depot/Amazon - PO is internal tracking only
- Pickup: In-person - Bring PO or reference number

The PO tracks authorization, cost, and receiving - independent of order placement method.';

COMMENT ON COLUMN supply_chain.purchase_orders.sent_at IS 
'When PO was sent via EMAIL (if applicable). 
OPTIONAL: Portal-based and card-only vendors may never receive PO email.';

COMMENT ON COLUMN supply_chain.purchase_orders.ordered_at IS 
'When order was placed with vendor (via portal/phone/email).
This is SEPARATE from sent_at. Many orders are placed without sending PO.';
