# Production Readiness: Schema Reconciliation Plan

_Drafted 2026-06-12. Owner: Grant. Status: planned (not started)._

## The problem

Production (`yedgdlyhilfqghswtfwt`, "Inventory main") is **empty** — it has
never been deployed. Stage (`qnbrrutjbyrjmwohcbcv`) is the only environment
with the real schema, and it does **not** cleanly track the repo:

| Measure | Stage (live) | Repo |
|---|---|---|
| Applied migration entries | 135 | 102 migration files |
| inventory functions / tables | 130 / 75 | partially captured in stale `schema.sql` |
| supply_chain functions / tables | 55 / 20 | " |
| public functions / tables | 36 / 26 | " |

Drift sources, observed repeatedly:
- Hotfixes applied straight to stage via MCP `apply_migration` get
  push-timestamp version numbers that don't correspond to repo filenames
  (some hotfixes were later backported to files, some weren't).
- `supabase/schema.sql` is a stale snapshot — it disagreed with live reality
  at least three times on 2026-06-12 alone (cycle_counts count_type CHECK,
  inventory_events columns, receipts audit columns).
- The schema-drift audit (2026-06-12 baseline) found **42 functions referencing
  schema that doesn't exist** and **10 risky source patterns** — i.e., parts of
  the repo's SQL history never matched what actually runs.

Conclusion: replaying the repo's 102 migrations onto an empty prod database
will NOT reproduce stage. Promotion needs a deliberate baseline.

## The plan

### Phase 1 — Freeze a stage baseline (½ day)
1. `supabase link` the CLI to the stage project, then `supabase db dump`
   (schema-only) → `supabase/baselines/2026-06-stage-schema.sql`.
   Dump roles/grants and RLS policies explicitly (`--role-only` pass +
   verify policies are in the schema dump).
2. Dump seed-ish reference data separately (location_types, assignment_types,
   item_categories, guardrail defaults — NOT tenant business data).
3. Commit both. This is the new source of truth; the 102 historical
   migration files become archive-only (move to `supabase/migrations-archive/`).

### Phase 2 — Clean the baseline before it becomes prod (1–2 days)
1. Burn down the schema-drift audit list (42 lint errors): fix what's
   load-bearing, DROP what's dead (`create_test_item`, the v1 receipt RPC
   chain, `generate_reorder_pos` no-op stub, rfid functions referencing
   public.* tables, etc.). Re-run `rpc_schema_drift_audit()` until errors = 0
   or every remainder is consciously accepted and documented here.
2. Resolve the duplicate `public.emit_event` overloads down to one canonical
   signature (the p_type chassis one) once all callers are named-args.
3. Re-dump after cleanup → that dump is the prod baseline migration `00000`.

### Phase 3 — Prove reproducibility (½ day)
1. Create a throwaway Supabase branch (or local `supabase start`), apply the
   baseline + any post-baseline migrations, and diff against stage
   (`supabase db diff --linked`). Iterate until the diff is empty.
2. Add a CI step (or checklist item) that any future schema change MUST be a
   repo migration file applied via MCP with the same name — no anonymous
   hotfixes. The nightly schema-drift audit is the tripwire if this slips.

### Phase 4 — Stand up prod (½ day)
1. Apply baseline + post-baseline migrations to `yedgdlyhilfqghswtfwt`.
2. Seed reference data; create the tenant; configure env (CRON_SECRET,
   RESEND_API_KEY, OPENAI_API_KEY, Amazon punchout creds, GV keys,
   NEXT_PUBLIC_APP_URL, SCHEMA_AUDIT_EMAIL).
3. Point a prod Vercel environment at it; verify the cron suite fires;
   run `rpc_schema_drift_audit()` on prod — must be clean.

## Standing guardrails (already in place as of 2026-06-12)
- Nightly `/api/system/cron/schema-drift-audit` lints all functions against
  the live schema (plpgsql_check) + flags positional emit_event calls and
  root-only JWT tenant reads. Findings email SCHEMA_AUDIT_EMAIL.
- `tests/delete-fk-handling.test.ts` guards DELETE routes.
- `tests/ai-tool-deps.test.ts` guards AI tool RPC/table references.

## Audit status: ✅ ZERO (burned down 2026-06-12)
The 42 lint errors and 10 pattern findings were eliminated the same day
(migration `20260612000008_audit_burndown.sql`): dead functions dropped
(test scaffolding, legacy v1 receive chain, expenses stubs, broken RFID
bulk-session RPCs, the 6-arg cycle-count overload), every root-only JWT
tenant read COALESCEd, and the load-bearing breakage below fixed —
including removing direct stock_balances writes from issue/reversal
(double-count vs the trigger). `rpc_schema_drift_audit()` now returns 0/0
and the receiving E2E still passes. **Phase 2's function cleanup is done**;
the emit_event overload dedup remains. The nightly audit keeps it at zero.

Original Phase-2 list (all addressed):
- `inventory.rpc_issue_inventory` — inserts inventory_events columns that
  don't exist (same drift class as the receiving bug).
- `supply_chain.rpc_reverse_receipt_from_inventory` — same.
- `supply_chain.record_receipt_vendor_event` trigger — `extract(unknown,
  integer)` crash; latent because its vendor join usually returns no row.
- `inventory.rpc_inv_cycle_count_start` (both overloads) — the
  `p_item_category_id` branch references `ci.item_category_id` (real column
  is `category_id`); latent because nothing passes a category today.
- `inventory.expire_old_reservations` — references missing temp relation.
- `inventory.get_cycle_count_suggestions` — GROUP BY error.
