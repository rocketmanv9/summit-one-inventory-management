-- Refactor supply_chain.rpc_merge_vendor to snapshot the source→target address
-- map into aligned arrays (used via unnest) instead of a session temp table.
-- Rationale:
--   1. plpgsql_check (nightly lint) static-analyzes function bodies and cannot see
--      a runtime `create temp table`, so every later reference to `_addr_map`
--      tripped a false-positive 42P01 "relation does not exist".
--   2. `create temp table _addr_map on commit drop` would also throw
--      "already exists" if the RPC were ever called twice in one transaction.
-- Semantics are identical: the map is still computed exactly once (snapshot),
-- then consumed by the same four statements in the same order.

CREATE OR REPLACE FUNCTION supply_chain.rpc_merge_vendor(p_tenant_id uuid, p_source_vendor_id uuid, p_target_vendor_id uuid, p_last_event_id text)
 RETURNS TABLE(merged_already boolean, items_repointed integer, items_dropped integer, contacts_repointed integer, contacts_dropped integer, addresses_repointed integer, addresses_dropped integer, domains_repointed integer, domains_dropped integer, pos_repointed integer, perf_events_repointed integer, perf_metrics_repointed integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'supply_chain', 'public', 'extensions'
AS $function$
declare
  v_source        supply_chain.vendors%rowtype;
  v_target        supply_chain.vendors%rowtype;
  v_src_addr_ids  uuid[];
  v_tgt_addr_ids  uuid[];
  v_items_rp      int := 0;
  v_items_dp      int := 0;
  v_contacts_rp   int := 0;
  v_contacts_dp   int := 0;
  v_addr_rp       int := 0;
  v_addr_dp       int := 0;
  v_dom_rp        int := 0;
  v_dom_dp        int := 0;
  v_pos_rp        int := 0;
  v_perf_evt_rp   int := 0;
  v_perf_met_rp   int := 0;
  v_rc            int := 0;
begin
  if p_source_vendor_id = p_target_vendor_id then
    raise exception 'Cannot merge a vendor into itself' using errcode = '22023';
  end if;

  select * into v_source from supply_chain.vendors
    where id = p_source_vendor_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Source vendor not found' using errcode = 'no_data_found';
  end if;

  select * into v_target from supply_chain.vendors
    where id = p_target_vendor_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'Target vendor not found' using errcode = 'no_data_found';
  end if;

  if v_source.merged_into_vendor_id = p_target_vendor_id and v_source.active = false then
    return query select true, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0;
    return;
  end if;

  if v_source.merged_into_vendor_id is not null
     and v_source.merged_into_vendor_id <> p_target_vendor_id then
    raise exception 'Source vendor was already merged into a different vendor'
      using errcode = '22023';
  end if;

  if v_target.active = false then
    raise exception 'Cannot merge into an inactive vendor' using errcode = '22023';
  end if;

  -- Snapshot the source→target address map ONCE into aligned arrays.
  -- Identical ORDER BY on both aggregates keeps the two arrays element-aligned.
  select
    coalesce(array_agg(src_addr_id order by src_addr_id), '{}'::uuid[]),
    coalesce(array_agg(tgt_addr_id order by src_addr_id), '{}'::uuid[])
  into v_src_addr_ids, v_tgt_addr_ids
  from (
    select
      sa.id  as src_addr_id,
      ta.id  as tgt_addr_id
    from supply_chain.vendor_addresses sa
    left join lateral (
      select ta.id
      from supply_chain.vendor_addresses ta
      where ta.vendor_id = p_target_vendor_id
        and supply_chain._vendor_norm_street(ta.street1) = supply_chain._vendor_norm_street(sa.street1)
        and supply_chain._vendor_norm_street(sa.street1) <> ''
        and nullif(trim(coalesce(ta.zip,'')),'') is not distinct from nullif(trim(coalesce(sa.zip,'')),'')
      limit 1
    ) ta on true
    where sa.vendor_id = p_source_vendor_id
  ) q;

  delete from supply_chain.vendor_items si
  using unnest(v_src_addr_ids, v_tgt_addr_ids) as m(src_addr_id, tgt_addr_id)
  where si.vendor_id = p_source_vendor_id
    and si.vendor_address_id = m.src_addr_id
    and m.tgt_addr_id is not null
    and exists (
      select 1 from supply_chain.vendor_items ti
      where ti.vendor_id = p_target_vendor_id
        and ti.catalog_item_id = si.catalog_item_id
        and ti.vendor_address_id is not distinct from m.tgt_addr_id
    );
  get diagnostics v_items_dp = row_count;

  update supply_chain.vendor_items si
    set vendor_id = p_target_vendor_id,
        vendor_address_id = m.tgt_addr_id,
        last_event_id = p_last_event_id || ':itemaddr:' || si.id
  from unnest(v_src_addr_ids, v_tgt_addr_ids) as m(src_addr_id, tgt_addr_id)
  where si.vendor_id = p_source_vendor_id
    and si.vendor_address_id = m.src_addr_id
    and m.tgt_addr_id is not null;
  get diagnostics v_items_rp = row_count;

  delete from supply_chain.vendor_addresses sa
  using unnest(v_src_addr_ids, v_tgt_addr_ids) as m(src_addr_id, tgt_addr_id)
  where sa.id = m.src_addr_id and m.tgt_addr_id is not null;
  get diagnostics v_addr_dp = row_count;

  update supply_chain.vendor_addresses sa
    set vendor_id = p_target_vendor_id,
        last_event_id = p_last_event_id || ':addr:' || sa.id
  from unnest(v_src_addr_ids, v_tgt_addr_ids) as m(src_addr_id, tgt_addr_id)
  where sa.id = m.src_addr_id and m.tgt_addr_id is null;
  get diagnostics v_addr_rp = row_count;

  delete from supply_chain.vendor_items si
  where si.vendor_id = p_source_vendor_id
    and exists (
      select 1 from supply_chain.vendor_items ti
      where ti.vendor_id = p_target_vendor_id
        and ti.catalog_item_id = si.catalog_item_id
        and ti.vendor_address_id is not distinct from si.vendor_address_id
    );
  get diagnostics v_rc = row_count;
  v_items_dp := v_items_dp + v_rc;

  update supply_chain.vendor_items si
    set vendor_id = p_target_vendor_id,
        last_event_id = p_last_event_id || ':item:' || si.id
  where si.vendor_id = p_source_vendor_id;
  get diagnostics v_rc = row_count;
  v_items_rp := v_items_rp + v_rc;

  delete from supply_chain.vendor_contacts sc
  where sc.vendor_id = p_source_vendor_id
    and sc.email is not null
    and exists (
      select 1 from supply_chain.vendor_contacts tc
      where tc.vendor_id = p_target_vendor_id
        and lower(tc.email) = lower(sc.email)
    );
  get diagnostics v_contacts_dp = row_count;

  update supply_chain.vendor_contacts sc
    set vendor_id = p_target_vendor_id,
        last_event_id = p_last_event_id || ':contact:' || sc.id
  where sc.vendor_id = p_source_vendor_id;
  get diagnostics v_contacts_rp = row_count;

  delete from supply_chain.vendor_email_domains sd
  where sd.vendor_id = p_source_vendor_id
    and exists (
      select 1 from supply_chain.vendor_email_domains td
      where td.tenant_id = p_tenant_id
        and td.vendor_id = p_target_vendor_id
        and lower(td.domain) = lower(sd.domain)
    );
  get diagnostics v_dom_dp = row_count;

  update supply_chain.vendor_email_domains sd
    set vendor_id = p_target_vendor_id
  where sd.vendor_id = p_source_vendor_id;
  get diagnostics v_dom_rp = row_count;

  update supply_chain.purchase_orders po
    set vendor_id = p_target_vendor_id
  where po.vendor_id = p_source_vendor_id
    and po.tenant_id = p_tenant_id;
  get diagnostics v_pos_rp = row_count;

  update supply_chain.vendor_performance_events pe
    set vendor_id = p_target_vendor_id
  where pe.vendor_id = p_source_vendor_id
    and pe.tenant_id = p_tenant_id;
  get diagnostics v_perf_evt_rp = row_count;

  update supply_chain.vendor_performance_metrics pm
    set vendor_id = p_target_vendor_id
  where pm.vendor_id = p_source_vendor_id
    and pm.tenant_id = p_tenant_id;
  get diagnostics v_perf_met_rp = row_count;

  update supply_chain.vendors v
    set active = false,
        merged_into_vendor_id = p_target_vendor_id,
        merged_at = now(),
        last_event_id = p_last_event_id
  where v.id = p_source_vendor_id and v.tenant_id = p_tenant_id;

  perform public.emit_event(
    p_type      := 'supply_chain.vendor.merged',
    p_payload   := jsonb_build_object(
      'source_vendor_id',   p_source_vendor_id,
      'source_vendor_name', v_source.name,
      'target_vendor_id',   p_target_vendor_id,
      'target_vendor_name', v_target.name,
      'tenant_id',          p_tenant_id,
      'items_repointed',    v_items_rp,
      'addresses_repointed',v_addr_rp,
      'contacts_repointed', v_contacts_rp,
      'pos_repointed',      v_pos_rp,
      'merged_at',          now()
    ),
    p_tenant_id := p_tenant_id
  );

  return query select
    false,
    v_items_rp, v_items_dp,
    v_contacts_rp, v_contacts_dp,
    v_addr_rp, v_addr_dp,
    v_dom_rp, v_dom_dp,
    v_pos_rp,
    v_perf_evt_rp, v_perf_met_rp;
end;
$function$;
