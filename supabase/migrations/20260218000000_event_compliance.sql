-- =============================================================================
-- Event Compliance Migration
-- Adds outbox triggers to uncovered tables and makes existing triggers DELETE-aware.
-- Also registers new event types in event_catalog + event_definitions.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 3a. NEW OUTBOX TRIGGERS for previously uncovered tables
-- ---------------------------------------------------------------------------

-- ---- supply_chain.vendor_items ----

CREATE OR REPLACE FUNCTION supply_chain.emit_vendor_item_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_event_name TEXT;
    v_payload    JSONB;
    v_tenant     UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_event_name := 'supply_chain.vendor_item.deleted';
        v_tenant     := OLD.tenant_id;
        v_payload    := jsonb_build_object(
            'vendor_item_id', OLD.id,
            'vendor_id',      OLD.vendor_id,
            'catalog_item_id',OLD.catalog_item_id,
            'vendor_sku',     OLD.vendor_sku,
            'tenant_id',      OLD.tenant_id,
            'deleted_at',     NOW()
        );
    ELSIF TG_OP = 'INSERT' THEN
        v_event_name := 'supply_chain.vendor_item.created';
        v_tenant     := NEW.tenant_id;
        v_payload    := jsonb_build_object(
            'vendor_item_id', NEW.id,
            'vendor_id',      NEW.vendor_id,
            'catalog_item_id',NEW.catalog_item_id,
            'vendor_sku',     NEW.vendor_sku,
            'unit_cost',      NEW.unit_cost,
            'tenant_id',      NEW.tenant_id,
            'created_at',     NEW.created_at
        );
    ELSIF TG_OP = 'UPDATE' THEN
        v_event_name := 'supply_chain.vendor_item.updated';
        v_tenant     := NEW.tenant_id;
        v_payload    := jsonb_build_object(
            'vendor_item_id', NEW.id,
            'vendor_id',      NEW.vendor_id,
            'catalog_item_id',NEW.catalog_item_id,
            'vendor_sku',     NEW.vendor_sku,
            'unit_cost',      NEW.unit_cost,
            'tenant_id',      NEW.tenant_id,
            'updated_at',     NEW.updated_at
        );
    END IF;

    PERFORM public.emit_event(
        p_type      := v_event_name,
        p_payload   := v_payload,
        p_tenant_id := v_tenant
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trigger_vendor_item_events
    AFTER INSERT OR UPDATE OR DELETE ON supply_chain.vendor_items
    FOR EACH ROW EXECUTE FUNCTION supply_chain.emit_vendor_item_event();


-- ---- inventory.location_types ----

CREATE OR REPLACE FUNCTION inventory.emit_location_type_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_event_name TEXT;
    v_payload    JSONB;
    v_tenant     UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_event_name := 'inventory.location_type.deleted';
        v_tenant     := OLD.tenant_id;
        v_payload    := jsonb_build_object(
            'location_type_id', OLD.id,
            'name',             OLD.name,
            'code',             OLD.code,
            'tenant_id',        OLD.tenant_id,
            'deleted_at',       NOW()
        );
    ELSIF TG_OP = 'INSERT' THEN
        v_event_name := 'inventory.location_type.created';
        v_tenant     := NEW.tenant_id;
        v_payload    := jsonb_build_object(
            'location_type_id', NEW.id,
            'name',             NEW.name,
            'code',             NEW.code,
            'tenant_id',        NEW.tenant_id,
            'created_at',       NEW.created_at
        );
    ELSIF TG_OP = 'UPDATE' THEN
        v_event_name := 'inventory.location_type.updated';
        v_tenant     := NEW.tenant_id;
        v_payload    := jsonb_build_object(
            'location_type_id', NEW.id,
            'name',             NEW.name,
            'code',             NEW.code,
            'tenant_id',        NEW.tenant_id,
            'updated_at',       NEW.updated_at
        );
    END IF;

    PERFORM public.emit_event(
        p_type      := v_event_name,
        p_payload   := v_payload,
        p_tenant_id := v_tenant
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trigger_location_type_events
    AFTER INSERT OR UPDATE OR DELETE ON inventory.location_types
    FOR EACH ROW EXECUTE FUNCTION inventory.emit_location_type_event();


-- ---- inventory.assignment_types ----

CREATE OR REPLACE FUNCTION inventory.emit_assignment_type_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_event_name TEXT;
    v_payload    JSONB;
    v_tenant     UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_event_name := 'inventory.assignment_type.deleted';
        v_tenant     := OLD.tenant_id;
        v_payload    := jsonb_build_object(
            'assignment_type_id', OLD.id,
            'type_key',           OLD.type_key,
            'display_name',       OLD.display_name,
            'tenant_id',          OLD.tenant_id,
            'deleted_at',         NOW()
        );
    ELSIF TG_OP = 'INSERT' THEN
        v_event_name := 'inventory.assignment_type.created';
        v_tenant     := NEW.tenant_id;
        v_payload    := jsonb_build_object(
            'assignment_type_id', NEW.id,
            'type_key',           NEW.type_key,
            'display_name',       NEW.display_name,
            'is_system',          NEW.is_system,
            'tenant_id',          NEW.tenant_id,
            'created_at',         NEW.created_at
        );
    ELSIF TG_OP = 'UPDATE' THEN
        v_event_name := 'inventory.assignment_type.updated';
        v_tenant     := NEW.tenant_id;
        v_payload    := jsonb_build_object(
            'assignment_type_id', NEW.id,
            'type_key',           NEW.type_key,
            'display_name',       NEW.display_name,
            'is_active',          NEW.is_active,
            'tenant_id',          NEW.tenant_id,
            'updated_at',         NEW.updated_at
        );
    END IF;

    PERFORM public.emit_event(
        p_type      := v_event_name,
        p_payload   := v_payload,
        p_tenant_id := v_tenant
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trigger_assignment_type_events
    AFTER INSERT OR UPDATE OR DELETE ON inventory.assignment_types
    FOR EACH ROW EXECUTE FUNCTION inventory.emit_assignment_type_event();


-- ---- inventory.reservation_types ----

CREATE OR REPLACE FUNCTION inventory.emit_reservation_type_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_event_name TEXT;
    v_payload    JSONB;
    v_tenant     UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_event_name := 'inventory.reservation_type.deleted';
        v_tenant     := OLD.tenant_id;
        v_payload    := jsonb_build_object(
            'reservation_type_id', OLD.id,
            'type_key',            OLD.type_key,
            'display_name',        OLD.display_name,
            'tenant_id',           OLD.tenant_id,
            'deleted_at',          NOW()
        );
    ELSIF TG_OP = 'INSERT' THEN
        v_event_name := 'inventory.reservation_type.created';
        v_tenant     := NEW.tenant_id;
        v_payload    := jsonb_build_object(
            'reservation_type_id', NEW.id,
            'type_key',            NEW.type_key,
            'display_name',        NEW.display_name,
            'is_system',           NEW.is_system,
            'tenant_id',           NEW.tenant_id,
            'created_at',          NEW.created_at
        );
    ELSIF TG_OP = 'UPDATE' THEN
        v_event_name := 'inventory.reservation_type.updated';
        v_tenant     := NEW.tenant_id;
        v_payload    := jsonb_build_object(
            'reservation_type_id', NEW.id,
            'type_key',            NEW.type_key,
            'display_name',        NEW.display_name,
            'is_active',           NEW.is_active,
            'tenant_id',           NEW.tenant_id,
            'updated_at',          NEW.updated_at
        );
    END IF;

    PERFORM public.emit_event(
        p_type      := v_event_name,
        p_payload   := v_payload,
        p_tenant_id := v_tenant
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trigger_reservation_type_events
    AFTER INSERT OR UPDATE OR DELETE ON inventory.reservation_types
    FOR EACH ROW EXECUTE FUNCTION inventory.emit_reservation_type_event();


-- ---- inventory.transfers (status changes: shipped, cancelled, etc.) ----

CREATE OR REPLACE FUNCTION inventory.emit_transfer_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_event_name TEXT;
    v_payload    JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event_name := 'transfer.created';
        v_payload    := jsonb_build_object(
            'transfer_id', NEW.id,
            'status',      NEW.status,
            'tenant_id',   NEW.tenant_id,
            'created_at',  NEW.created_at
        );
    ELSIF TG_OP = 'UPDATE' THEN
        -- Detect status transitions
        IF OLD.status IS DISTINCT FROM NEW.status THEN
            CASE NEW.status
                WHEN 'in_transit'  THEN v_event_name := 'inventory.transfer.shipped';
                WHEN 'cancelled'   THEN v_event_name := 'inventory.transfer.cancelled';
                WHEN 'completed'   THEN v_event_name := 'transfer.completed';
                ELSE                    v_event_name := 'transfer.updated';
            END CASE;
        ELSE
            v_event_name := 'transfer.updated';
        END IF;

        v_payload := jsonb_build_object(
            'transfer_id',    NEW.id,
            'old_status',     OLD.status,
            'new_status',     NEW.status,
            'from_location_id', NEW.from_location_id,
            'to_location_id', NEW.to_location_id,
            'tenant_id',      NEW.tenant_id,
            'updated_at',     NEW.updated_at
        );
    END IF;

    PERFORM public.emit_event(
        p_type      := v_event_name,
        p_payload   := v_payload,
        p_tenant_id := NEW.tenant_id
    );

    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trigger_transfer_events
    AFTER INSERT OR UPDATE ON inventory.transfers
    FOR EACH ROW EXECUTE FUNCTION inventory.emit_transfer_event();


-- ---- inventory.transfer_lines ----

CREATE OR REPLACE FUNCTION inventory.emit_transfer_line_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_event_name TEXT;
    v_payload    JSONB;
    v_tenant     UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_event_name := 'inventory.transfer_line.deleted';
        v_tenant     := OLD.tenant_id;
        v_payload    := jsonb_build_object(
            'transfer_line_id', OLD.id,
            'transfer_id',      OLD.transfer_id,
            'catalog_item_id',  OLD.catalog_item_id,
            'qty',              OLD.qty,
            'tenant_id',        OLD.tenant_id,
            'deleted_at',       NOW()
        );
    ELSIF TG_OP = 'INSERT' THEN
        v_event_name := 'inventory.transfer_line.created';
        v_tenant     := NEW.tenant_id;
        v_payload    := jsonb_build_object(
            'transfer_line_id', NEW.id,
            'transfer_id',      NEW.transfer_id,
            'catalog_item_id',  NEW.catalog_item_id,
            'qty',              NEW.qty,
            'line_number',      NEW.line_number,
            'tenant_id',        NEW.tenant_id,
            'created_at',       NEW.created_at
        );
    ELSIF TG_OP = 'UPDATE' THEN
        v_event_name := 'inventory.transfer_line.updated';
        v_tenant     := NEW.tenant_id;
        v_payload    := jsonb_build_object(
            'transfer_line_id', NEW.id,
            'transfer_id',      NEW.transfer_id,
            'catalog_item_id',  NEW.catalog_item_id,
            'qty',              NEW.qty,
            'qty_shipped',      NEW.qty_shipped,
            'qty_received',     NEW.qty_received,
            'line_number',      NEW.line_number,
            'tenant_id',        NEW.tenant_id,
            'updated_at',       NEW.updated_at
        );
    END IF;

    PERFORM public.emit_event(
        p_type      := v_event_name,
        p_payload   := v_payload,
        p_tenant_id := v_tenant
    );

    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trigger_transfer_line_events
    AFTER INSERT OR UPDATE OR DELETE ON inventory.transfer_lines
    FOR EACH ROW EXECUTE FUNCTION inventory.emit_transfer_line_event();


-- ---------------------------------------------------------------------------
-- 3b. Make EXISTING triggers DELETE-aware
-- ---------------------------------------------------------------------------

-- ---- inventory.emit_catalog_item_event: add DELETE handling ----

CREATE OR REPLACE FUNCTION inventory.emit_catalog_item_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_event_name TEXT;
    v_payload    JSONB;
    v_changes    JSONB;
    v_tenant     UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_event_name := 'inventory.catalog_item.deleted';
        v_tenant     := OLD.tenant_id;
        v_payload    := jsonb_build_object(
            'item_id',   OLD.id,
            'sku',       OLD.sku,
            'name',      OLD.name,
            'tenant_id', OLD.tenant_id,
            'deleted_at', NOW()
        );

        PERFORM public.emit_event(
            p_type      := v_event_name,
            p_payload   := v_payload,
            p_tenant_id := v_tenant
        );
        RETURN OLD;

    ELSIF TG_OP = 'INSERT' THEN
        v_event_name := 'inventory.item.created';
        v_payload := jsonb_build_object(
            'item_id',        NEW.id,
            'sku',            NEW.sku,
            'name',           NEW.name,
            'category_id',    NEW.category_id,
            'tracking_mode',  NEW.tracking_mode,
            'unit_of_measure',NEW.unit_of_measure,
            'tenant_id',      NEW.tenant_id,
            'created_at',     NEW.created_at
        );

    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.active = TRUE AND NEW.active = FALSE THEN
            v_event_name := 'catalog_item.deactivated';
            v_payload := jsonb_build_object(
                'item_id',        NEW.id,
                'tenant_id',      NEW.tenant_id,
                'deactivated_at', NEW.updated_at
            );
        ELSIF OLD.active = FALSE AND NEW.active = TRUE THEN
            v_event_name := 'catalog_item.reactivated';
            v_payload := jsonb_build_object(
                'item_id',        NEW.id,
                'tenant_id',      NEW.tenant_id,
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
                'item_id',    NEW.id,
                'tenant_id',  NEW.tenant_id,
                'changes',    v_changes,
                'updated_at', NEW.updated_at
            );
        END IF;
    END IF;

    PERFORM public.emit_event(
        p_type      := v_event_name,
        p_payload   := v_payload,
        p_tenant_id := NEW.tenant_id
    );

    RETURN NEW;
END;
$$;

-- Update trigger to fire on DELETE too
DROP TRIGGER IF EXISTS trigger_catalog_item_events ON inventory.catalog_items;
CREATE TRIGGER trigger_catalog_item_events
    AFTER INSERT OR UPDATE OR DELETE ON inventory.catalog_items
    FOR EACH ROW EXECUTE FUNCTION inventory.emit_catalog_item_event();


-- ---- inventory.emit_category_event: add DELETE handling ----

CREATE OR REPLACE FUNCTION inventory.emit_category_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_event_name TEXT;
    v_payload    JSONB;
    v_changes    JSONB;
    v_tenant     UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_event_name := 'inventory.item_category.deleted';
        v_tenant     := OLD.tenant_id;
        v_payload    := jsonb_build_object(
            'category_id', OLD.id,
            'name',        OLD.name,
            'tenant_id',   OLD.tenant_id,
            'deleted_at',  NOW()
        );

        PERFORM public.emit_event(
            p_type      := v_event_name,
            p_payload   := v_payload,
            p_tenant_id := v_tenant
        );
        RETURN OLD;

    ELSIF TG_OP = 'INSERT' THEN
        v_event_name := 'category.created';
        v_payload := jsonb_build_object(
            'category_id', NEW.id,
            'name',        NEW.name,
            'tenant_id',   NEW.tenant_id,
            'created_at',  NEW.created_at
        );
    ELSIF TG_OP = 'UPDATE' THEN
        v_event_name := 'category.updated';
        v_changes := jsonb_build_object();

        IF OLD.name != NEW.name THEN
            v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('old', OLD.name, 'new', NEW.name));
        END IF;

        v_payload := jsonb_build_object(
            'category_id', NEW.id,
            'tenant_id',   NEW.tenant_id,
            'changes',     v_changes,
            'updated_at',  NEW.updated_at
        );
    END IF;

    PERFORM public.emit_event(
        p_type      := v_event_name,
        p_payload   := v_payload,
        p_tenant_id := NEW.tenant_id
    );

    RETURN NEW;
END;
$$;

-- Update trigger to fire on DELETE too
DROP TRIGGER IF EXISTS trigger_category_events ON inventory.item_categories;
CREATE TRIGGER trigger_category_events
    AFTER INSERT OR UPDATE OR DELETE ON inventory.item_categories
    FOR EACH ROW EXECUTE FUNCTION inventory.emit_category_event();


-- ---- inventory.emit_location_event: add DELETE handling ----

CREATE OR REPLACE FUNCTION inventory.emit_location_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_event_name TEXT;
    v_payload    JSONB;
    v_changes    JSONB;
    v_tenant     UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_event_name := 'inventory.location.deleted';
        v_tenant     := OLD.tenant_id;
        v_payload    := jsonb_build_object(
            'location_id', OLD.id,
            'name',        OLD.name,
            'tenant_id',   OLD.tenant_id,
            'deleted_at',  NOW()
        );

        PERFORM public.emit_event(
            p_type      := v_event_name,
            p_payload   := v_payload,
            p_tenant_id := v_tenant
        );
        RETURN OLD;

    ELSIF TG_OP = 'INSERT' THEN
        v_event_name := 'location.created';
        v_payload := jsonb_build_object(
            'location_id',       NEW.id,
            'location_type_id',  NEW.location_type_id,
            'name',              NEW.name,
            'parent_location_id',NEW.parent_location_id,
            'address',           NEW.address,
            'external_ref',      NEW.external_ref,
            'tenant_id',         NEW.tenant_id,
            'created_at',        NEW.created_at,
            'created_by',        NEW.created_by
        );
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.active = TRUE AND NEW.active = FALSE THEN
            v_event_name := 'location.deactivated';
            v_payload := jsonb_build_object(
                'location_id',     NEW.id,
                'tenant_id',       NEW.tenant_id,
                'deactivated_at',  NEW.updated_at,
                'deactivated_by',  NEW.updated_by
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
                'tenant_id',   NEW.tenant_id,
                'changes',     v_changes,
                'updated_at',  NEW.updated_at,
                'updated_by',  NEW.updated_by
            );
        END IF;
    END IF;

    PERFORM public.emit_event(
        p_type      := v_event_name,
        p_payload   := v_payload,
        p_tenant_id := NEW.tenant_id
    );

    RETURN NEW;
END;
$$;

-- Update trigger to fire on DELETE too
DROP TRIGGER IF EXISTS trigger_location_events ON inventory.locations;
CREATE TRIGGER trigger_location_events
    AFTER INSERT OR UPDATE OR DELETE ON inventory.locations
    FOR EACH ROW EXECUTE FUNCTION inventory.emit_location_event();


-- ---------------------------------------------------------------------------
-- 3b-extra. Update PO status trigger to handle 'voided' status
-- The baseline emit_po_status_event() CASE has ELSE RETURN NEW, so 'voided'
-- falls through silently. We replace the function to add voided handling.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION supply_chain.emit_po_status_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_event_name TEXT;
  v_payload JSONB;
  v_line_count INTEGER;
  v_total_value NUMERIC;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(qty_ordered * COALESCE(unit_cost, 0)), 0)
  INTO v_line_count, v_total_value
  FROM supply_chain.purchase_order_lines
  WHERE po_id = NEW.id;

  IF TG_OP = 'INSERT' THEN
    v_event_name := 'supply_chain.purchase_order.created';
    v_payload := jsonb_build_object(
      'po_id', NEW.id,
      'po_number', NEW.po_number,
      'vendor_id', NEW.vendor_id,
      'vendor_name', NEW.vendor_name_snapshot,
      'vendor_code', NEW.vendor_code_snapshot,
      'order_date', NEW.order_date,
      'expected_delivery_date', NEW.expected_delivery_date,
      'line_items_count', v_line_count,
      'total_value', v_total_value,
      'tenant_id', NEW.tenant_id,
      'created_at', NEW.created_at
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status != NEW.status THEN
      CASE NEW.status
        WHEN 'submitted' THEN
          v_event_name := 'supply_chain.purchase_order.submitted';
          v_payload := jsonb_build_object(
            'po_id', NEW.id,
            'po_number', NEW.po_number,
            'vendor_id', NEW.vendor_id,
            'vendor_name', NEW.vendor_name_snapshot,
            'vendor_code', NEW.vendor_code_snapshot,
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
            'approved_by_user_id', NEW.approved_by_user_id,
            'tenant_id', NEW.tenant_id,
            'approved_at', NEW.approved_at
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
        WHEN 'voided' THEN
          v_event_name := 'supply_chain.purchase_order.voided';
          v_payload := jsonb_build_object(
            'po_id', NEW.id,
            'po_number', NEW.po_number,
            'vendor_id', NEW.vendor_id,
            'vendor_name', NEW.vendor_name_snapshot,
            'vendor_code', NEW.vendor_code_snapshot,
            'old_status', OLD.status,
            'tenant_id', NEW.tenant_id,
            'voided_at', NEW.updated_at
          );
        ELSE
          RETURN NEW;
      END CASE;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  PERFORM public.emit_event(
    p_type      := v_event_name,
    p_payload   := v_payload,
    p_tenant_id := NEW.tenant_id
  );

  RETURN NEW;
END;
$$;

-- No need to recreate trigger — it already fires AFTER INSERT OR UPDATE


-- ---------------------------------------------------------------------------
-- 3c. Register new events in event_catalog + event_definitions
-- ---------------------------------------------------------------------------

-- event_catalog (version 1 register_event)
SELECT public.register_event(
    'supply_chain.vendor_item.created',
    'Vendor Item Created',
    'Emitted when a vendor-item mapping is created',
    '{"vendor_item_id":"uuid","vendor_id":"uuid","catalog_item_id":"uuid"}'::jsonb,
    NULL,
    'vendor_item'
);
SELECT public.register_event(
    'supply_chain.vendor_item.updated',
    'Vendor Item Updated',
    'Emitted when a vendor-item mapping is updated',
    '{"vendor_item_id":"uuid","vendor_id":"uuid","unit_cost":0}'::jsonb,
    NULL,
    'vendor_item'
);
SELECT public.register_event(
    'supply_chain.vendor_item.deleted',
    'Vendor Item Deleted',
    'Emitted when a vendor-item mapping is deleted',
    '{"vendor_item_id":"uuid","vendor_id":"uuid"}'::jsonb,
    NULL,
    'vendor_item'
);
SELECT public.register_event(
    'supply_chain.purchase_order.voided',
    'Purchase Order Voided',
    'Emitted when a purchase order is soft-deleted (voided)',
    '{"po_id":"uuid","po_number":"PO-2026-001","old_status":"draft","new_status":"voided"}'::jsonb,
    NULL,
    'purchase_order'
);
SELECT public.register_event(
    'inventory.location_type.created',
    'Location Type Created',
    'Emitted when a location type is created',
    '{"location_type_id":"uuid","name":"Warehouse","code":"WH"}'::jsonb,
    NULL,
    'location_type'
);
SELECT public.register_event(
    'inventory.location_type.updated',
    'Location Type Updated',
    'Emitted when a location type is updated',
    '{"location_type_id":"uuid","name":"Warehouse","code":"WH"}'::jsonb,
    NULL,
    'location_type'
);
SELECT public.register_event(
    'inventory.location_type.deleted',
    'Location Type Deleted',
    'Emitted when a location type is deleted',
    '{"location_type_id":"uuid","name":"Warehouse"}'::jsonb,
    NULL,
    'location_type'
);
SELECT public.register_event(
    'inventory.assignment_type.created',
    'Assignment Type Created',
    'Emitted when an assignment type is created',
    '{"assignment_type_id":"uuid","type_key":"crew","display_name":"Crew"}'::jsonb,
    NULL,
    'assignment_type'
);
SELECT public.register_event(
    'inventory.assignment_type.updated',
    'Assignment Type Updated',
    'Emitted when an assignment type is updated',
    '{"assignment_type_id":"uuid","type_key":"crew","display_name":"Crew","is_active":true}'::jsonb,
    NULL,
    'assignment_type'
);
SELECT public.register_event(
    'inventory.assignment_type.deleted',
    'Assignment Type Deleted',
    'Emitted when an assignment type is deleted',
    '{"assignment_type_id":"uuid","type_key":"crew"}'::jsonb,
    NULL,
    'assignment_type'
);
SELECT public.register_event(
    'inventory.reservation_type.created',
    'Reservation Type Created',
    'Emitted when a reservation type is created',
    '{"reservation_type_id":"uuid","type_key":"job","display_name":"Job"}'::jsonb,
    NULL,
    'reservation_type'
);
SELECT public.register_event(
    'inventory.reservation_type.updated',
    'Reservation Type Updated',
    'Emitted when a reservation type is updated',
    '{"reservation_type_id":"uuid","type_key":"job","display_name":"Job","is_active":true}'::jsonb,
    NULL,
    'reservation_type'
);
SELECT public.register_event(
    'inventory.reservation_type.deleted',
    'Reservation Type Deleted',
    'Emitted when a reservation type is deleted',
    '{"reservation_type_id":"uuid","type_key":"job"}'::jsonb,
    NULL,
    'reservation_type'
);
SELECT public.register_event(
    'inventory.catalog_item.deleted',
    'Catalog Item Deleted',
    'Emitted when a catalog item is hard-deleted',
    '{"item_id":"uuid","sku":"SKU-001","name":"Widget"}'::jsonb,
    NULL,
    'catalog_item'
);
SELECT public.register_event(
    'inventory.item_category.deleted',
    'Item Category Deleted',
    'Emitted when an item category is deleted',
    '{"category_id":"uuid","name":"Tools"}'::jsonb,
    NULL,
    'item_category'
);
SELECT public.register_event(
    'inventory.location.deleted',
    'Location Deleted',
    'Emitted when a location is hard-deleted',
    '{"location_id":"uuid","name":"Main Warehouse"}'::jsonb,
    NULL,
    'location'
);
SELECT public.register_event(
    'transfer.created',
    'Transfer Created',
    'Emitted when a new transfer is created',
    '{"transfer_id":"uuid","status":"draft","tenant_id":"uuid"}'::jsonb,
    NULL,
    'transfer'
);
SELECT public.register_event(
    'transfer.updated',
    'Transfer Updated',
    'Emitted when a transfer is updated (non-status-change)',
    '{"transfer_id":"uuid","old_status":"draft","new_status":"draft","tenant_id":"uuid"}'::jsonb,
    NULL,
    'transfer'
);
SELECT public.register_event(
    'transfer.completed',
    'Transfer Completed',
    'Emitted when a transfer is completed',
    '{"transfer_id":"uuid","old_status":"in_transit","new_status":"completed"}'::jsonb,
    NULL,
    'transfer'
);
SELECT public.register_event(
    'inventory.transfer.shipped',
    'Transfer Shipped',
    'Emitted when a transfer transitions to in_transit',
    '{"transfer_id":"uuid","old_status":"draft","new_status":"in_transit"}'::jsonb,
    NULL,
    'transfer'
);
SELECT public.register_event(
    'inventory.transfer.cancelled',
    'Transfer Cancelled',
    'Emitted when a transfer is cancelled',
    '{"transfer_id":"uuid","old_status":"draft","new_status":"cancelled"}'::jsonb,
    NULL,
    'transfer'
);
SELECT public.register_event(
    'inventory.transfer_line.created',
    'Transfer Line Created',
    'Emitted when a transfer line is added',
    '{"transfer_line_id":"uuid","transfer_id":"uuid","catalog_item_id":"uuid","qty":10}'::jsonb,
    NULL,
    'transfer_line'
);
SELECT public.register_event(
    'inventory.transfer_line.updated',
    'Transfer Line Updated',
    'Emitted when a transfer line is updated',
    '{"transfer_line_id":"uuid","transfer_id":"uuid","qty":10,"qty_shipped":10}'::jsonb,
    NULL,
    'transfer_line'
);
SELECT public.register_event(
    'inventory.transfer_line.deleted',
    'Transfer Line Deleted',
    'Emitted when a transfer line is removed',
    '{"transfer_line_id":"uuid","transfer_id":"uuid"}'::jsonb,
    NULL,
    'transfer_line'
);

-- event_definitions (version 2 register_event) — for the poller/UI
SELECT public.register_event('supply_chain.vendor_item.created',  1, 'supply_chain', 'Vendor-item mapping created');
SELECT public.register_event('supply_chain.vendor_item.updated',  1, 'supply_chain', 'Vendor-item mapping updated');
SELECT public.register_event('supply_chain.vendor_item.deleted',  1, 'supply_chain', 'Vendor-item mapping deleted');
SELECT public.register_event('supply_chain.purchase_order.voided',1, 'supply_chain', 'Purchase order voided (soft delete)');
SELECT public.register_event('inventory.location_type.created',   1, 'inventory',    'Location type created');
SELECT public.register_event('inventory.location_type.updated',   1, 'inventory',    'Location type updated');
SELECT public.register_event('inventory.location_type.deleted',   1, 'inventory',    'Location type deleted');
SELECT public.register_event('inventory.assignment_type.created',  1, 'inventory',    'Assignment type created');
SELECT public.register_event('inventory.assignment_type.updated',  1, 'inventory',    'Assignment type updated');
SELECT public.register_event('inventory.assignment_type.deleted',  1, 'inventory',    'Assignment type deleted');
SELECT public.register_event('inventory.reservation_type.created', 1, 'inventory',    'Reservation type created');
SELECT public.register_event('inventory.reservation_type.updated', 1, 'inventory',    'Reservation type updated');
SELECT public.register_event('inventory.reservation_type.deleted', 1, 'inventory',    'Reservation type deleted');
SELECT public.register_event('inventory.catalog_item.deleted',    1, 'inventory',    'Catalog item hard-deleted');
SELECT public.register_event('inventory.item_category.deleted',   1, 'inventory',    'Item category deleted');
SELECT public.register_event('inventory.location.deleted',        1, 'inventory',    'Location hard-deleted');
SELECT public.register_event('transfer.created',                  1, 'inventory',    'Transfer created');
SELECT public.register_event('transfer.updated',                  1, 'inventory',    'Transfer updated (non-status-change)');
SELECT public.register_event('transfer.completed',                1, 'inventory',    'Transfer completed');
SELECT public.register_event('inventory.transfer.shipped',        1, 'inventory',    'Transfer shipped (draft -> in_transit)');
SELECT public.register_event('inventory.transfer.cancelled',      1, 'inventory',    'Transfer cancelled');
SELECT public.register_event('inventory.transfer_line.created',   1, 'inventory',    'Transfer line created');
SELECT public.register_event('inventory.transfer_line.updated',   1, 'inventory',    'Transfer line updated');
SELECT public.register_event('inventory.transfer_line.deleted',   1, 'inventory',    'Transfer line deleted');

-- ---------------------------------------------------------------------------
-- 3c-extra. Back-fill baseline event registrations
-- The baseline migration had triggers emitting events but never registered
-- them in event_catalog or event_definitions. Register them now so the
-- emit_event() function can look up versions and aggregate types.
-- Uses ON CONFLICT DO UPDATE (idempotent).
-- ---------------------------------------------------------------------------

-- Catalog Item events (baseline triggers)
SELECT public.register_event('inventory.item.created',    'Item Created',              'Emitted when a catalog item is created',       '{"item_id":"uuid","sku":"SKU-001"}'::jsonb, NULL, 'catalog_item');
SELECT public.register_event('catalog_item.updated',      'Catalog Item Updated',      'Emitted when a catalog item is updated',       '{"item_id":"uuid","changes":{}}'::jsonb,     NULL, 'catalog_item');
SELECT public.register_event('catalog_item.deactivated',  'Catalog Item Deactivated',  'Emitted when a catalog item is deactivated',   '{"item_id":"uuid"}'::jsonb,                   NULL, 'catalog_item');
SELECT public.register_event('catalog_item.reactivated',  'Catalog Item Reactivated',  'Emitted when a catalog item is reactivated',   '{"item_id":"uuid"}'::jsonb,                   NULL, 'catalog_item');

-- Category events (baseline triggers)
SELECT public.register_event('category.created', 'Category Created', 'Emitted when an item category is created', '{"category_id":"uuid","name":"Tools"}'::jsonb, NULL, 'item_category');
SELECT public.register_event('category.updated', 'Category Updated', 'Emitted when an item category is updated', '{"category_id":"uuid","changes":{}}'::jsonb,   NULL, 'item_category');

-- Location events (baseline triggers)
SELECT public.register_event('location.created',     'Location Created',     'Emitted when a location is created',     '{"location_id":"uuid","name":"Warehouse"}'::jsonb, NULL, 'location');
SELECT public.register_event('location.updated',     'Location Updated',     'Emitted when a location is updated',     '{"location_id":"uuid","changes":{}}'::jsonb,        NULL, 'location');
SELECT public.register_event('location.deactivated', 'Location Deactivated', 'Emitted when a location is deactivated', '{"location_id":"uuid"}'::jsonb,                     NULL, 'location');

-- Asset events (baseline triggers)
SELECT public.register_event('asset.created', 'Asset Created', 'Emitted when an asset is created', '{"asset_id":"uuid"}'::jsonb, NULL, 'asset');
SELECT public.register_event('asset.updated', 'Asset Updated', 'Emitted when an asset is updated', '{"asset_id":"uuid"}'::jsonb, NULL, 'asset');
SELECT public.register_event('asset.retired', 'Asset Retired', 'Emitted when an asset is retired', '{"asset_id":"uuid"}'::jsonb, NULL, 'asset');

-- Stock events (baseline triggers)
SELECT public.register_event('stock.replenished', 'Stock Replenished', 'Emitted when stock is added',       '{"catalog_item_id":"uuid","qty_change":10}'::jsonb, NULL, 'stock');
SELECT public.register_event('stock.issued',      'Stock Issued',      'Emitted when stock is issued',      '{"catalog_item_id":"uuid","qty_issued":5}'::jsonb,  NULL, 'stock');
SELECT public.register_event('stock.returned',    'Stock Returned',    'Emitted when stock is returned',    '{"catalog_item_id":"uuid","qty_change":3}'::jsonb,  NULL, 'stock');
SELECT public.register_event('stock.adjusted',    'Stock Adjusted',    'Emitted when stock is adjusted',    '{"catalog_item_id":"uuid","delta":2}'::jsonb,       NULL, 'stock');
SELECT public.register_event('stock.transferred', 'Stock Transferred', 'Emitted when stock is transferred', '{"catalog_item_id":"uuid"}'::jsonb,                 NULL, 'stock');

-- Stock threshold events (baseline triggers)
SELECT public.register_event('stock.low_threshold_reached', 'Low Stock Threshold', 'Emitted when stock falls below reorder point', '{"catalog_item_id":"uuid","current_qty":2,"reorder_point":10}'::jsonb, NULL, 'stock');
SELECT public.register_event('stock.out_of_stock',          'Out of Stock',        'Emitted when stock reaches zero',              '{"catalog_item_id":"uuid","location_id":"uuid"}'::jsonb,               NULL, 'stock');

-- Purchase Order events (baseline triggers)
SELECT public.register_event('supply_chain.purchase_order.created',   'PO Created',    'Emitted when a purchase order is created',                '{"po_id":"uuid","po_number":"PO-001"}'::jsonb, NULL, 'purchase_order');
SELECT public.register_event('supply_chain.purchase_order.submitted', 'PO Submitted',  'Emitted when a purchase order is submitted for approval', '{"po_id":"uuid","po_number":"PO-001"}'::jsonb, NULL, 'purchase_order');
SELECT public.register_event('supply_chain.purchase_order.approved',  'PO Approved',   'Emitted when a purchase order is approved',               '{"po_id":"uuid","po_number":"PO-001"}'::jsonb, NULL, 'purchase_order');
SELECT public.register_event('supply_chain.purchase_order.cancelled', 'PO Cancelled',  'Emitted when a purchase order is cancelled',              '{"po_id":"uuid","po_number":"PO-001"}'::jsonb, NULL, 'purchase_order');
SELECT public.register_event('supply_chain.purchase_order.closed',    'PO Closed',     'Emitted when a purchase order is closed',                 '{"po_id":"uuid","po_number":"PO-001"}'::jsonb, NULL, 'purchase_order');
SELECT public.register_event('supply_chain.purchase_order.in_transit','PO In Transit',  'Emitted when a purchase order ships',                    '{"po_id":"uuid","po_number":"PO-001"}'::jsonb, NULL, 'purchase_order');
SELECT public.register_event('supply_chain.purchase_order.received',  'PO Received',   'Emitted when a purchase order is received',               '{"po_id":"uuid","po_number":"PO-001"}'::jsonb, NULL, 'purchase_order');

-- Vendor events (baseline triggers)
SELECT public.register_event('supply_chain.vendor.created',     'Vendor Created',     'Emitted when a vendor is created',     '{"vendor_id":"uuid"}'::jsonb, NULL, 'vendor');
SELECT public.register_event('supply_chain.vendor.deactivated', 'Vendor Deactivated', 'Emitted when a vendor is deactivated', '{"vendor_id":"uuid"}'::jsonb, NULL, 'vendor');
SELECT public.register_event('supply_chain.vendor.reactivated', 'Vendor Reactivated', 'Emitted when a vendor is reactivated', '{"vendor_id":"uuid"}'::jsonb, NULL, 'vendor');

-- Receipt events (baseline triggers)
SELECT public.register_event('supply_chain.receipt.created',    'Receipt Created',    'Emitted when a receipt is created',   '{"receipt_id":"uuid"}'::jsonb, NULL, 'receipt');
SELECT public.register_event('supply_chain.receipt.line_added', 'Receipt Line Added', 'Emitted when a receipt line is added', '{"receipt_id":"uuid","catalog_item_id":"uuid"}'::jsonb, NULL, 'receipt');

-- Back-fill event_definitions (v2) for baseline events
SELECT public.register_event('inventory.item.created',    1, 'inventory',    'Catalog item created');
SELECT public.register_event('catalog_item.updated',      1, 'inventory',    'Catalog item updated');
SELECT public.register_event('catalog_item.deactivated',  1, 'inventory',    'Catalog item deactivated');
SELECT public.register_event('catalog_item.reactivated',  1, 'inventory',    'Catalog item reactivated');
SELECT public.register_event('category.created',          1, 'inventory',    'Item category created');
SELECT public.register_event('category.updated',          1, 'inventory',    'Item category updated');
SELECT public.register_event('location.created',          1, 'inventory',    'Location created');
SELECT public.register_event('location.updated',          1, 'inventory',    'Location updated');
SELECT public.register_event('location.deactivated',      1, 'inventory',    'Location deactivated');
SELECT public.register_event('asset.created',             1, 'inventory',    'Asset created');
SELECT public.register_event('asset.updated',             1, 'inventory',    'Asset updated');
SELECT public.register_event('asset.retired',             1, 'inventory',    'Asset retired');
SELECT public.register_event('stock.replenished',         1, 'inventory',    'Stock replenished');
SELECT public.register_event('stock.issued',              1, 'inventory',    'Stock issued');
SELECT public.register_event('stock.returned',            1, 'inventory',    'Stock returned');
SELECT public.register_event('stock.adjusted',            1, 'inventory',    'Stock adjusted');
SELECT public.register_event('stock.transferred',         1, 'inventory',    'Stock transferred');
SELECT public.register_event('stock.low_threshold_reached', 1, 'inventory',  'Low stock threshold reached');
SELECT public.register_event('stock.out_of_stock',        1, 'inventory',    'Stock out of stock');
SELECT public.register_event('supply_chain.purchase_order.created',   1, 'supply_chain', 'Purchase order created');
SELECT public.register_event('supply_chain.purchase_order.submitted', 1, 'supply_chain', 'Purchase order submitted');
SELECT public.register_event('supply_chain.purchase_order.approved',  1, 'supply_chain', 'Purchase order approved');
SELECT public.register_event('supply_chain.purchase_order.cancelled', 1, 'supply_chain', 'Purchase order cancelled');
SELECT public.register_event('supply_chain.purchase_order.closed',    1, 'supply_chain', 'Purchase order closed');
SELECT public.register_event('supply_chain.purchase_order.in_transit',1, 'supply_chain', 'Purchase order in transit');
SELECT public.register_event('supply_chain.purchase_order.received',  1, 'supply_chain', 'Purchase order received');
SELECT public.register_event('supply_chain.vendor.created',           1, 'supply_chain', 'Vendor created');
SELECT public.register_event('supply_chain.vendor.deactivated',       1, 'supply_chain', 'Vendor deactivated');
SELECT public.register_event('supply_chain.vendor.reactivated',       1, 'supply_chain', 'Vendor reactivated');
SELECT public.register_event('supply_chain.purchase_order.rejected',  1, 'supply_chain', 'Purchase order rejected');
SELECT public.register_event('supply_chain.receipt.created',          1, 'supply_chain', 'Receipt created');
SELECT public.register_event('supply_chain.receipt.line_added',       1, 'supply_chain', 'Receipt line added');

-- Dashboard events (baseline triggers)
SELECT public.register_event('dashboard.created',        'Dashboard Created',       'Emitted when a dashboard is created',        '{"dashboard_id":"uuid"}'::jsonb, NULL, 'dashboard');
SELECT public.register_event('dashboard.updated',        'Dashboard Updated',       'Emitted when a dashboard is updated',        '{"dashboard_id":"uuid"}'::jsonb, NULL, 'dashboard');
SELECT public.register_event('dashboard.deleted',        'Dashboard Deleted',       'Emitted when a dashboard is deleted',        '{"dashboard_id":"uuid"}'::jsonb, NULL, 'dashboard');
SELECT public.register_event('dashboard_widget.added',   'Dashboard Widget Added',  'Emitted when a widget is added to a dashboard',   '{"widget_id":"uuid"}'::jsonb, NULL, 'dashboard_widget');
SELECT public.register_event('dashboard_widget.updated', 'Dashboard Widget Updated','Emitted when a dashboard widget is updated',       '{"widget_id":"uuid"}'::jsonb, NULL, 'dashboard_widget');
SELECT public.register_event('dashboard_widget.deleted', 'Dashboard Widget Deleted','Emitted when a dashboard widget is removed',       '{"widget_id":"uuid"}'::jsonb, NULL, 'dashboard_widget');
SELECT public.register_event('supply_chain.purchase_order.rejected',  'PO Rejected', 'Emitted when a purchase order is rejected', '{"po_id":"uuid","po_number":"PO-001"}'::jsonb, NULL, 'purchase_order');

SELECT public.register_event('dashboard.created',        1, 'public', 'Dashboard created');
SELECT public.register_event('dashboard.updated',        1, 'public', 'Dashboard updated');
SELECT public.register_event('dashboard.deleted',        1, 'public', 'Dashboard deleted');
SELECT public.register_event('dashboard_widget.added',   1, 'public', 'Dashboard widget added');
SELECT public.register_event('dashboard_widget.updated', 1, 'public', 'Dashboard widget updated');
SELECT public.register_event('dashboard_widget.deleted', 1, 'public', 'Dashboard widget deleted');


-- ---------------------------------------------------------------------------
-- 3d. UNIQUE constraints on (tenant_id, last_event_id)
-- Already present in baseline for all four tables:
--   supply_chain_vendor_items_tenant_last_event_id_uq
--   inventory_location_types_tenant_last_event_id_uq
--   inventory_transfers_tenant_last_event_id_uq
--   inventory_transfer_lines_tenant_last_event_id_uq
-- No action needed.
-- ---------------------------------------------------------------------------
