-- ============================================================================
-- Gmail OAuth Integration
--
-- Adds three tenant-scoped tables in the supply_chain schema:
--   1. google_connections          — per-user OR shared-mailbox Google/Gmail
--                                     OAuth connections. Refresh tokens are NOT
--                                     stored here; only a Supabase Vault secret
--                                     reference is kept (matches the Printify /
--                                     Amazon integration pattern).
--   2. purchase_order_emails        — audit trail of POs emailed to vendors
--                                     (via Gmail or the Resend fallback).
--   3. purchase_order_email_replies — vendor replies synced back from Gmail and
--                                     linked to the originating PO.
--
-- connection_type supports the "shared company mailbox" requirement
-- (purchasing@company.com) in addition to per-user Gmail accounts.
-- ============================================================================

-- ── Shared updated_at trigger function (supply_chain) ───────────────────────
CREATE OR REPLACE FUNCTION supply_chain.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. google_connections
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS supply_chain.google_connections (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id                UUID NOT NULL,
  -- The user who owns (personal) or administers (shared mailbox) this connection.
  user_id                  UUID NOT NULL,
  -- 'user'          → grant@company.com sends from their own Gmail.
  -- 'shared_mailbox'→ purchasing@company.com, usable by the whole tenant.
  connection_type          TEXT NOT NULL DEFAULT 'user'
                             CHECK (connection_type IN ('user', 'shared_mailbox')),
  google_email             TEXT NOT NULL,
  google_sub               TEXT,
  -- Optional human label, e.g. "Purchasing" or "Accounts Payable".
  display_name             TEXT,
  -- Supabase Vault secret name holding the encrypted refresh token. The raw
  -- token is NEVER stored in this table and NEVER returned to the frontend.
  refresh_token_secret_ref TEXT NOT NULL,
  scopes                   TEXT[] NOT NULL DEFAULT '{}',
  connected_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at               TIMESTAMPTZ,
  -- Idempotency key for outbox events (repo convention).
  last_event_id            TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A user may connect a given Google account once (per the spec).
CREATE UNIQUE INDEX IF NOT EXISTS uq_google_connections_tenant_user_email
  ON supply_chain.google_connections (tenant_id, user_id, google_email);

-- A shared mailbox is unique per tenant regardless of which admin set it up,
-- so two admins can't double-connect purchasing@company.com.
CREATE UNIQUE INDEX IF NOT EXISTS uq_google_connections_shared_mailbox
  ON supply_chain.google_connections (tenant_id, google_email)
  WHERE connection_type = 'shared_mailbox';

CREATE INDEX IF NOT EXISTS idx_google_connections_tenant_id
  ON supply_chain.google_connections (tenant_id);
CREATE INDEX IF NOT EXISTS idx_google_connections_tenant_user
  ON supply_chain.google_connections (tenant_id, user_id);

ALTER TABLE supply_chain.google_connections ENABLE ROW LEVEL SECURITY;

-- Service role: full access (route handlers use the service client).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'supply_chain' AND tablename = 'google_connections' AND policyname = 'google_connections_service_role_all') THEN
    CREATE POLICY google_connections_service_role_all ON supply_chain.google_connections
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Authenticated SELECT: a user sees ONLY their own connections plus their
-- tenant's shared mailboxes. They can never see another user's connection.
-- (Token material lives in Vault, not in selectable columns, so even this
--  exposes no secrets.)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'supply_chain' AND tablename = 'google_connections' AND policyname = 'google_connections_owner_select') THEN
    CREATE POLICY google_connections_owner_select ON supply_chain.google_connections
      FOR SELECT TO authenticated
      USING (
        tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid
        AND (
          user_id = (current_setting('request.jwt.claims', true)::json->>'sub')::uuid
          OR connection_type = 'shared_mailbox'
        )
      );
END IF;
END $$;

DROP TRIGGER IF EXISTS trg_google_connections_updated_at ON supply_chain.google_connections;
CREATE TRIGGER trg_google_connections_updated_at
  BEFORE UPDATE ON supply_chain.google_connections
  FOR EACH ROW EXECUTE FUNCTION supply_chain.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- 2. purchase_order_emails  (audit trail of sent POs)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS supply_chain.purchase_order_emails (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id          UUID NOT NULL,
  purchase_order_id  UUID NOT NULL,
  -- Which Gmail connection sent it (null when sent via the Resend fallback).
  connection_id      UUID REFERENCES supply_chain.google_connections (id) ON DELETE SET NULL,
  provider           TEXT NOT NULL DEFAULT 'gmail'
                       CHECK (provider IN ('gmail', 'resend')),
  gmail_message_id   TEXT,
  gmail_thread_id    TEXT,
  sent_by_user_id    UUID,
  from_email         TEXT,
  recipient_email    TEXT NOT NULL,
  subject            TEXT,
  status             TEXT NOT NULL DEFAULT 'sent'
                       CHECK (status IN ('sent', 'failed')),
  sent_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_event_id      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_emails_tenant_id
  ON supply_chain.purchase_order_emails (tenant_id);
CREATE INDEX IF NOT EXISTS idx_po_emails_po
  ON supply_chain.purchase_order_emails (tenant_id, purchase_order_id);
-- Used by reply-sync to map a thread back to its PO.
CREATE INDEX IF NOT EXISTS idx_po_emails_thread
  ON supply_chain.purchase_order_emails (tenant_id, gmail_thread_id)
  WHERE gmail_thread_id IS NOT NULL;

ALTER TABLE supply_chain.purchase_order_emails ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'supply_chain' AND tablename = 'purchase_order_emails' AND policyname = 'po_emails_service_role_all') THEN
    CREATE POLICY po_emails_service_role_all ON supply_chain.purchase_order_emails
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'supply_chain' AND tablename = 'purchase_order_emails' AND policyname = 'po_emails_tenant_select') THEN
    CREATE POLICY po_emails_tenant_select ON supply_chain.purchase_order_emails
      FOR SELECT TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_po_emails_updated_at ON supply_chain.purchase_order_emails;
CREATE TRIGGER trg_po_emails_updated_at
  BEFORE UPDATE ON supply_chain.purchase_order_emails
  FOR EACH ROW EXECUTE FUNCTION supply_chain.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- 3. purchase_order_email_replies  (vendor replies synced from Gmail)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS supply_chain.purchase_order_email_replies (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id          UUID NOT NULL,
  purchase_order_id  UUID,
  po_email_id        UUID REFERENCES supply_chain.purchase_order_emails (id) ON DELETE SET NULL,
  connection_id      UUID REFERENCES supply_chain.google_connections (id) ON DELETE SET NULL,
  gmail_message_id   TEXT NOT NULL,
  gmail_thread_id    TEXT,
  from_email         TEXT,
  subject            TEXT,
  snippet            TEXT,
  body_text          TEXT,
  received_at        TIMESTAMPTZ,
  last_event_id      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per Gmail message per tenant (idempotent re-sync).
CREATE UNIQUE INDEX IF NOT EXISTS uq_po_replies_tenant_message
  ON supply_chain.purchase_order_email_replies (tenant_id, gmail_message_id);
CREATE INDEX IF NOT EXISTS idx_po_replies_tenant_id
  ON supply_chain.purchase_order_email_replies (tenant_id);
CREATE INDEX IF NOT EXISTS idx_po_replies_po
  ON supply_chain.purchase_order_email_replies (tenant_id, purchase_order_id);

ALTER TABLE supply_chain.purchase_order_email_replies ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'supply_chain' AND tablename = 'purchase_order_email_replies' AND policyname = 'po_replies_service_role_all') THEN
    CREATE POLICY po_replies_service_role_all ON supply_chain.purchase_order_email_replies
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'supply_chain' AND tablename = 'purchase_order_email_replies' AND policyname = 'po_replies_tenant_select') THEN
    CREATE POLICY po_replies_tenant_select ON supply_chain.purchase_order_email_replies
      FOR SELECT TO authenticated
      USING (tenant_id = (current_setting('request.jwt.claims', true)::json->>'tenant_id')::uuid);
  END IF;
END $$;
