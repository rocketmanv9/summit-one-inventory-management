-- ============================================================================
-- Migration: deprecate_apparel_tables
-- Description: Marks legacy apparel tables as deprecated in favor of the
--   provisioning schema. Does NOT drop tables — they remain for backward
--   compatibility during migration period.
-- ============================================================================

-- Mark tables as deprecated
COMMENT ON TABLE inventory.apparel_config IS
  'DEPRECATED: Use provisioning.providers + provisioning.provider_item_mappings instead. '
  'Will be removed in a future migration once all tenants have been migrated.';

COMMENT ON TABLE inventory.apparel_orders IS
  'DEPRECATED: Use provisioning.provisioning_requests + provisioning.provisioning_lines instead. '
  'Will be removed in a future migration once all tenants have been migrated.';

-- ── Helper function to migrate existing apparel data ────────────────────────
-- This is a one-time migration helper. Call per-tenant as needed.
CREATE OR REPLACE FUNCTION provisioning.migrate_apparel_to_provisioning(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_config    record;
  v_provider  record;
  v_migrated  jsonb := '{"providers": 0, "mappings": 0, "orders": 0}'::jsonb;
BEGIN
  -- 1. Migrate apparel_config → providers (as internal_warehouse or print_on_demand)
  SELECT * INTO v_config
  FROM inventory.apparel_config
  WHERE tenant_id = p_tenant_id
  LIMIT 1;

  IF v_config IS NULL THEN
    RETURN v_migrated;
  END IF;

  -- Create a Printful provider if printful_product_id is configured
  IF v_config.printful_product_id IS NOT NULL THEN
    INSERT INTO provisioning.providers (
      tenant_id, provider_key, display_name, provider_type,
      config, capabilities, priority, is_active
    )
    VALUES (
      p_tenant_id,
      'printful-legacy',
      'Printful (migrated from apparel)',
      'print_on_demand',
      jsonb_build_object(
        'printful_product_id', v_config.printful_product_id,
        'shipping_address', v_config.shipping_address
      ),
      '["apparel"]'::jsonb,
      100,
      v_config.enabled
    )
    ON CONFLICT (tenant_id, provider_key) DO NOTHING
    RETURNING * INTO v_provider;

    IF v_provider IS NOT NULL THEN
      v_migrated := jsonb_set(v_migrated, '{providers}', '1');

      -- 2. Migrate size_variant_map → provider_item_mappings
      IF v_config.size_variant_map IS NOT NULL THEN
        INSERT INTO provisioning.provider_item_mappings (
          tenant_id, provider_id, catalog_item_id,
          external_product_id, external_variant_id, metadata
        )
        SELECT
          p_tenant_id,
          v_provider.id,
          (value->>'catalog_item_id')::uuid,
          v_config.printful_product_id::text,
          value->>'variant_id',
          jsonb_build_object('size', key, 'migrated_from', 'apparel_config')
        FROM jsonb_each(v_config.size_variant_map)
        WHERE value->>'catalog_item_id' IS NOT NULL
        ON CONFLICT (tenant_id, provider_id, catalog_item_id) DO NOTHING;

        v_migrated := jsonb_set(
          v_migrated, '{mappings}',
          to_jsonb((SELECT count(*) FROM jsonb_each(v_config.size_variant_map)))
        );
      END IF;
    END IF;
  END IF;

  -- 3. Migrate apparel_orders → provisioning_requests + provisioning_lines
  -- (informational only — does not create full provisioning requests,
  --  just records them in history for audit trail)
  INSERT INTO provisioning.provisioning_history (
    tenant_id, action, actor_system, details
  )
  SELECT
    p_tenant_id,
    'legacy_order_migrated',
    'migrate_apparel_to_provisioning',
    jsonb_build_object(
      'legacy_order_id', ao.id,
      'status', ao.status,
      'items', ao.items,
      'printful_order_id', ao.printful_order_id,
      'created_at', ao.created_at
    )
  FROM inventory.apparel_orders ao
  WHERE ao.tenant_id = p_tenant_id;

  v_migrated := jsonb_set(
    v_migrated, '{orders}',
    to_jsonb((SELECT count(*) FROM inventory.apparel_orders WHERE tenant_id = p_tenant_id))
  );

  RETURN v_migrated;
END;
$$;
