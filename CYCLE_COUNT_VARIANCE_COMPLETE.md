# Cycle Count Variance Handling - Complete Implementation Guide

## Core Philosophy

**Counts observe. Reasons explain. Adjustments commit reality. Events tell the truth.**

A cycle count is an **observation**, not a correction. Corrections only happen when a user accepts variance with a reason. The system clearly separates:

1. **Observation** (cycle count)
2. **Explanation** (reason)
3. **Decision** (accept / investigate / reject)
4. **Adjustment** (actual stock change)

---

## Workflow States

### 1. Draft → In Progress
- User creates cycle count, selects location
- User clicks "Start Count"
- System snapshots current inventory (`qty_on_hand` → `qty_expected`)
- Creates `cycle_count_lines` for each item at location
- Status changes to `in_progress`

### 2. In Progress → Under Review
- User enters actual counts (`qty_counted`)
- System calculates variance: `counted - expected`
- User clicks "Submit for Review"
- Status changes to `under_review`
- Lines with variance require decisions

### 3. Under Review → Posted
- User makes decisions for each variance:
  - **Accept** (with reason) - will adjust inventory
  - **Investigate** - flag for follow-up, no adjustment
  - **Reject** - invalid count, no adjustment
- User clicks "Approve & Post"
- System validates all variance has decisions
- Creates stock movements for accepted variances
- Updates `qty_on_hand` in stock_balances
- Emits events
- Status changes to `posted`

---

## Decision Types & Behaviors

### Accept Variance ✓
**What happens:**
1. Creates `stock_movement` with `movement_type='adjustment'`
2. Updates `stock_balances.qty_on_hand` by variance delta
3. Links movement to cycle count line (`reference_type='cycle_count_line'`)
4. Stores reason code and notes in movement
5. Emits `inventory.stock.adjusted` event
6. If new qty < reorder_point, emits `inventory.reorder.suggested` event

**Required:** Reason code selection

**Reason Codes:**
- `usage_not_recorded` - Material used but not logged
- `transfer_not_recorded` - Moved locations without documentation
- `loss_theft` - Missing due to loss or theft (audit flag)
- `damage_disposal` - Damaged/disposed items not recorded
- `counting_error` - Human error during counting (low confidence)
- `receiving_error` - Receiving transaction recorded incorrectly
- `bulk_drift` - Estimation drift for bulk materials
- `unknown` - Reason unclear

**Example:**
```
Expected: 100 units
Counted: 95 units
Variance: -5 units
Decision: Accepted (reason: usage_not_recorded)
Result: qty_on_hand reduced from 100 → 95
```

### Investigate ⚠
**What happens:**
1. Marks line with `decision_status='investigating'`
2. Records notes from user
3. Does **NOT** adjust inventory
4. Emits `inventory.variance.investigation_needed` event
5. Inventory remains locked at expected quantity

**Use when:**
- Variance is unexplained
- Need to review usage logs
- Need to check transfer records
- Suspect counting error but unsure
- Requires physical recount

**Resolution:**
- User investigates root cause
- Can change decision to Accept or Reject after investigation

### Reject Count ✗
**What happens:**
1. Marks line with `decision_status='rejected'`
2. Records notes explaining why count is invalid
3. Does **NOT** adjust inventory
4. Preserves count record for audit trail
5. Emits `inventory.cycle_count.rejected` event

**Use when:**
- Counting process was flawed
- Wrong location counted
- Wrong item identified
- Count occurred during active operations
- Data entry error detected

**Result:** Count observation is invalidated, no stock change

---

## Guardrails & Safety Rules

### Hard Rules
✅ **NEVER** auto-default to "Loss / Theft"  
✅ **NEVER** delete cycle count records  
✅ **NEVER** overwrite count history  
✅ **ALWAYS** store: who, when, why  
✅ **ALWAYS** require reason for accepted variance  
✅ **ALWAYS** block posting if variance undecided  
✅ **NEVER** run reorder logic on count completion (only after adjustment)  

### Validation
- Cannot approve cycle count with pending variance decisions
- Cannot accept variance without selecting a reason
- Cannot delete posted cycle counts
- Variance tolerance: >0.01 units requires decision (<0.01 = match, auto-accepted)

---

## Event Emission

### inventory.stock.adjusted
**Emitted when:** Variance accepted and posted

**Payload:**
```json
{
  "catalog_item_id": "uuid",
  "location_id": "uuid",
  "delta": -5.0,
  "reason": "usage_not_recorded",
  "old_qty": 100,
  "new_qty": 95,
  "cycle_count_id": "uuid",
  "adjusted_by": "user_id",
  "movement_id": "uuid"
}
```

**Consumers:**
- Analytics dashboards
- Audit logs
- Variance reporting
- Cost accounting

### inventory.reorder.suggested
**Emitted when:** Stock adjustment drops qty below reorder point

**Payload:**
```json
{
  "catalog_item_id": "uuid",
  "item_name": "Asphalt Mix Type A",
  "sku": "ASP-001",
  "current_qty": 20,
  "reorder_point": 50,
  "triggered_by": "cycle_count",
  "cycle_count_id": "uuid"
}
```

**Consumers:**
- Purchasing module
- Reorder automation
- Procurement alerts

### inventory.cycle_count.rejected
**Emitted when:** Count is rejected as invalid

**Payload:**
```json
{
  "cycle_count_id": "uuid",
  "line_id": "uuid",
  "catalog_item_id": "uuid",
  "variance": -5.0,
  "qty_counted": 95,
  "qty_expected": 100,
  "reason": "counting_error",
  "notes": "Count performed during active loading operations",
  "rejected_by": "user_id"
}
```

**Consumers:**
- Quality control
- Audit trails
- Recount scheduling

### inventory.variance.investigation_needed
**Emitted when:** Variance marked for investigation

**Payload:**
```json
{
  "cycle_count_id": "uuid",
  "line_id": "uuid",
  "catalog_item_id": "uuid",
  "variance": -5.0,
  "qty_counted": 95,
  "qty_expected": 100,
  "reason": null,
  "notes": "Large variance, need to review usage logs",
  "flagged_by": "user_id"
}
```

**Consumers:**
- Investigation queue
- Supervisor notifications
- Audit workflows

---

## API Endpoints

### POST /api/inventory/cycle-counts/[id]/lines/[line_id]/decide
Make variance decision

**Request:**
```json
{
  "decision": "accepted",
  "reason": "usage_not_recorded",
  "notes": "Material used for equipment maintenance"
}
```

**Validations:**
- `decision` must be: pending, accepted, rejected, investigating
- If `decision=accepted`, `reason` is required
- `reason` must be valid code (see list above)

**Response:**
```json
{
  "data": { /* updated line */ },
  "message": "Variance accepted"
}
```

### POST /api/inventory/cycle-counts/[id]/approve
Approve and post cycle count

**Validations:**
- All variance lines must have decisions (not pending)
- Cycle count must be in `under_review` status

**Process:**
1. Validates all variance decided
2. For each accepted variance:
   - Creates stock_movement
   - Updates stock_balances.qty_on_hand
   - Links movement to cycle_count_line
   - Emits inventory.stock.adjusted event
   - Checks reorder point, emits reorder.suggested if needed
3. Updates cycle count status to `posted`

**Response:**
```json
{
  "data": {
    "success": true,
    "message": "Cycle count posted with 3 adjustment(s)",
    "adjustments_created": 3,
    "adjustments": [
      { "catalog_item_id": "uuid", "delta": -5, "new_qty": 95 }
    ],
    "reorder_suggestions": [
      { "catalog_item_id": "uuid", "sku": "ASP-001", "current_qty": 20, "reorder_point": 50 }
    ]
  }
}
```

---

## Database Schema

### cycle_count_lines
```sql
decision_status variance_decision_status DEFAULT 'pending'
decision_reason TEXT
decision_notes TEXT
decided_by_user_id UUID
decided_at TIMESTAMPTZ
adjustment_movement_id UUID REFERENCES stock_movements(id)
posted_at TIMESTAMPTZ
```

### stock_movements
```sql
movement_type TEXT -- 'adjustment' for cycle count variances
reason_code TEXT -- maps to decision_reason
reference_id UUID -- links to cycle_count_lines.id
reference_type TEXT -- 'cycle_count_line'
```

---

## UI Behavior

### Under Review Status
**Displays:**
- List of all count lines
- Variance amount and percentage for each
- Decision interface for lines with variance:
  - Reason dropdown (if variance exists)
  - "Investigate" button
  - "Reject Count" button
- Decision status badge (accepted/investigating/rejected)
- "Change" button to modify decision

**Approve Button:**
- **Disabled** if any variance pending
- Shows warning: "⚠ X item(s) with variance need decisions"
- **Enabled** when all variance decided
- Shows summary: "✓ Ready to Post - X variance(s) will be adjusted"
- Confirms action with details before posting

### Blind Count Mode
- Hides `qty_expected` during counting
- Reveals variance only in review stage
- Prevents bias during observation

---

## Special Handling by Reason

### Loss / Theft
- Flags item for audit review
- May trigger security investigation workflow
- Tracks loss patterns by item/location

### Damage / Disposal
- If item is asset-tracked (serialized), marks asset as `retired/disposed`
- Updates asset lifecycle status
- Links to disposal documentation

### Bulk Drift
- Common for bulk materials (asphalt, concrete, aggregates)
- Future: Auto-accept within tolerance band (±5% for bulk items)
- Tracks estimation drift patterns

### Counting Error
- Marks as "low confidence" adjustment
- May trigger recount requirement
- Used for training/quality improvement

---

## Future Enhancements

### Tolerance Bands (Auto-Accept)
For bulk items, auto-accept variance within threshold:
```javascript
if (item.tracking_mode === 'bulk' && Math.abs(variance_percent) < 5%) {
  decision_status = 'accepted'
  decision_reason = 'within_tolerance'
}
```

### Investigation Workflow
- Dedicated investigation queue page
- Ability to attach photos/documents
- Investigation resolution tracking
- Recount scheduling from investigation

### Variance Analytics
- Variance trends by item/location/reason
- Counting accuracy metrics by user
- Cost impact of variances
- Pattern detection (frequent loss at specific location)

---

## Testing Scenarios

### Scenario 1: Accepted Variance
1. Create cycle count for "Warehouse A"
2. Start count (snapshots 100 units expected)
3. Enter 95 units counted (variance: -5)
4. Submit for review
5. Select reason: "usage_not_recorded"
6. Approve & Post
7. **Verify:** qty_on_hand = 95, stock_movement created, event emitted

### Scenario 2: Investigation
1. Count shows -20 units variance (large)
2. Click "Investigate"
3. Add notes: "Need to check recent transfers"
4. Approve (investigation doesn't adjust stock)
5. **Verify:** qty_on_hand unchanged, investigation event emitted

### Scenario 3: Rejected Count
1. Count shows +50 units variance
2. Realize count was done at wrong location
3. Click "Reject Count"
4. Add notes: "Wrong location - need recount"
5. Approve
6. **Verify:** qty_on_hand unchanged, rejection event emitted

### Scenario 4: Blocked Posting
1. Count has 3 items with variance
2. Accept 2, leave 1 pending
3. Try to approve
4. **Verify:** Button disabled, warning shown, posting blocked

### Scenario 5: Reorder Trigger
1. Item has reorder_point = 50
2. Expected: 60, Counted: 40 (variance: -20)
3. Accept variance (reason: loss_theft)
4. Approve & Post
5. **Verify:** qty_on_hand = 40, reorder.suggested event emitted

---

## API Examples

### Accept Variance
```bash
curl -X POST /api/inventory/cycle-counts/123/lines/456/decide \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "accepted",
    "reason": "usage_not_recorded",
    "notes": "Used for equipment maintenance, ticket #789"
  }'
```

### Investigate
```bash
curl -X POST /api/inventory/cycle-counts/123/lines/456/decide \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "investigating",
    "notes": "Large variance, need supervisor review"
  }'
```

### Reject
```bash
curl -X POST /api/inventory/cycle-counts/123/lines/456/decide \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "rejected",
    "notes": "Count performed during active operations"
  }'
```

### Approve (Blocked)
```bash
curl -X POST /api/inventory/cycle-counts/123/approve

# Response (400):
{
  "error": "2 variance line(s) require decisions before posting"
}
```

### Approve (Success)
```bash
curl -X POST /api/inventory/cycle-counts/123/approve

# Response (200):
{
  "data": {
    "success": true,
    "message": "Cycle count posted with 3 adjustment(s)",
    "adjustments_created": 3,
    "adjustments": [...],
    "reorder_suggestions": [...]
  }
}
```

---

## Summary Checklist

✅ Counts observe (immutable observation)  
✅ Reasons explain (classification)  
✅ Adjustments commit reality (stock change)  
✅ Events tell the truth (audit trail)  
✅ No silent auto-fixing  
✅ Require reason for acceptance  
✅ Support investigation workflow  
✅ Support rejection workflow  
✅ Block posting if variance undecided  
✅ Update stock_balances on acceptance  
✅ Create stock_movements with reason  
✅ Emit events for all actions  
✅ Trigger reorder logic only after adjustment  
✅ Link adjustments to cycle count lines  
✅ Preserve all history  
✅ Never delete records  
✅ Store who/when/why  
✅ Reward honesty, not hide variance  

**Status: ✅ COMPLETE & PRODUCTION-READY**
