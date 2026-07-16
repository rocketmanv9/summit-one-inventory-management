-- Consolidate the three overlapping "how much do I have" tables down to one.
--
-- inventory.stock_balances is the real balance store (maintained by the
-- movement posting pipeline). inventory.inventory_levels was a legacy
-- parallel store (3 stale rows, last touched June '26) that survived only as
-- a per-item+location reorder_point holder, and item_location_par_levels
-- (0 rows ever) was a second, never-used par-level system layered on top.
-- Reorder configuration now lives in exactly one place:
-- catalog_items.reorder_point (item-level, matching how the Inventory page
-- and mv_low_stock_summary already read it).
--
-- Also fixes emit_stock_threshold_event: it previously required an
-- item_location_par_levels row (0 rows -> the stock.low_threshold_reached /
-- stock.out_of_stock events never fired once). It now reads
-- catalog_items.reorder_point and compares the item's tenant-wide on-hand
-- total, so these events fire for real.

-- 1) Preserve any per-location reorder points into the item-level column.
UPDATE inventory.catalog_items ci
SET reorder_point = il.reorder_point
FROM inventory.inventory_levels il
WHERE il.catalog_item_id = ci.id
  AND il.tenant_id = ci.tenant_id
  AND il.reorder_point IS NOT NULL
  AND ci.reorder_point IS NULL;

-- 2) Threshold events from catalog_items.reorder_point (AFTER UPDATE row
--    trigger on stock_balances — the updated row is already visible to the
--    SUM, so total_before is reconstructed from the OLD/NEW delta).
CREATE OR REPLACE FUNCTION inventory.emit_stock_threshold_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions'
AS $function$
DECLARE
  v_reorder_point numeric;
  v_total_after numeric;
  v_total_before numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.qty_on_hand < OLD.qty_on_hand THEN
    SELECT ci.reorder_point INTO v_reorder_point
    FROM inventory.catalog_items ci
    WHERE ci.id = NEW.catalog_item_id AND ci.tenant_id = NEW.tenant_id;

    IF v_reorder_point IS NOT NULL THEN
      SELECT COALESCE(SUM(sb.qty_on_hand), 0) INTO v_total_after
      FROM inventory.stock_balances sb
      WHERE sb.catalog_item_id = NEW.catalog_item_id
        AND sb.tenant_id = NEW.tenant_id;
      v_total_before := v_total_after - NEW.qty_on_hand + OLD.qty_on_hand;

      IF v_total_before > v_reorder_point AND v_total_after <= v_reorder_point THEN
        PERFORM public.emit_event(
          p_type => 'stock.low_threshold_reached',
          p_payload => jsonb_build_object(
            'item_id', NEW.catalog_item_id,
            'location_id', NEW.location_id,
            'current_qty', v_total_after,
            'reorder_point', v_reorder_point,
            'tenant_id', NEW.tenant_id,
            'detected_at', NOW()
          ),
          p_tenant_id => NEW.tenant_id,
          p_actor_id => NULL,
          p_trace_id => NULL,
          p_correlation_id => NULL,
          p_aggregate_id => NEW.id
        );
      END IF;
    END IF;

    IF OLD.qty_on_hand > 0 AND NEW.qty_on_hand <= 0 THEN
      PERFORM public.emit_event(
        p_type => 'stock.out_of_stock',
        p_payload => jsonb_build_object(
          'item_id', NEW.catalog_item_id,
          'location_id', NEW.location_id,
          'previous_qty', OLD.qty_on_hand,
          'tenant_id', NEW.tenant_id,
          'occurred_at', NOW()
        ),
        p_tenant_id => NEW.tenant_id,
        p_actor_id => NULL,
        p_trace_id => NULL,
        p_correlation_id => NULL,
        p_aggregate_id => NEW.id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3) rpc_wizard_create_item: identical to the previous version except the
--    duplicate INSERT INTO inventory.inventory_levels is gone —
--    rpc_create_catalog_item already stores p_reorder_point on the item.
CREATE OR REPLACE FUNCTION inventory.rpc_wizard_create_item(p_name text, p_description text DEFAULT NULL::text, p_tracking_mode text DEFAULT 'stock'::text, p_reorder_point numeric DEFAULT NULL::numeric, p_base_sku text DEFAULT NULL::text, p_sku text DEFAULT NULL::text, p_category_id uuid DEFAULT NULL::uuid, p_create_category jsonb DEFAULT NULL::jsonb, p_vendor_id uuid DEFAULT NULL::uuid, p_create_vendor jsonb DEFAULT NULL::jsonb, p_vendor_sku text DEFAULT NULL::text, p_vendor_unit_cost numeric DEFAULT NULL::numeric, p_location_id uuid DEFAULT NULL::uuid, p_create_location jsonb DEFAULT NULL::jsonb, p_initial_qty numeric DEFAULT NULL::numeric, p_initial_cost numeric DEFAULT NULL::numeric, p_barcode text DEFAULT NULL::text, p_create_assets text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_has_variants boolean DEFAULT false, p_variant_dimensions text[] DEFAULT NULL::text[], p_variant_options jsonb DEFAULT NULL::jsonb, p_uom_term_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'inventory', 'supply_chain', 'public'
AS $function$
DECLARE
  v_tenant_id uuid; v_user_id uuid; v_category_id uuid; v_vendor_id uuid; v_location_id uuid;
  v_item_result record; v_item_id uuid; v_item_sku text; v_event_id text;
  v_result jsonb; v_created_entities jsonb := '[]'::jsonb; v_vendor_item_id uuid;
  v_asset_list jsonb; v_asset jsonb; v_asset_id uuid; v_asset_tags text[] := '{}'; v_i integer;
  v_variant_combos jsonb; v_combo jsonb; v_variant_id uuid; v_variant_sku text; v_variant_ids uuid[] := '{}';
BEGIN
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_user_id := (auth.jwt()->> 'user_id')::uuid;
  IF v_user_id IS NULL THEN v_user_id := auth.uid(); END IF;
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key)<>'' THEN
    SELECT ci.id, ci.sku, ci.last_event_id INTO v_item_result FROM inventory.catalog_items ci WHERE ci.tenant_id=v_tenant_id AND ci.last_event_id=p_idempotency_key;
    IF FOUND THEN RETURN jsonb_build_object('success',true,'idempotent_hit',true,'item_id',v_item_result.id,'item_sku',v_item_result.sku,'created_entities','[]'::jsonb); END IF;
  ELSE p_idempotency_key := gen_random_uuid()::text; END IF;
  IF p_name IS NULL OR trim(p_name)='' THEN RAISE EXCEPTION 'Item name is required'; END IF;
  v_category_id := p_category_id;
  IF v_category_id IS NULL AND p_create_category IS NOT NULL THEN
    INSERT INTO inventory.item_categories(tenant_id,name,sku_prefix,sku_mode,parent_category_id,last_event_id) VALUES(v_tenant_id,p_create_category->>'name',p_create_category->>'sku_prefix',COALESCE(p_create_category->>'sku_mode','sequential'),(p_create_category->>'parent_category_id')::uuid,'wiz-cat-'||p_idempotency_key) ON CONFLICT (tenant_id, last_event_id) DO NOTHING RETURNING id INTO v_category_id;
    IF v_category_id IS NULL THEN SELECT id INTO v_category_id FROM inventory.item_categories WHERE tenant_id=v_tenant_id AND last_event_id='wiz-cat-'||p_idempotency_key; END IF;
    v_created_entities := v_created_entities||jsonb_build_object('type','category','id',v_category_id,'name',p_create_category->>'name');
    IF v_category_id IS NOT NULL THEN INSERT INTO inventory.sku_settings(tenant_id,category_id,separator,next_sequence) VALUES(v_tenant_id,v_category_id,'-',1) ON CONFLICT(category_id) DO NOTHING; END IF;
  END IF;
  v_vendor_id := p_vendor_id;
  IF v_vendor_id IS NULL AND p_create_vendor IS NOT NULL THEN
    INSERT INTO supply_chain.vendors(tenant_id,name,code,contact_name,contact_email,contact_phone,payment_terms,lead_time_days,last_event_id) VALUES(v_tenant_id,p_create_vendor->>'name',p_create_vendor->>'code',p_create_vendor->>'contact_name',p_create_vendor->>'contact_email',p_create_vendor->>'contact_phone',COALESCE(p_create_vendor->>'payment_terms','NET30'),(p_create_vendor->>'lead_time_days')::integer,'wiz-ven-'||p_idempotency_key) ON CONFLICT (tenant_id, last_event_id) DO NOTHING RETURNING id INTO v_vendor_id;
    IF v_vendor_id IS NULL THEN SELECT id INTO v_vendor_id FROM supply_chain.vendors WHERE tenant_id=v_tenant_id AND last_event_id='wiz-ven-'||p_idempotency_key; END IF;
    v_created_entities := v_created_entities||jsonb_build_object('type','vendor','id',v_vendor_id,'name',p_create_vendor->>'name');
  END IF;
  v_location_id := p_location_id;
  IF v_location_id IS NULL AND p_create_location IS NOT NULL THEN
    INSERT INTO inventory.locations(tenant_id,name,location_type_id,address,last_event_id) VALUES(v_tenant_id,p_create_location->>'name',(p_create_location->>'location_type_id')::uuid,p_create_location->>'address','wiz-loc-'||p_idempotency_key) ON CONFLICT (tenant_id, last_event_id) DO NOTHING RETURNING id INTO v_location_id;
    IF v_location_id IS NULL THEN SELECT id INTO v_location_id FROM inventory.locations WHERE tenant_id=v_tenant_id AND last_event_id='wiz-loc-'||p_idempotency_key; END IF;
    v_created_entities := v_created_entities||jsonb_build_object('type','location','id',v_location_id,'name',p_create_location->>'name');
  END IF;
  SELECT * INTO v_item_result FROM inventory.rpc_create_catalog_item(p_name:=p_name,p_description:=p_description,p_category_id:=v_category_id,p_tracking_mode:=p_tracking_mode,p_reorder_point:=p_reorder_point,p_base_sku:=p_base_sku,p_sku:=p_sku,p_last_event_id:=p_idempotency_key,p_uom_term_id:=p_uom_term_id);
  v_item_id := v_item_result.id; v_item_sku := v_item_result.sku;
  IF v_vendor_id IS NOT NULL OR p_barcode IS NOT NULL THEN UPDATE inventory.catalog_items SET preferred_vendor_id=COALESCE(v_vendor_id,preferred_vendor_id),barcode=COALESCE(p_barcode,barcode) WHERE id=v_item_id AND tenant_id=v_tenant_id; END IF;
  IF p_has_variants AND p_variant_dimensions IS NOT NULL AND array_length(p_variant_dimensions,1)>0 THEN UPDATE inventory.catalog_items SET is_parent=true,variant_dimensions=to_jsonb(p_variant_dimensions),variant_options=COALESCE(p_variant_options,'{}'::jsonb) WHERE id=v_item_id AND tenant_id=v_tenant_id; END IF;
  v_created_entities := v_created_entities||jsonb_build_object('type','item','id',v_item_id,'sku',v_item_sku,'name',p_name);
  IF v_vendor_id IS NOT NULL THEN
    INSERT INTO supply_chain.vendor_items(tenant_id,vendor_id,catalog_item_id,vendor_sku,unit_cost,is_preferred,last_event_id) VALUES(v_tenant_id,v_vendor_id,v_item_id,COALESCE(p_vendor_sku,v_item_sku),p_vendor_unit_cost,true,'wiz-vi-'||p_idempotency_key) ON CONFLICT (tenant_id, last_event_id) DO NOTHING RETURNING id INTO v_vendor_item_id;
    IF v_vendor_item_id IS NOT NULL THEN v_created_entities := v_created_entities||jsonb_build_object('type','vendor_item','id',v_vendor_item_id); END IF;
  END IF;
  IF v_location_id IS NOT NULL AND p_initial_qty IS NOT NULL AND p_initial_qty>0 THEN
    v_event_id := 'wiz-stk-'||p_idempotency_key;
    INSERT INTO inventory.inventory_events(tenant_id,event_type,occurred_at,actor_user_id,last_event_id,payload) VALUES(v_tenant_id,'adjust',now(),v_user_id,v_event_id,jsonb_build_object('catalog_item_id',v_item_id,'location_id',v_location_id,'reason','initial_stock','old_qty',0,'new_qty',p_initial_qty,'notes','Initial stock set during item wizard creation')) ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
    INSERT INTO inventory.stock_movements(tenant_id,catalog_item_id,location_id,quantity_delta,movement_type,unit_cost,reason,notes,occurred_at,created_by_user_id,last_event_id) VALUES(v_tenant_id,v_item_id,v_location_id,p_initial_qty,'adjusted',p_initial_cost,'initial_stock','Initial stock set during item wizard creation',now(),v_user_id,v_event_id) ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
    v_created_entities := v_created_entities||jsonb_build_object('type','initial_stock','location_id',v_location_id,'quantity',p_initial_qty,'unit_cost',p_initial_cost);
  END IF;
  IF p_create_assets IS NOT NULL AND p_create_assets<>'' THEN
    v_asset_list := p_create_assets::jsonb;
    FOR v_i IN 0..jsonb_array_length(v_asset_list)-1 LOOP
      v_asset := v_asset_list->v_i;
      INSERT INTO inventory.assets(tenant_id,catalog_item_id,asset_tag,serial_number,status,location_id,last_event_id) VALUES(v_tenant_id,v_item_id,v_asset->>'asset_tag',v_asset->>'serial_number','available',v_location_id,'wiz-ast-'||v_i||'-'||p_idempotency_key) ON CONFLICT (tenant_id, asset_tag) DO NOTHING RETURNING id INTO v_asset_id;
      IF v_asset_id IS NOT NULL THEN v_asset_tags := array_append(v_asset_tags,v_asset->>'asset_tag'); END IF;
    END LOOP;
    IF array_length(v_asset_tags,1)>0 THEN v_created_entities := v_created_entities||jsonb_build_object('type','assets','count',array_length(v_asset_tags,1),'tags',to_jsonb(v_asset_tags)); END IF;
  END IF;
  IF p_has_variants AND p_variant_dimensions IS NOT NULL AND array_length(p_variant_dimensions,1)>0 AND p_variant_options IS NOT NULL AND p_variant_options<>'{}'::jsonb THEN
    v_variant_combos := inventory.generate_variant_combos(p_variant_dimensions,p_variant_options);
    FOR v_i IN 0..jsonb_array_length(v_variant_combos)-1 LOOP
      v_combo := v_variant_combos->v_i; v_variant_sku := v_item_sku||'-'||(v_combo->>'sku_suffix');
      INSERT INTO inventory.catalog_items(tenant_id,name,sku,description,category_id,uom_term_id,tracking_mode,reorder_point,base_sku,parent_item_id,variant_attributes,is_parent,last_event_id) VALUES(v_tenant_id,p_name||' - '||(v_combo->>'label'),v_variant_sku,p_description,v_category_id,p_uom_term_id,p_tracking_mode,p_reorder_point,v_combo->>'sku_suffix',v_item_id,v_combo->'attributes',false,'wiz-var-'||v_i||'-'||p_idempotency_key) ON CONFLICT (tenant_id, last_event_id) DO NOTHING RETURNING catalog_items.id INTO v_variant_id;
      IF v_variant_id IS NULL THEN SELECT ci.id INTO v_variant_id FROM inventory.catalog_items ci WHERE ci.tenant_id=v_tenant_id AND ci.last_event_id='wiz-var-'||v_i||'-'||p_idempotency_key; END IF;
      IF v_variant_id IS NOT NULL THEN v_variant_ids := array_append(v_variant_ids,v_variant_id); END IF;
    END LOOP;
    IF array_length(v_variant_ids,1)>0 THEN v_created_entities := v_created_entities||jsonb_build_object('type','variants','count',array_length(v_variant_ids,1),'variant_ids',to_jsonb(v_variant_ids)); END IF;
  END IF;
  RETURN jsonb_build_object('success',true,'idempotent_hit',false,'item_id',v_item_id,'item_sku',v_item_sku,'item_barcode',p_barcode,'category_id',v_category_id,'vendor_id',v_vendor_id,'location_id',v_location_id,'created_asset_tags',to_jsonb(v_asset_tags),'created_entities',v_created_entities);
END;
$function$;

-- 4) v_items_needing_reorder loses the par-level override (same columns,
--    reorder config now comes from catalog_items alone).
CREATE OR REPLACE VIEW inventory.v_items_needing_reorder AS
SELECT sb.tenant_id,
    sb.catalog_item_id,
    sb.location_id,
    ci.sku,
    ci.name AS item_name,
    l.name AS location_name,
    sb.qty_on_hand,
    sb.qty_reserved,
    sb.qty_available,
    COALESCE(oo.qty_on_order, 0::numeric) AS qty_on_order,
    sb.qty_available + COALESCE(oo.qty_on_order, 0::numeric) AS inventory_position,
    COALESCE(ci.reorder_point, 0::numeric) AS reorder_point,
    COALESCE(ci.min_stock_level, 0::numeric) AS min_stock_level,
    COALESCE(ci.target_level, 0::numeric) AS target_level,
    COALESCE(ci.reorder_qty, 0::numeric) AS reorder_qty,
    ci.lead_time_days,
    ci.preferred_vendor_id,
        CASE
            WHEN sb.qty_available <= 0::numeric THEN 'critical'::text
            WHEN (sb.qty_available + COALESCE(oo.qty_on_order, 0::numeric)) <= COALESCE(ci.min_stock_level, 0::numeric) THEN 'high'::text
            WHEN (sb.qty_available + COALESCE(oo.qty_on_order, 0::numeric)) <= COALESCE(ci.reorder_point, 0::numeric) THEN 'medium'::text
            ELSE 'low'::text
        END AS alert_priority,
        CASE
            WHEN sb.qty_available <= 0::numeric THEN 'stockout'::text
            WHEN (sb.qty_available + COALESCE(oo.qty_on_order, 0::numeric)) <= COALESCE(ci.min_stock_level, 0::numeric) THEN 'below_min'::text
            WHEN (sb.qty_available + COALESCE(oo.qty_on_order, 0::numeric)) <= COALESCE(ci.reorder_point, 0::numeric) THEN 'below_reorder'::text
            ELSE NULL::text
        END AS alert_type,
    GREATEST(COALESCE(ci.target_level, 0::numeric) - (sb.qty_available + COALESCE(oo.qty_on_order, 0::numeric)), COALESCE(ci.reorder_qty, 0::numeric)) AS suggested_order_qty
   FROM inventory.stock_balances sb
     JOIN inventory.catalog_items ci ON ci.id = sb.catalog_item_id
     JOIN inventory.locations l ON l.id = sb.location_id
     LEFT JOIN inventory.v_on_order_by_item_location oo ON oo.catalog_item_id = sb.catalog_item_id AND oo.location_id = sb.location_id
  WHERE ci.active = true AND (ci.tracking_mode = ANY (ARRAY['stock'::text, 'both'::text])) AND ((sb.qty_available + COALESCE(oo.qty_on_order, 0::numeric)) <= COALESCE(ci.reorder_point, 0::numeric) OR sb.qty_available <= 0::numeric);

-- 5) Drop the redundant tables and their views.
DROP VIEW IF EXISTS inventory.v_item_global_stock;
DROP VIEW IF EXISTS inventory.v_items_below_par;
DROP TABLE IF EXISTS inventory.inventory_levels CASCADE;
DROP TABLE IF EXISTS inventory.item_location_par_levels CASCADE;
