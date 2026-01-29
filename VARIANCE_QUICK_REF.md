# Cycle Count Variance - Quick Reference Card

## 🎯 Core Principle
**Counts observe. Reasons explain. Adjustments commit reality. Events tell the truth.**

---

## 📋 Workflow

```
1. CREATE → Draft cycle count
2. START → Snapshot inventory (qty_expected)
3. COUNT → Enter actual counts (qty_counted)
4. SUBMIT → Calculate variance, move to review
5. DECIDE → Accept/Investigate/Reject for each variance
6. APPROVE → Create adjustments, update stock, emit events
```

---

## 🔀 Decision Options

| Decision | Stock Changes? | Use When |
|----------|---------------|----------|
| ✅ **Accept** + reason | YES | Variance explained, adjust to reality |
| ⚠️ **Investigate** | NO | Need more info, flag for follow-up |
| ❌ **Reject** | NO | Invalid count, need recount |

---

## 🏷️ Reason Codes (for Accept)

- `usage_not_recorded` - Used but not logged
- `transfer_not_recorded` - Moved without doc
- `loss_theft` - Missing (audit flag)
- `damage_disposal` - Damaged/disposed
- `counting_error` - Human error
- `receiving_error` - Wrong receiving qty
- `bulk_drift` - Estimation drift
- `unknown` - Unclear

---

## 🚫 Guardrails

❌ Cannot approve with pending variance  
❌ Cannot accept without reason  
❌ Cannot delete posted counts  
✅ All actions tracked (who/when/why)  
✅ Original counts preserved  
✅ Events emitted for audit  

---

## 📡 Events Emitted

### inventory.stock.adjusted
**When:** Variance accepted  
**Data:** delta, reason, old_qty, new_qty, movement_id

### inventory.reorder.suggested
**When:** Stock drops below reorder point  
**Data:** item, current_qty, reorder_point

### inventory.cycle_count.rejected
**When:** Count rejected  
**Data:** variance, reason, notes

### inventory.variance.investigation_needed
**When:** Variance needs investigation  
**Data:** variance, notes, flagged_by

---

## 🎬 What Happens on Approve?

For each **accepted** variance:
1. ✅ Create stock_movement (type: adjustment)
2. ✅ Update stock_balances.qty_on_hand by delta
3. ✅ Link movement to cycle_count_line
4. ✅ Emit inventory.stock.adjusted event
5. ✅ Check reorder point → emit reorder.suggested if needed
6. ✅ Record adjustment_movement_id on line

For **investigating** variances:
- 🔍 Flag for follow-up, no stock change

For **rejected** counts:
- 🚫 Preserve for audit, no stock change

---

## 💻 API Quick Examples

### Accept Variance
```bash
POST /api/inventory/cycle-counts/{id}/lines/{line_id}/decide
{
  "decision": "accepted",
  "reason": "usage_not_recorded",
  "notes": "Used for maintenance"
}
```

### Investigate
```bash
POST /api/inventory/cycle-counts/{id}/lines/{line_id}/decide
{
  "decision": "investigating",
  "notes": "Large variance, need supervisor review"
}
```

### Approve (Success)
```bash
POST /api/inventory/cycle-counts/{id}/approve

→ 200: {
  "adjustments_created": 3,
  "reorder_suggestions": [...]
}
```

### Approve (Blocked)
```bash
POST /api/inventory/cycle-counts/{id}/approve

→ 400: {
  "error": "2 variance line(s) require decisions"
}
```

---

## 🎨 UI Behavior

### Under Review Status
- Shows variance amount & percentage
- Reason dropdown (accept path)
- Investigate button
- Reject button
- "Change" button (modify decision)

### Approve Button
- **Disabled** if variance undecided
- **Enabled** when all decided
- Shows warning/ready state
- Confirms before posting

---

## 🧪 Test Checklist

1. ✅ Create cycle count
2. ✅ Start count (creates lines)
3. ✅ Enter counts with variance
4. ✅ Submit for review
5. ✅ Try to approve → **BLOCKED**
6. ✅ Accept variance (with reason)
7. ✅ Approve → **SUCCESS**
8. ✅ Verify stock_balances updated
9. ✅ Verify stock_movements created
10. ✅ Verify events emitted

---

## 📊 Variance Calculation

```
variance = qty_counted - qty_expected

Negative (-5): Stock reduced
Positive (+5): Stock increased
~0 (≤0.01): Match, no adjustment
```

---

## 🛡️ Safety Rules

✅ Variance is evidence, not error  
✅ Never auto-default to loss/theft  
✅ Never delete count records  
✅ Never overwrite history  
✅ Always store who/when/why  
✅ Reward honesty, don't hide variance  

---

## 📁 Key Files

- Backend: `src/app/api/inventory/cycle-counts/[id]/approve/route.ts`
- Decision: `src/app/api/inventory/cycle-counts/[id]/lines/[line_id]/decide/route.ts`
- Frontend: `src/app/(dashboard)/inventory/cycle-counts/page.tsx`
- Migration: `supabase/migrations/20260129000003_add_adjustment_tracking.sql`

---

## 📖 Full Documentation

See: `CYCLE_COUNT_VARIANCE_COMPLETE.md`

---

**Status: ✅ Production Ready**
