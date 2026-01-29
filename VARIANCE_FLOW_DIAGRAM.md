# Cycle Count Variance Flow - Visual Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    CYCLE COUNT VARIANCE WORKFLOW                        │
└─────────────────────────────────────────────────────────────────────────┘

PHASE 1: OBSERVATION (Immutable)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
┌──────────┐         ┌──────────┐         ┌──────────┐
│  Draft   │  Start  │   In     │  Count  │ Submit   │
│  Count   │────────▶│ Progress │────────▶│   for    │
│          │         │          │         │  Review  │
└──────────┘         └──────────┘         └──────────┘
                           │
                           │ User enters counts
                           ▼
                    qty_counted ≠ qty_expected
                           │
                           ▼
                     VARIANCE DETECTED


PHASE 2: DECISION (Required for each variance)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

            ┌──────────────────────────┐
            │   VARIANCE DETECTED      │
            │  (counted ≠ expected)    │
            └──────────┬───────────────┘
                       │
          ┌────────────┼────────────┐
          │            │            │
          ▼            ▼            ▼
    ┌─────────┐  ┌──────────┐  ┌─────────┐
    │ ACCEPT  │  │INVESTIGATE│ │ REJECT  │
    │+ reason │  │  + notes  │  │+ notes  │
    └────┬────┘  └─────┬────┘  └────┬────┘
         │             │             │
         │             │             │


PHASE 3: OUTCOME (Different actions based on decision)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌─────────────────────────┐  ┌──────────────────────┐  ┌─────────────────────┐
│  ACCEPT PATH            │  │  INVESTIGATE PATH    │  │  REJECT PATH        │
├─────────────────────────┤  ├──────────────────────┤  ├─────────────────────┤
│ ✅ Create Movement      │  │ ⚠️  Flag for Review  │  │ ❌ Mark Invalid     │
│ ✅ Update Stock         │  │ ❌ NO Stock Change   │  │ ❌ NO Stock Change  │
│ ✅ Link to Count Line   │  │ ✅ Emit Event        │  │ ✅ Emit Event       │
│ ✅ Emit Adjusted Event  │  │ ✅ Preserve Record   │  │ ✅ Preserve Record  │
│ ✅ Check Reorder Point  │  │ ⏳ Awaits Action     │  │ 🔄 Needs Recount    │
└─────────────────────────┘  └──────────────────────┘  └─────────────────────┘


DETAILED: ACCEPT PATH (Stock Adjustment)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

 qty_expected = 100          qty_counted = 95          variance = -5
       │                            │                        │
       └────────────────────────────┴────────────────────────┘
                                    │
                      ┌─────────────▼──────────────┐
                      │  User: "Accept Variance"   │
                      │  Reason: usage_not_recorded│
                      └─────────────┬──────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
            ▼                       ▼                       ▼
    ┌───────────────┐      ┌───────────────┐      ┌──────────────┐
    │CREATE MOVEMENT│      │UPDATE BALANCE │      │ EMIT EVENTS  │
    ├───────────────┤      ├───────────────┤      ├──────────────┤
    │type:adjustment│      │old: 100       │      │stock.adjusted│
    │from_loc: L1   │      │delta: -5      │      │reorder.suggested│
    │to_loc: null   │      │new: 95        │      │              │
    │qty: 5         │      └───────────────┘      └──────────────┘
    │reason: usage  │              │
    │ref: line_id   │              │
    └───────┬───────┘              │
            │                      │
            └──────────┬───────────┘
                       ▼
              ┌────────────────┐
              │  qty_on_hand   │
              │  100 → 95      │
              │  ✅ COMMITTED  │
              └────────────────┘


VARIANCE DECISION MATRIX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌───────────────┬──────────────┬───────────────┬──────────────────────┐
│ Decision      │ Stock Change │ Event Emitted │ Use Case             │
├───────────────┼──────────────┼───────────────┼──────────────────────┤
│ Accept        │ ✅ YES       │ .adjusted     │ Variance explained   │
│ + reason      │ qty ± delta  │ .reorder*     │ Adjust to reality    │
├───────────────┼──────────────┼───────────────┼──────────────────────┤
│ Investigate   │ ❌ NO        │ .investigation│ Need more info       │
│ + notes       │ qty unchanged│               │ Flag for follow-up   │
├───────────────┼──────────────┼───────────────┼──────────────────────┤
│ Reject        │ ❌ NO        │ .rejected     │ Invalid count        │
│ + notes       │ qty unchanged│               │ Preserve for audit   │
└───────────────┴──────────────┴───────────────┴──────────────────────┘
                                                 * if qty < reorder_point


REASON CODE HANDLING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌────────────────────────┬─────────────────────────────────────────┐
│ Reason Code            │ Special Handling                        │
├────────────────────────┼─────────────────────────────────────────┤
│ usage_not_recorded     │ Standard adjustment                     │
│ transfer_not_recorded  │ Standard adjustment                     │
├────────────────────────┼─────────────────────────────────────────┤
│ loss_theft             │ ⚠️  Audit flag, security review         │
├────────────────────────┼─────────────────────────────────────────┤
│ damage_disposal        │ 🔧 Mark asset as retired (if serialized)│
├────────────────────────┼─────────────────────────────────────────┤
│ counting_error         │ ⚠️  Low confidence, training flag       │
│ receiving_error        │ Standard adjustment                     │
├────────────────────────┼─────────────────────────────────────────┤
│ bulk_drift             │ 📊 Track estimation patterns            │
│                        │ Future: Auto-accept within ±5%          │
├────────────────────────┼─────────────────────────────────────────┤
│ unknown                │ ❓ Requires investigation               │
└────────────────────────┴─────────────────────────────────────────┘


EVENT EMISSION FLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

                    ┌──────────────────┐
                    │ Variance Decision│
                    │      Made        │
                    └────────┬─────────┘
                             │
                ┌────────────┼────────────┐
                │            │            │
                ▼            ▼            ▼
        ┌───────────┐ ┌───────────┐ ┌──────────┐
        │  Accept   │ │Investigate│ │  Reject  │
        └─────┬─────┘ └─────┬─────┘ └────┬─────┘
              │             │             │
              ▼             ▼             ▼
    ┌─────────────────┐ ┌──────────────┐ ┌─────────────┐
    │inventory.stock  │ │inventory.    │ │inventory.   │
    │    .adjusted    │ │variance.     │ │cycle_count. │
    │                 │ │investigation_│ │  rejected   │
    │                 │ │   needed     │ │             │
    └────────┬────────┘ └──────────────┘ └─────────────┘
             │
             ├─ Analytics Dashboard
             ├─ Audit Logs
             ├─ Cost Accounting
             │
             └─▶ if (qty < reorder_point)
                        │
                        ▼
                ┌──────────────────┐
                │  inventory.      │
                │  reorder.        │
                │  suggested       │
                └────────┬─────────┘
                         │
                         ├─ Purchasing Module
                         ├─ Procurement Alerts
                         └─ Reorder Automation


UI STATE DIAGRAM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

UNDER REVIEW STATE:

┌─────────────────────────────────────────────────────────────┐
│  Item: Asphalt Mix Type A                                   │
│  SKU: ASP-001                                                │
│  Expected: 100 tons  │  Counted: 95 tons  │  Variance: -5   │
├─────────────────────────────────────────────────────────────┤
│  Variance %: 5.0% ⚠️                                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─ Pending Decision ──────────────────────────────────┐    │
│  │ Reason: [Select reason to accept ▼]                  │    │
│  │         - usage_not_recorded                          │    │
│  │         - transfer_not_recorded                       │    │
│  │         - loss_theft                                  │    │
│  │         ... etc                                       │    │
│  │                                                       │    │
│  │ [Investigate] [Reject Count]                          │    │
│  └───────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘

AFTER DECISION:

┌─────────────────────────────────────────────────────────────┐
│  Item: Asphalt Mix Type A                                   │
│  SKU: ASP-001                                                │
│  Expected: 100 tons  │  Counted: 95 tons  │  Variance: -5   │
├─────────────────────────────────────────────────────────────┤
│  ✅ Accepted: usage_not_recorded                [Change]    │
└─────────────────────────────────────────────────────────────┘

APPROVE BUTTON STATES:

┌──────────────────────────────────────────────────────────────┐
│ DISABLED (Undecided Variance Exists):                        │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ ⚠️  3 item(s) with variance need decisions               │ │
│ │                                                          │ │
│ │ [   Approve & Post to Inventory   ]  ← GRAYED OUT       │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ ENABLED (All Variance Decided):                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ ✓ Ready to Post                                          │ │
│ │ • 3 variance(s) will be adjusted                         │ │
│ │ • 1 variance(s) marked for investigation                 │ │
│ │                                                          │ │
│ │ [   Approve & Post to Inventory   ]  ← GREEN, ENABLED   │ │
│ └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘


DELTA CALCULATION VISUAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NEGATIVE VARIANCE (Stock Reduced):
  Expected: 100  │  Counted: 95  │  Delta: -5
        │              │               │
        └──────────────┴───────────────┘
                       │
              ┌────────▼────────┐
              │ stock_movement  │
              ├─────────────────┤
              │ from_loc: L1    │ ◀── Removing from location
              │ to_loc: null    │
              │ qty: 5          │
              │ type: adjustment│
              └─────────────────┘
                       │
              qty_on_hand: 100 → 95

POSITIVE VARIANCE (Stock Increased):
  Expected: 50  │  Counted: 55  │  Delta: +5
        │              │               │
        └──────────────┴───────────────┘
                       │
              ┌────────▼────────┐
              │ stock_movement  │
              ├─────────────────┤
              │ from_loc: null  │
              │ to_loc: L1      │ ◀── Adding to location
              │ qty: 5          │
              │ type: adjustment│
              └─────────────────┘
                       │
              qty_on_hand: 50 → 55


AUDIT TRAIL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

cycle_counts
  ├─ count_number: CC-20260129-00001
  ├─ status: posted
  ├─ approved_by_user_id: user_123
  └─ approved_at: 2026-01-29 14:30:00

cycle_count_lines
  ├─ qty_expected: 100
  ├─ qty_counted: 95
  ├─ variance: -5
  ├─ decision_status: accepted
  ├─ decision_reason: usage_not_recorded
  ├─ decision_notes: "Used for equipment maintenance"
  ├─ decided_by_user_id: user_123
  ├─ decided_at: 2026-01-29 14:25:00
  └─ adjustment_movement_id: mov_456

stock_movements
  ├─ id: mov_456
  ├─ movement_type: adjustment
  ├─ qty: 5
  ├─ reason_code: usage_not_recorded
  ├─ reference_id: line_789
  ├─ reference_type: cycle_count_line
  └─ moved_at: 2026-01-29 14:30:00

inventory.events
  ├─ event_type: inventory.stock.adjusted
  ├─ payload: { delta: -5, reason: usage_not_recorded, ... }
  └─ created_at: 2026-01-29 14:30:00


PHILOSOPHY IN ACTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

┌──────────────┬─────────────────────────────────────────────┐
│ Principle    │ Implementation                              │
├──────────────┼─────────────────────────────────────────────┤
│ Counts       │ qty_counted stored immutably                │
│ observe      │ Never deleted, always preserved             │
├──────────────┼─────────────────────────────────────────────┤
│ Reasons      │ decision_reason classifies variance         │
│ explain      │ Stored in movement, emitted in events       │
├──────────────┼─────────────────────────────────────────────┤
│ Adjustments  │ Stock updated ONLY on acceptance            │
│ commit       │ stock_movement creates permanent record    │
│ reality      │ qty_on_hand reflects counted reality        │
├──────────────┼─────────────────────────────────────────────┤
│ Events tell  │ All actions emit events                     │
│ the truth    │ Full context for audit & downstream systems │
└──────────────┴─────────────────────────────────────────────┘


STATUS: ✅ PRODUCTION READY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
