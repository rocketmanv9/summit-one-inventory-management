-- 1. REAL TABLE: Widgets (For the dynamic dashboard)
create table if not exists public.widgets (
  id uuid default gen_random_uuid() primary key,
  tenant_id uuid not null,
  widget_type text not null, -- e.g., 'chart', 'stat_card'
  title text,
  config jsonb default '{}'::jsonb, -- Store settings here
  position integer default 0
);
alter table public.widgets enable row level security;

-- 2. LEGACY TABLE: Dashboard Stats (To stop the 404 crashes)
create table if not exists public.dashboard_stats (
  id uuid default gen_random_uuid() primary key,
  tenant_id uuid not null,
  total_inventory integer default 0,
  low_stock_items integer default 0,
  pending_orders integer default 0
);
alter table public.dashboard_stats enable row level security;

-- 3. RLS Policies
create policy "Tenant Access Widgets" on public.widgets
  for all using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

create policy "Tenant Access Stats" on public.dashboard_stats
  for select using (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- 4. Seed Data (So the UI isn't blank)
-- Insert a Dummy Stat row to keep useDashboards.ts happy
insert into public.dashboard_stats (tenant_id, total_inventory, low_stock_items)
values ('ae837809-1a24-4ab5-ba06-34fd98c05f48', 150, 5);

-- Insert a Sample Widget to prove the real system works
insert into public.widgets (tenant_id, widget_type, title, position)
values ('ae837809-1a24-4ab5-ba06-34fd98c05f48', 'stat_card', 'Total Revenue', 1);
