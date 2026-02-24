# Supabase Migration Workflow

## Current State

- **Baseline**: `00000000000000_baseline.sql` — squashed snapshot of all schema as of Feb 13, 2026
- **New migrations**: Timestamped files after the baseline (e.g., `20260218000000_event_compliance.sql`)
- **Environments**: dev (linked via `supabase link`)

## How Migrations Work

Supabase tracks which migrations have been applied in `supabase_migrations.schema_migrations` on the remote DB. When you run `supabase db push`, it compares local files in `supabase/migrations/` against that remote table and applies any that are missing.

## Safe Workflow (Follow This Every Time)

### Creating a new migration

```bash
# 1. Create the migration file
npx supabase migration new <descriptive_name>
# This creates: supabase/migrations/<timestamp>_<descriptive_name>.sql

# 2. Write your SQL in the new file

# 3. Check what will be pushed (ALWAYS dry-run first)
npx supabase db push --dry-run

# 4. If dry-run looks good, push for real
npx supabase db push
```

### Checking sync status

```bash
# See local vs remote migration status
npx supabase migration list
```

Both columns should have matching timestamps. If a migration shows only in "Remote" or only in "Local", there's a mismatch.

## What Went Wrong (Feb 2026) and How We Fixed It

### The Problem

Over Jan-Feb 2026, ~120 individual migration files were applied to the dev DB one-by-one. Later, all of them were squashed into a single `00000000000000_baseline.sql` locally and the individual files were deleted.

This created a mismatch: the remote DB's migration history table listed 120+ individual migrations, but locally only the baseline existed. `supabase db push` refused to work because it saw remote migrations that didn't exist locally.

### The Fix

```bash
# 1. Marked all old individual migrations as "reverted" in the remote history table
#    This is METADATA ONLY — it does NOT touch any schema or data
npx supabase migration repair --status reverted 20260106000000 20260122000001 ...

# 2. Registered the baseline as "applied" on remote
npx supabase migration repair --status applied 00000000000000

# 3. Verified sync
npx supabase migration list
# Output: both baseline and new migration show Local + Remote
```

### Root Cause

Squashing migrations locally without updating the remote history table. The baseline file replaced all individual files, but the remote DB still expected them.

## Rules to Prevent Future Issues

### 1. Never delete migration files that have been pushed to any remote DB

Once `supabase db push` applies a migration, the remote DB records it. If you delete the local file, the next push will fail.

### 2. If you need to squash migrations, repair the remote history

```bash
# After squashing, mark the old migrations as reverted on remote:
npx supabase migration repair --status reverted <timestamp1> <timestamp2> ...

# Then mark the new baseline/squashed file as applied:
npx supabase migration repair --status applied <new_timestamp>
```

### 3. Always dry-run before pushing

```bash
npx supabase db push --dry-run
```

If this shows unexpected migrations or errors, STOP and investigate.

### 4. Keep migrations additive and idempotent

- Use `CREATE OR REPLACE FUNCTION` instead of `CREATE FUNCTION`
- Use `CREATE TABLE IF NOT EXISTS` for new tables
- Use `INSERT ... ON CONFLICT DO NOTHING` for seed data
- For triggers (which don't support CREATE OR REPLACE): `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`
- Never use raw `DROP TABLE` or `TRUNCATE` without explicit justification

### 5. One migration per logical change

Don't pile unrelated schema changes into a single file. If you're adding event triggers AND creating a new table, consider separate migrations so they can be reasoned about independently.

### 6. Name migrations descriptively

```
Good:  20260218000000_event_compliance.sql
Good:  20260301000000_add_transfer_line_status.sql
Bad:   20260218000000_update.sql
Bad:   20260218000000_fix.sql
```

## Useful Commands Reference

| Command | What it does | Safe? |
|---------|-------------|-------|
| `npx supabase migration list` | Shows local vs remote migration status | Read-only |
| `npx supabase db push --dry-run` | Shows what WOULD be pushed without doing it | Read-only |
| `npx supabase db push` | Applies pending migrations to remote DB | **Writes to DB** |
| `npx supabase migration new <name>` | Creates a new empty migration file locally | Local only |
| `npx supabase migration repair --status reverted <id>` | Marks a remote migration as reverted (metadata only) | Metadata only |
| `npx supabase migration repair --status applied <id>` | Marks a migration as applied on remote (metadata only) | Metadata only |
| `npx supabase db pull` | Pulls remote schema into a new local migration | Local only |
| `npx supabase db diff` | Shows schema differences between local and remote | Read-only |

## Emergency: "Remote migration versions not found in local"

This means the remote DB has migration records that don't exist locally. Fix:

```bash
# 1. Check what's out of sync
npx supabase migration list

# 2. For each migration that appears ONLY in Remote, mark it as reverted
npx supabase migration repair --status reverted <timestamp>

# 3. Verify
npx supabase migration list
# All rows should now show both Local and Remote
```

This is safe — `repair --status reverted` only updates the metadata table, never touches schema or data.
