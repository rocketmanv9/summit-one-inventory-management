-- =====================================================
-- CONSTRUCTION-FRIENDLY PURCHASE ORDER ENHANCEMENTS
-- =====================================================
-- Purpose: Enable fast PO creation (~60 seconds) with flexible data
-- while maintaining auditability and receiving accuracy.
-- 
-- Key Features:
-- 1. Non-catalog line items (free-text descriptions)
-- 2. Delivery method (vendor ships vs customer pickup)
-- 3. Cost context (job, yard stock, overhead)
-- 4. Max authorized spend cap
-- 5. Needed-by date for ops planning
-- 6. Vendor defaults and configuration
-- 7. Flexible pricing (unknown, estimated, market)
-- 8. Approximate quantities
-- =====================================================

-- =====================================================
-- 1. VENDOR CONFIGURATION & DEFAULTS
-- =====================================================

-- Add vendor configuration columns
ALTER TABLE supply_chain.vendors 
ADD COLUMN IF NOT EXISTS po_required BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS default_delivery_method TEXT CHECK (default_delivery_method IN ('ship', 'pickup', 'varies')),
ADD COLUMN IF NOT EXISTS default_payment_method TEXT CHECK (default_payment_method IN ('invoice', 'card', 'cod', 'account')),
ADD COLUMN IF NOT EXISTS po_email TEXT,
ADD COLUMN IF NOT EXISTS po_instructions TEXT,
ADD COLUMN IF NOT EXISTS requires_po_in_subject BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS min_order_amount NUMERIC(18, 4),
ADD COLUMN IF NOT EXISTS freight_terms TEXT;

COMMENT ON COLUMN supply_chain.vendors.po_required IS 'Whether this vendor requires a PO for all purchases';
COMMENT ON COLUMN supply_chain.vendors.default_delivery_method IS 'Default delivery method: ship (vendor delivers), pickup (customer picks up), varies';
COMMENT ON COLUMN supply_chain.vendors.default_payment_method IS 'Default payment method: invoice, card, cod, account';
COMMENT ON COLUMN supply_chain.vendors.po_email IS 'Email address to send POs to';
COMMENT ON COLUMN supply_chain.vendors.po_instructions IS 'Special instructions for POs to this vendor';
COMMENT ON COLUMN supply_chain.vendors.requires_po_in_subject IS 'Whether PO number must be in email subject line';
COMMENT ON COLUMN supply_chain.vendors.min_order_amount IS 'Minimum order amount for this vendor';
COMMENT ON COLUMN supply_chain.vendors.freight_terms IS 'Freight terms (e.g., FOB, prepaid, collect)';

-- =====================================================
-- 2. ENHANCED PURCHASE ORDERS TABLE
-- =====================================================

-- Add new columns to purchase_orders
ALTER TABLE supply_chain.purchase_orders
ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES supply_chain.vendors(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS delivery_method TEXT DEFAULT 'ship' CHECK (delivery_method IN ('ship', 'pickup')),
ADD COLUMN IF NOT EXISTS needed_by_date DATE,
ADD COLUMN IF NOT EXISTS cost_context TEXT DEFAULT 'yard' CHECK (cost_context IN ('job', 'yard', 'overhead')),
ADD COLUMN IF NOT EXISTS job_id UUID,
ADD COLUMN IF NOT EXISTS max_authorized_spend NUMERIC(18, 4),
ADD COLUMN IF NOT EXISTS pickup_location_id UUID REFERENCES inventory.locations(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS vendor_quote_ref TEXT,
ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sent_by_user_id UUID,
ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN supply_chain.purchase_orders.vendor_id IS 'Reference to vendor (replaces vendor_location_id pattern)';
COMMENT ON COLUMN supply_chain.purchase_orders.delivery_method IS 'Ship (vendor delivers) or pickup (we pick up)';
COMMENT ON COLUMN supply_chain.purchase_orders.needed_by_date IS 'When we need the materials (ops planning, not vendor promise)';
COMMENT ON COLUMN supply_chain.purchase_orders.cost_context IS 'Job, yard stock, or overhead - for cost tracking';
COMMENT ON COLUMN supply_chain.purchase_orders.job_id IS 'Job/project ID if cost_context = job';
COMMENT ON COLUMN supply_chain.purchase_orders.max_authorized_spend IS 'Maximum authorized spend (when pricing is unknown/variable)';
COMMENT ON COLUMN supply_chain.purchase_orders.pickup_location_id IS 'Location for pickup if delivery_method = pickup';
COMMENT ON COLUMN supply_chain.purchase_orders.vendor_quote_ref IS 'Vendor quote or reference number';
COMMENT ON COLUMN supply_chain.purchase_orders.sent_at IS 'When PO was sent to vendor';
COMMENT ON COLUMN supply_chain.purchase_orders.sent_by_user_id IS 'User who sent the PO to vendor';
COMMENT ON COLUMN supply_chain.purchase_orders.attachments IS 'Array of attachment URLs (quotes, screenshots, emails)';

-- Add index for vendor_id
CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor_id ON supply_chain.purchase_orders(tenant_id, vendor_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_orders_needed_by ON supply_chain.purchase_orders(tenant_id, needed_by_date) WHERE needed_by_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_orders_job_id ON supply_chain.purchase_orders(tenant_id, job_id) WHERE job_id IS NOT NULL;

-- =====================================================
-- 3. FLEXIBLE PURCHASE ORDER LINES
-- =====================================================

-- Add support for non-catalog items and flexible quantities
ALTER TABLE supply_chain.purchase_order_lines
ADD COLUMN IF NOT EXISTS item_description TEXT,
ADD COLUMN IF NOT EXISTS item_vendor_sku TEXT,
ADD COLUMN IF NOT EXISTS unit_of_measure TEXT,
ADD COLUMN IF NOT EXISTS is_approximate_qty BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS price_basis TEXT CHECK (price_basis IN ('fixed', 'estimated', 'market', 'unknown')),
ADD COLUMN IF NOT EXISTS estimated_unit_cost NUMERIC(18, 4),
ADD COLUMN IF NOT EXISTS line_notes TEXT;

-- Make catalog_item_id optional (for non-catalog items)
ALTER TABLE supply_chain.purchase_order_lines
ALTER COLUMN catalog_item_id DROP NOT NULL;

COMMENT ON COLUMN supply_chain.purchase_order_lines.item_description IS 'Free-text description for non-catalog items';
COMMENT ON COLUMN supply_chain.purchase_order_lines.item_vendor_sku IS 'Vendor SKU/part number (informational only)';
COMMENT ON COLUMN supply_chain.purchase_order_lines.unit_of_measure IS 'Unit of measure for non-catalog items';
COMMENT ON COLUMN supply_chain.purchase_order_lines.is_approximate_qty IS 'True if quantity is approximate (~30 tons)';
COMMENT ON COLUMN supply_chain.purchase_order_lines.price_basis IS 'Fixed, estimated, market pricing, or unknown';
COMMENT ON COLUMN supply_chain.purchase_order_lines.estimated_unit_cost IS 'Estimated unit cost when exact price unknown';
COMMENT ON COLUMN supply_chain.purchase_order_lines.line_notes IS 'Line-specific notes (fuel surcharge, backorder ok, etc)';

-- Add constraint: must have either catalog_item_id OR item_description
ALTER TABLE supply_chain.purchase_order_lines
ADD CONSTRAINT chk_line_has_item_reference 
CHECK (catalog_item_id IS NOT NULL OR item_description IS NOT NULL);

-- Add constraint: must have unit_of_measure if non-catalog
ALTER TABLE supply_chain.purchase_order_lines
ADD CONSTRAINT chk_noncatalog_has_uom
CHECK (catalog_item_id IS NOT NULL OR unit_of_measure IS NOT NULL);

-- =====================================================
-- 4. QTY ON ORDER TRACKING
-- =====================================================

-- Create view to calculate qty_on_order from open POs
CREATE OR REPLACE VIEW inventory.v_qty_on_order AS
SELECT 
    pol.tenant_id,
    pol.catalog_item_id,
    COALESCE(po.delivery_location_id, po.pickup_location_id) AS location_id,
    SUM(pol.qty_ordered - pol.qty_received) AS qty_on_order
FROM supply_chain.purchase_order_lines pol
JOIN supply_chain.purchase_orders po ON pol.po_id = po.id
WHERE po.status IN ('draft', 'awaiting_approval', 'approved', 'placed', 'acknowledged', 'partially_received')
    AND pol.status IN ('open', 'partially_received')
    AND pol.catalog_item_id IS NOT NULL
    AND (pol.qty_ordered - pol.qty_received) > 0
GROUP BY pol.tenant_id, pol.catalog_item_id, COALESCE(po.delivery_location_id, po.pickup_location_id);

COMMENT ON VIEW inventory.v_qty_on_order IS 'Calculates qty_on_order from open PO lines grouped by item and location';

-- =====================================================
-- 5. PO STATE MACHINE VALIDATION
-- =====================================================

-- Create function to validate PO status transitions
CREATE OR REPLACE FUNCTION supply_chain.validate_po_status_transition()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow any transition from draft
    IF OLD.status = 'draft' THEN
        RETURN NEW;
    END IF;
    
    -- Prevent invalid transitions
    IF OLD.status = 'cancelled' AND NEW.status != 'cancelled' THEN
        RAISE EXCEPTION 'Cannot change status of cancelled PO';
    END IF;
    
    IF OLD.status = 'closed' AND NEW.status != 'closed' THEN
        RAISE EXCEPTION 'Cannot change status of closed PO';
    END IF;
    
    -- Prevent going backwards in workflow (except cancellation)
    IF NEW.status = 'draft' AND OLD.status != 'draft' THEN
        RAISE EXCEPTION 'Cannot return PO to draft status';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for status validation
DROP TRIGGER IF EXISTS trg_validate_po_status ON supply_chain.purchase_orders;
CREATE TRIGGER trg_validate_po_status
    BEFORE UPDATE OF status ON supply_chain.purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION supply_chain.validate_po_status_transition();

-- =====================================================
-- 6. AUTO-UPDATE PO STATUS FROM LINE STATUS
-- =====================================================

-- Create function to auto-update PO status based on line statuses
CREATE OR REPLACE FUNCTION supply_chain.update_po_status_from_lines()
RETURNS TRIGGER AS $$
DECLARE
    v_po_id UUID;
    v_line_stats RECORD;
BEGIN
    -- Get the PO ID (works for INSERT, UPDATE, DELETE)
    v_po_id := COALESCE(NEW.po_id, OLD.po_id);
    
    -- Calculate line statistics
    SELECT
        COUNT(*) AS total_lines,
        COUNT(*) FILTER (WHERE status = 'fully_received') AS fully_received_count,
        COUNT(*) FILTER (WHERE status IN ('open', 'partially_received')) AS open_count,
        COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_count,
        SUM(qty_ordered) AS total_ordered,
        SUM(qty_received) AS total_received
    INTO v_line_stats
    FROM supply_chain.purchase_order_lines
    WHERE po_id = v_po_id;
    
    -- Update PO status based on line statuses
    IF v_line_stats.fully_received_count = v_line_stats.total_lines AND v_line_stats.total_lines > 0 THEN
        -- All lines fully received
        UPDATE supply_chain.purchase_orders
        SET status = 'fully_received', updated_at = NOW()
        WHERE id = v_po_id AND status NOT IN ('closed', 'cancelled');
        
    ELSIF v_line_stats.total_received > 0 THEN
        -- Some quantity received
        UPDATE supply_chain.purchase_orders
        SET status = 'partially_received', updated_at = NOW()
        WHERE id = v_po_id AND status NOT IN ('fully_received', 'closed', 'cancelled');
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update PO status when lines change
DROP TRIGGER IF EXISTS trg_update_po_status_from_lines ON supply_chain.purchase_order_lines;
CREATE TRIGGER trg_update_po_status_from_lines
    AFTER INSERT OR UPDATE OF qty_received, status OR DELETE ON supply_chain.purchase_order_lines
    FOR EACH ROW
    EXECUTE FUNCTION supply_chain.update_po_status_from_lines();

-- =====================================================
-- 7. ENHANCED RPC FOR PO CREATION
-- =====================================================

-- Drop old function if exists
DROP FUNCTION IF EXISTS supply_chain.rpc_create_purchase_order(UUID, TEXT, UUID, JSONB, TIMESTAMPTZ, TEXT);

-- Create enhanced RPC function
CREATE OR REPLACE FUNCTION supply_chain.rpc_create_purchase_order(
    p_vendor_id UUID,
    p_po_number TEXT,
    p_delivery_method TEXT DEFAULT 'ship',
    p_needed_by_date DATE DEFAULT NULL,
    p_cost_context TEXT DEFAULT 'yard',
    p_job_id UUID DEFAULT NULL,
    p_delivery_location_id UUID DEFAULT NULL,
    p_pickup_location_id UUID DEFAULT NULL,
    p_max_authorized_spend NUMERIC DEFAULT NULL,
    p_vendor_quote_ref TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL,
    p_attachments JSONB DEFAULT '[]'::jsonb,
    p_lines JSONB DEFAULT '[]'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO supply_chain, inventory, public
AS $$
DECLARE
    v_tenant_id UUID;
    v_user_id UUID;
    v_po_id UUID;
    v_line JSONB;
    v_line_number INT := 0;
    v_total_estimated_cost NUMERIC := 0;
    v_has_unknown_pricing BOOLEAN := false;
    v_event_id UUID;
    v_result JSONB;
BEGIN
    -- Get tenant and user from auth context
    v_tenant_id := (auth.jwt() ->> 'tenant_id')::UUID;
    v_user_id := (auth.jwt() ->> 'user_id')::UUID;
    
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required - no tenant_id in JWT';
    END IF;
    
    -- Validate delivery method and location pairing
    IF p_delivery_method = 'ship' AND p_delivery_location_id IS NULL THEN
        RAISE EXCEPTION 'delivery_location_id required when delivery_method = ship';
    END IF;
    
    IF p_delivery_method = 'pickup' AND p_pickup_location_id IS NULL THEN
        RAISE EXCEPTION 'pickup_location_id required when delivery_method = pickup';
    END IF;
    
    -- Validate cost context
    IF p_cost_context = 'job' AND p_job_id IS NULL THEN
        RAISE EXCEPTION 'job_id required when cost_context = job';
    END IF;
    
    -- Generate event ID for idempotency
    v_event_id := gen_random_uuid();
    
    -- Insert PO header
    INSERT INTO supply_chain.purchase_orders (
        tenant_id,
        po_number,
        vendor_id,
        delivery_method,
        needed_by_date,
        cost_context,
        job_id,
        delivery_location_id,
        pickup_location_id,
        max_authorized_spend,
        vendor_quote_ref,
        notes,
        attachments,
        order_date,
        status,
        created_by_user_id,
        last_event_id
    ) VALUES (
        v_tenant_id,
        p_po_number,
        p_vendor_id,
        p_delivery_method,
        p_needed_by_date,
        p_cost_context,
        p_job_id,
        p_delivery_location_id,
        p_pickup_location_id,
        p_max_authorized_spend,
        p_vendor_quote_ref,
        p_notes,
        p_attachments,
        CURRENT_DATE,
        'draft',
        v_user_id,
        v_event_id::text
    )
    RETURNING id INTO v_po_id;
    
    -- Insert PO lines
    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
        v_line_number := v_line_number + 1;
        
        -- Check for unknown pricing
        IF (v_line->>'unit_cost') IS NULL AND (v_line->>'estimated_unit_cost') IS NULL THEN
            v_has_unknown_pricing := true;
        END IF;
        
        -- Calculate estimated cost
        IF (v_line->>'unit_cost') IS NOT NULL THEN
            v_total_estimated_cost := v_total_estimated_cost + 
                ((v_line->>'qty_ordered')::NUMERIC * (v_line->>'unit_cost')::NUMERIC);
        ELSIF (v_line->>'estimated_unit_cost') IS NOT NULL THEN
            v_total_estimated_cost := v_total_estimated_cost + 
                ((v_line->>'qty_ordered')::NUMERIC * (v_line->>'estimated_unit_cost')::NUMERIC);
        END IF;
        
        INSERT INTO supply_chain.purchase_order_lines (
            tenant_id,
            po_id,
            line_number,
            catalog_item_id,
            item_description,
            item_vendor_sku,
            unit_of_measure,
            qty_ordered,
            is_approximate_qty,
            unit_cost,
            estimated_unit_cost,
            price_basis,
            line_notes,
            status,
            created_by,
            last_event_id
        ) VALUES (
            v_tenant_id,
            v_po_id,
            v_line_number,
            (v_line->>'catalog_item_id')::UUID,
            v_line->>'item_description',
            v_line->>'item_vendor_sku',
            v_line->>'unit_of_measure',
            (v_line->>'qty_ordered')::NUMERIC,
            COALESCE((v_line->>'is_approximate_qty')::BOOLEAN, false),
            (v_line->>'unit_cost')::NUMERIC,
            (v_line->>'estimated_unit_cost')::NUMERIC,
            COALESCE(v_line->>'price_basis', 'fixed'),
            v_line->>'line_notes',
            'open',
            v_user_id,
            v_event_id::text
        );
    END LOOP;
    
    -- Validate spend authorization if pricing is unknown
    IF v_has_unknown_pricing AND p_max_authorized_spend IS NULL THEN
        RAISE EXCEPTION 'max_authorized_spend required when line items have unknown pricing';
    END IF;
    
    -- Emit purchase_order.created event
    PERFORM inventory.publish_event(
        p_tenant_id := v_tenant_id,
        p_scope := 'supply_chain',
        p_event_name := 'purchase_order.created',
        p_aggregate_type := 'purchase_order',
        p_aggregate_id := v_po_id,
        p_payload := jsonb_build_object(
            'po_id', v_po_id,
            'po_number', p_po_number,
            'vendor_id', p_vendor_id,
            'delivery_method', p_delivery_method,
            'cost_context', p_cost_context,
            'line_count', v_line_number,
            'estimated_total_cost', v_total_estimated_cost,
            'has_unknown_pricing', v_has_unknown_pricing
        ),
        p_event_version := 1,
        p_metadata := jsonb_build_object(
            'created_by', v_user_id,
            'source', 'rpc_create_purchase_order'
        )
    );
    
    -- Build result
    v_result := jsonb_build_object(
        'success', true,
        'po_id', v_po_id,
        'po_number', p_po_number,
        'line_count', v_line_number,
        'status', 'draft',
        'estimated_total_cost', v_total_estimated_cost,
        'has_unknown_pricing', v_has_unknown_pricing,
        'event_id', v_event_id
    );
    
    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION supply_chain.rpc_create_purchase_order IS 
'Create construction-friendly PO with flexible line items, delivery methods, and cost tracking. 
Supports non-catalog items, approximate quantities, and unknown pricing.';

-- =====================================================
-- 8. GRANT PERMISSIONS
-- =====================================================

-- Grant execute on new RPC to authenticated users
GRANT EXECUTE ON FUNCTION supply_chain.rpc_create_purchase_order TO authenticated;
GRANT EXECUTE ON FUNCTION supply_chain.rpc_create_purchase_order TO service_role;

-- =====================================================
-- 9. UPDATE SEED DATA
-- =====================================================

-- Update existing vendors with defaults (safe for existing data)
UPDATE supply_chain.vendors
SET 
    po_required = false,
    default_delivery_method = 'ship',
    default_payment_method = 'invoice'
WHERE po_required IS NULL;

COMMENT ON TABLE supply_chain.purchase_orders IS 
'Construction-friendly purchase orders supporting: 
- Non-catalog items (free-text descriptions)
- Flexible delivery (vendor ship or customer pickup)  
- Cost tracking (job, yard, overhead)
- Unknown/estimated pricing with spend caps
- Approximate quantities
- Vendor defaults and configuration';

COMMENT ON TABLE supply_chain.purchase_order_lines IS
'Flexible PO line items supporting both catalog and non-catalog items with approximate quantities and variable pricing';
