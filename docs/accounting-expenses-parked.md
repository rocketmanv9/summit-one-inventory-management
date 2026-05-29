# Accounting Expenses — PARKED feature

**Status:** Parked, not wired up. Undecided whether expense tracking belongs in
the inventory service at all. This doc records what already exists so the
decision can be made later without re-discovery.

**Do not build/wire this up without an explicit architecture decision.**

## What exists today

### Table (canonical location: `supply_chain`)
- `supply_chain.accounting_expenses` — created in `00000000000000_baseline.sql`
  (around line 14700). Described as *"Non-authoritative expense tracking for
  matching to POs."*
- Status check constraint: `status IN ('posted','matched','disputed','ignored')`.
- Relevant columns referenced by the matching logic: `tenant_id`, `amount`,
  `status`, `vendor_id`, `expense_date`, `po_id`, `matched_at`, `updated_at`.
- There is **no** `inventory.accounting_expenses` table — only the `supply_chain`
  one. (See schema-authority note below.)

### Database logic (already defined in baseline)
- **Trigger:** `auto_match_expenses_trigger` — `AFTER INSERT ON
  supply_chain.receipts`, runs `supply_chain.auto_match_expenses_on_receipt()`.
  Auto-matches unmatched `posted` expenses for the same vendor to the PO when a
  receipt arrives, using a ±5% amount tolerance and a date window.
- **RPC:** `supply_chain.rpc_match_expense_to_po(p_tenant_id, p_expense_id,
  p_po_id, p_user_id)` — manual match; validates expense/PO status and publishes
  an event. Granted to `service_role` and `authenticated`.

### API routes (stubbed, intentionally inert)
Under `src/app/api/inventory/accounting/expenses/`:
- `GET /` → returns `{ data: [] }` (does not query the table).
- `PATCH /:id`, `DELETE /:id`, `POST /:id/match` → throw
  `AppError.notFound('Accounting expenses API is not enabled in the inventory service')`.

These were previously commented *"table does not exist yet,"* which was **false**
— the comments were corrected to say the API is deliberately parked. The routes
are otherwise unchanged (still inert).

### What the stubs were intended to do (inferred from route names + the RPC)
- `GET /` — list a tenant's expenses.
- `PATCH /:id` — edit an expense.
- `DELETE /:id` — remove an expense.
- `POST /:id/match` — manually match an expense to a PO (would call
  `rpc_match_expense_to_po`).

## ⚠️ Schema-authority confusion (a latent bug to fix IF this is unparked)

**Canonical schema is `supply_chain`** — that is where the table, its trigger, the
RPC, RLS, and grants all live.

However, the two function **bodies** reference `inventory.accounting_expenses`
(4 sites in baseline.sql: lines ~7207, ~7217, ~9641, ~9664), e.g.
`FROM inventory.accounting_expenses` and `UPDATE inventory.accounting_expenses`.
Because the table only exists in `supply_chain`, and explicit schema
qualification ignores `search_path`, these references resolve to a
non-existent relation. Consequences:
- `auto_match_expenses_on_receipt()` would raise *"relation
  inventory.accounting_expenses does not exist"* if ever exercised by a receipt
  insert in a tenant. It has likely just never fired in practice (not verified
  against a live DB).
- If this feature is revived, change those 4 references to
  `supply_chain.accounting_expenses` (and verify the `inventory.purchase_orders`
  references in the same functions point at the correct schema too).

## Recommendation when picking this up
1. Decide ownership: inventory service vs a dedicated accounting/finance service.
2. Fix the `inventory.` → `supply_chain.` references in the two functions.
3. Implement the four routes against `supply_chain.accounting_expenses` /
   `rpc_match_expense_to_po`, emitting outbox events on writes.
4. Add tenant-scoped RLS verification (the table must enforce `tenant_id`).
