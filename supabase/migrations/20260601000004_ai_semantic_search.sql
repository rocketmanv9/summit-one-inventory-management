-- AI Semantic Search — item embeddings + similarity RPC
--
-- Adds a 1536-dim embedding column to catalog_items (text-embedding-3-small)
-- and the rpc_semantic_search_items function the AI `semantic_search` tool
-- calls. The tool was previously dead because neither existed.
--
-- Embeddings are populated at runtime by POST /api/ai/reindex (admin), which
-- backfills items lacking an embedding. This migration only creates the
-- schema + function; it does not require any embedding data to apply.

create extension if not exists vector;

-- ── Embedding column ────────────────────────────────────────────────────
alter table inventory.catalog_items
  add column if not exists embedding vector(1536);

-- HNSW cosine index (pgvector >= 0.5). Builds incrementally, so it is safe to
-- create before any embeddings exist.
create index if not exists idx_catalog_items_embedding
  on inventory.catalog_items
  using hnsw (embedding vector_cosine_ops);

-- ── Similarity search RPC ───────────────────────────────────────────────
-- query_embedding is passed as text (the JSON-serialized vector, e.g.
-- "[0.1,0.2,...]") and cast to vector inside, so the calling convention is
-- unambiguous regardless of how PostgREST serializes the argument.
create or replace function inventory.rpc_semantic_search_items(
  query_embedding text,
  match_tenant_id uuid,
  match_count integer default 10
)
returns table (
  id uuid,
  name text,
  sku text,
  category_name text,
  similarity double precision
)
language sql
stable
security definer
set search_path to 'inventory', 'public', 'extensions'
as $$
  select
    ci.id,
    ci.name,
    ci.sku,
    ic.name as category_name,
    1 - (ci.embedding <=> query_embedding::vector(1536)) as similarity
  from inventory.catalog_items ci
  left join inventory.item_categories ic on ic.id = ci.category_id
  where ci.tenant_id = match_tenant_id
    and ci.embedding is not null
    and ci.deleted_at is null
    and ci.active
  order by ci.embedding <=> query_embedding::vector(1536)
  limit greatest(1, least(coalesce(match_count, 10), 50));
$$;

grant execute on function inventory.rpc_semantic_search_items(text, uuid, integer)
  to authenticated, service_role;
