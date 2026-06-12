-- Schema-drift audit burn-down: 42 lint errors + 10 risky patterns -> 0.
-- Consolidates the five stage hotfix migrations (audit_burndown_drops,
-- _inplace, _fixes, _round2, _round3) applied 2026-06-12. The DO blocks
-- rewrite functions in place via pg_get_functiondef + replace, so re-running
-- against an already-fixed database is a no-op.
--
-- DROPPED (dead: unused by app code, other functions, and pg_cron):
--   test scaffolding (create_test_item/_location, setup_test_scenario),
--   legacy v1 receive chain (rpc_inv_receive, rpc_create_receipt),
--   generate_reorder_pos stub, expenses feature stubs
--   (rpc_match_expense_to_po, auto_match_expenses_on_receipt + trigger),
--   update_event_catalog_item, expire_old_reservations,
--   verify_quantity_integrity, detect_movements_since_snapshot,
--   rfid bulk-session RPCs (broken at every layer; never worked),
--   the legacy 6-arg rpc_inv_cycle_count_start overload (called a
--   publish_event signature that doesn't exist; ends overload ambiguity).
--
-- FIXED:
--   * all root-only auth.jwt()->>'tenant_id' reads -> COALESCE app_metadata
--   * ensure_local_user_flexible rewritten with to_jsonb(NEW) (12 findings)
--   * rpc_issue_inventory / rpc_reverse_receipt_from_inventory:
--     inventory_events real schema (payload jsonb, verb event_type) AND
--     removed direct stock_balances writes (double-count vs the trigger)
--   * rpc_inv_cycle_count_start: ci.category_id (item_category_id never existed)
--   * record_receipt_vendor_event: date-date is already an integer (extract crash)
--   * emit_cycle_count_event: NEW.scheduled_for (count_date never existed)
--   * emit_abc_classification_event / emit_reorder_alert_event: outbox PK is id
--   * emit_stock_threshold_event: par levels have max_qty, not reorder_qty
--   * get_cycle_count_suggestions: removed invalid ORDER BY+LIMIT inside MAX()
--   * get_ledger_with_running_balance: source_ref_id::text (declared text)
--   * auto_create_draft_po: po_number_sequences real columns
--     (current_year/current_sequence) + purchase_orders.created_by_user_id
--   * rpc_claim_device: qualified ambiguous role/name/device_id references
--   * rpc_hybrid_search / rpc_resolve_entity_by_vector: search_path gains
--     extensions so the vector <=> operator resolves
--
-- Verified: rpc_schema_drift_audit() returns 0/0, and the receiving E2E
-- (synthetic PO -> receipt -> +2 stock, fully_received) still passes.

-- ── 1. Drops ────────────────────────────────────────────────────────────────
DO $$
DECLARE r record; t record;
BEGIN
  FOR t IN
    SELECT tgname, tgrelid::regclass AS rel
    FROM pg_trigger tr JOIN pg_proc p ON p.oid = tr.tgfoid
    WHERE p.proname = 'auto_match_expenses_on_receipt' AND NOT tr.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', t.tgname, t.rel);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE (n.nspname, p.proname) IN (
      ('inventory','create_test_item'),('inventory','create_test_location'),
      ('inventory','setup_test_scenario'),('inventory','rpc_inv_receive'),
      ('inventory','expire_old_reservations'),('inventory','verify_quantity_integrity'),
      ('inventory','detect_movements_since_snapshot'),
      ('supply_chain','rpc_create_receipt'),('supply_chain','generate_reorder_pos'),
      ('supply_chain','rpc_match_expense_to_po'),('supply_chain','auto_match_expenses_on_receipt'),
      ('public','update_event_catalog_item'),
      ('public','rfid_add_tag_to_bulk_session'),('public','rfid_retire_tag'),
      ('public','rfid_start_bulk_assignment_session')
    )
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS inventory.rpc_inv_cycle_count_start(uuid,uuid,text,uuid[],uuid,text);

-- ── 2. JWT claim-path + mechanical in-place fixes ───────────────────────────
DO $$
DECLARE r record; v_def text;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('inventory','supply_chain','public') AND p.prokind = 'f'
      AND (p.prosrc LIKE '%auth.jwt() ->> ''tenant_id''%' OR p.prosrc LIKE '%auth.jwt()->>''tenant_id''%')
      AND p.prosrc NOT LIKE '%app_metadata%'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_def := replace(v_def, '(auth.jwt() ->> ''tenant_id'')::UUID',
      'COALESCE((auth.jwt() -> ''app_metadata'' ->> ''tenant_id'')::UUID, (auth.jwt() ->> ''tenant_id'')::UUID)');
    v_def := replace(v_def, '(auth.jwt() ->> ''tenant_id'')::uuid',
      'COALESCE((auth.jwt() -> ''app_metadata'' ->> ''tenant_id'')::uuid, (auth.jwt() ->> ''tenant_id'')::uuid)');
    v_def := replace(v_def, '(auth.jwt()->>''tenant_id'')::UUID',
      'COALESCE((auth.jwt() -> ''app_metadata'' ->> ''tenant_id'')::UUID, (auth.jwt()->>''tenant_id'')::UUID)');
    v_def := replace(v_def, '(auth.jwt()->>''tenant_id'')::uuid',
      'COALESCE((auth.jwt() -> ''app_metadata'' ->> ''tenant_id'')::uuid, (auth.jwt()->>''tenant_id'')::uuid)');
    EXECUTE v_def;
  END LOOP;

  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'inventory' AND p.proname = 'rpc_inv_cycle_count_start'
  LOOP
    EXECUTE replace(pg_get_functiondef(r.oid), 'ci.item_category_id', 'ci.category_id');
  END LOOP;

  FOR r IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'supply_chain' AND p.proname = 'record_receipt_vendor_event'
  LOOP
    EXECUTE replace(pg_get_functiondef(r.oid),
      'EXTRACT(DAY FROM NEW.received_at::date - v_expected_date)',
      '(NEW.received_at::date - v_expected_date)');
  END LOOP;
END $$;

ALTER FUNCTION inventory.rpc_hybrid_search(text,vector,uuid,text[],integer,double precision,double precision)
  SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions';
ALTER FUNCTION inventory.rpc_resolve_entity_by_vector(vector,uuid,text,integer,double precision)
  SET search_path TO 'inventory', 'supply_chain', 'public', 'extensions';

-- ── 3. ensure_local_user_flexible: static field access via to_jsonb ─────────
CREATE OR REPLACE FUNCTION public.ensure_local_user_flexible()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_rec jsonb := to_jsonb(NEW);
  v_user_id UUID;
  v_tenant_id UUID;
BEGIN
  v_user_id := COALESCE(
    (v_rec->>'created_by')::uuid,
    (v_rec->>'updated_by')::uuid,
    (v_rec->>'actor_user_id')::uuid,
    (v_rec->>'user_id')::uuid
  );
  v_tenant_id := (v_rec->>'tenant_id')::uuid;

  IF v_user_id IS NOT NULL AND v_tenant_id IS NOT NULL THEN
    INSERT INTO public.local_users (user_id, tenant_id, name, role)
    VALUES (v_user_id, v_tenant_id, 'Pending Sync', 'member')
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 4. Structural + qualification fixes ─────────────────────────────────────
DO $do$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='inventory' AND p.proname='rpc_issue_inventory'));
  v_def := regexp_replace(v_def, 'INSERT INTO inventory\.inventory_events[^;]+;', $rep$INSERT INTO inventory.inventory_events (
      tenant_id, event_type, occurred_at, actor_user_id, source_system, last_event_id, payload
    ) VALUES (
      v_tenant_id, 'issue', NOW(),
      (auth.jwt() ->> 'user_id')::UUID,
      'inventory.rpc_issue_inventory', v_event_id,
      jsonb_build_object(
        'catalog_item_id', (v_item->>'catalog_item_id')::UUID,
        'location_id', p_location_id,
        'quantity_delta', -(v_item->>'qty_issued')::NUMERIC,
        'issued_to_type', p_issued_to_type,
        'issued_to_ref', p_issued_to_ref,
        'reason', p_reason
      )
    );$rep$);
  v_def := regexp_replace(v_def, 'INSERT INTO inventory\.stock_balances[^;]+;', '-- stock_balances is trigger-maintained from stock_movements');
  v_def := regexp_replace(v_def, 'UPDATE inventory\.stock_balances[^;]+;', '-- stock_balances is trigger-maintained from stock_movements', 'g');
  EXECUTE v_def;

  v_def := pg_get_functiondef((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='supply_chain' AND p.proname='rpc_reverse_receipt_from_inventory'));
  v_def := regexp_replace(v_def, 'INSERT INTO inventory\.inventory_events[^;]+;', $rep$INSERT INTO inventory.inventory_events (
      tenant_id, event_type, occurred_at, actor_user_id, source_system, last_event_id, payload
    ) VALUES (
      v_tenant_id, 'adjust', NOW(), p_actor_user_id,
      'supply_chain.rpc_reverse_receipt_from_inventory', v_event_id,
      jsonb_build_object(
        'catalog_item_id', v_line.catalog_item_id,
        'location_id', v_receipt.location_id,
        'quantity_delta', -v_line.qty_received,
        'reason', 'receipt_reversal',
        'original_receipt_id', p_receipt_id,
        'original_receipt_number', v_receipt.receipt_number,
        'reversal_reason', p_reason,
        'correlation_id', p_receipt_id
      )
    );$rep$);
  v_def := regexp_replace(v_def, 'INSERT INTO inventory\.stock_balances[^;]+;', '-- stock_balances is trigger-maintained from stock_movements');
  v_def := regexp_replace(v_def, 'UPDATE inventory\.stock_balances[^;]+;', '-- stock_balances is trigger-maintained from stock_movements', 'g');
  EXECUTE v_def;

  v_def := pg_get_functiondef((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='rpc_claim_device'));
  v_def := replace(v_def, 'role = COALESCE(p_role, role)', 'role = COALESCE(p_role, rfid_devices.role)');
  v_def := replace(v_def, 'name = COALESCE(p_device_name, name)', 'name = COALESCE(p_device_name, rfid_devices.name)');
  v_def := replace(v_def, 'WHERE device_id = v_device.id', 'WHERE rfid_device_configs.device_id = v_device.id');
  EXECUTE v_def;

  v_def := pg_get_functiondef((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='inventory' AND p.proname='rpc_calculate_abc_classification'));
  v_def := regexp_replace(v_def, 'AND sm\.movement_state = ''confirmed''', '');
  EXECUTE v_def;

  v_def := pg_get_functiondef((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='inventory' AND p.proname='emit_stock_threshold_event'));
  v_def := replace(v_def, 'v_par_level.reorder_qty', 'v_par_level.max_qty');
  EXECUTE v_def;

  v_def := pg_get_functiondef((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='inventory' AND p.proname='emit_abc_classification_event'));
  EXECUTE replace(v_def, 'event_id,', 'id,');
  v_def := pg_get_functiondef((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='inventory' AND p.proname='emit_reorder_alert_event'));
  EXECUTE replace(v_def, 'event_id,', 'id,');

  v_def := pg_get_functiondef((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='inventory' AND p.proname='emit_cycle_count_event'));
  EXECUTE replace(v_def, 'NEW.count_date', 'NEW.scheduled_for');

  v_def := pg_get_functiondef((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='inventory' AND p.proname='get_cycle_count_suggestions'));
  EXECUTE regexp_replace(v_def, 'ORDER BY cc\.completed_at DESC\s+LIMIT 1', '', 'g');

  v_def := pg_get_functiondef((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='inventory' AND p.proname='get_ledger_with_running_balance'));
  EXECUTE replace(v_def, 'sm.source_ref_id,', 'sm.source_ref_id::text,');

  v_def := pg_get_functiondef((SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='inventory' AND p.proname='auto_create_draft_po'));
  v_def := replace(v_def,
    'SET next_number = next_number + 1 WHERE tenant_id = p_tenant_id RETURNING next_number - 1 INTO v_next_num',
    'SET current_sequence = current_sequence + 1 WHERE tenant_id = p_tenant_id RETURNING current_sequence INTO v_next_num');
  v_def := replace(v_def,
    '(tenant_id, next_number, prefix) VALUES (p_tenant_id, 2, ''PO'') RETURNING next_number - 1 INTO v_next_num',
    '(tenant_id, current_year, current_sequence) VALUES (p_tenant_id, EXTRACT(YEAR FROM now())::int, 1) RETURNING current_sequence INTO v_next_num');
  v_def := regexp_replace(v_def, '\mcreated_by\M', 'created_by_user_id', 'g');
  EXECUTE v_def;
END $do$;
