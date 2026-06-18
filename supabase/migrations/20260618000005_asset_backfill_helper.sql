-- One-time backfill helper used by scripts/backfill-fleet-assets.mjs to mirror
-- existing Fleet vehicles/equipment into inventory.assets in chunks. Loops the
-- per-row apply RPC and returns the (fleet_asset_id, inventory_asset_id) pairs
-- so the caller can set the reverse link on the Fleet side. Kept as a permanent
-- utility for future re-syncs/reconciliation.

CREATE OR REPLACE FUNCTION inventory.rpc_bulk_apply_fleet_assets(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'inventory','public'
AS $$
DECLARE r jsonb; v_inv uuid; v_pairs jsonb := '[]'::jsonb;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_inv := inventory.rpc_apply_fleet_asset_sync(
      (r->>'tn')::uuid, (r->>'id')::uuid, 'upsert',
      r->>'t', r->>'n', r->>'s', r->>'v', r->>'u', r->>'st',
      'fleet-backfill:'||(r->>'id'));
    IF v_inv IS NOT NULL THEN
      v_pairs := v_pairs || jsonb_build_array(jsonb_build_array(r->>'id', v_inv::text));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('applied', jsonb_array_length(v_pairs), 'pairs', v_pairs);
END; $$;

GRANT EXECUTE ON FUNCTION inventory.rpc_bulk_apply_fleet_assets(jsonb) TO service_role;
