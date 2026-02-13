-- =====================================================================
-- Migration: Enforce admin role for assignment_types writes
-- Date: 2026-02-13
-- Description: Keep tenant-scoped reads for authenticated users, but
--              require admin role for INSERT/UPDATE/DELETE.
-- =====================================================================

-- Drop prior broad or legacy policies
DROP POLICY IF EXISTS assignment_types_tenant_isolation ON inventory.assignment_types;
DROP POLICY IF EXISTS "assignment_types_tenant_isolation" ON inventory.assignment_types;
DROP POLICY IF EXISTS assignment_types_select ON inventory.assignment_types;
DROP POLICY IF EXISTS "assignment_types_select" ON inventory.assignment_types;
DROP POLICY IF EXISTS assignment_types_insert ON inventory.assignment_types;
DROP POLICY IF EXISTS "assignment_types_insert" ON inventory.assignment_types;
DROP POLICY IF EXISTS assignment_types_update ON inventory.assignment_types;
DROP POLICY IF EXISTS "assignment_types_update" ON inventory.assignment_types;
DROP POLICY IF EXISTS assignment_types_delete ON inventory.assignment_types;
DROP POLICY IF EXISTS "assignment_types_delete" ON inventory.assignment_types;

-- SELECT: any authenticated user in the same tenant can read
CREATE POLICY assignment_types_select ON inventory.assignment_types
  FOR SELECT TO authenticated
  USING (
    current_role = 'service_role'
    OR tenant_id = COALESCE(
      NULLIF(current_setting('app.current_tenant_id', true), '')::uuid,
      NULLIF(current_setting('app.tenant_id', true), '')::uuid,
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

-- INSERT: tenant match + admin role
CREATE POLICY assignment_types_insert ON inventory.assignment_types
  FOR INSERT TO authenticated
  WITH CHECK (
    current_role = 'service_role'
    OR (
      tenant_id = COALESCE(
        NULLIF(current_setting('app.current_tenant_id', true), '')::uuid,
        NULLIF(current_setting('app.tenant_id', true), '')::uuid,
        (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
        (auth.jwt() ->> 'tenant_id')::uuid
      )
      AND (
        (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
        OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
      )
    )
  );

-- UPDATE: tenant match + admin role
CREATE POLICY assignment_types_update ON inventory.assignment_types
  FOR UPDATE TO authenticated
  USING (
    current_role = 'service_role'
    OR (
      tenant_id = COALESCE(
        NULLIF(current_setting('app.current_tenant_id', true), '')::uuid,
        NULLIF(current_setting('app.tenant_id', true), '')::uuid,
        (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
        (auth.jwt() ->> 'tenant_id')::uuid
      )
      AND (
        (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
        OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
      )
    )
  )
  WITH CHECK (
    current_role = 'service_role'
    OR (
      tenant_id = COALESCE(
        NULLIF(current_setting('app.current_tenant_id', true), '')::uuid,
        NULLIF(current_setting('app.tenant_id', true), '')::uuid,
        (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
        (auth.jwt() ->> 'tenant_id')::uuid
      )
      AND (
        (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
        OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
      )
    )
  );

-- DELETE: tenant match + admin role
CREATE POLICY assignment_types_delete ON inventory.assignment_types
  FOR DELETE TO authenticated
  USING (
    current_role = 'service_role'
    OR (
      tenant_id = COALESCE(
        NULLIF(current_setting('app.current_tenant_id', true), '')::uuid,
        NULLIF(current_setting('app.tenant_id', true), '')::uuid,
        (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
        (auth.jwt() ->> 'tenant_id')::uuid
      )
      AND (
        (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
        OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
      )
    )
  );
