-- Skip vendor code validation when reactivating (restoring) a vendor,
-- same as we already do for deactivation.
CREATE OR REPLACE FUNCTION supply_chain.enforce_vendor_code_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO supply_chain, public
AS $$
DECLARE
  v_settings supply_chain.tenant_settings;
  v_code TEXT;
  v_has_usage BOOLEAN;
BEGIN
  SELECT * INTO v_settings
  FROM supply_chain.tenant_settings
  WHERE tenant_id = NEW.tenant_id;

  IF NOT FOUND THEN
    v_settings := supply_chain.get_or_create_tenant_settings(NEW.tenant_id);
  END IF;

  -- Skip validation when deactivating OR reactivating a vendor
  IF TG_OP = 'UPDATE' AND NEW.active IS DISTINCT FROM OLD.active THEN
    RETURN NEW;
  END IF;

  v_code := NULLIF(BTRIM(NEW.code), '');

  -- Auto-generate if configured and code not provided
  IF v_code IS NULL THEN
    IF v_settings.vendor_code_strategy IN ('sequential', 'hybrid') THEN
      v_code := supply_chain.generate_vendor_code(NEW.tenant_id);
    ELSIF v_settings.vendor_code_required THEN
      RAISE EXCEPTION 'Vendor code is required by tenant settings';
    ELSE
      NEW.code := NULL;
      RETURN NEW;
    END IF;
  END IF;

  -- Normalize case
  IF v_settings.vendor_code_case = 'upper' THEN
    v_code := UPPER(v_code);
  ELSIF v_settings.vendor_code_case = 'lower' THEN
    v_code := LOWER(v_code);
  END IF;

  -- Validate length
  IF v_settings.vendor_code_min_length IS NOT NULL AND LENGTH(v_code) < v_settings.vendor_code_min_length THEN
    RAISE EXCEPTION 'Vendor code must be at least % characters', v_settings.vendor_code_min_length;
  END IF;
  IF v_settings.vendor_code_max_length IS NOT NULL AND LENGTH(v_code) > v_settings.vendor_code_max_length THEN
    RAISE EXCEPTION 'Vendor code must be at most % characters', v_settings.vendor_code_max_length;
  END IF;

  -- Validate prefix/suffix
  IF v_settings.vendor_code_prefix IS NOT NULL AND v_settings.vendor_code_prefix <> '' THEN
    IF v_code NOT LIKE v_settings.vendor_code_prefix || '%' THEN
      RAISE EXCEPTION 'Vendor code must start with %', v_settings.vendor_code_prefix;
    END IF;
  END IF;

  IF v_settings.vendor_code_suffix IS NOT NULL AND v_settings.vendor_code_suffix <> '' THEN
    IF v_code NOT LIKE '%' || v_settings.vendor_code_suffix THEN
      RAISE EXCEPTION 'Vendor code must end with %', v_settings.vendor_code_suffix;
    END IF;
  END IF;

  -- Validate allowed chars
  IF v_settings.vendor_code_allowed_chars IS NOT NULL AND v_settings.vendor_code_allowed_chars <> '' THEN
    IF v_code !~ ('^[' || v_settings.vendor_code_allowed_chars || ']+$') THEN
      RAISE EXCEPTION 'Vendor code contains invalid characters';
    END IF;
  END IF;

  -- Validate regex
  IF v_settings.vendor_code_regex IS NOT NULL AND v_settings.vendor_code_regex <> '' THEN
    IF v_code !~ v_settings.vendor_code_regex THEN
      RAISE EXCEPTION 'Vendor code does not match required format';
    END IF;
  END IF;

  -- Prevent unauthorized edits
  IF TG_OP = 'UPDATE' AND NEW.code IS DISTINCT FROM OLD.code THEN
    IF v_settings.vendor_code_user_editable IS FALSE THEN
      RAISE EXCEPTION 'Vendor code editing is disabled by tenant settings';
    END IF;

    IF v_settings.vendor_code_immutable_after_use THEN
      SELECT EXISTS (
        SELECT 1 FROM supply_chain.purchase_orders po WHERE po.vendor_id = NEW.id
      ) OR EXISTS (
        SELECT 1 FROM supply_chain.receipts r WHERE r.vendor_id = NEW.id
      ) INTO v_has_usage;

      IF v_has_usage THEN
        RAISE EXCEPTION 'Vendor code cannot be changed after purchase activity exists';
      END IF;
    END IF;
  END IF;

  NEW.code := v_code;
  RETURN NEW;
END;
$$;
