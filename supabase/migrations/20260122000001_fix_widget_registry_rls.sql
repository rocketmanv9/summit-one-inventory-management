-- ============================================================================
-- Fix Widget Registry & Dashboard Widgets RLS for Anonymous Access
-- ============================================================================
-- Date: 2026-01-22
-- Purpose: Allow anonymous users to:
--   1. View enabled widgets from widget_registry
--   2. Manage dashboard_widgets (since we use custom JWT auth via session cookie)
-- This is needed because the app uses custom authentication, not Supabase auth.jwt()
-- ============================================================================

-- ============================================================================
-- 1. Widget Registry - Allow viewing enabled widgets
-- ============================================================================

DROP POLICY IF EXISTS anon_can_view_widget_registry ON public.widget_registry;

CREATE POLICY anon_can_view_widget_registry 
  ON public.widget_registry 
  FOR SELECT 
  TO anon 
  USING (is_enabled = true);

COMMENT ON POLICY anon_can_view_widget_registry ON public.widget_registry IS 
  'Allows anonymous users to view enabled widgets for dashboard widget selection';

-- ============================================================================
-- 2. Dashboard Widgets - Allow anon role to manage (tenant check in API)
-- ============================================================================

-- Note: These policies allow anon role full access to dashboard_widgets.
-- Security is enforced at the API layer via session cookie validation.
-- The API always filters by tenant_id from the session.

DROP POLICY IF EXISTS anon_can_manage_dashboard_widgets_select ON public.dashboard_widgets;
DROP POLICY IF EXISTS anon_can_manage_dashboard_widgets_insert ON public.dashboard_widgets;
DROP POLICY IF EXISTS anon_can_manage_dashboard_widgets_update ON public.dashboard_widgets;
DROP POLICY IF EXISTS anon_can_manage_dashboard_widgets_delete ON public.dashboard_widgets;

CREATE POLICY anon_can_manage_dashboard_widgets_select 
  ON public.dashboard_widgets 
  FOR SELECT 
  TO anon 
  USING (true);

CREATE POLICY anon_can_manage_dashboard_widgets_insert 
  ON public.dashboard_widgets 
  FOR INSERT 
  TO anon 
  WITH CHECK (true);

CREATE POLICY anon_can_manage_dashboard_widgets_update 
  ON public.dashboard_widgets 
  FOR UPDATE 
  TO anon 
  USING (true);

CREATE POLICY anon_can_manage_dashboard_widgets_delete 
  ON public.dashboard_widgets 
  FOR DELETE 
  TO anon 
  USING (true);

COMMENT ON POLICY anon_can_manage_dashboard_widgets_select ON public.dashboard_widgets IS 
  'Allows anon users to view dashboard widgets - tenant isolation enforced by API';
COMMENT ON POLICY anon_can_manage_dashboard_widgets_insert ON public.dashboard_widgets IS 
  'Allows anon users to create dashboard widgets - tenant isolation enforced by API';
COMMENT ON POLICY anon_can_manage_dashboard_widgets_update ON public.dashboard_widgets IS 
  'Allows anon users to update dashboard widgets - tenant isolation enforced by API';
COMMENT ON POLICY anon_can_manage_dashboard_widgets_delete ON public.dashboard_widgets IS 
  'Allows anon users to delete dashboard widgets - tenant isolation enforced by API';
