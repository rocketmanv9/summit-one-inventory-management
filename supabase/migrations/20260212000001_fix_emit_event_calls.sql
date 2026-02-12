-- =================================================================
-- FIX ALL emit_event() CALLS TO USE NEW SIGNATURE
-- =================================================================
-- Updates all trigger functions and RPC calls to use the new
-- emit_event() parameter names (p_type instead of positional params)
-- =================================================================

-- This migration updates all existing emit_event() calls throughout
-- the codebase to use the new named parameter signature.
--
-- Old (positional):
--   PERFORM public.emit_event(event_name, payload, tenant_id);
--
-- New (named):
--   PERFORM public.emit_event(
--     p_type := event_name,
--     p_payload := payload,
--     p_tenant_id := tenant_id
--   );

-- =================================================================
-- 1. inventory.emit_asset_event()
-- =================================================================

CREATE OR REPLACE FUNCTION inventory.emit_asset_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_event_name TEXT;
    v_payload JSONB;
    v_changes JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_name := 'asset.created';
        v_payload := jsonb_build_object(
            'asset_id', NEW.id,
            'asset_tag', NEW.asset_tag,
            'catalog_item_id', NEW.catalog_item_id,
            'status', NEW.status,
            'home_location_id', NEW.home_location_id,
            'tenant_id', NEW.tenant_id,
            'created_at', NEW.created_at
        );
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.status = 'retired' AND OLD.status != 'retired' THEN
            v_event_name := 'asset.retired';
            v_payload := jsonb_build_object(
                'asset_id', NEW.id,
                'asset_tag', NEW.asset_tag,
                'tenant_id', NEW.tenant_id,
                'retired_at', NEW.updated_at
            );
        ELSE
            v_event_name := 'asset.updated';
            v_changes := jsonb_build_object();
            
            IF OLD.status != NEW.status THEN
                v_changes := v_changes || jsonb_build_object('status', jsonb_build_object('old', OLD.status, 'new', NEW.status));
            END IF;
            IF OLD.home_location_id IS DISTINCT FROM NEW.home_location_id THEN
                v_changes := v_changes || jsonb_build_object('home_location_id', jsonb_build_object('old', OLD.home_location_id, 'new', NEW.home_location_id));
            END IF;
            
            v_payload := jsonb_build_object(
                'asset_id', NEW.id,
                'tenant_id', NEW.tenant_id,
                'changes', v_changes,
                'updated_at', NEW.updated_at
            );
        END IF;
    END IF;
    
    PERFORM public.emit_event(
        p_type := v_event_name,
        p_payload := v_payload,
        p_tenant_id := NEW.tenant_id
    );
    
    RETURN NEW;
END;
$$;

-- =================================================================
-- 2. inventory.emit_catalog_item_event()
-- =================================================================

CREATE OR REPLACE FUNCTION inventory.emit_catalog_item_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_event_name TEXT;
    v_payload JSONB;
    v_changes JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_name := 'inventory.item.created';
        v_payload := jsonb_build_object(
            'item_id', NEW.id,
            'sku', NEW.sku,
            'name', NEW.name,
            'category_id', NEW.category_id,
            'tracking_mode', NEW.tracking_mode,
            'unit_of_measure', NEW.unit_of_measure,
            'tenant_id', NEW.tenant_id,
            'created_at', NEW.created_at
        );
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.active = TRUE AND NEW.active = FALSE THEN
            v_event_name := 'catalog_item.deactivated';
            v_payload := jsonb_build_object(
                'item_id', NEW.id,
                'tenant_id', NEW.tenant_id,
                'deactivated_at', NEW.updated_at
            );
        ELSIF OLD.active = FALSE AND NEW.active = TRUE THEN
            v_event_name := 'catalog_item.reactivated';
            v_payload := jsonb_build_object(
                'item_id', NEW.id,
                'tenant_id', NEW.tenant_id,
                'reactivated_at', NEW.updated_at
            );
        ELSE
            v_event_name := 'catalog_item.updated';
            v_changes := jsonb_build_object();

            IF OLD.name != NEW.name THEN
                v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', OLD.name, 'new', NEW.name));
            END IF;
            IF OLD.sku != NEW.sku THEN
                v_changes := v_changes || jsonb_build_object('sku', jsonb_build_object('old', OLD.sku, 'new', NEW.sku));
            END IF;
            IF OLD.unit_of_measure IS DISTINCT FROM NEW.unit_of_measure THEN
                v_changes := v_changes || jsonb_build_object('unit_of_measure', jsonb_build_object('old', OLD.unit_of_measure, 'new', NEW.unit_of_measure));
            END IF;
            IF OLD.category_id IS DISTINCT FROM NEW.category_id THEN
                v_changes := v_changes || jsonb_build_object('category_id', jsonb_build_object('old', OLD.category_id, 'new', NEW.category_id));
            END IF;

            v_payload := jsonb_build_object(
                'item_id', NEW.id,
                'tenant_id', NEW.tenant_id,
                'changes', v_changes,
                'updated_at', NEW.updated_at
            );
        END IF;
    END IF;

    PERFORM public.emit_event(
        p_type := v_event_name,
        p_payload := v_payload,
        p_tenant_id := NEW.tenant_id
    );

    RETURN NEW;
END;
$$ ;

-- =================================================================
-- 3. inventory.emit_location_event()
-- =================================================================

CREATE OR REPLACE FUNCTION inventory.emit_location_event() 
RETURNS TRIGGER
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
DECLARE
    v_event_name TEXT;
    v_payload JSONB;
    v_changes JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_name := 'location.created';
        v_payload := jsonb_build_object(
            'location_id', NEW.id,
            'location_type_id', NEW.location_type_id,
            'name', NEW.name,
            'parent_location_id', NEW.parent_location_id,
            'address', NEW.address,
            'external_ref', NEW.external_ref,
            'tenant_id', NEW.tenant_id,
            'created_at', NEW.created_at,
            'created_by', NEW.created_by
        );
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.active = TRUE AND NEW.active = FALSE THEN
            v_event_name := 'location.deactivated';
            v_payload := jsonb_build_object(
                'location_id', NEW.id,
                'tenant_id', NEW.tenant_id,
                'deactivated_at', NEW.updated_at,
                'deactivated_by', NEW.updated_by
            );
        ELSE
            v_event_name := 'location.updated';
            v_changes := jsonb_build_object();
            
            IF OLD.name != NEW.name THEN
                v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', OLD.name, 'new', NEW.name));
            END IF;
            
            IF OLD.location_type_id != NEW.location_type_id THEN
                v_changes := v_changes || jsonb_build_object('location_type_id', jsonb_build_object('old', OLD.location_type_id, 'new', NEW.location_type_id));
            END IF;
            
            IF (OLD.parent_location_id IS DISTINCT FROM NEW.parent_location_id) THEN
                v_changes := v_changes || jsonb_build_object('parent_location_id', jsonb_build_object('old', OLD.parent_location_id, 'new', NEW.parent_location_id));
            END IF;
            
            IF (OLD.address IS DISTINCT FROM NEW.address) THEN
                v_changes := v_changes || jsonb_build_object('address', jsonb_build_object('old', OLD.address, 'new', NEW.address));
            END IF;
            
            v_payload := jsonb_build_object(
                'location_id', NEW.id,
                'tenant_id', NEW.tenant_id,
                'changes', v_changes,
                'updated_at', NEW.updated_at,
                'updated_by', NEW.updated_by
            );
        END IF;
    END IF;
    
    PERFORM public.emit_event(
        p_type := v_event_name,
        p_payload := v_payload,
        p_tenant_id := NEW.tenant_id
    );
    
    RETURN NEW;
END;
$$;

-- =================================================================
-- 4. supply_chain.emit_vendor_event()
-- =================================================================

CREATE OR REPLACE FUNCTION supply_chain.emit_vendor_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_name TEXT;
  v_payload JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_name := 'supply_chain.vendor.created';
    v_payload := jsonb_build_object(
      'vendor_id', NEW.id,
      'vendor_code', NEW.vendor_code,
      'vendor_name', NEW.vendor_name,
      'tenant_id', NEW.tenant_id,
      'created_at', NEW.created_at
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.active = TRUE AND NEW.active = FALSE THEN
      v_event_name := 'supply_chain.vendor.deactivated';
      v_payload := jsonb_build_object(
        'vendor_id', NEW.id,
        'vendor_code', NEW.vendor_code,
        'vendor_name', NEW.vendor_name,
        'tenant_id', NEW.tenant_id,
        'deactivated_at', NEW.updated_at
      );
    ELSIF OLD.active = FALSE AND NEW.active = TRUE THEN
      v_event_name := 'supply_chain.vendor.reactivated';
      v_payload := jsonb_build_object(
        'vendor_id', NEW.id,
        'vendor_code', NEW.vendor_code,
        'vendor_name', NEW.vendor_name,
        'tenant_id', NEW.tenant_id,
        'reactivated_at', NEW.updated_at
      );
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  PERFORM public.emit_event(
    p_type := v_event_name,
    p_payload := v_payload,
    p_tenant_id := NEW.tenant_id
  );

  RETURN NEW;
END;
$$;

-- =================================================================
-- 5. supply_chain.emit_purchase_order_event()
-- =================================================================

CREATE OR REPLACE FUNCTION supply_chain.emit_purchase_order_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_name TEXT;
  v_payload JSONB;
  v_line_count INT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_name := 'supply_chain.purchase_order.created';
    
    SELECT COUNT(*) INTO v_line_count
    FROM supply_chain.purchase_order_lines
    WHERE po_id = NEW.id;
    
    v_payload := jsonb_build_object(
      'po_id', NEW.id,
      'po_number', NEW.po_number,
      'vendor_id', NEW.vendor_id,
      'vendor_name', NEW.vendor_name_snapshot,
      'vendor_code', NEW.vendor_code_snapshot,
      'total_lines', v_line_count,
      'delivery_location_id', NEW.delivery_location_id,
      'expected_delivery_date', NEW.expected_delivery_date,
      'status', NEW.status,
      'tenant_id', NEW.tenant_id,
      'created_at', NEW.created_at
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
    SELECT COUNT(*) INTO v_line_count
    FROM supply_chain.purchase_order_lines
    WHERE po_id = NEW.id;
    
    IF NEW.status = 'draft' THEN
      RETURN NEW;
    ELSE
      CASE NEW.status
        WHEN 'submitted' THEN
          v_event_name := 'supply_chain.purchase_order.submitted';
          v_payload := jsonb_build_object(
            'po_id', NEW.id,
            'po_number', NEW.po_number,
            'vendor_id', NEW.vendor_id,
            'vendor_name', NEW.vendor_name_snapshot,
            'vendor_code', NEW.vendor_code_snapshot,
            'total_lines', v_line_count,
            'tenant_id', NEW.tenant_id,
            'submitted_at', NEW.updated_at
          );
        WHEN 'approved' THEN
          v_event_name := 'supply_chain.purchase_order.approved';
          v_payload := jsonb_build_object(
            'po_id', NEW.id,
            'po_number', NEW.po_number,
            'vendor_id', NEW.vendor_id,
            'vendor_name', NEW.vendor_name_snapshot,
            'vendor_code', NEW.vendor_code_snapshot,
            'total_lines', v_line_count,
            'tenant_id', NEW.tenant_id,
            'approved_at', NEW.updated_at
          );
        WHEN 'rejected' THEN
          v_event_name := 'supply_chain.purchase_order.rejected';
          v_payload := jsonb_build_object(
            'po_id', NEW.id,
            'po_number', NEW.po_number,
            'vendor_id', NEW.vendor_id,
            'vendor_name', NEW.vendor_name_snapshot,
            'vendor_code', NEW.vendor_code_snapshot,
            'tenant_id', NEW.tenant_id,
            'rejected_at', NEW.updated_at
          );
        WHEN 'cancelled' THEN
          v_event_name := 'supply_chain.purchase_order.cancelled';
          v_payload := jsonb_build_object(
            'po_id', NEW.id,
            'po_number', NEW.po_number,
            'vendor_id', NEW.vendor_id,
            'vendor_name', NEW.vendor_name_snapshot,
            'vendor_code', NEW.vendor_code_snapshot,
            'tenant_id', NEW.tenant_id,
            'cancelled_at', NEW.updated_at
          );
        WHEN 'closed' THEN
          v_event_name := 'supply_chain.purchase_order.closed';
          v_payload := jsonb_build_object(
            'po_id', NEW.id,
            'po_number', NEW.po_number,
            'vendor_id', NEW.vendor_id,
            'vendor_name', NEW.vendor_name_snapshot,
            'vendor_code', NEW.vendor_code_snapshot,
            'total_lines', v_line_count,
            'tenant_id', NEW.tenant_id,
            'closed_at', NEW.updated_at
          );
        WHEN 'in_transit' THEN
          v_event_name := 'supply_chain.purchase_order.in_transit';
          v_payload := jsonb_build_object(
            'po_id', NEW.id,
            'po_number', NEW.po_number,
            'vendor_id', NEW.vendor_id,
            'vendor_name', NEW.vendor_name_snapshot,
            'vendor_code', NEW.vendor_code_snapshot,
            'tenant_id', NEW.tenant_id,
            'shipped_at', NEW.updated_at
          );
        WHEN 'received' THEN
          v_event_name := 'supply_chain.purchase_order.received';
          v_payload := jsonb_build_object(
            'po_id', NEW.id,
            'po_number', NEW.po_number,
            'vendor_id', NEW.vendor_id,
            'vendor_name', NEW.vendor_name_snapshot,
            'vendor_code', NEW.vendor_code_snapshot,
            'total_lines', v_line_count,
            'tenant_id', NEW.tenant_id,
            'received_at', NEW.updated_at
          );
        ELSE
          RETURN NEW;
      END CASE;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.emit_event(
    p_type := v_event_name,
    p_payload := v_payload,
    p_tenant_id := NEW.tenant_id
  );

  RETURN NEW;
END;
$$;

-- =================================================================
-- 6. supply_chain.emit_receipt_event()
-- =================================================================

CREATE OR REPLACE FUNCTION supply_chain.emit_receipt_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payload JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_payload := jsonb_build_object(
      'receipt_id', NEW.id,
      'receipt_number', NEW.receipt_number,
      'location_id', NEW.location_id,
      'po_id', NEW.po_id,
      'vendor_id', NEW.vendor_id,
      'vendor_name', NEW.vendor_name_snapshot,
      'vendor_code', NEW.vendor_code_snapshot,
      'received_by_user_id', NEW.received_by_user_id,
      'tenant_id', NEW.tenant_id,
      'received_at', NEW.received_at
    );

    PERFORM public.emit_event(
      p_type := 'supply_chain.receipt.created',
      p_payload := v_payload,
      p_tenant_id := NEW.tenant_id
    );
  END IF;

  RETURN NEW;
END;
$$;

-- =================================================================
-- VERIFICATION
-- =================================================================

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'emit_event() CALL MIGRATION COMPLETE';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Updated Functions:';
  RAISE NOTICE '  ✓ inventory.emit_asset_event()';
  RAISE NOTICE '  ✓ inventory.emit_catalog_item_event()';
  RAISE NOTICE '  ✓ inventory.emit_location_event()';
  RAISE NOTICE '  ✓ supply_chain.emit_vendor_event()';
  RAISE NOTICE '  ✓ supply_chain.emit_purchase_order_event()';
  RAISE NOTICE '  ✓ supply_chain.emit_receipt_event()';
  RAISE NOTICE '';
  RAISE NOTICE 'Next: Update TypeScript code if needed';
  RAISE NOTICE '========================================';
END
$$;
