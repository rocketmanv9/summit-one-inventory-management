/**
 * FIX: Update transfer_lines and stock_movements RLS policies to support
 * both JWT tenant_id paths (app_metadata and root).
 *
 * These tables were missed in migration 20260129000007 which updated all
 * other inventory tables. Without this fix, authenticated users cannot
 * read or update transfer_lines directly, causing shipTransfer and the
 * transfer list to silently return empty line arrays.
 */

-- transfer_lines
DROP POLICY IF EXISTS transfer_lines_tenant_isolation ON inventory.transfer_lines;
CREATE POLICY transfer_lines_tenant_isolation ON inventory.transfer_lines
  USING (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  )
  WITH CHECK (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );

-- stock_movements (also missed in the original migration)
DROP POLICY IF EXISTS stock_movements_tenant_isolation ON inventory.stock_movements;
CREATE POLICY stock_movements_tenant_isolation ON inventory.stock_movements
  USING (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  )
  WITH CHECK (
    tenant_id = COALESCE(
      (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
      (auth.jwt() ->> 'tenant_id')::uuid
    )
  );
