-- Adds inventory.generate_variant_combos(text[], jsonb): the cartesian-product
-- helper that rpc_wizard_create_item calls to expand variant dimensions/options
-- into concrete variant rows. It was referenced by the wizard but never defined,
-- so creating an item WITH variants failed with
-- "function inventory.generate_variant_combos(text[], jsonb) does not exist".
--
-- Input:  p_dims    = ['Size','Color']
--         p_options = {"Size":["S","M","L"],"Color":["Red","Blue"]}  (values may
--                     also be objects {value,label}).
-- Output: a jsonb array of combos, each:
--         { "attributes": {"Size":"S","Color":"Red"},
--           "label": "S / Red",
--           "sku_suffix": "S-RED" }

CREATE OR REPLACE FUNCTION inventory.generate_variant_combos(p_dims text[], p_options jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'inventory','public'
AS $$
DECLARE
  v_acc jsonb := jsonb_build_array(jsonb_build_object('attributes','{}'::jsonb,'vals','[]'::jsonb));
  v_next jsonb;
  v_dim text;
  v_combo jsonb;
  v_opt jsonb;
  v_optval text;
  v_optlabel text;
  v_parts jsonb;
  v_label text;
  v_suffix text;
BEGIN
  IF p_dims IS NULL OR array_length(p_dims,1) IS NULL OR p_options IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Build the cartesian product across dimensions (in dimension order).
  FOREACH v_dim IN ARRAY p_dims LOOP
    IF NOT (p_options ? v_dim) OR jsonb_typeof(p_options->v_dim) <> 'array'
       OR jsonb_array_length(p_options->v_dim) = 0 THEN
      CONTINUE; -- dimension with no options: skip it
    END IF;
    v_next := '[]'::jsonb;
    FOR v_combo IN SELECT value FROM jsonb_array_elements(v_acc) LOOP
      FOR v_opt IN SELECT value FROM jsonb_array_elements(p_options->v_dim) LOOP
        v_optval   := COALESCE(v_opt->>'value', v_opt #>> '{}');
        v_optlabel := COALESCE(v_opt->>'label', v_opt #>> '{}');
        v_next := v_next || jsonb_build_array(jsonb_build_object(
          'attributes', (v_combo->'attributes') || jsonb_build_object(v_dim, v_optval),
          'vals', (v_combo->'vals') || jsonb_build_array(jsonb_build_object('v', v_optval, 'l', v_optlabel))
        ));
      END LOOP;
    END LOOP;
    v_acc := v_next;
  END LOOP;

  -- No dimension actually expanded → no variants.
  IF jsonb_array_length(v_acc) = 1 AND (v_acc->0->'vals') = '[]'::jsonb THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Derive label ("S / Red") and sku_suffix ("S-RED") for each combo.
  v_next := '[]'::jsonb;
  FOR v_combo IN SELECT value FROM jsonb_array_elements(v_acc) LOOP
    v_parts := v_combo->'vals';
    SELECT string_agg(elem->>'l', ' / ' ORDER BY ord),
           string_agg(regexp_replace(upper(elem->>'v'), '[^A-Z0-9]+', '', 'g'), '-' ORDER BY ord)
      INTO v_label, v_suffix
      FROM jsonb_array_elements(v_parts) WITH ORDINALITY AS t(elem, ord);
    v_next := v_next || jsonb_build_array(jsonb_build_object(
      'attributes', v_combo->'attributes',
      'label', COALESCE(v_label, ''),
      'sku_suffix', COALESCE(NULLIF(v_suffix, ''), 'VAR')
    ));
  END LOOP;

  RETURN v_next;
END;
$$;

ALTER FUNCTION inventory.generate_variant_combos(text[], jsonb) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION inventory.generate_variant_combos(text[], jsonb) TO authenticated, service_role;
