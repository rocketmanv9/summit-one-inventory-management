-- ============================================================================
-- AI Conversations & Messages Tables
--
-- Persistent chat history for the Isabelle AI assistant.
-- Conversations survive page refresh and track token usage per session.
-- ============================================================================

-- ── ai_conversations ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory.ai_conversations (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     UUID NOT NULL,
  user_id       UUID NOT NULL,

  -- ── Conversation metadata ──────────────────────────────────────────────────
  title         TEXT,
  surface       TEXT NOT NULL DEFAULT 'corner'
                CHECK (surface IN ('corner', 'panel', 'workspace')),
  model         TEXT NOT NULL DEFAULT 'gpt-4.1',
  total_tokens  INT NOT NULL DEFAULT 0,

  -- ── Timestamps ─────────────────────────────────────────────────────────────
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE inventory.ai_conversations ENABLE ROW LEVEL SECURITY;

-- Service role: full access
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'ai_conversations'
      AND policyname = 'ai_conversations_service_role_all'
  ) THEN
    CREATE POLICY ai_conversations_service_role_all ON inventory.ai_conversations
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Authenticated users: SELECT scoped to tenant
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'ai_conversations'
      AND policyname = 'ai_conversations_tenant_select'
  ) THEN
    CREATE POLICY ai_conversations_tenant_select ON inventory.ai_conversations
      FOR SELECT TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Authenticated users: INSERT scoped to tenant
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'ai_conversations'
      AND policyname = 'ai_conversations_tenant_insert'
  ) THEN
    CREATE POLICY ai_conversations_tenant_insert ON inventory.ai_conversations
      FOR INSERT TO authenticated
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Authenticated users: UPDATE scoped to tenant
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'ai_conversations'
      AND policyname = 'ai_conversations_tenant_update'
  ) THEN
    CREATE POLICY ai_conversations_tenant_update ON inventory.ai_conversations
      FOR UPDATE TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid)
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Authenticated users: DELETE scoped to tenant
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'ai_conversations'
      AND policyname = 'ai_conversations_tenant_delete'
  ) THEN
    CREATE POLICY ai_conversations_tenant_delete ON inventory.ai_conversations
      FOR DELETE TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_conversations_tenant_id
  ON inventory.ai_conversations (tenant_id);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user
  ON inventory.ai_conversations (tenant_id, user_id, created_at DESC);

-- ── ai_messages ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory.ai_messages (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID NOT NULL,
  conversation_id UUID NOT NULL REFERENCES inventory.ai_conversations(id) ON DELETE CASCADE,

  -- ── Message content ────────────────────────────────────────────────────────
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content         TEXT,
  tool_calls      JSONB,
  tool_call_id    TEXT,
  data_display    JSONB,
  image_url       TEXT,

  -- ── Metadata (tokens, latency, model used) ────────────────────────────────
  metadata        JSONB DEFAULT '{}',

  -- ── Timestamps ─────────────────────────────────────────────────────────────
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE inventory.ai_messages ENABLE ROW LEVEL SECURITY;

-- Service role: full access
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'ai_messages'
      AND policyname = 'ai_messages_service_role_all'
  ) THEN
    CREATE POLICY ai_messages_service_role_all ON inventory.ai_messages
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Authenticated users: SELECT scoped to tenant
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'ai_messages'
      AND policyname = 'ai_messages_tenant_select'
  ) THEN
    CREATE POLICY ai_messages_tenant_select ON inventory.ai_messages
      FOR SELECT TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Authenticated users: INSERT scoped to tenant
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inventory'
      AND tablename = 'ai_messages'
      AND policyname = 'ai_messages_tenant_insert'
  ) THEN
    CREATE POLICY ai_messages_tenant_insert ON inventory.ai_messages
      FOR INSERT TO authenticated
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_messages_tenant_id
  ON inventory.ai_messages (tenant_id);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
  ON inventory.ai_messages (conversation_id, created_at ASC);
