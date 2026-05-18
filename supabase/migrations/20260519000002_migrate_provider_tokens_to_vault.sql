-- Migrate existing plaintext provider tokens to Supabase Vault.
-- For each provider row where config->>'api_token_ref' does NOT start with 'provider-secret-',
-- store the token in vault and update config to reference it.

DO $$
DECLARE
  r RECORD;
  v_secret_name TEXT;
  v_token TEXT;
  v_secret_id UUID;
BEGIN
  FOR r IN
    SELECT id, tenant_id, config
    FROM provisioning.providers
    WHERE config->>'api_token_ref' IS NOT NULL
      AND config->>'api_token_ref' != ''
      AND NOT (config->>'api_token_ref' LIKE 'provider-secret-%')
  LOOP
    v_token := r.config->>'api_token_ref';
    v_secret_name := 'provider-secret-' || r.tenant_id || '-' || r.id;

    -- Store in vault
    SELECT vault.create_secret(v_token, v_secret_name) INTO v_secret_id;

    -- Update config to reference the vault secret name
    UPDATE provisioning.providers
    SET config = jsonb_set(config, '{api_token_ref}', to_jsonb(v_secret_name))
    WHERE id = r.id;
  END LOOP;
END;
$$;
