-- GV PROJECT function (NOT the inventory DB) — applied to the GV Supabase
-- projects via MCP/SQL editor, NOT through supabase/migrations (which deploy to
-- the inventory project). Kept here for reproducibility.
--
-- Why: custom-vendor creation (POST /api/gv/vendors) failed with
-- "new row violates row-level security policy for table vendors". The chassis
-- tenant vendor SDK sets app.current_tenant_id via a separate set_claim request,
-- but GV's PostgREST pools connections, so the follow-up INSERT lands on a
-- connection without the GUC and the tenant-scoped RLS WITH CHECK rejects it.
-- Only the GV anon key is available to the app (no service-role bypass), so the
-- reliable fix is a SECURITY DEFINER RPC that sets context + inserts atomically
-- in one request. Repointed in src/lib/vendors.ts::createCustomVendor.

CREATE OR REPLACE FUNCTION public.rpc_gv_create_vendor(
  p_tenant_id uuid,
  p_name text,
  p_vendor_type_id uuid,
  p_account_number text DEFAULT NULL,
  p_payment_terms text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_tags jsonb DEFAULT '[]'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS public.vendors
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.vendors;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required' USING ERRCODE = '22004';
  END IF;
  INSERT INTO public.vendors(
    tenant_id, name, vendor_type_id, account_number, payment_terms, notes,
    tags, metadata, is_custom, is_active
  ) VALUES (
    p_tenant_id, p_name, p_vendor_type_id, p_account_number, p_payment_terms, p_notes,
    COALESCE(p_tags, '[]'::jsonb), COALESCE(p_metadata, '{}'::jsonb), true, true
  )
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_gv_create_vendor(uuid,text,uuid,text,text,text,jsonb,jsonb) TO anon, authenticated, service_role;
