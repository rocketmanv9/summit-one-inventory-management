-- Vendor duplicates browser (tyler-ideas item 01).
--
-- rpc_vendor_match_candidates (20260810000001) scores ONE candidate against the
-- book — perfect for the add flow, O(n) per call. The duplicates BROWSER needs
-- the whole book scanned pairwise, and looping the per-candidate RPC from the
-- API would be O(n) round trips of O(n) work each. This helper does the same
-- signal scoring set-based, in one call:
--
--   name    — trigram similarity (>= 45%) or full containment of one normalized
--             name in the other (the Lakeside "Foster Road Asphalt Plant" case).
--   address — same normalized street on file (vendor_addresses OR the
--             denormalized vendor row); +zip agreement = near-certain.
--   domain  — shared registrable domain from portal_url or vendor_email_domains.
--   phone   — same digits (7+) on the vendor row contact/phone fields.
--
-- Confidence mirrors the per-candidate RPC exactly: strongest signal + 8 when a
-- second independent signal corroborates, capped at 100. Only active vendors are
-- scanned (merged vendors are already inactive), the candidate set is capped so
-- a giant book can't O(n^2) explode, and each returned side carries the counts
-- the browser shows side-by-side (items / POs / addresses / contacts).
--
-- Read-only; no tables created or altered.

create or replace function supply_chain.rpc_vendor_duplicate_pairs(
  p_tenant_id      uuid,
  p_min_confidence int default 45,
  p_limit          int default 100
)
returns table (
  vendor_a_id     uuid,
  vendor_a_name   text,
  vendor_a_code   text,
  a_address       text,
  a_item_count    int,
  a_po_count      int,
  a_address_count int,
  a_contact_count int,
  vendor_b_id     uuid,
  vendor_b_name   text,
  vendor_b_code   text,
  b_address       text,
  b_item_count    int,
  b_po_count      int,
  b_address_count int,
  b_contact_count int,
  confidence      int,
  reasons         text[]
)
language plpgsql
stable
security definer
set search_path = supply_chain, public, extensions
as $$
begin
  return query
  with cand as (
    select
      v.id,
      v.name,
      v.code,
      supply_chain._vendor_norm_name(v.name)          as name_norm,
      supply_chain._vendor_norm_domain(v.portal_url)  as site_domain,
      nullif(regexp_replace(coalesce(v.contact_phone, v.phone_number, ''), '\D', '', 'g'), '')
                                                      as phone_digits,
      nullif(trim(both ', ' from concat_ws(', ',
        v.address_line_1,
        nullif(trim(concat_ws(' ', v.city, v.state)), ''))), '') as display_address
    from supply_chain.vendors v
    where v.tenant_id = p_tenant_id
      and v.active = true
    order by v.name
    limit 1500
  ),
  -- Every street a vendor answers to: child address rows + the denormalized row.
  addr_keys as (
    select a.vendor_id as id,
           supply_chain._vendor_norm_street(a.street1) as street_norm,
           nullif(trim(coalesce(a.zip, '')), '')       as zip
    from supply_chain.vendor_addresses a
    join cand c on c.id = a.vendor_id
    where supply_chain._vendor_norm_street(a.street1) <> ''
    union
    select v.id,
           supply_chain._vendor_norm_street(v.address_line_1),
           nullif(trim(coalesce(v.postal_code, '')), '')
    from supply_chain.vendors v
    join cand c on c.id = v.id
    where supply_chain._vendor_norm_street(v.address_line_1) <> ''
  ),
  -- Every domain a vendor answers to: portal_url + active sender domains.
  dom_keys as (
    select c.id, c.site_domain as domain
    from cand c
    where c.site_domain is not null
    union
    select ed.vendor_id, supply_chain._vendor_norm_domain(ed.domain)
    from supply_chain.vendor_email_domains ed
    join cand c on c.id = ed.vendor_id
    where ed.is_active = true
      and supply_chain._vendor_norm_domain(ed.domain) is not null
  ),
  name_pairs as (
    select a.id as a_id, b.id as b_id,
      greatest(
        (similarity(a.name_norm, b.name_norm) * 100)::int,
        case when a.name_norm like '%' || b.name_norm || '%'
               or b.name_norm like '%' || a.name_norm || '%' then 90 else 0 end
      ) as score,
      case
        when a.name_norm like '%' || b.name_norm || '%'
          or b.name_norm like '%' || a.name_norm || '%'
        then 'One name contains the other'
        else 'Similar names (' || round(similarity(a.name_norm, b.name_norm) * 100) || '% match)'
      end as reason
    from cand a
    join cand b on a.id < b.id
    where a.name_norm <> '' and b.name_norm <> ''
      and (
        similarity(a.name_norm, b.name_norm) >= 0.45
        or a.name_norm like '%' || b.name_norm || '%'
        or b.name_norm like '%' || a.name_norm || '%'
      )
  ),
  -- Street-level matches only (the city/zip-only tiers from the per-candidate
  -- RPC would pair up every vendor in town — too noisy for a whole-book scan).
  addr_pairs as (
    select least(ka.id, kb.id)    as a_id,
           greatest(ka.id, kb.id) as b_id,
           max(case when ka.zip is not null and ka.zip = kb.zip then 98 else 90 end) as score,
           'Same street address on file' as reason
    from addr_keys ka
    join addr_keys kb
      on kb.street_norm = ka.street_norm
     and ka.id < kb.id
    group by least(ka.id, kb.id), greatest(ka.id, kb.id)
  ),
  dom_pairs as (
    select least(da.id, db.id)    as a_id,
           greatest(da.id, db.id) as b_id,
           85 as score,
           'Domain matches (' || min(da.domain) || ')' as reason
    from dom_keys da
    join dom_keys db
      on db.domain = da.domain
     and da.id < db.id
    group by least(da.id, db.id), greatest(da.id, db.id)
  ),
  phone_pairs as (
    select a.id as a_id, b.id as b_id, 60 as score,
           'Phone number matches' as reason
    from cand a
    join cand b
      on a.id < b.id
     and a.phone_digits = b.phone_digits
    where a.phone_digits is not null
      and length(a.phone_digits) >= 7
  ),
  all_signals as (
    select np.a_id, np.b_id, np.score, np.reason from name_pairs np
    union all
    select ap.a_id, ap.b_id, ap.score, ap.reason from addr_pairs ap
    union all
    select dp.a_id, dp.b_id, dp.score, dp.reason from dom_pairs dp
    union all
    select pp.a_id, pp.b_id, pp.score, pp.reason from phone_pairs pp
  ),
  scored as (
    select s.a_id, s.b_id,
      -- Same formula as rpc_vendor_match_candidates: strongest signal + 8 when a
      -- second independent signal (>= 45) corroborates, capped at 100.
      least(100,
        max(s.score)
        + case when count(*) filter (where s.score >= 45) >= 2 then 8 else 0 end
      )::int as pair_confidence,
      array_agg(s.reason order by s.score desc) as pair_reasons
    from all_signals s
    group by s.a_id, s.b_id
  )
  select
    ca.id, ca.name, ca.code, ca.display_address,
    (select count(*)::int from supply_chain.vendor_items vi
      where vi.vendor_id = ca.id),
    (select count(*)::int from supply_chain.purchase_orders po
      where po.vendor_id = ca.id and po.tenant_id = p_tenant_id),
    (select count(*)::int from supply_chain.vendor_addresses va
      where va.vendor_id = ca.id),
    (select count(*)::int from supply_chain.vendor_contacts vc
      where vc.vendor_id = ca.id),
    cb.id, cb.name, cb.code, cb.display_address,
    (select count(*)::int from supply_chain.vendor_items vi
      where vi.vendor_id = cb.id),
    (select count(*)::int from supply_chain.purchase_orders po
      where po.vendor_id = cb.id and po.tenant_id = p_tenant_id),
    (select count(*)::int from supply_chain.vendor_addresses va
      where va.vendor_id = cb.id),
    (select count(*)::int from supply_chain.vendor_contacts vc
      where vc.vendor_id = cb.id),
    sc.pair_confidence,
    sc.pair_reasons
  from scored sc
  join cand ca on ca.id = sc.a_id
  join cand cb on cb.id = sc.b_id
  where sc.pair_confidence >= coalesce(p_min_confidence, 45)
  order by sc.pair_confidence desc, ca.name, cb.name
  limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

grant execute on function supply_chain.rpc_vendor_duplicate_pairs(uuid, int, int)
  to authenticated, service_role;
