-- Create tenant-specific settings table for purchase order configuration
-- This allows each tenant to customize PO numbering and auto-approval rules

CREATE TABLE IF NOT EXISTS supply_chain.tenant_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  
  -- PO Number Format Configuration
  po_number_format TEXT NOT NULL DEFAULT 'sequential-year', -- 'sequential-year', 'sequential', 'timestamp', 'custom'
  po_number_prefix TEXT, -- Optional prefix (e.g., "PO", "ORDER")
  po_number_current_seq INTEGER DEFAULT 0, -- Current sequence number for sequential formats
  po_number_custom_template TEXT, -- Custom template for advanced users (e.g., "{YEAR}-{TENANT}-{SEQ:4}")
  
  -- Auto-Approval Configuration
  auto_approve_enabled BOOLEAN DEFAULT false,
  auto_approve_limit NUMERIC(12,2), -- Maximum total $ for auto-approval
  
  -- Audit fields
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID, -- User who last updated settings
  
  -- Ensure one settings record per tenant
  CONSTRAINT tenant_settings_unique_tenant UNIQUE(tenant_id)
);

-- Create index for faster tenant lookups
CREATE INDEX idx_tenant_settings_tenant_id ON supply_chain.tenant_settings(tenant_id);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON supply_chain.tenant_settings TO service_role;
GRANT SELECT ON supply_chain.tenant_settings TO authenticated;

-- Create function to get or create default settings for a tenant
CREATE OR REPLACE FUNCTION supply_chain.get_or_create_tenant_settings(p_tenant_id UUID)
RETURNS supply_chain.tenant_settings
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_settings supply_chain.tenant_settings;
BEGIN
  -- Try to get existing settings
  SELECT * INTO v_settings
  FROM supply_chain.tenant_settings
  WHERE tenant_id = p_tenant_id;
  
  -- If not found, create default settings
  IF NOT FOUND THEN
    INSERT INTO supply_chain.tenant_settings (
      tenant_id,
      po_number_format,
      po_number_prefix,
      po_number_current_seq,
      auto_approve_enabled,
      auto_approve_limit
    ) VALUES (
      p_tenant_id,
      'sequential-year', -- Default to year-based sequential (26-0001)
      null, -- No prefix by default
      0,
      false, -- Auto-approve disabled by default
      null
    )
    RETURNING * INTO v_settings;
  END IF;
  
  RETURN v_settings;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION supply_chain.get_or_create_tenant_settings(UUID) TO service_role;

-- Add comment
COMMENT ON TABLE supply_chain.tenant_settings IS 'Tenant-specific settings for purchase order numbering and approval rules';
COMMENT ON COLUMN supply_chain.tenant_settings.po_number_format IS 'Format type: sequential-year (26-0001), sequential (0001), timestamp (PO-ABC123), or custom';
COMMENT ON COLUMN supply_chain.tenant_settings.auto_approve_limit IS 'POs under this total amount will be auto-approved if enabled';

-- Log migration
DO $$
BEGIN
  RAISE NOTICE '✓ Created tenant_settings table with PO numbering and auto-approval configuration';
  RAISE NOTICE '✓ Created get_or_create_tenant_settings function';
  RAISE NOTICE '✓ Default format: sequential-year (YY-####)';
END $$;
