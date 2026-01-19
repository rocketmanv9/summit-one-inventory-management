# AI Agent Quick Reference - Inventory System

## 🤖 System Design Philosophy

**Ledger-First:** The source of truth is `inventory_movements` (append-only). Stock is derived.

**AI-Assisted, Not Autonomous:** AI suggests, humans approve. All automation is auditable.

**Tenant-Scoped:** Every query, every suggestion, every trace includes `tenant_id`.

---

## 🎯 Core Tables

| Table | Purpose | Key Insight |
|-------|---------|-------------|
| `inventory_movements` | Append-only ledger | **Never update/delete**. Create compensating movements. |
| `inventory_stock` | Materialized view | Auto-updated by triggers. Rebuild from ledger if corrupted. |
| `inventory_reservations` | Committed stock | Reduces `available_quantity` automatically. |
| `inventory_item_aliases` | Fuzzy matching | Use for "Did you mean?" AI suggestions. |
| `inventory_ai_suggestions` | Pending actions | **Always status='new' until human approval**. |
| `inventory_decision_traces` | Explainability log | Record WHY decisions were made. |
| `inventory_reorder_rules` | Min/max thresholds | Drive automated reorder suggestions. |

---

## 🔐 Security Model

### RLS Enforcement
- **Every table** has `tenant_id UUID NOT NULL`
- **Every policy** filters by `(auth.jwt() ->> 'tenant_id')::uuid`
- **service_role** bypasses RLS (use in backend RPCs only)

### Idempotency
- All ingestion uses `last_event_id UUID UNIQUE`
- RPCs: `ON CONFLICT (last_event_id) DO NOTHING`
- Webhooks: Check `processed_events` before processing

---

## 📊 Critical Views (Frontend-Ready)

```sql
-- Use these instead of raw tables
inventory.v_inventory_items              -- Items with stock summary + reorder status
inventory.v_inventory_availability_by_location  -- Stock per location
inventory.v_inventory_item_movement_history     -- Audit trail
inventory.v_inventory_low_stock_alerts          -- Items needing reorder
inventory.v_inventory_active_reservations       -- Currently reserved stock
```

---

## 🛠️ Safe Operations (Always Use RPCs)

### Never Write Directly to Tables
❌ Don't: `INSERT INTO inventory_stock ...`  
✅ Do: Call RPC → RPC writes to movements → Trigger updates stock

### Available RPCs

| Function | Use Case | Returns |
|----------|----------|---------|
| `rpc_inventory_receive_po(...)` | Receive from vendor | `{success, movement_id, quantity}` |
| `rpc_inventory_issue_to_job(...)` | Issue to job/project | `{success, movement_id, remaining_available}` |
| `rpc_inventory_return_from_job(...)` | Return from job | `{success, movement_id}` |
| `rpc_inventory_transfer(...)` | Move between locations | `{success, movement_id}` |
| `rpc_inventory_adjust(...)` | Count adjustment | `{success, movement_id, adjustment}` |
| `rpc_inventory_reserve(...)` | Create reservation | `{success, reservation_id}` |
| `rpc_inventory_release_reservation(...)` | Cancel reservation | `{success, reservation_id}` |
| `rpc_inventory_bootstrap_tenant(...)` | Onboard new tenant | `{success, default_location_id, ...}` |

### Example RPC Call (from Next.js API route)

```typescript
const { data, error } = await supabase.rpc('rpc_inventory_issue_to_job', {
  p_tenant_id: tenantId,
  p_user_id: userId,
  p_item_id: itemId,
  p_quantity: 10,
  p_unit_id: unitId,
  p_from_location_id: locationId,
  p_job_id: jobId,
  p_reason_code: 'JOB_INSTALL',
  p_notes: 'Installed on Job #456',
  p_event_id: uniqueEventId // For idempotency
});

if (error) throw error;
console.log(data); // { success: true, movement_id: "...", remaining_available: 40 }
```

---

## 🧠 AI-Assisted Workflows

### 1. Smart Reorder Suggestions

**AI Agent Logic:**
```sql
-- Step 1: Find low stock items
SELECT * FROM inventory.v_inventory_low_stock_alerts
WHERE tenant_id = $1;

-- Step 2: For each item, create suggestion
INSERT INTO inventory.inventory_ai_suggestions (
    tenant_id, suggestion_type, payload, reasoning, confidence
)
VALUES (
    $tenant_id,
    'reorder_item',
    jsonb_build_object(
        'item_id', $item_id,
        'current_qty', $current_qty,
        'min_qty', $min_qty,
        'reorder_qty', $reorder_qty,
        'vendor_id', $vendor_id
    ),
    format('Stock at %s units, below minimum of %s', $current_qty, $min_qty),
    0.95  -- High confidence for rule-based suggestion
)
RETURNING id;

-- Step 3: Record decision trace
INSERT INTO inventory.inventory_decision_traces (
    tenant_id, decision_type, entity_type, entity_id,
    reasoning, decision_maker, decided_by
)
VALUES (
    $tenant_id,
    'reorder_suggestion_created',
    'item',
    $item_id,
    jsonb_build_object('rule': 'min_qty_threshold', 'alert_id': $alert_id),
    'ai_agent',
    NULL  -- No user yet, will be set on approval
);
```

**Frontend displays:**
- Suggestion card with reasoning
- "Approve" button → creates PO draft
- "Reject" button → updates status to 'rejected'

---

### 2. Fuzzy Item Matching

**User types:** "2x4 stud 8ft"

**AI Agent Logic:**
```sql
-- Step 1: Normalize input
-- normalized: '2x4 stud 8ft'

-- Step 2: Search aliases
SELECT i.id, i.name, a.alias_text, a.confidence,
       similarity(a.normalized_alias, lower($input)) AS match_score
FROM inventory.inventory_item_aliases a
JOIN inventory.items i ON i.id = a.item_id
WHERE a.tenant_id = $tenant_id
  AND a.normalized_alias % lower($input)  -- Trigram similarity
ORDER BY match_score DESC
LIMIT 5;

-- Step 3: If no match, suggest creating alias
INSERT INTO inventory.inventory_item_aliases (
    tenant_id, item_id, alias_text, source, confidence
)
VALUES (
    $tenant_id,
    $matched_item_id,
    $user_input,
    'ai_learned',
    0.75  -- Lower confidence for learned alias
);
```

---

### 3. Explainable Decisions

**Every automation records WHY:**

```sql
-- When AI triggers a transfer
INSERT INTO inventory.inventory_decision_traces (
    tenant_id,
    decision_type,
    entity_type,
    entity_id,
    reasoning,
    decision_maker,
    outcome
)
VALUES (
    $tenant_id,
    'stock_transfer_triggered',
    'movement',
    $movement_id,
    jsonb_build_object(
        'rule', 'balance_stock_across_locations',
        'from_location', $from_location_name,
        'from_available', $from_qty,
        'to_location', $to_location_name,
        'to_available', $to_qty,
        'threshold_delta', $threshold
    ),
    'ai_agent',
    'success'
);
```

**User can query:** "Why was stock moved from Yard A to Yard B?"

**System shows:** "AI balanced stock: Yard A had 150 units (75 over threshold), Yard B had 20 units (30 under threshold). Transferred 50 units to optimize."

---

## 📈 Metrics & Monitoring

### Key Queries for Dashboards

**Stock Health:**
```sql
SELECT 
    COUNT(*) FILTER (WHERE needs_reorder) AS items_need_reorder,
    COUNT(*) AS total_active_items,
    SUM(total_available) AS total_available_units
FROM inventory.v_inventory_items
WHERE tenant_id = $tenant_id AND status = 'active';
```

**AI Suggestion Metrics:**
```sql
SELECT 
    suggestion_type,
    status,
    COUNT(*) AS count,
    AVG(confidence) AS avg_confidence
FROM inventory.inventory_ai_suggestions
WHERE tenant_id = $tenant_id
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY suggestion_type, status;
```

**Decision Audit:**
```sql
SELECT 
    decision_type,
    decision_maker,
    COUNT(*) AS count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count
FROM inventory.inventory_decision_traces
WHERE tenant_id = $tenant_id
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY decision_type, decision_maker;
```

---

## 🚨 Common Pitfalls

### ❌ Don't: Direct Stock Manipulation
```sql
-- WRONG
UPDATE inventory.inventory_stock
SET on_hand_quantity = on_hand_quantity + 10;
```

### ✅ Do: Create Movement
```sql
-- CORRECT
SELECT inventory.rpc_inventory_adjust(
    p_tenant_id := $tenant_id,
    p_quantity_delta := 10,
    p_reason_code := 'ADJUST_FOUND',
    ...
);
```

---

### ❌ Don't: Auto-Apply AI Suggestions
```sql
-- WRONG
INSERT INTO inventory_movements (...)
SELECT payload->>'item_id', ...
FROM inventory_ai_suggestions
WHERE status = 'new';
```

### ✅ Do: Wait for Human Approval
```sql
-- CORRECT - Only process approved suggestions
UPDATE inventory_ai_suggestions
SET status = 'accepted', resolved_by = $user_id, resolved_at = NOW()
WHERE id = $suggestion_id
RETURNING payload;

-- Then: Use payload to create actual movement via RPC
```

---

### ❌ Don't: Forget Tenant Scope
```sql
-- WRONG - Leaks across tenants
SELECT SUM(on_hand_quantity) FROM inventory.inventory_stock;
```

### ✅ Do: Always Filter by Tenant
```sql
-- CORRECT
SELECT SUM(on_hand_quantity) 
FROM inventory.inventory_stock
WHERE tenant_id = $tenant_id;
```

---

## 🎓 Naming Conventions

| Pattern | Example | Usage |
|---------|---------|-------|
| `rpc_inventory_*` | `rpc_inventory_receive_po` | Public callable functions |
| `v_inventory_*` | `v_inventory_items` | Read-only views |
| `inventory_*` | `inventory_movements` | Domain tables |
| `*_tenant_isolation` | `movements_tenant_isolation` | RLS policies |
| `trigger_*` | `trigger_update_stock` | Trigger names |
| `idx_*_tenant_*` | `idx_movements_tenant_created` | Indexes (always start with tenant) |

---

## 🔄 Data Flow Summary

```
Human Action
    ↓
Frontend Component
    ↓
Next.js API Route (validates session)
    ↓
RPC Call (SECURITY DEFINER, validates tenant)
    ↓
Insert into inventory_movements (ledger)
    ↓
Trigger: update_stock_on_movement (updates read model)
    ↓
Trigger: publish_movement_event (outbox)
    ↓
Events Poller → Core/Other Services
    ↓
Decision Trace (optional, for explainability)
    ↓
Response to Frontend
```

**AI Suggestions run in parallel:**
```
Scheduled Job / Webhook
    ↓
AI Agent queries views (v_inventory_low_stock_alerts, etc.)
    ↓
Insert into inventory_ai_suggestions (status='new')
    ↓
Insert into inventory_decision_traces (decision_maker='ai_agent')
    ↓
Frontend polls for suggestions
    ↓
User approves/rejects
    ↓
Update suggestion status
    ↓
If approved → trigger actual RPC call
```

---

## 🧪 Quick Sanity Checks

**Before deployment:**
```sql
-- 1. All tables have RLS
SELECT tablename FROM pg_tables 
WHERE schemaname = 'inventory' AND rowsecurity = false;
-- Expected: 0 rows

-- 2. All movements have ledger protection
SELECT tgname FROM pg_trigger 
WHERE tgrelid = 'inventory.inventory_movements'::regclass 
  AND tgname = 'prevent_movements_modification';
-- Expected: 1 row

-- 3. Stock rebuilds correctly
SELECT inventory.rebuild_stock_from_ledger($tenant_id);
-- Expected: success=true
```

---

## 📞 AI Agent Commands

| What AI Wants to Do | Command |
|---------------------|---------|
| Find low stock items | `SELECT * FROM v_inventory_low_stock_alerts WHERE tenant_id = $1` |
| Suggest reorder | `INSERT INTO inventory_ai_suggestions (suggestion_type='reorder_item', ...)` |
| Check availability | `SELECT available_quantity FROM inventory_stock WHERE tenant_id=$1 AND item_id=$2` |
| Audit movements | `SELECT * FROM v_inventory_item_movement_history WHERE tenant_id=$1 AND item_id=$2` |
| Match fuzzy input | `SELECT * FROM inventory_item_aliases WHERE normalized_alias % lower($input)` |
| Explain decision | `SELECT reasoning FROM inventory_decision_traces WHERE entity_id=$1 ORDER BY created_at DESC LIMIT 1` |
| Bootstrap new tenant | `SELECT inventory.rpc_inventory_bootstrap_tenant($tenant_id, $user_id)` |

---

**Remember:** This system is ledger-first, AI-assisted, tenant-scoped, and designed for explainability. Every operation is auditable. Every suggestion requires approval. Every decision is traceable.
