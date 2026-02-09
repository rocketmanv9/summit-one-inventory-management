-- Guard audit field updates when auth.uid() is not a Supabase user

CREATE OR REPLACE FUNCTION inventory.set_audit_fields() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid;
  v_uid_exists boolean;
BEGIN
  v_uid := auth.uid();
  v_uid_exists := v_uid IS NOT NULL AND EXISTS (
    SELECT 1 FROM auth.users WHERE id = v_uid
  );

  IF TG_OP = 'INSERT' THEN
    IF v_uid_exists THEN
      NEW.created_by = v_uid;
      NEW.updated_by = v_uid;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF v_uid_exists THEN
      NEW.updated_by = v_uid;
    END IF;

    IF OLD.created_by IS NOT NULL THEN
      NEW.created_by = OLD.created_by;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
