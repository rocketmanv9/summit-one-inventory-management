-- Vendor merge tool (item 02 — inventory-buying sprint).
--
-- Item 01 stops NEW duplicates from being created. This migration cleans up the
-- ones already on file: an admin picks a duplicate vendor (source) and the real
-- one (target), and everything the source owns is re-pointed to the target, the
-- source is deactivated, and the link is recorded so the merge is auditable and
-- reversible-in-spirit (you can always see where a vendor went).
--
-- The whole re-point runs inside ONE plpgsql function = one transaction, so a
-- half-merge can't happen. Bulk SQL edits bypass the outbox mirrors, so this is
-- deliberately NOT hand-run SQL: the function re-points through real UPDATE/
-- DELETE statements that fire the existing per-table event triggers
-- (vendor_item events, vendor.deactivated), and emits an explicit
-- supply_chain.vendor.merged event for the merge itself.
--
-- Dedup rules (so we never clobber the target's own data):
--   vendor_items          — a source row whose (catalog_item_id, vendor_address_id)
--                           already exists on the target is DROPPED (keep the
--                           target's pricing); others re-point.
--   vendor_contacts       — a source contact whose email already exists on the
--                           target is DROPPED; others re-point.
--   vendor_addresses      — a source address whose normalized street1+zip already
--                           exists on the target is DROPPED (this is exactly the
--                           Lakeside "Foster Road" 6400 SE 101st Ave case); any
--                           vendor_items pinned to that source address are first
--                           re-homed onto the target's equivalent address so the
--                           ON DELETE CASCADE can't take an item with it. Others
--                           re-point.
--   vendor_email_domains  — unique (tenant,vendor,domain): dup domains DROPPED.
--   purchase_orders       — re-point vendor_id; the vendor_*_snapshot columns are
--                           left as history (set_purchase_order_vendor_snapshot
--                           only fills them when NULL, so a re-point never
--                           rewrites a placed PO's recorded vendor).
--   performance events/metrics — trivially re-pointed (PK only).

-- 1) Audit columns on vendors: where did a deactivated vendor go, and when.
alter table supply_chain.vendors
  add column if not exists merged_into_vendor_id uuid references supply_chain.vendors(id),
  add column if not exists merged_at timestamptz;

-- Only meaningful for the handful of merged rows; partial index keeps it tiny.
create index if not exists idx_vendors_merged_into
  on supply_chain.vendors (merged_into_vendor_id)
  where merged_into_vendor_id is not null;

-- 2) Merge function. Returns a one-row summary of what moved (also used to render
--    the "what will change" preview by running it — no, previews are computed
--    read-only in the API; this function only ever mutates). Idempotent: a second
--    call once the source is already merged into the same target is a no-op that
--    returns zeroed counts with merged_already = true.
create or replace function supply_chain.rpc_merge_vendor(
  p_tenant_id         uuid,
  p_source_vendor_id  uuid,
  p_target_vendor_id  uuid,
  p_last_event_id     text
)
returns table (
  merged_already       boolean,
  items_repointed      int,
  items_dropped        int,
  contacts_repointed   int,
  contacts_dropped     int,
  addresses_repointed  int,
  addresses_dropped    int,
  domains_repointed    int,
  domains_dropped      int,
  pos_repointed        int,
  perf_events_repointed int,
  perf_metrics_repointed int
)
language plpgsql
security definer
set search_path = supply_chain, public, extensions
as $$
declare
  v_source        supply_chain.vendors%rowtype;
  v_target        supply_chain.vendors%rowtype;
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
  v_rc            int := 0;   -- scratch for GET DIAGNOSTICS (can't take an expr)
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

  -- Idempotent replay: already merged into this exact target → no-op.
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

  -- ---- Addresses -------------------------------------------------------------
  -- Map each SOURCE address to the TARGET's equivalent (same normalized
  -- street1+zip) if one exists. Those source addresses are duplicates to drop;
  -- first re-home any vendor_items pinned to them onto the target's row so the
  -- ON DELETE CASCADE on vendor_items.vendor_address_id can't delete an item.
  create temp table _addr_map on commit drop as
  select
    sa.id  as src_addr_id,
    ta.id  as tgt_addr_id           -- non-null when the source addr is a dup
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
  where sa.vendor_id = p_source_vendor_id;

  -- Re-home items pinned to a soon-to-be-dropped source address onto the target
  -- equivalent. Guard the composite unique: if the target already has that
  -- (catalog_item, target_addr) pair, drop the source item instead of colliding.
  delete from supply_chain.vendor_items si
  using _addr_map m
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
  from _addr_map m
  where si.vendor_id = p_source_vendor_id
    and si.vendor_address_id = m.src_addr_id
    and m.tgt_addr_id is not null;
  get diagnostics v_items_rp = row_count;

  -- Drop the duplicate source addresses (their dependent items are re-homed).
  delete from supply_chain.vendor_addresses sa
  using _addr_map m
  where sa.id = m.src_addr_id and m.tgt_addr_id is not null;
  get diagnostics v_addr_dp = row_count;

  -- Re-point the remaining (non-duplicate) source addresses to the target.
  update supply_chain.vendor_addresses sa
    set vendor_id = p_target_vendor_id,
        last_event_id = p_last_event_id || ':addr:' || sa.id
  from _addr_map m
  where sa.id = m.src_addr_id and m.tgt_addr_id is null;
  get diagnostics v_addr_rp = row_count;

  -- ---- Items (address-independent rows) --------------------------------------
  -- Any source items NOT already handled above. Drop rows whose
  -- (catalog_item, vendor_address_id) already exists on the target; re-point the
  -- rest. vendor_address_id here is either NULL or a source addr that has just
  -- been re-pointed to the target (so the composite compares correctly).
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

  -- ---- Contacts --------------------------------------------------------------
  -- Drop source contacts whose (lower) email already exists on the target; keep
  -- the target's version. Contacts with no email are always carried over.
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

  -- ---- Email domains (unique tenant,vendor,domain) ---------------------------
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

  -- ---- Purchase orders (keep the historical snapshot) ------------------------
  update supply_chain.purchase_orders po
    set vendor_id = p_target_vendor_id
  where po.vendor_id = p_source_vendor_id
    and po.tenant_id = p_tenant_id;
  get diagnostics v_pos_rp = row_count;

  -- ---- Performance history ---------------------------------------------------
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

  -- ---- Deactivate + record the merge -----------------------------------------
  -- Flipping active true→false fires emit_vendor_event → vendor.deactivated.
  update supply_chain.vendors v
    set active = false,
        merged_into_vendor_id = p_target_vendor_id,
        merged_at = now(),
        last_event_id = p_last_event_id
  where v.id = p_source_vendor_id and v.tenant_id = p_tenant_id;

  -- Explicit merge event for the outbox (the per-table triggers cover the moved
  -- child rows; this names the merge itself).
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
$$;

grant execute on function supply_chain.rpc_merge_vendor(uuid, uuid, uuid, text)
  to authenticated, service_role;

-- 3) Preview: same dedup classification as the merge, read-only, so the UI can
--    show "1 contact, 1 address (1 duplicate will be skipped), 0 items, 0 POs"
--    BEFORE the user confirms — and it stays in lockstep with what the merge
--    actually does (same normalized-street/zip and email rules).
create or replace function supply_chain.rpc_merge_vendor_preview(
  p_tenant_id         uuid,
  p_source_vendor_id  uuid,
  p_target_vendor_id  uuid
)
returns table (
  items_move       int,
  items_skip       int,
  contacts_move    int,
  contacts_skip    int,
  addresses_move   int,
  addresses_skip   int,
  domains_move     int,
  domains_skip     int,
  pos_move         int,
  perf_events_move int,
  perf_metrics_move int
)
language sql
stable
security definer
set search_path = supply_chain, public, extensions
as $$
  with
  addr as (
    select sa.id,
      exists (
        select 1 from supply_chain.vendor_addresses ta
        where ta.vendor_id = p_target_vendor_id
          and supply_chain._vendor_norm_street(ta.street1) = supply_chain._vendor_norm_street(sa.street1)
          and supply_chain._vendor_norm_street(sa.street1) <> ''
          and nullif(trim(coalesce(ta.zip,'')),'') is not distinct from nullif(trim(coalesce(sa.zip,'')),'')
      ) as is_dup
    from supply_chain.vendor_addresses sa
    where sa.vendor_id = p_source_vendor_id
  ),
  itm as (
    select si.id,
      exists (
        select 1 from supply_chain.vendor_items ti
        where ti.vendor_id = p_target_vendor_id
          and ti.catalog_item_id = si.catalog_item_id
      ) as is_dup
    from supply_chain.vendor_items si
    where si.vendor_id = p_source_vendor_id
  ),
  con as (
    select sc.id,
      (sc.email is not null and exists (
        select 1 from supply_chain.vendor_contacts tc
        where tc.vendor_id = p_target_vendor_id and lower(tc.email) = lower(sc.email)
      )) as is_dup
    from supply_chain.vendor_contacts sc
    where sc.vendor_id = p_source_vendor_id
  ),
  dom as (
    select sd.id,
      exists (
        select 1 from supply_chain.vendor_email_domains td
        where td.tenant_id = p_tenant_id and td.vendor_id = p_target_vendor_id
          and lower(td.domain) = lower(sd.domain)
      ) as is_dup
    from supply_chain.vendor_email_domains sd
    where sd.vendor_id = p_source_vendor_id
  )
  select
    (select count(*) from itm where not is_dup)::int,
    (select count(*) from itm where is_dup)::int,
    (select count(*) from con where not is_dup)::int,
    (select count(*) from con where is_dup)::int,
    (select count(*) from addr where not is_dup)::int,
    (select count(*) from addr where is_dup)::int,
    (select count(*) from dom where not is_dup)::int,
    (select count(*) from dom where is_dup)::int,
    (select count(*) from supply_chain.purchase_orders where vendor_id = p_source_vendor_id and tenant_id = p_tenant_id)::int,
    (select count(*) from supply_chain.vendor_performance_events where vendor_id = p_source_vendor_id and tenant_id = p_tenant_id)::int,
    (select count(*) from supply_chain.vendor_performance_metrics where vendor_id = p_source_vendor_id and tenant_id = p_tenant_id)::int;
$$;

grant execute on function supply_chain.rpc_merge_vendor_preview(uuid, uuid, uuid)
  to authenticated, service_role;
