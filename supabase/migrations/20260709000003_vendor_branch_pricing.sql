-- Per-branch vendor pricing.
--
-- Multi-location vendors are one vendors row + a vendor_addresses row per
-- plant/branch. Pricing previously lived only at the company level
-- (vendor_items unique on tenant/vendor/catalog_item). This adds an optional
-- vendor_address_id to vendor_items so a branch can override the company
-- default price, and to purchase_orders so a PO records which branch it was
-- priced against.
--
-- Resolution rule: branch row (vendor_address_id = chosen branch) wins,
-- else company default row (vendor_address_id IS NULL).

-- ── vendor_items: branch column + widened natural key ──────────────────────
ALTER TABLE supply_chain.vendor_items
  ADD COLUMN IF NOT EXISTS vendor_address_id UUID
    REFERENCES supply_chain.vendor_addresses(id) ON DELETE CASCADE;

ALTER TABLE supply_chain.vendor_items
  DROP CONSTRAINT IF EXISTS vendor_items_tenant_vendor_item_unique;

-- NULLS NOT DISTINCT so at most one company-default row per vendor+item, and
-- the PostgREST upsert (ON CONFLICT on these 4 columns) has a single arbiter.
ALTER TABLE supply_chain.vendor_items
  ADD CONSTRAINT vendor_items_tenant_vendor_item_addr_unique
  UNIQUE NULLS NOT DISTINCT (tenant_id, vendor_id, catalog_item_id, vendor_address_id);

CREATE INDEX IF NOT EXISTS idx_vendor_items_vendor_address_id
  ON supply_chain.vendor_items(vendor_address_id);

COMMENT ON COLUMN supply_chain.vendor_items.vendor_address_id IS
  'NULL = company-wide default price; set = branch/plant-specific override.';

-- ── inventory.vendor_items view: expose the new column ─────────────────────
CREATE OR REPLACE VIEW inventory.vendor_items WITH (security_invoker = true) AS
SELECT id,
    tenant_id,
    vendor_id,
    catalog_item_id,
    vendor_sku,
    vendor_uom_term_id,
    pack_size,
    is_preferred,
    unit_cost,
    currency,
    lead_time_days,
    min_order_qty,
    notes,
    created_at,
    updated_at,
    vendor_address_id
   FROM supply_chain.vendor_items;

-- ── purchase_orders: record which branch the PO was priced against ─────────
ALTER TABLE supply_chain.purchase_orders
  ADD COLUMN IF NOT EXISTS vendor_address_id UUID
    REFERENCES supply_chain.vendor_addresses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor_address_id
  ON supply_chain.purchase_orders(vendor_address_id);

-- ── auto_create_draft_po: deterministically prefer the company default ─────
-- (LIMIT 1 without an order could grab a random branch override now.)
CREATE OR REPLACE FUNCTION inventory.auto_create_draft_po(p_alert_id uuid, p_tenant_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'inventory', 'supply_chain', 'public'
AS $function$
DECLARE v_alert RECORD; v_vendor_id uuid; v_vendor_item RECORD; v_po_id uuid; v_po_number text; v_next_num int;
BEGIN
  SELECT ra.*, ci.preferred_vendor_id, ci.name AS item_name, ci.sku AS item_sku, ci.uom_term_id, ci.reorder_qty INTO v_alert
  FROM inventory.reorder_alerts ra JOIN inventory.catalog_items ci ON ci.id = ra.catalog_item_id AND ci.tenant_id = ra.tenant_id WHERE ra.id = p_alert_id AND ra.tenant_id = p_tenant_id;
  IF v_alert IS NULL THEN RAISE EXCEPTION 'Reorder alert not found'; END IF;
  v_vendor_id := v_alert.preferred_vendor_id;
  IF v_vendor_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_vendor_item FROM supply_chain.vendor_items
  WHERE vendor_id = v_vendor_id AND catalog_item_id = v_alert.catalog_item_id AND tenant_id = p_tenant_id
  ORDER BY vendor_address_id NULLS FIRST LIMIT 1;
  UPDATE supply_chain.po_number_sequences SET current_sequence = current_sequence + 1 WHERE tenant_id = p_tenant_id RETURNING current_sequence INTO v_next_num;
  IF v_next_num IS NULL THEN INSERT INTO supply_chain.po_number_sequences (tenant_id, current_year, current_sequence) VALUES (p_tenant_id, EXTRACT(YEAR FROM now())::int, 1) RETURNING current_sequence INTO v_next_num; END IF;
  v_po_number := 'PO-' || LPAD(v_next_num::text, 6, '0');
  INSERT INTO supply_chain.purchase_orders (tenant_id, po_number, vendor_id, vendor_name_snapshot, delivery_location_id, status, order_date, notes, last_event_id, created_by_user_id)
  SELECT p_tenant_id, v_po_number, v_vendor_id, vn.name, v_alert.location_id, 'draft', CURRENT_DATE, 'Auto-generated from reorder alert for ' || v_alert.item_name, gen_random_uuid()::text, NULL
  FROM supply_chain.vendors vn WHERE vn.id = v_vendor_id AND vn.tenant_id = p_tenant_id RETURNING id INTO v_po_id;
  INSERT INTO supply_chain.purchase_order_lines (po_id, line_number, catalog_item_id, item_description, item_vendor_sku, uom_term_id, qty_ordered, unit_cost, last_event_id)
  VALUES (v_po_id, 1, v_alert.catalog_item_id, v_alert.item_name, COALESCE(v_vendor_item.vendor_sku, v_alert.item_sku), v_alert.uom_term_id, COALESCE(v_alert.suggested_order_qty, v_alert.reorder_qty, 1), COALESCE(v_vendor_item.unit_cost, 0), gen_random_uuid()::text);
  RETURN v_po_id;
END;
$function$;

-- ── rpc_create_purchase_order: accept + record the branch ───────────────────
-- DROP (not CREATE OR REPLACE with a new signature) so we never end up with
-- two overloads — PostgREST named-arg calls become ambiguous with overloads.
DROP FUNCTION supply_chain.rpc_create_purchase_order(uuid,text,text,date,text,uuid,uuid,uuid,numeric,text,text,jsonb,jsonb,text);

CREATE FUNCTION supply_chain.rpc_create_purchase_order(
  p_vendor_id uuid,
  p_po_number text DEFAULT NULL::text,
  p_delivery_method text DEFAULT 'ship'::text,
  p_needed_by_date date DEFAULT NULL::date,
  p_cost_context text DEFAULT 'overhead'::text,
  p_job_id uuid DEFAULT NULL::uuid,
  p_delivery_location_id uuid DEFAULT NULL::uuid,
  p_pickup_location_id uuid DEFAULT NULL::uuid,
  p_max_authorized_spend numeric DEFAULT NULL::numeric,
  p_vendor_quote_ref text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_attachments jsonb DEFAULT NULL::jsonb,
  p_lines jsonb DEFAULT '[]'::jsonb,
  p_initiated_by text DEFAULT 'user'::text,
  p_vendor_address_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'supply_chain', 'inventory', 'public'
AS $function$
DECLARE
  v_tenant_id UUID; v_user_id UUID; v_po_id UUID; v_line JSONB; v_line_number INT := 0;
  v_total_estimated_cost NUMERIC := 0; v_has_unknown_pricing BOOLEAN := false;
  v_event_id UUID; v_vendor_name TEXT; v_vendor_code TEXT; v_result JSONB; v_generated_po_number TEXT;
  v_aa_enabled BOOLEAN; v_agent_enabled BOOLEAN; v_effective_limit NUMERIC;
  v_auto_approve BOOLEAN := false; v_status TEXT;
  v_budget_amount NUMERIC; v_budget_period TEXT; v_budget_anchor DATE;
  v_b_start DATE; v_b_end DATE; v_spent NUMERIC; v_remaining NUMERIC := NULL;
  v_cap_ok BOOLEAN; v_budget_ok BOOLEAN := true;
BEGIN
  v_tenant_id := COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::UUID,(auth.jwt()->>'tenant_id')::UUID);
  v_user_id := COALESCE((auth.jwt()->'app_metadata'->>'user_id')::UUID,(auth.jwt()->>'user_id')::UUID,(auth.jwt()->>'sub')::UUID);
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Authentication required - no tenant_id in JWT'; END IF;
  IF p_delivery_method = 'ship' AND p_delivery_location_id IS NULL THEN RAISE EXCEPTION 'delivery_location_id required when delivery_method = ship'; END IF;
  IF p_delivery_method = 'pickup' AND p_pickup_location_id IS NULL THEN RAISE EXCEPTION 'pickup_location_id required when delivery_method = pickup'; END IF;
  IF p_cost_context = 'job' AND p_job_id IS NULL THEN RAISE EXCEPTION 'job_id required when cost_context = job'; END IF;
  IF p_vendor_address_id IS NOT NULL THEN
    PERFORM 1 FROM supply_chain.vendor_addresses va WHERE va.id = p_vendor_address_id AND va.vendor_id = p_vendor_id AND va.tenant_id = v_tenant_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'vendor_address_id does not belong to this vendor'; END IF;
  END IF;
  IF p_po_number IS NULL OR p_po_number = '' THEN v_generated_po_number := supply_chain.generate_po_number(v_tenant_id); ELSE v_generated_po_number := p_po_number; END IF;
  SELECT name, code INTO v_vendor_name, v_vendor_code FROM supply_chain.vendors WHERE id = p_vendor_id AND tenant_id = v_tenant_id;

  SELECT
    COALESCE(SUM((elem->>'qty_ordered')::numeric * COALESCE((elem->>'unit_cost')::numeric, (elem->>'estimated_unit_cost')::numeric, 0)), 0),
    COALESCE(bool_or((elem->>'unit_cost') IS NULL AND (elem->>'estimated_unit_cost') IS NULL), false)
  INTO v_total_estimated_cost, v_has_unknown_pricing
  FROM jsonb_array_elements(p_lines) elem;

  SELECT auto_approve_enabled, agent_auto_order_enabled INTO v_aa_enabled, v_agent_enabled
  FROM supply_chain.tenant_settings WHERE tenant_id = v_tenant_id;
  IF p_initiated_by = 'agent' THEN v_aa_enabled := COALESCE(v_agent_enabled, false); ELSE v_aa_enabled := COALESCE(v_aa_enabled, true); END IF;

  v_effective_limit := supply_chain.resolve_spend_limit(v_tenant_id, v_user_id, p_vendor_id, p_initiated_by);
  v_cap_ok := (v_effective_limit IS NULL OR (NOT v_has_unknown_pricing AND v_total_estimated_cost <= v_effective_limit));

  IF p_initiated_by <> 'agent' AND v_user_id IS NOT NULL THEN
    SELECT budget_amount, budget_period, budget_anchor INTO v_budget_amount, v_budget_period, v_budget_anchor
    FROM public.local_users WHERE user_id = v_user_id AND tenant_id = v_tenant_id;
    IF v_budget_amount IS NOT NULL AND v_budget_period IS NOT NULL AND v_budget_anchor IS NOT NULL THEN
      SELECT period_start, period_end INTO v_b_start, v_b_end
      FROM supply_chain.budget_period_bounds(v_budget_period, v_budget_anchor, CURRENT_DATE);
      v_spent := supply_chain.user_period_spend(v_tenant_id, v_user_id, v_b_start, v_b_end);
      v_remaining := v_budget_amount - COALESCE(v_spent, 0);
      v_budget_ok := (NOT v_has_unknown_pricing) AND (v_total_estimated_cost <= v_remaining);
    END IF;
  END IF;

  v_auto_approve := v_aa_enabled AND v_cap_ok AND v_budget_ok;
  v_status := CASE WHEN v_auto_approve THEN 'approved' ELSE 'draft' END;

  v_event_id := gen_random_uuid();
  INSERT INTO supply_chain.purchase_orders (tenant_id, po_number, vendor_id, vendor_address_id, vendor_name_snapshot, vendor_code_snapshot, delivery_method, needed_by_date, cost_context, job_id, delivery_location_id, pickup_location_id, max_authorized_spend, vendor_quote_ref, notes, attachments, status, approved_at, approved_by_user_id, created_by_user_id, order_date, last_event_id)
  VALUES (v_tenant_id, v_generated_po_number, p_vendor_id, p_vendor_address_id, v_vendor_name, v_vendor_code, p_delivery_method, p_needed_by_date, p_cost_context, p_job_id, p_delivery_location_id, p_pickup_location_id, p_max_authorized_spend, p_vendor_quote_ref, p_notes, p_attachments, v_status, CASE WHEN v_auto_approve THEN now() ELSE NULL END, CASE WHEN v_auto_approve THEN v_user_id ELSE NULL END, v_user_id, CURRENT_DATE, v_event_id) RETURNING id INTO v_po_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_number := v_line_number + 1;
    INSERT INTO supply_chain.purchase_order_lines (tenant_id, po_id, line_number, catalog_item_id, item_description, uom_term_id, qty_ordered, unit_cost, estimated_unit_cost, price_basis, is_approximate_qty, line_notes, status, last_event_id)
    VALUES (v_tenant_id, v_po_id, v_line_number, (v_line->>'catalog_item_id')::UUID, v_line->>'item_description', (v_line->>'uom_term_id')::UUID, (v_line->>'qty_ordered')::NUMERIC, (v_line->>'unit_cost')::NUMERIC, (v_line->>'estimated_unit_cost')::NUMERIC, COALESCE(v_line->>'price_basis','fixed'), COALESCE((v_line->>'is_approximate_qty')::BOOLEAN,false), v_line->>'line_notes', 'pending', v_event_id);
  END LOOP;

  v_result := jsonb_build_object('success',true,'po_id',v_po_id,'po_number',v_generated_po_number,'line_count',v_line_number,'status',v_status,'auto_approved',v_auto_approve,'effective_limit',v_effective_limit,'budget_remaining',v_remaining,'initiated_by',p_initiated_by);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION supply_chain.rpc_create_purchase_order(uuid,text,text,date,text,uuid,uuid,uuid,numeric,text,text,jsonb,jsonb,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION supply_chain.rpc_create_purchase_order(uuid,text,text,date,text,uuid,uuid,uuid,numeric,text,text,jsonb,jsonb,text,uuid) TO authenticated, service_role;
