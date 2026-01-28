-- Add per-vendor auto-approve limits to tenant settings
-- This allows tenants to set different approval limits for different vendors

-- Add vendor-specific auto-approve limits (JSONB)
ALTER TABLE supply_chain.tenant_settings 
ADD COLUMN IF NOT EXISTS vendor_auto_approve_limits JSONB DEFAULT '{}'::jsonb;

-- Add comment
COMMENT ON COLUMN supply_chain.tenant_settings.vendor_auto_approve_limits IS 'Per-vendor auto-approve limits as JSON: {"vendor_id": amount}. If set, overrides global limit for that vendor.';

-- Create helper function to get auto-approve limit for a specific vendor
CREATE OR REPLACE FUNCTION supply_chain.get_vendor_auto_approve_limit(
  p_tenant_id UUID,
  p_vendor_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_settings supply_chain.tenant_settings;
  v_vendor_limit NUMERIC;
BEGIN
  -- Get tenant settings
  SELECT * INTO v_settings
  FROM supply_chain.tenant_settings
  WHERE tenant_id = p_tenant_id;
  
  -- If no settings or auto-approve not enabled, return null
  IF NOT FOUND OR NOT v_settings.auto_approve_enabled THEN
    RETURN NULL;
  END IF;
  
  -- Check for vendor-specific limit first
  IF v_settings.vendor_auto_approve_limits IS NOT NULL THEN
    v_vendor_limit := (v_settings.vendor_auto_approve_limits->>p_vendor_id::text)::numeric;
    
    IF v_vendor_limit IS NOT NULL THEN
      RETURN v_vendor_limit;
    END IF;
  END IF;
  
  -- Fall back to global limit
  RETURN v_settings.auto_approve_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION supply_chain.get_vendor_auto_approve_limit(UUID, UUID) TO service_role;

-- Log migration
DO $$
BEGIN
  RAISE NOTICE '✓ Added vendor_auto_approve_limits column to tenant_settings';
  RAISE NOTICE '✓ Created get_vendor_auto_approve_limit function';
  RAISE NOTICE '✓ Vendors can now have individual auto-approve limits';
END $$;
