# HR ingestion + spend limits — resume handoff

## RESUME PROMPT (paste this after restarting Claude Code)

> Resuming the HR ingestion + purchasing spend-limits feature on branch `stage`. Read the memory file `hr-service-source.md` and `docs/plans/hr-limits-handoff.md` for full context. Status: the whole feature is BUILT, applied to stage, and validated (tsc/lint/compliance clean) but NOT committed. The remaining task is turning on **real-time HR people sync** via the event hub. I just added the command-center hub as MCP server `supabase_cc` (project ref `xwevjpxuwkjqbbldqgui`) and need it authenticated. Next step: read-only inspect the hub's `event_sources` + `event_subscriptions` (is HR a registered source? what `endpoint_url` + signing scheme does the existing `core-events` subscription use? is this hub project stage or prod?), then show me the exact HR→inventory subscription you'd register (`org_people.created/updated/deleted` → `/api/webhooks/hr-events`) and wait for my go before writing anything. Don't forget positions are pull-only and the webhook only delivers to a deployed URL, not localhost.

---

## What the feature does
Ingest users + positions from `summit-one-hr`; set PO spend limits per **user**, per **position**, and a separate **AI-agent** cap. Precedence: vendor > user > position > tenant. Over-cap → PO goes to `draft` (not blocked). Decisions made: per-order caps only; agent auto-reorder kept SUGGEST-ONLY.

## DONE & verified on stage (NOT committed)
- Migrations applied to stage: `20260605000002_hr_positions_and_spend_limits.sql`, `20260605000003_hr_people_mirror.sql`.
- `public.positions` mirror (+per-position `spending_limit`), `local_users.position_id/hr_person_id/spending_limit`, `tenant_settings.agent_auto_order_enabled/agent_auto_order_limit/hr_tenant_id`, `supply_chain.resolve_spend_limit()`, `rpc_create_purchase_order` gained `p_initiated_by`.
- `public.hr_people` roster mirror (ALL people, no limit col).
- `src/lib/hr.ts` (service-key read client), env `HR_SUPABASE_URL`/`HR_SUPABASE_SERVICE_ROLE_KEY` in .env.local + .env.example.
- Routes: `POST /api/hr/sync`, `GET /api/hr/overview`, `PATCH /api/hr/positions/[id]`, `PATCH /api/hr/users/[id]`, `PATCH /api/hr/settings`, `POST /api/webhooks/hr-events`.
- UI: `src/app/(dashboard)/settings/people/page.tsx` + "People & Limits" tab.
- Verified on stage: 50 positions synced, grant→"General Manager", cascade returns user $2000 > position $5000 > tenant $1000 > null; agent $500. Roster join works (grant is_app_user=true).

## Architecture facts
- Tenants ALIGN: app + HR both use `052abee2-ffdc-470e-975a-b917dde72b8e` → `hr_tenant_id` stays null (identity).
- HR (ref `gptqvqbrcfilersbnudl`) emits `org_people.created/updated/deleted` (payload `{op,new,old}`); NO position events → positions are pull-only.
- **Hub = `summit-one-command-center`** (ref `xwevjpxuwkjqbbldqgui`, MCP `supabase_cc`): owns `event_sources` + `event_subscriptions` + `event_deliveries`; its `events-poller` edge fn polls each spoke's `events_outbox` and POSTs to subscriber webhooks with `x-event-signature` (hmac_sha256_body). Core is just another spoke.

## Immediate next step
1. Authenticate `supabase_cc` (just added; needs Claude restart to load, then `/mcp` → Authenticate).
2. Read-only inspect hub: `event_sources` (HR present? env?), `event_subscriptions` (core-events row → endpoint_url + signing_type/secret_ref pattern).
3. Verify chassis `createWebhookRoute` validates the hub's `x-event-signature` scheme (else small fix).
4. Propose + (on approval) register HR→inventory subscription for `org_people.*` → deployed `/api/webhooks/hr-events`.

## Open decisions for the user
- Real-time needs the app DEPLOYED (hub can't POST localhost). Consider also a nightly cron Sync (covers positions too).
- Commit the HR work to `stage`? (still uncommitted)
