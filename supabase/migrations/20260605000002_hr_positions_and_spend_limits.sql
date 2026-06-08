-- HR ingestion + per-user / per-position / agent spending limits.
--
-- Brings people + positions from summit-one-hr (separate Supabase, org_positions /
-- org_people) into a local mirror so we can attach PURCHASE-ORDER spending limits at
-- three levels and resolve them with a precedence cascade.
--
-- Limit resolution (per-order cap, same semantics as today's auto_approve_limit:
-- over the cap -> PO goes to 'draft' for human approval, never hard-blocked):
--   vendor override  >  user override  >  position default  >  tenant global
-- The AI agent's auto-reorder uses its OWN separate cap (agent_auto_order_limit),
-- gated by agent_auto_order_enabled, instead of inheriting a person's position.
--
-- Tenant mapping: app tenant_id and HR tenant_id are configurable via
-- tenant_settings.hr_tenant_id; it DEFAULTS to identity (same uuid), which is correct
-- for AC Moate (local_users + HR both use 052abee2-...). See hr_tenant_id below.

-- ============================================================
-- 1. Local positions mirror (synced from summit-one-hr.org_positions)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.positions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  hr_position_id  UUID,                       -- org_positions.id in summit-one-hr (NULL for manual rows)
  title           TEXT NOT NULL,              -- org_positions.title (display)
  name            TEXT,                       -- org_positions.name (short)
  role_level      TEXT,                       -- resolved org_role_levels.name (e.g. Crew, Manager)
  role_level_rank INT,                        -- org_role_levels.rank_order
  spending_limit  NUMERIC(12,2),              -- per-position default PO cap (NULL = no position-level cap)
  is_active       BOOLEAN DEFAULT true,
  source          TEXT NOT NULL DEFAULT 'hr', -- 'hr' | 'manual'
  synced_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT positions_source_chk CHECK (source IN ('hr','manual')),
  CONSTRAINT positions_tenant_hr_uq UNIQUE (tenant_id, hr_position_id)
);

CREATE INDEX IF NOT EXISTS idx_positions_tenant_id ON public.positions (tenant_id);

ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;

-- service_role (sync + write routes) full access
DROP POLICY IF EXISTS "positions_service_role_full" ON public.positions;
CREATE POLICY "positions_service_role_full" ON public.positions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- authenticated users read their own tenant's positions (writes go via service-role routes)
DROP POLICY IF EXISTS "positions_tenant_read" ON public.positions;
CREATE POLICY "positions_tenant_read" ON public.positions
  FOR SELECT TO authenticated
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

GRANT SELECT ON public.positions TO authenticated;
GRANT ALL ON public.positions TO service_role;

COMMENT ON TABLE public.positions IS
  'Positions mirrored from summit-one-hr (org_positions) plus optional manual rows. '
  'Carries per-position PO spending_limit. Synced via /api/hr/sync (service role). '
  'Authenticated clients may READ their tenant''s rows; writes are service-role only.';

-- ============================================================
-- 2. Attach position + per-user limit to synced users
-- ============================================================
ALTER TABLE public.local_users ADD COLUMN IF NOT EXISTS position_id    UUID REFERENCES public.positions(id) ON DELETE SET NULL;
ALTER TABLE public.local_users ADD COLUMN IF NOT EXISTS hr_person_id   UUID;            -- org_people.id matched by email
ALTER TABLE public.local_users ADD COLUMN IF NOT EXISTS spending_limit NUMERIC(12,2);   -- per-user override PO cap

CREATE INDEX IF NOT EXISTS idx_local_users_position_id ON public.local_users (position_id);

-- ============================================================
-- 3. Agent auto-order cap + HR tenant mapping on tenant_settings
-- ============================================================
ALTER TABLE supply_chain.tenant_settings ADD COLUMN IF NOT EXISTS agent_auto_order_enabled BOOLEAN DEFAULT false;
ALTER TABLE supply_chain.tenant_settings ADD COLUMN IF NOT EXISTS agent_auto_order_limit   NUMERIC(12,2);
ALTER TABLE supply_chain.tenant_settings ADD COLUMN IF NOT EXISTS hr_tenant_id             UUID; -- NULL => identity (same as app tenant)

-- ============================================================
-- 4. Spend-limit resolver (precedence cascade)
-- ============================================================
CREATE OR REPLACE FUNCTION supply_chain.resolve_spend_limit(
  p_tenant_id    UUID,
  p_user_id      UUID,
  p_vendor_id    UUID,
  p_initiated_by TEXT DEFAULT 'user'   -- 'user' | 'agent'
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'supply_chain', 'public'
AS $function$
DECLARE
  v_aa_limit       NUMERIC;
  v_vendor_limits  JSONB;
  v_agent_limit    NUMERIC;
  v_vendor_limit   NUMERIC;
  v_user_limit     NUMERIC;
  v_position_limit NUMERIC;
BEGIN
  SELECT auto_approve_limit, vendor_auto_approve_limits, agent_auto_order_limit
    INTO v_aa_limit, v_vendor_limits, v_agent_limit
  FROM supply_chain.tenant_settings
  WHERE tenant_id = p_tenant_id;

  -- A vendor-specific limit, when configured, always wins (existing behavior).
  v_vendor_limit := NULLIF(v_vendor_limits->>p_vendor_id::text, '')::numeric;
  IF v_vendor_limit IS NOT NULL THEN
    RETURN v_vendor_limit;
  END IF;

  -- The agent does not inherit a person's position; it gets its own cap,
  -- falling back to the tenant global when unset.
  IF p_initiated_by = 'agent' THEN
    RETURN COALESCE(v_agent_limit, v_aa_limit);
  END IF;

  -- Human path: most-specific wins -> user override, then position default, then tenant global.
  SELECT lu.spending_limit, pos.spending_limit
    INTO v_user_limit, v_position_limit
  FROM public.local_users lu
  LEFT JOIN public.positions pos ON pos.id = lu.position_id
  WHERE lu.user_id = p_user_id AND lu.tenant_id = p_tenant_id;

  -- NULL result => no cap anywhere => auto-approve any amount (matches existing semantics).
  RETURN COALESCE(v_user_limit, v_position_limit, v_aa_limit);
END;
$function$;

COMMENT ON FUNCTION supply_chain.resolve_spend_limit(UUID, UUID, UUID, TEXT) IS
  'Per-order PO spending cap. Precedence: vendor override > user override > position default > tenant global. '
  'initiated_by=''agent'' uses agent_auto_order_limit instead of the user/position cascade. '
  'Returns NULL when no cap applies (=> unlimited / auto-approve).';

-- ============================================================
-- 5. rpc_create_purchase_order: apply the cascade + agent path
--    (only the auto-approve resolution changed; everything else preserved)
-- ============================================================
-- Adding p_initiated_by changes the signature, so CREATE OR REPLACE would leave a
-- second overload. Drop the existing 13-arg version first for a clean replace.
DROP FUNCTION IF EXISTS supply_chain.rpc_create_purchase_order(uuid,text,text,date,text,uuid,uuid,uuid,numeric,text,text,jsonb,jsonb);

CREATE OR REPLACE FUNCTION supply_chain.rpc_create_purchase_order(
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
  p_initiated_by text DEFAULT 'user'::text   -- NEW: 'user' | 'agent'
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
BEGIN
  v_tenant_id := COALESCE((auth.jwt()->'app_metadata'->>'tenant_id')::UUID,(auth.jwt()->>'tenant_id')::UUID);
  v_user_id := COALESCE((auth.jwt()->'app_metadata'->>'user_id')::UUID,(auth.jwt()->>'user_id')::UUID,(auth.jwt()->>'sub')::UUID);
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Authentication required - no tenant_id in JWT'; END IF;
  IF p_delivery_method = 'ship' AND p_delivery_location_id IS NULL THEN RAISE EXCEPTION 'delivery_location_id required when delivery_method = ship'; END IF;
  IF p_delivery_method = 'pickup' AND p_pickup_location_id IS NULL THEN RAISE EXCEPTION 'pickup_location_id required when delivery_method = pickup'; END IF;
  IF p_cost_context = 'job' AND p_job_id IS NULL THEN RAISE EXCEPTION 'job_id required when cost_context = job'; END IF;
  IF p_po_number IS NULL OR p_po_number = '' THEN v_generated_po_number := supply_chain.generate_po_number(v_tenant_id); ELSE v_generated_po_number := p_po_number; END IF;
  SELECT name, code INTO v_vendor_name, v_vendor_code FROM supply_chain.vendors WHERE id = p_vendor_id AND tenant_id = v_tenant_id;

  -- Pre-compute order total + unknown-pricing flag to drive the auto-approve decision.
  SELECT
    COALESCE(SUM((elem->>'qty_ordered')::numeric * COALESCE((elem->>'unit_cost')::numeric, (elem->>'estimated_unit_cost')::numeric, 0)), 0),
    COALESCE(bool_or((elem->>'unit_cost') IS NULL AND (elem->>'estimated_unit_cost') IS NULL), false)
  INTO v_total_estimated_cost, v_has_unknown_pricing
  FROM jsonb_array_elements(p_lines) elem;

  -- Read the relevant enable flag. Human POs honor auto_approve_enabled (defaults ON);
  -- agent POs honor agent_auto_order_enabled (defaults OFF so the agent can't silently approve).
  SELECT auto_approve_enabled, agent_auto_order_enabled
  INTO v_aa_enabled, v_agent_enabled
  FROM supply_chain.tenant_settings WHERE tenant_id = v_tenant_id;

  IF p_initiated_by = 'agent' THEN
    v_aa_enabled := COALESCE(v_agent_enabled, false);
  ELSE
    v_aa_enabled := COALESCE(v_aa_enabled, true);
  END IF;

  -- Effective cap via the precedence cascade (vendor > user > position > tenant; agent uses its own).
  v_effective_limit := supply_chain.resolve_spend_limit(v_tenant_id, v_user_id, p_vendor_id, p_initiated_by);

  v_auto_approve := v_aa_enabled AND (v_effective_limit IS NULL OR (NOT v_has_unknown_pricing AND v_total_estimated_cost <= v_effective_limit));
  v_status := CASE WHEN v_auto_approve THEN 'approved' ELSE 'draft' END;

  v_event_id := gen_random_uuid();
  INSERT INTO supply_chain.purchase_orders (tenant_id, po_number, vendor_id, vendor_name_snapshot, vendor_code_snapshot, delivery_method, needed_by_date, cost_context, job_id, delivery_location_id, pickup_location_id, max_authorized_spend, vendor_quote_ref, notes, attachments, status, approved_at, approved_by_user_id, order_date, last_event_id)
  VALUES (v_tenant_id, v_generated_po_number, p_vendor_id, v_vendor_name, v_vendor_code, p_delivery_method, p_needed_by_date, p_cost_context, p_job_id, p_delivery_location_id, p_pickup_location_id, p_max_authorized_spend, p_vendor_quote_ref, p_notes, p_attachments, v_status, CASE WHEN v_auto_approve THEN now() ELSE NULL END, CASE WHEN v_auto_approve THEN v_user_id ELSE NULL END, CURRENT_DATE, v_event_id) RETURNING id INTO v_po_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_number := v_line_number + 1;
    INSERT INTO supply_chain.purchase_order_lines (tenant_id, po_id, line_number, catalog_item_id, item_description, uom_term_id, qty_ordered, unit_cost, estimated_unit_cost, price_basis, is_approximate_qty, line_notes, status, last_event_id)
    VALUES (v_tenant_id, v_po_id, v_line_number, (v_line->>'catalog_item_id')::UUID, v_line->>'item_description', (v_line->>'uom_term_id')::UUID, (v_line->>'qty_ordered')::NUMERIC, (v_line->>'unit_cost')::NUMERIC, (v_line->>'estimated_unit_cost')::NUMERIC, COALESCE(v_line->>'price_basis','fixed'), COALESCE((v_line->>'is_approximate_qty')::BOOLEAN,false), v_line->>'line_notes', 'pending', v_event_id);
  END LOOP;

  v_result := jsonb_build_object('success',true,'po_id',v_po_id,'po_number',v_generated_po_number,'line_count',v_line_number,'status',v_status,'auto_approved',v_auto_approve,'effective_limit',v_effective_limit,'initiated_by',p_initiated_by);
  RETURN v_result;
END;
$function$;
