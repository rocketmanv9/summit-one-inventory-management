-- =====================================================
-- Dashboard Outbox + RLS Hardening
-- Date: 2026-02-11
-- Purpose: Enforce tenant isolation, soft-delete behavior, and
--          emit canonical dashboard events to outbox.
-- =====================================================

BEGIN;

-- =====================================================
-- 1. Ensure columns used by UI + RLS exist
-- =====================================================

ALTER TABLE public.dashboards
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE public.dashboard_widgets
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE public.dashboard_widgets
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

-- =====================================================
-- 2. Enforce RLS on dashboards/widgets using current_tenant_id
-- =====================================================

ALTER TABLE public.dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_widgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.widget_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dashboards_tenant_isolation_select ON public.dashboards;
DROP POLICY IF EXISTS dashboards_tenant_isolation_insert ON public.dashboards;
DROP POLICY IF EXISTS dashboards_tenant_isolation_update ON public.dashboards;
DROP POLICY IF EXISTS dashboards_tenant_isolation_delete ON public.dashboards;
DROP POLICY IF EXISTS "Users can view dashboards based on scope" ON public.dashboards;
DROP POLICY IF EXISTS "Users can create dashboards in their tenant" ON public.dashboards;
DROP POLICY IF EXISTS "Users can update their own dashboards or tenant admins can update tenant dashboards" ON public.dashboards;
DROP POLICY IF EXISTS "Users can delete their own dashboards or admins can delete tenant dashboards" ON public.dashboards;

DROP POLICY IF EXISTS dashboard_widgets_tenant_isolation_select ON public.dashboard_widgets;
DROP POLICY IF EXISTS dashboard_widgets_tenant_isolation_insert ON public.dashboard_widgets;
DROP POLICY IF EXISTS dashboard_widgets_tenant_isolation_update ON public.dashboard_widgets;
DROP POLICY IF EXISTS dashboard_widgets_tenant_isolation_delete ON public.dashboard_widgets;
DROP POLICY IF EXISTS "Tenants can view their own widgets" ON public.dashboard_widgets;
DROP POLICY IF EXISTS "Tenants can create their own widgets" ON public.dashboard_widgets;
DROP POLICY IF EXISTS "Tenants can update their own widgets" ON public.dashboard_widgets;
DROP POLICY IF EXISTS "Tenants can delete their own widgets" ON public.dashboard_widgets;
DROP POLICY IF EXISTS anon_can_manage_dashboard_widgets_select ON public.dashboard_widgets;
DROP POLICY IF EXISTS anon_can_manage_dashboard_widgets_insert ON public.dashboard_widgets;
DROP POLICY IF EXISTS anon_can_manage_dashboard_widgets_update ON public.dashboard_widgets;
DROP POLICY IF EXISTS anon_can_manage_dashboard_widgets_delete ON public.dashboard_widgets;

DROP POLICY IF EXISTS widget_registry_enabled_select ON public.widget_registry;
DROP POLICY IF EXISTS widget_registry_service_role_manage ON public.widget_registry;
DROP POLICY IF EXISTS "Authenticated users can view widget registry" ON public.widget_registry;
DROP POLICY IF EXISTS "Service role can manage widget registry" ON public.widget_registry;
DROP POLICY IF EXISTS anon_can_view_widget_registry ON public.widget_registry;

CREATE POLICY dashboards_tenant_isolation_select
  ON public.dashboards
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    AND deleted_at IS NULL
  );

CREATE POLICY dashboards_tenant_isolation_insert
  ON public.dashboards
  FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (
      (scope = 'user' AND owner_user_id::text = auth.jwt() ->> 'sub')
      OR scope IN ('tenant', 'role')
    )
  );

CREATE POLICY dashboards_tenant_isolation_update
  ON public.dashboards
  FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    AND deleted_at IS NULL
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
  );

CREATE POLICY dashboards_tenant_isolation_delete
  ON public.dashboards
  FOR DELETE
  USING (
    tenant_id = public.current_tenant_id()
  );

CREATE POLICY dashboard_widgets_tenant_isolation_select
  ON public.dashboard_widgets
  FOR SELECT
  USING (
    tenant_id = public.current_tenant_id()
    AND deleted_at IS NULL
  );

CREATE POLICY dashboard_widgets_tenant_isolation_insert
  ON public.dashboard_widgets
  FOR INSERT
  WITH CHECK (
    tenant_id = public.current_tenant_id()
  );

CREATE POLICY dashboard_widgets_tenant_isolation_update
  ON public.dashboard_widgets
  FOR UPDATE
  USING (
    tenant_id = public.current_tenant_id()
    AND deleted_at IS NULL
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
  );

CREATE POLICY dashboard_widgets_tenant_isolation_delete
  ON public.dashboard_widgets
  FOR DELETE
  USING (
    tenant_id = public.current_tenant_id()
  );

CREATE POLICY widget_registry_enabled_select
  ON public.widget_registry
  FOR SELECT
  TO authenticated
  USING (is_enabled = true);

CREATE POLICY widget_registry_service_role_manage
  ON public.widget_registry
  TO service_role
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- 2b. Events poller compatibility wrappers
-- =====================================================

CREATE OR REPLACE FUNCTION public.poll_inventory_events(
  p_batch_size integer DEFAULT 100,
  p_max_attempts integer DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  scope text,
  event_type text,
  aggregate_type text,
  aggregate_id uuid,
  payload jsonb,
  metadata jsonb,
  status text,
  retry_count integer,
  created_at timestamptz,
  last_error text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM supply_chain.poll_pending_events(p_batch_size, p_max_attempts);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_event_status(
  p_event_id uuid,
  p_status text,
  p_published_at timestamptz DEFAULT NULL,
  p_retry_count integer DEFAULT NULL,
  p_last_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE inventory.events_outbox
  SET
    status = p_status,
    published_at = COALESCE(p_published_at, published_at),
    retry_count = COALESCE(p_retry_count, retry_count),
    last_error = COALESCE(p_last_error, last_error),
    error_message = COALESCE(p_last_error, error_message),
    last_attempt_at = now(),
    last_retry_at = CASE WHEN p_status IN ('pending', 'failed') THEN now() ELSE last_retry_at END,
    next_attempt_at = CASE WHEN p_status IN ('pending', 'failed') THEN now() ELSE next_attempt_at END
  WHERE id = p_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.poll_inventory_events(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_event_status(uuid, text, timestamptz, integer, text) TO service_role;

-- =====================================================
-- 3. Trigger: populate audit + tenant fields from JWT
-- =====================================================

CREATE OR REPLACE FUNCTION public.set_dashboard_audit_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();

  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := public.current_tenant_id();
  END IF;

  IF NEW.created_at IS NULL THEN
    NEW.created_at := now();
  END IF;

  NEW.updated_at := now();

  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS NULL THEN
      NEW.created_by := v_user_id;
    END IF;

    IF NEW.owner_user_id IS NULL AND NEW.scope = 'user' THEN
      NEW.owner_user_id := v_user_id;
    END IF;
  END IF;

  NEW.updated_by := v_user_id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_dashboard_widget_audit_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := public.current_tenant_id();
  END IF;

  IF NEW.created_at IS NULL THEN
    NEW.created_at := now();
  END IF;

  NEW.updated_at := now();
  NEW.created_by := COALESCE(NEW.created_by, auth.uid());
  NEW.updated_by := auth.uid();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_dashboards_audit_public ON public.dashboards;
CREATE TRIGGER set_dashboards_audit_public
  BEFORE INSERT OR UPDATE ON public.dashboards
  FOR EACH ROW
  EXECUTE FUNCTION public.set_dashboard_audit_fields();

DROP TRIGGER IF EXISTS set_dashboard_widgets_audit_public ON public.dashboard_widgets;
CREATE TRIGGER set_dashboard_widgets_audit_public
  BEFORE INSERT OR UPDATE ON public.dashboard_widgets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_dashboard_widget_audit_fields();

-- =====================================================
-- 4. Event Definitions + outbox emission
-- =====================================================

INSERT INTO public.event_definitions (event_name, version, producer, description, payload_schema)
VALUES
  ('dashboard.created', 1, 'public.dashboards', 'Dashboard created', '{"type":"object","required":["dashboard_id","tenant_id","name"],"properties":{"dashboard_id":{"type":"string"},"tenant_id":{"type":"string"},"name":{"type":"string"},"scope":{"type":"string"},"owner_user_id":{"type":"string"},"created_by":{"type":"string"},"created_at":{"type":"string"}}}'::jsonb),
  ('dashboard.updated', 1, 'public.dashboards', 'Dashboard updated', '{"type":"object","required":["dashboard_id","tenant_id"],"properties":{"dashboard_id":{"type":"string"},"tenant_id":{"type":"string"},"changes":{"type":"object"}}}'::jsonb),
  ('dashboard.deleted', 1, 'public.dashboards', 'Dashboard deleted', '{"type":"object","required":["dashboard_id","tenant_id"],"properties":{"dashboard_id":{"type":"string"},"tenant_id":{"type":"string"},"deleted_at":{"type":"string"}}}'::jsonb),
  ('dashboard_widget.added', 1, 'public.dashboard_widgets', 'Widget added to dashboard', '{"type":"object","required":["widget_id","dashboard_id","tenant_id","widget_key"],"properties":{"widget_id":{"type":"string"},"dashboard_id":{"type":"string"},"tenant_id":{"type":"string"},"widget_key":{"type":"string"},"created_at":{"type":"string"}}}'::jsonb),
  ('dashboard_widget.updated', 1, 'public.dashboard_widgets', 'Widget updated', '{"type":"object","required":["widget_id","dashboard_id","tenant_id"],"properties":{"widget_id":{"type":"string"},"dashboard_id":{"type":"string"},"tenant_id":{"type":"string"},"changes":{"type":"object"}}}'::jsonb),
  ('dashboard_widget.deleted', 1, 'public.dashboard_widgets', 'Widget deleted', '{"type":"object","required":["widget_id","dashboard_id","tenant_id"],"properties":{"widget_id":{"type":"string"},"dashboard_id":{"type":"string"},"tenant_id":{"type":"string"},"deleted_at":{"type":"string"}}}'::jsonb)
ON CONFLICT (event_name, version) DO NOTHING;

CREATE OR REPLACE FUNCTION public.emit_dashboard_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_name text;
  v_payload jsonb;
  v_metadata jsonb;
  v_changes jsonb;
BEGIN
  v_metadata := jsonb_build_object(
    'source', 'dashboard',
    'actor_user_id', auth.uid(),
    'request_id', current_setting('request.id', true)
  );

  IF TG_OP = 'INSERT' THEN
    v_event_name := 'dashboard.created';
    v_payload := jsonb_build_object(
      'dashboard_id', NEW.id,
      'tenant_id', NEW.tenant_id,
      'name', NEW.name,
      'scope', NEW.scope,
      'owner_user_id', NEW.owner_user_id,
      'created_by', NEW.created_by,
      'created_at', NEW.created_at
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
      v_event_name := 'dashboard.deleted';
      v_payload := jsonb_build_object(
        'dashboard_id', NEW.id,
        'tenant_id', NEW.tenant_id,
        'deleted_at', NEW.deleted_at
      );
    ELSE
      v_event_name := 'dashboard.updated';
      v_changes := jsonb_strip_nulls(
        jsonb_build_object(
          'name', CASE WHEN NEW.name IS DISTINCT FROM OLD.name THEN jsonb_build_object('old', OLD.name, 'new', NEW.name) END,
          'description', CASE WHEN NEW.description IS DISTINCT FROM OLD.description THEN jsonb_build_object('old', OLD.description, 'new', NEW.description) END,
          'is_default', CASE WHEN NEW.is_default IS DISTINCT FROM OLD.is_default THEN jsonb_build_object('old', OLD.is_default, 'new', NEW.is_default) END,
          'scope', CASE WHEN NEW.scope IS DISTINCT FROM OLD.scope THEN jsonb_build_object('old', OLD.scope, 'new', NEW.scope) END
        )
      );
      v_payload := jsonb_build_object(
        'dashboard_id', NEW.id,
        'tenant_id', NEW.tenant_id,
        'changes', COALESCE(v_changes, '{}'::jsonb)
      );
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO inventory.events_outbox (
    tenant_id,
    scope,
    event_type,
    aggregate_type,
    aggregate_id,
    actor_user_id,
    payload,
    metadata,
    event_name,
    event_version,
    status,
    created_at
  ) VALUES (
    NEW.tenant_id,
    'tenant',
    v_event_name,
    'dashboard',
    NEW.id,
    auth.uid(),
    v_payload,
    v_metadata,
    v_event_name,
    1,
    'pending',
    now()
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.emit_dashboard_widget_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_name text;
  v_payload jsonb;
  v_metadata jsonb;
  v_changes jsonb;
BEGIN
  v_metadata := jsonb_build_object(
    'source', 'dashboard_widget',
    'actor_user_id', auth.uid(),
    'request_id', current_setting('request.id', true)
  );

  IF TG_OP = 'INSERT' THEN
    v_event_name := 'dashboard_widget.added';
    v_payload := jsonb_build_object(
      'widget_id', NEW.id,
      'dashboard_id', NEW.dashboard_id,
      'tenant_id', NEW.tenant_id,
      'widget_key', NEW.widget_key,
      'created_at', NEW.created_at
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
      v_event_name := 'dashboard_widget.deleted';
      v_payload := jsonb_build_object(
        'widget_id', NEW.id,
        'dashboard_id', NEW.dashboard_id,
        'tenant_id', NEW.tenant_id,
        'deleted_at', NEW.deleted_at
      );
    ELSE
      v_event_name := 'dashboard_widget.updated';
      v_changes := jsonb_strip_nulls(
        jsonb_build_object(
          'title', CASE WHEN NEW.title IS DISTINCT FROM OLD.title THEN jsonb_build_object('old', OLD.title, 'new', NEW.title) END,
          'layout', CASE WHEN NEW.layout IS DISTINCT FROM OLD.layout THEN jsonb_build_object('old', OLD.layout, 'new', NEW.layout) END,
          'config', CASE WHEN NEW.config IS DISTINCT FROM OLD.config THEN jsonb_build_object('old', OLD.config, 'new', NEW.config) END,
          'refresh_seconds', CASE WHEN NEW.refresh_seconds IS DISTINCT FROM OLD.refresh_seconds THEN jsonb_build_object('old', OLD.refresh_seconds, 'new', NEW.refresh_seconds) END
        )
      );
      v_payload := jsonb_build_object(
        'widget_id', NEW.id,
        'dashboard_id', NEW.dashboard_id,
        'tenant_id', NEW.tenant_id,
        'changes', COALESCE(v_changes, '{}'::jsonb)
      );
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO inventory.events_outbox (
    tenant_id,
    scope,
    event_type,
    aggregate_type,
    aggregate_id,
    actor_user_id,
    payload,
    metadata,
    event_name,
    event_version,
    status,
    created_at
  ) VALUES (
    NEW.tenant_id,
    'tenant',
    v_event_name,
    'dashboard_widget',
    NEW.id,
    auth.uid(),
    v_payload,
    v_metadata,
    v_event_name,
    1,
    'pending',
    now()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dashboards_emit_event ON public.dashboards;
CREATE TRIGGER dashboards_emit_event
  AFTER INSERT OR UPDATE ON public.dashboards
  FOR EACH ROW
  EXECUTE FUNCTION public.emit_dashboard_event();

DROP TRIGGER IF EXISTS dashboard_widgets_emit_event ON public.dashboard_widgets;
CREATE TRIGGER dashboard_widgets_emit_event
  AFTER INSERT OR UPDATE ON public.dashboard_widgets
  FOR EACH ROW
  EXECUTE FUNCTION public.emit_dashboard_widget_event();

COMMIT;
