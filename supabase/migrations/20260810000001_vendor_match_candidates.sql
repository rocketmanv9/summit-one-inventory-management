-- Vendor duplicate-match engine (item 01 — inventory-buying sprint).
--
-- No path that adds a vendor (AI web search, AI suggest, email search, manual)
-- should silently create a duplicate. This RPC scores a candidate vendor against
-- the tenant's EXISTING vendors and returns ranked matches with human-readable
-- reasons, so the UI can warn and the POST route can hard-gate.
--
-- The real failure this catches: "Lakeside Industries" (9 plant addresses,
-- incl. Foster Road at 6400 SE 101st Ave, Portland OR 97266) already existed,
-- yet the web-search flow created "Lakeside Industries Foster Road Asphalt
-- Plant" at that EXACT address. Either the high name overlap OR the exact
-- address match should have flagged it.
--
-- Signals (weighted, best-per-vendor wins; scores are 0-100):
--   name        — trigram similarity + token-subset containment, legal-suffix
--                 and punctuation insensitive ("Lakeside Industries Foster Road
--                 Asphalt Plant" contains all tokens of "Lakeside Industries").
--   address     — normalized street1+zip exact match against vendor_addresses OR
--                 the vendor's denormalized address_line_1 (near-certain); same
--                 city+state with similar street = moderate.
--   website     — registrable-ish domain match against vendors.portal_url and
--                 supply_chain.vendor_email_domains.
--   email/phone — contact email domain match; digits-only phone match.

create extension if not exists pg_trgm;

-- Normalize a company name for comparison: lowercase, strip legal suffixes and
-- generic branch words, collapse to single spaces. Used for token-overlap.
create or replace function supply_chain._vendor_norm_name(p text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
    regexp_replace(
      lower(coalesce(p, '')),
      '\y(inc|incorporated|llc|l\.l\.c|ltd|limited|co|corp|corporation|company|the|plant|branch|location|store|asphalt|industries)\y',
      ' ', 'g'
    ),
    '[^a-z0-9]+', ' ', 'g'
  ))
$$;

-- Normalize a street line to digits + significant tokens for exact-ish compare.
create or replace function supply_chain._vendor_norm_street(p text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
    regexp_replace(
      lower(coalesce(p, '')),
      '\y(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|suite|ste|unit|north|south|east|west|n|s|e|w|ne|nw|se|sw)\y',
      ' ', 'g'
    ),
    '[^a-z0-9]+', ' ', 'g'
  ))
$$;

-- Reduce a URL / email / bare host to a registrable-ish domain for comparison
-- (strip scheme, leading www, path; keep last two labels).
create or replace function supply_chain._vendor_norm_domain(p text)
returns text
language sql
immutable
as $$
  with h as (
    select split_part(
      regexp_replace(
        regexp_replace(lower(coalesce(p, '')), '^[a-z][a-z0-9+.-]*://', ''),
        '^www\.', ''
      ),
      '/', 1
    ) as host
  ), h2 as (
    select case when position('@' in host) > 0 then split_part(host, '@', 2) else host end as host
    from h
  )
  select case
    when host ~ '\.[a-z]{2,}$' then
      (regexp_match(host, '([a-z0-9-]+\.[a-z]{2,})$'))[1]
    else null
  end
  from h2
$$;

-- Score existing vendors against a candidate. Returns one row per matched vendor
-- (best signals folded in) with a 0-100 confidence and a text[] of reasons.
create or replace function supply_chain.rpc_vendor_match_candidates(
  p_tenant_id   uuid,
  p_name        text,
  p_street1     text default null,
  p_city        text default null,
  p_state       text default null,
  p_zip         text default null,
  p_website     text default null,
  p_email       text default null,
  p_domain      text default null,
  p_phone       text default null,
  p_exclude_id  uuid default null
)
returns table (
  vendor_id   uuid,
  vendor_name text,
  confidence  int,
  reasons     text[]
)
language plpgsql
stable
security definer
set search_path = supply_chain, public, extensions
as $$
declare
  v_name_norm    text := supply_chain._vendor_norm_name(p_name);
  v_street_norm  text := supply_chain._vendor_norm_street(p_street1);
  v_zip          text := nullif(trim(coalesce(p_zip, '')), '');
  v_city         text := nullif(lower(trim(coalesce(p_city, ''))), '');
  v_state        text := nullif(lower(trim(coalesce(p_state, ''))), '');
  v_domain       text := coalesce(
                    supply_chain._vendor_norm_domain(p_domain),
                    supply_chain._vendor_norm_domain(p_website),
                    supply_chain._vendor_norm_domain(p_email));
  v_phone_digits text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
begin
  if v_name_norm = '' and v_domain is null and v_street_norm = '' and v_phone_digits is null then
    return;  -- nothing to match on
  end if;

  return query
  with cand as (
    select
      v.id,
      v.name,
      supply_chain._vendor_norm_name(v.name)              as name_norm,
      similarity(supply_chain._vendor_norm_name(v.name), v_name_norm) as name_sim,
      supply_chain._vendor_norm_domain(v.portal_url)      as vendor_domain
    from supply_chain.vendors v
    where v.tenant_id = p_tenant_id
      and v.active = true
      and (p_exclude_id is null or v.id <> p_exclude_id)
  ),
  -- Name: trigram similarity OR full token-subset containment (candidate ⊇
  -- existing or existing ⊇ candidate). Token containment catches the Lakeside
  -- case where the new name simply appends "Foster Road Asphalt Plant".
  name_score as (
    select
      c.id,
      greatest(
        (c.name_sim * 100)::int,
        case
          when v_name_norm <> '' and c.name_norm <> '' and (
               c.name_norm like '%' || v_name_norm || '%'
            or v_name_norm  like '%' || c.name_norm || '%')
          then 90 else 0 end
      ) as score,
      case
        when v_name_norm <> '' and c.name_norm <> '' and (
             c.name_norm like '%' || v_name_norm || '%'
          or v_name_norm  like '%' || c.name_norm || '%')
        then 'Name overlaps "' || c.name || '"'
        when c.name_sim >= 0.45
        then 'Similar name to "' || c.name || '" (' || round(c.name_sim * 100) || '% match)'
        else null
      end as reason
    from cand c
  ),
  -- Address: check both vendor_addresses rows and the denormalized vendor row.
  addr_rows as (
    select a.vendor_id,
           supply_chain._vendor_norm_street(a.street1) as street_norm,
           nullif(trim(coalesce(a.zip, '')), '')        as zip,
           nullif(lower(trim(coalesce(a.city, ''))), '') as city,
           nullif(lower(trim(coalesce(a.state, ''))), '') as state,
           a.label
    from supply_chain.vendor_addresses a
    join cand c on c.id = a.vendor_id
    union all
    select v.id,
           supply_chain._vendor_norm_street(v.address_line_1),
           nullif(trim(coalesce(v.postal_code, '')), ''),
           nullif(lower(trim(coalesce(v.city, ''))), ''),
           nullif(lower(trim(coalesce(v.state, ''))), ''),
           null::text
    from supply_chain.vendors v
    join cand c on c.id = v.id
    where v.address_line_1 is not null
  ),
  addr_score as (
    select
      ar.vendor_id as id,
      max(
        case
          when v_street_norm <> '' and ar.street_norm = v_street_norm
               and v_zip is not null and ar.zip = v_zip then 98
          when v_street_norm <> '' and ar.street_norm = v_street_norm then 90
          when v_street_norm <> '' and ar.street_norm <> ''
               and v_city is not null and ar.city = v_city
               and v_state is not null and ar.state = v_state
               and similarity(ar.street_norm, v_street_norm) >= 0.5 then 70
          when v_zip is not null and ar.zip = v_zip
               and v_city is not null and ar.city = v_city then 45
          else 0
        end
      ) as score,
      (array_agg(
        case
          when v_street_norm <> '' and ar.street_norm = v_street_norm then
            'Address already on file' ||
            coalesce(' as "' || ar.label || '"', '') ||
            coalesce(' (' || initcap(ar.city) || ')', '')
          else null
        end
      ) filter (where v_street_norm <> '' and ar.street_norm = v_street_norm))[1] as reason
    from addr_rows ar
    group by ar.vendor_id
  ),
  domain_score as (
    select c.id,
      case when v_domain is not null and c.vendor_domain = v_domain then 85 else 0 end as score,
      case when v_domain is not null and c.vendor_domain = v_domain
           then 'Website domain matches (' || v_domain || ')' else null end as reason
    from cand c
  ),
  email_dom_score as (
    select ed.vendor_id as id,
      case when v_domain is not null then 80 else 0 end as score,
      'Email domain matches (' || v_domain || ')' as reason
    from supply_chain.vendor_email_domains ed
    join cand c on c.id = ed.vendor_id
    where ed.is_active = true and v_domain is not null
      and supply_chain._vendor_norm_domain(ed.domain) = v_domain
  ),
  phone_score as (
    select c.id,
      case when v_phone_digits is not null
             and regexp_replace(coalesce(vv.contact_phone, vv.phone_number, ''), '\D', '', 'g') = v_phone_digits
           then 60 else 0 end as score,
      'Phone number matches' as reason
    from cand c
    join supply_chain.vendors vv on vv.id = c.id
    where v_phone_digits is not null
      and regexp_replace(coalesce(vv.contact_phone, vv.phone_number, ''), '\D', '', 'g') = v_phone_digits
  ),
  merged as (
    select c.id, c.name,
      coalesce(ns.score, 0)  as name_s,   ns.reason  as name_r,
      coalesce(as_.score, 0) as addr_s,   as_.reason as addr_r,
      coalesce(ds.score, 0)  as dom_s,    ds.reason  as dom_r,
      coalesce(es.score, 0)  as email_s,  es.reason  as email_r,
      coalesce(ps.score, 0)  as phone_s,  ps.reason  as phone_r
    from cand c
    left join name_score ns on ns.id = c.id
    left join addr_score as_ on as_.id = c.id
    left join domain_score ds on ds.id = c.id
    left join email_dom_score es on es.id = c.id
    left join phone_score ps on ps.id = c.id
  )
  select
    m.id,
    m.name,
    -- Confidence: the strongest single signal, plus a small corroboration bump
    -- when a second independent signal also fires (capped at 100).
    least(100, (
      greatest(m.name_s, m.addr_s, m.dom_s, m.email_s, m.phone_s)
      + case when (
          (m.name_s  >= 45)::int + (m.addr_s >= 45)::int + (m.dom_s >= 45)::int
        + (m.email_s >= 45)::int + (m.phone_s >= 45)::int
        ) >= 2 then 8 else 0 end
    ))::int as confidence,
    array_remove(array[m.addr_r, m.name_r, m.dom_r, m.email_r, m.phone_r], null) as reasons
  from merged m
  where greatest(m.name_s, m.addr_s, m.dom_s, m.email_s, m.phone_s) >= 45
  order by confidence desc
  limit 8;
end;
$$;

grant execute on function supply_chain.rpc_vendor_match_candidates(
  uuid, text, text, text, text, text, text, text, text, text, uuid
) to authenticated, service_role;
