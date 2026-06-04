-- Dashboard scope-aware visibility (RLS)
--
-- Bug: the SELECT policies on dashboards / dashboard_widgets filtered by
-- tenant_id only, ignoring the `scope` column. A `scope='user'` (private)
-- dashboard owned by one user was therefore readable by every user in the
-- tenant — and because the dashboard page redirects to the `is_default`
-- dashboard, everyone landed on one user's personal dashboard.
--
-- Fix: scope reads to tenant-wide dashboards + the requesting user's own
-- private dashboards. The INSERT policy already enforces ownership; this
-- brings SELECT in line. Widgets inherit visibility from their parent
-- dashboard so a widget can't be read by id without access to its dashboard.
--
-- Role-scoped (scope='role') dashboards are intentionally NOT surfaced yet:
-- there is no app-role claim wired into the JWT. Add a clause here and in the
-- frontend visibilityFilter() once that exists. No role-scoped dashboards
-- currently exist.

DROP POLICY IF EXISTS dashboards_tenant_isolation_select ON public.dashboards;
CREATE POLICY dashboards_tenant_isolation_select ON public.dashboards
  FOR SELECT USING (
    tenant_id = current_tenant_id()
    AND (
      scope = 'tenant'
      OR (scope = 'user' AND owner_user_id::text = (auth.jwt() ->> 'sub'))
      -- TODO(role-scope): OR (scope = 'role' AND role_key = <app role claim>)
    )
  );

DROP POLICY IF EXISTS dashboard_widgets_tenant_isolation_select ON public.dashboard_widgets;
CREATE POLICY dashboard_widgets_tenant_isolation_select ON public.dashboard_widgets
  FOR SELECT USING (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM public.dashboards d
      WHERE d.id = dashboard_widgets.dashboard_id
        AND d.tenant_id = current_tenant_id()
        AND (
          d.scope = 'tenant'
          OR (d.scope = 'user' AND d.owner_user_id::text = (auth.jwt() ->> 'sub'))
        )
    )
  );
