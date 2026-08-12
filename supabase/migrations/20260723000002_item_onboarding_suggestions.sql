-- 20260723000002_item_onboarding_suggestions.sql
-- AI email → item onboarding suggestions (Grant, 2026-07-23).
--
-- The Gmail integration already reads vendor mail for PO replies and receipt
-- collection. This adds the "you keep buying this — want to track it?" layer:
-- a background scan reads recent purchase-looking emails, extracts line items
-- with AI, drops anything already in inventory.catalog_items, and queues the
-- rest here for a human Accept (→ pre-filled item wizard) or Dismiss.
--
--   inventory.item_onboarding_suggestions      — the suggestion queue
--   inventory.item_suggestion_scanned_messages — Gmail message ids already
--       processed per tenant, so re-scans never double-count occurrences
--
-- Dedupe: one suggestion row per (tenant, normalized item name). Repeat
-- sightings bump `occurrences` instead of inserting duplicates; dismissed and
-- accepted rows are left untouched by later scans.

CREATE TABLE IF NOT EXISTS inventory.item_onboarding_suggestions (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL,
    source                text NOT NULL DEFAULT 'email',
    source_ref            text,                    -- gmail message id of first sighting
    email_subject         text,
    email_from            text,
    email_date            timestamptz,
    vendor_id             uuid,                    -- matched supply_chain.vendors.id, if any
    vendor_name           text,
    item_name             text NOT NULL,
    item_description      text,
    quantity              numeric,
    unit_cost             numeric,
    currency              text DEFAULT 'USD',
    confidence            numeric NOT NULL DEFAULT 0,   -- 0..1 from the extractor
    rationale             text,                    -- why the AI thinks this is worth tracking
    occurrences           integer NOT NULL DEFAULT 1,
    last_seen_at          timestamptz NOT NULL DEFAULT now(),
    status                text NOT NULL DEFAULT 'suggested'
                          CHECK (status IN ('suggested', 'accepted', 'dismissed')),
    resolved_by_user_id   uuid,
    resolved_at           timestamptz,
    created_item_id       uuid,                    -- catalog item created from this suggestion
    dedupe_key            text NOT NULL,           -- normalized lower(item_name)
    last_event_id         text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, dedupe_key)
);

COMMENT ON TABLE inventory.item_onboarding_suggestions IS
    'AI-extracted "add this to inventory" candidates mined from purchase-looking emails. '
    'Accept routes into the item wizard pre-filled; Dismiss suppresses future re-suggestions.';

CREATE INDEX IF NOT EXISTS idx_item_onboarding_suggestions_tenant
    ON inventory.item_onboarding_suggestions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_item_onboarding_suggestions_tenant_status
    ON inventory.item_onboarding_suggestions (tenant_id, status, last_seen_at DESC);

ALTER TABLE inventory.item_onboarding_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS item_onboarding_suggestions_service_role ON inventory.item_onboarding_suggestions;
CREATE POLICY item_onboarding_suggestions_service_role
    ON inventory.item_onboarding_suggestions TO service_role
    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS item_onboarding_suggestions_tenant_read ON inventory.item_onboarding_suggestions;
CREATE POLICY item_onboarding_suggestions_tenant_read
    ON inventory.item_onboarding_suggestions FOR SELECT TO authenticated
    USING (tenant_id = public.current_tenant_id());

-- ── Scan bookkeeping ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS inventory.item_suggestion_scanned_messages (
    tenant_id     uuid NOT NULL,
    message_id    text NOT NULL,
    connection_id uuid,
    scanned_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, message_id)
);

COMMENT ON TABLE inventory.item_suggestion_scanned_messages IS
    'Gmail message ids already processed by the item-suggestion scanner, per tenant. '
    'Prevents re-processing (and occurrence double-counting) across scan runs.';

ALTER TABLE inventory.item_suggestion_scanned_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS item_suggestion_scanned_messages_service_role ON inventory.item_suggestion_scanned_messages;
CREATE POLICY item_suggestion_scanned_messages_service_role
    ON inventory.item_suggestion_scanned_messages TO service_role
    USING (true) WITH CHECK (true);
