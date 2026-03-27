# Supabase Migrations Checklist

Before your service goes live, apply these chassis migrations to your Supabase project.
Run them in order via the Supabase dashboard (SQL Editor) or the CLI.

## Required Migrations

| Order | File | What it creates |
|-------|------|-----------------|
| 1 | `00001_base_rls.sql` | `set_claim()` RPC, `processed_events`, `dead_events`, `audit_logs`, `webhook_subscriptions` + RLS policies |
| 2 | `00002_idempotency_keys.sql` | `idempotency_keys` table + `idempotency_claim/complete/release` RPCs |
| 3 | `00003_events_outbox.sql` | `events_outbox` table + `outbox_claim_batch/mark_dispatched/mark_failed` RPCs |
| 4 | `00004_summit_publisher_protocol_v1_2.sql` | `summit_config`, `event_catalog`, `events_dead_letter` tables + immutability trigger + protocol RPCs |
| 5 | `00005_outbox_backoff_schema_version.sql` | Outbox retry backoff (`next_attempt_at`, `attempt_count`), dead-letter auto-move, `chassis_schema_version` |
| 6 | `00006_outbox_idempotency_unique.sql` | Outbox idempotency unique constraint |
| 7 | `00007_emit_event_on_conflict.sql` | `emit_event()` ON CONFLICT for idempotent emission |
| 8 | `00008_hub_inbox_consumer_receipts.sql` | `hub_event_inbox`, `consumer_event_receipts` tables + `hub_inbox_try_insert/consumer_try_begin` RPCs |

## How to apply

```bash
# Option A: Supabase CLI (if linked)
supabase db push

# Option B: Copy/paste each file into Supabase Dashboard > SQL Editor > New query > Run
```

All migrations are idempotent (safe to run multiple times).

## Verification

After applying, run `npx chassis doctor` to verify all tables, RPCs, and schema version.
