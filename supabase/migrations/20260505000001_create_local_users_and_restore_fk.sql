-- Create the local_users table (synced from Core via webhooks)
-- Replaces auth.users FK references since users come from Summit One Core, not Supabase Auth
CREATE TABLE public.local_users (
  user_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  email TEXT,
  name TEXT,
  role TEXT DEFAULT 'member',
  synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_local_users_tenant_id ON public.local_users (tenant_id);

ALTER TABLE public.local_users ENABLE ROW LEVEL SECURITY;

-- RLS: service_role full access
CREATE POLICY "service_role_full_access" ON public.local_users
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- RLS: authenticated users can see their tenant's users
CREATE POLICY "tenant_read_access" ON public.local_users
  FOR SELECT TO authenticated
  USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);

-- RLS: authenticated can insert (for auto-sync trigger)
CREATE POLICY "authenticated_insert" ON public.local_users
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Seed known user IDs (stub entries - webhook will fill details later)
INSERT INTO public.local_users (user_id, tenant_id, email, name, role)
VALUES
  ('e9c3b342-1742-4333-9d00-585ee9b471b0', '052abee2-ffdc-470e-975a-b917dde72b8e', NULL, 'Unknown User', 'member'),
  ('00000000-0000-0000-0000-000000000001', '052abee2-ffdc-470e-975a-b917dde72b8e', 'dev@test.com', 'Dev User', 'admin')
ON CONFLICT (user_id) DO NOTHING;

-- Function to auto-create stub user entries (prevents FK violations before webhook sync)
CREATE OR REPLACE FUNCTION public.ensure_local_user_flexible()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID;
  v_tenant_id UUID;
BEGIN
  -- Try each possible user column
  BEGIN v_user_id := NEW.created_by; EXCEPTION WHEN undefined_column THEN v_user_id := NULL; END;
  IF v_user_id IS NULL THEN
    BEGIN v_user_id := NEW.updated_by; EXCEPTION WHEN undefined_column THEN v_user_id := NULL; END;
  END IF;
  IF v_user_id IS NULL THEN
    BEGIN v_user_id := NEW.actor_user_id; EXCEPTION WHEN undefined_column THEN v_user_id := NULL; END;
  END IF;
  IF v_user_id IS NULL THEN
    BEGIN v_user_id := NEW.user_id; EXCEPTION WHEN undefined_column THEN v_user_id := NULL; END;
  END IF;

  BEGIN v_tenant_id := NEW.tenant_id; EXCEPTION WHEN undefined_column THEN v_tenant_id := NULL; END;

  IF v_user_id IS NOT NULL AND v_tenant_id IS NOT NULL THEN
    INSERT INTO public.local_users (user_id, tenant_id, name, role)
    VALUES (v_user_id, v_tenant_id, 'Pending Sync', 'member')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- Add FK constraints from inventory schema (BASE TABLES only)
-- ============================================================

ALTER TABLE inventory.assets
  ADD CONSTRAINT fk_assets_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_assets_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.asset_events
  ADD CONSTRAINT fk_asset_events_actor FOREIGN KEY (actor_user_id) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.asset_state
  ADD CONSTRAINT fk_asset_state_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.abc_classification
  ADD CONSTRAINT fk_abc_classification_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_abc_classification_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.catalog_items
  ADD CONSTRAINT fk_catalog_items_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_catalog_items_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.cycle_counts
  ADD CONSTRAINT fk_cycle_counts_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_cycle_counts_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.cycle_count_lines
  ADD CONSTRAINT fk_cycle_count_lines_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_cycle_count_lines_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.cycle_count_asset_lines
  ADD CONSTRAINT fk_cycle_count_asset_lines_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_cycle_count_asset_lines_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.daily_asset_metrics
  ADD CONSTRAINT fk_daily_asset_metrics_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.daily_item_activity
  ADD CONSTRAINT fk_daily_item_activity_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.dashboards
  ADD CONSTRAINT fk_dashboards_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_dashboards_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.dashboard_widgets
  ADD CONSTRAINT fk_dashboard_widgets_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_dashboard_widgets_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.events_outbox
  ADD CONSTRAINT fk_events_outbox_actor FOREIGN KEY (actor_user_id) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.guardrail_exceptions
  ADD CONSTRAINT fk_guardrail_exceptions_actor FOREIGN KEY (actor_user_id) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.identifiers
  ADD CONSTRAINT fk_identifiers_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_identifiers_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.inventory_events
  ADD CONSTRAINT fk_inventory_events_actor FOREIGN KEY (actor_user_id) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.item_categories
  ADD CONSTRAINT fk_item_categories_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_item_categories_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.locations
  ADD CONSTRAINT fk_locations_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_locations_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.reorder_alerts
  ADD CONSTRAINT fk_reorder_alerts_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_reorder_alerts_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.reservations
  ADD CONSTRAINT fk_reservations_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_reservations_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.rfid_devices
  ADD CONSTRAINT fk_rfid_devices_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_rfid_devices_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.rfid_tags
  ADD CONSTRAINT fk_rfid_tags_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_rfid_tags_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE inventory.stock_balances
  ADD CONSTRAINT fk_stock_balances_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

-- ============================================================
-- Add FK constraints from supply_chain schema
-- ============================================================

ALTER TABLE supply_chain.procurement_events
  ADD CONSTRAINT fk_procurement_events_actor FOREIGN KEY (actor_user_id) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE supply_chain.purchase_order_lines
  ADD CONSTRAINT fk_sc_po_lines_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_sc_po_lines_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE supply_chain.purchase_orders
  ADD CONSTRAINT fk_sc_purchase_orders_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE supply_chain.receipt_lines
  ADD CONSTRAINT fk_sc_receipt_lines_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_sc_receipt_lines_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE supply_chain.receipts
  ADD CONSTRAINT fk_sc_receipts_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_sc_receipts_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE supply_chain.tenant_settings
  ADD CONSTRAINT fk_tenant_settings_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE supply_chain.vendor_performance_events
  ADD CONSTRAINT fk_vendor_perf_events_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

-- ============================================================
-- Add FK constraints from public schema
-- ============================================================

ALTER TABLE public.audit_logs
  ADD CONSTRAINT fk_audit_logs_user_id FOREIGN KEY (user_id) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE public.dashboards
  ADD CONSTRAINT fk_public_dashboards_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_public_dashboards_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE public.dashboard_widgets
  ADD CONSTRAINT fk_public_dashboard_widgets_created_by FOREIGN KEY (created_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_public_dashboard_widgets_updated_by FOREIGN KEY (updated_by) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

ALTER TABLE public.events_outbox
  ADD CONSTRAINT fk_public_events_outbox_actor FOREIGN KEY (actor_user_id) REFERENCES public.local_users(user_id) ON DELETE SET NULL;

-- ============================================================
-- Add ensure_local_user triggers on key tables
-- (prevents FK violations when a user acts before webhook sync)
-- ============================================================

CREATE TRIGGER trg_ensure_user_inventory_events
  BEFORE INSERT ON inventory.events_outbox
  FOR EACH ROW EXECUTE FUNCTION public.ensure_local_user_flexible();

CREATE TRIGGER trg_ensure_user_public_events
  BEFORE INSERT ON public.events_outbox
  FOR EACH ROW EXECUTE FUNCTION public.ensure_local_user_flexible();

CREATE TRIGGER trg_ensure_user_dashboards
  BEFORE INSERT ON inventory.dashboards
  FOR EACH ROW EXECUTE FUNCTION public.ensure_local_user_flexible();

CREATE TRIGGER trg_ensure_user_public_dashboards
  BEFORE INSERT ON public.dashboards
  FOR EACH ROW EXECUTE FUNCTION public.ensure_local_user_flexible();

CREATE TRIGGER trg_ensure_user_audit_logs
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.ensure_local_user_flexible();

CREATE TRIGGER trg_ensure_user_inventory_inv_events
  BEFORE INSERT ON inventory.inventory_events
  FOR EACH ROW EXECUTE FUNCTION public.ensure_local_user_flexible();

CREATE TRIGGER trg_ensure_user_procurement_events
  BEFORE INSERT ON supply_chain.procurement_events
  FOR EACH ROW EXECUTE FUNCTION public.ensure_local_user_flexible();

CREATE TRIGGER trg_ensure_user_assets
  BEFORE INSERT ON inventory.assets
  FOR EACH ROW EXECUTE FUNCTION public.ensure_local_user_flexible();

CREATE TRIGGER trg_ensure_user_catalog_items
  BEFORE INSERT ON inventory.catalog_items
  FOR EACH ROW EXECUTE FUNCTION public.ensure_local_user_flexible();

CREATE TRIGGER trg_ensure_user_locations
  BEFORE INSERT ON inventory.locations
  FOR EACH ROW EXECUTE FUNCTION public.ensure_local_user_flexible();

CREATE TRIGGER trg_ensure_user_reservations
  BEFORE INSERT ON inventory.reservations
  FOR EACH ROW EXECUTE FUNCTION public.ensure_local_user_flexible();

CREATE TRIGGER trg_ensure_user_purchase_orders
  BEFORE INSERT ON supply_chain.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.ensure_local_user_flexible();

CREATE TRIGGER trg_ensure_user_receipts
  BEFORE INSERT ON supply_chain.receipts
  FOR EACH ROW EXECUTE FUNCTION public.ensure_local_user_flexible();

-- Grant permissions for PostgREST access
GRANT SELECT ON public.local_users TO authenticated;
GRANT INSERT ON public.local_users TO authenticated;
GRANT UPDATE ON public.local_users TO authenticated;
GRANT ALL ON public.local_users TO service_role;
