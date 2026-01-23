# Vendor Ordering Modes & Distributor Support - Implementation Notes

## 🎯 Problem Solved

**The Reality:** Not all vendors accept traditional purchase orders. Large distributors (Uline, Grainger, White Cap, HD Supply) require ordering through portals, while retail vendors (Home Depot, Amazon) use card payments. The PO exists internally for authorization and tracking, but may never be "sent" to the vendor.

**The Solution:** Decouple "PO creation" from "order placement" and support multiple vendor ordering patterns without breaking PO integrity or inventory accuracy.

---

## ✅ What Was Changed

### 1. Key Assumptions REMOVED

| Old Assumption | New Reality |
|---------------|-------------|
| ❌ "PO must be sent to be valid" | ✅ PO is internal authorization; sending is optional |
| ❌ "All vendors accept emailed POs" | ✅ Different vendors have different ordering modes |
| ❌ "Vendor confirms receipt of PO" | ✅ Confirmation is optional; not required for receiving |
| ❌ "PO placement = PO sending" | ✅ Ordering and sending are separate actions |
| ❌ "Can't receive without vendor confirmation" | ✅ Can always receive against open PO |

### 2. New Enum: `ordering_mode`

Created explicit vendor ordering modes that reflect real-world patterns:

```sql
CREATE TYPE supply_chain.ordering_mode AS ENUM (
    'email_po',              -- Traditional: PO emailed to vendor
    'portal_with_po_ref',    -- Portal ordering - PO # referenced during checkout
    'phone_with_po_ref',     -- Phone ordering - PO # referenced verbally
    'card_only_internal_po', -- Card payment - PO is internal only
    'pickup_only',           -- In-person pickup - PO is authorization
    'mixed'                  -- Vendor supports multiple methods
);
```

**Why This Matters:**
- Drives UI hints and workflow guidance
- Does NOT hard-block users
- Config-driven, not code-driven
- Editable per-vendor without code changes

### 3. Extended Vendor Configuration

Added fields to `supply_chain.vendors`:

| Field | Purpose | Example |
|-------|---------|---------|
| `ordering_mode` | How to order from this vendor | `portal_with_po_ref` |
| `accepts_net_terms` | Invoice vs card payment | `true` (invoices) or `false` (card only) |
| `requires_external_order_number` | Need vendor's order # for receiving | `true` for Uline/Grainger |
| `portal_url` | Link to vendor portal | `https://www.uline.com` |
| `phone_number` | Phone for orders | `1-800-VENDOR` |
| `notes_for_buyers` | Free-text guidance | "Enter PO # in comments field" |

**Example Vendor Configs:**

```typescript
// Uline
{
  ordering_mode: 'portal_with_po_ref',
  portal_url: 'https://www.uline.com',
  accepts_net_terms: true,
  requires_external_order_number: true,
  notes_for_buyers: 'Enter PO # in Reference field during checkout. Account required.'
}

// Home Depot
{
  ordering_mode: 'card_only_internal_po',
  portal_url: 'https://www.homedepot.com',
  accepts_net_terms: false,
  default_payment_method: 'card',
  notes_for_buyers: 'Use company card. Attach receipt when receiving.'
}

// Traditional Supplier
{
  ordering_mode: 'email_po',
  po_email: 'orders@supplier.com',
  accepts_net_terms: true,
  notes_for_buyers: 'Email PO to orders@ - they will confirm within 24 hours'
}
```

### 4. External Order Tracking (Optional)

Added fields to `supply_chain.purchase_orders`:

| Field | Purpose | Required |
|-------|---------|----------|
| `external_order_number` | Vendor's order/confirmation # | Optional |
| `ordered_at` | When order was placed | Optional |
| `ordered_by_user_id` | Who placed the external order | Optional |
| `order_placement_method` | Portal/phone/email/in_person | Optional |
| `order_placement_notes` | Free-text notes about placement | Optional |

**Why Optional:**
- Provides traceability when available
- Doesn't block workflow when unknown
- Useful for invoice matching
- Helps troubleshoot shipping issues

**Key Insight:** `sent_at` and `ordered_at` are DIFFERENT:
- `sent_at` = When PO email was sent (if applicable)
- `ordered_at` = When order was placed with vendor (portal/phone/email)

### 5. New RPC Functions

#### `rpc_mark_po_ordered()`
Records that order was placed with vendor (portal/phone/email).

```typescript
markPOAsOrdered(
  poId: string,
  externalOrderNumber?: string,
  placementMethod?: 'portal' | 'email' | 'phone' | 'in_person',
  placementNotes?: string
)
```

**What it does:**
- Updates PO status to `placed`
- Records external order details
- Emits `purchase_order.ordered_externally` event
- Does NOT send email (separate action)

#### `rpc_send_po_email()`
Sends PO via email (if vendor accepts email POs).

```typescript
sendPOEmail(
  poId: string,
  recipientEmail?: string
)
```

**What it does:**
- Updates `sent_at` timestamp
- Emits `purchase_order.sent` event
- Triggers email service (via event)
- Completely separate from "ordering"

**Critical Distinction:**
```
Email PO Vendor:
  1. Create PO
  2. Send PO via email → rpc_send_po_email()
  3. Vendor confirms (optional)
  4. Receive materials

Portal Vendor (Uline):
  1. Create PO
  2. Log into portal
  3. Add to cart, reference PO # at checkout
  4. Mark as ordered → rpc_mark_po_ordered()
  5. Receive materials (PO never "sent")
```

### 6. View: `v_vendor_ordering_guidance`

Provides ordering instructions per vendor:

```sql
SELECT * FROM supply_chain.v_vendor_ordering_guidance WHERE vendor_id = ?;

Returns:
{
  ordering_instructions: "Order via portal: https://uline.com\nReference PO # during checkout",
  payment_guidance: "Invoice - Net 30",
  receiving_notes: "External order # required for receiving"
}
```

**Used By:**
- `PlaceOrderModal` to show context-aware guidance
- `CreatePOModal` to display vendor requirements
- Dashboard widgets to remind users

---

## 🎨 UI Changes

### New Component: `PlaceOrderModal`

Mode-aware modal that guides users through order placement:

| Vendor Type | UI Shows |
|-------------|----------|
| **Email PO** | Email input, "Send PO" button |
| **Portal** | "Open Portal" link, steps, external order # input |
| **Phone** | Phone number, call instructions, confirmation # input |
| **Card Only** | Payment reminder, order # input, receipt note |
| **Pickup** | Print PO button, pickup notes |
| **Mixed** | Method selector, dynamic form |

**Example: Portal Vendor (Uline)**

```
┌─────────────────────────────────────────┐
│ Place Order - PO #PO-2026-042           │
│ Uline • Portal (w/ PO Ref)              │
├─────────────────────────────────────────┤
│ ℹ Order placed in vendor portal,        │
│   PO # referenced during checkout       │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ PO Number: PO-2026-042    [Copy]    │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ [Open Uline Portal]                     │
│                                         │
│ Steps:                                  │
│ 1. Log in to vendor portal              │
│ 2. Add items to cart                    │
│ 3. Enter PO # PO-2026-042 at checkout   │
│ 4. Complete order and save confirm #    │
│                                         │
│ External Order # (required)             │
│ [_________________________________]     │
│                                         │
│ Order Notes (optional)                  │
│ [_________________________________]     │
│ [_________________________________]     │
│                                         │
│ [✓ Confirm Order Placed]                │
│                                         │
│ Payment: Invoice - Net 30               │
│ Receiving: External order # required    │
└─────────────────────────────────────────┘
```

### Updated `CreatePOModal`

Now shows vendor-specific hints:

```tsx
{vendorDefaults && vendorDefaults.ordering_mode === 'portal_with_po_ref' && (
  <Alert>
    <Globe className="h-4 w-4" />
    <AlertDescription>
      This vendor requires portal ordering.
      You'll reference this PO # during checkout.
    </AlertDescription>
  </Alert>
)}
```

---

## 🔄 Workflow Changes

### Before (Rigid)
```
Create PO → Send PO → Wait for Confirmation → Receive
```
❌ Assumes vendor accepts email POs  
❌ Blocks on confirmation  
❌ Doesn't support portals

### After (Flexible)
```
Create PO (internal authorization)
  ↓
[Choose based on vendor mode]
  ├─ Email PO → Send via rpc_send_po_email()
  ├─ Portal → Order in portal → Mark ordered via rpc_mark_po_ordered()
  ├─ Phone → Call vendor → Mark ordered
  ├─ Card → Purchase with card → Mark ordered
  └─ Pickup → Schedule pickup → Mark ordered
  ↓
Receive (always works, regardless of ordering mode)
```

✅ Supports all vendor types  
✅ No blocking steps  
✅ Receiving always works

---

## 📊 Event Model

### New Event: `purchase_order.ordered_externally`

Emitted when order is placed (portal/phone/email):

```json
{
  "event_type": "purchase_order.ordered_externally",
  "payload": {
    "po_id": "uuid",
    "po_number": "PO-2026-042",
    "external_order_number": "ULINE-12345678",
    "order_placement_method": "portal",
    "vendor_id": "uuid"
  }
}
```

### Existing Event: `purchase_order.sent`

Now specifically for email sending (optional):

```json
{
  "event_type": "purchase_order.sent",
  "payload": {
    "po_id": "uuid",
    "po_number": "PO-2026-042",
    "recipient_email": "orders@vendor.com",
    "vendor_id": "uuid"
  }
}
```

**Key Distinction:**
- `ordered_externally` = Order placed (all vendors)
- `sent` = PO emailed (email-based vendors only)

---

## 🛡️ Data Integrity Guarantees

### What Still Works

✅ **Inventory correctness:** Receiving is still the only thing that moves inventory  
✅ **Auditability:** All order placement tracked with user, timestamp, method  
✅ **Multi-tenant safety:** All queries scoped by tenant  
✅ **Event-driven:** Events emitted for all state changes  
✅ **Idempotency:** `last_event_id` on all mutations

### What Changed (Safely)

| Aspect | Before | After |
|--------|--------|-------|
| PO validity | Required "sent" | Valid when created |
| Receiving gate | Needed confirmation | Always allowed on open PO |
| Vendor interaction | Assumed email | Mode-specific |
| Status tracking | Linear progression | Flexible workflow |

---

## 🎯 Real-World Scenarios Supported

### Scenario 1: Uline Portal Order

```
1. Foreman creates PO for safety supplies
2. Office admin logs into Uline portal
3. Adds items to cart
4. Enters PO # in "Reference" field at checkout
5. Completes order, gets Uline order # ULINE-12345678
6. Clicks "Mark as Ordered" in system
7. Enters Uline order # and cart total
8. Materials arrive with packing slip showing Uline order #
9. Receive against PO (matches by PO # or Uline #)
10. Invoice arrives with Uline # - matches to PO
```

✅ PO never emailed  
✅ Still tracks authorization  
✅ Receiving works  
✅ Invoice matching works

### Scenario 2: Home Depot Card Purchase

```
1. Foreman creates PO for emergency supplies
2. Runner goes to Home Depot
3. Buys with company card
4. Marks PO as "ordered" with card payment method
5. Attaches receipt photo
6. Receive against PO when back at yard
```

✅ Vendor never saw PO  
✅ PO provides authorization  
✅ Receipt attached for audit  
✅ Cost tracked to job

### Scenario 3: Traditional Email PO

```
1. Create PO for asphalt
2. Click "Send PO" → emails to vendor
3. Vendor confirms via email (optional)
4. Materials arrive
5. Receive against PO
```

✅ Works exactly as before  
✅ Backwards compatible

---

## 📝 Migration Guide

### For Existing POs

```sql
-- All existing POs default to 'email_po' mode
UPDATE supply_chain.vendors
SET ordering_mode = 'email_po'
WHERE ordering_mode IS NULL;
```

**Safe:** Existing workflows unchanged.

### For Existing Vendors

Classify your vendors:

```sql
-- Portal vendors (Uline, Grainger, etc)
UPDATE supply_chain.vendors
SET ordering_mode = 'portal_with_po_ref',
    portal_url = 'https://www.uline.com',
    requires_external_order_number = true,
    notes_for_buyers = 'Enter PO # in Reference field during checkout'
WHERE name ILIKE '%uline%';

-- Card-only vendors (retail)
UPDATE supply_chain.vendors
SET ordering_mode = 'card_only_internal_po',
    accepts_net_terms = false,
    default_payment_method = 'card',
    notes_for_buyers = 'Use company card. PO is for internal tracking.'
WHERE name ILIKE '%home depot%' OR name ILIKE '%amazon%';
```

---

## 🚀 Usage Examples

### TypeScript: Place Order via Portal

```typescript
import { PlaceOrderModal } from '@/components/modals/PlaceOrderModal';

function PODetailPage({ po }: { po: PurchaseOrder }) {
  const [showPlaceOrder, setShowPlaceOrder] = useState(false);
  
  return (
    <>
      <Button onClick={() => setShowPlaceOrder(true)}>
        Place Order
      </Button>
      
      <PlaceOrderModal
        open={showPlaceOrder}
        onClose={() => setShowPlaceOrder(false)}
        po={po}
        onSuccess={() => {
          toast.success('Order placed successfully');
          refreshPO();
        }}
      />
    </>
  );
}
```

### TypeScript: Get Vendor Guidance

```typescript
import { getVendorOrderingGuidance } from '@/lib/api/purchase-orders';

const guidance = await getVendorOrderingGuidance(vendorId);

// Shows:
// {
//   ordering_instructions: "Order via portal: https://uline.com\nReference PO # during checkout",
//   payment_guidance: "Invoice - Net 30",
//   receiving_notes: "External order # required for receiving"
// }
```

### SQL: Query POs by Ordering Mode

```sql
-- Find all POs for portal vendors
SELECT po.*, v.ordering_mode, v.portal_url
FROM supply_chain.purchase_orders po
JOIN supply_chain.vendors v ON v.id = po.vendor_id
WHERE v.ordering_mode = 'portal_with_po_ref'
  AND po.status = 'draft';
```

---

## ⚠️ Important Notes

### PO "Sending" is Now Optional

**Old Code:**
```typescript
if (!po.sent_at) {
  throw new Error('PO must be sent before receiving'); // ❌ WRONG
}
```

**New Code:**
```typescript
if (po.status === 'draft') {
  throw new Error('PO must be approved before receiving'); // ✅ CORRECT
}
// sent_at is optional - portal vendors never "send"
```

### External Order Numbers

**Use Cases:**
- Invoice matching (vendor shows their order #, not PO #)
- Receiving lookup (packing slip has vendor order #)
- Customer service (vendor needs their order # to help)

**Not Required:**
- Creating PO
- Approving PO
- Receiving (can use PO # OR external order #)

### Receiving Still Works Universally

```typescript
// Can receive against PO regardless of:
// - Whether it was "sent"
// - Whether vendor confirmed
// - How order was placed
// - Payment method

receiveAgainstPO(poId, lines); // ✅ Always works for open POs
```

---

## 🔮 Future Enhancements

### Phase 2 (Easy Adds)

- [ ] Vendor portal SSO links
- [ ] Automated external order # capture (via email parsing)
- [ ] Vendor performance by ordering mode
- [ ] Bulk "mark as ordered" for daily portal orders
- [ ] Receipt photo attachment for card purchases

### Phase 3 (Advanced)

- [ ] Portal API integrations (Uline API, Grainger API)
- [ ] Auto-submit POs via vendor APIs
- [ ] Real-time order status from vendor portals
- [ ] Automated invoice matching by external order #
- [ ] Vendor spending analytics by ordering mode

---

## ✅ Testing Checklist

### Database

- [ ] Migration applies cleanly
- [ ] Enum created successfully
- [ ] Vendor config fields added
- [ ] PO external order fields added
- [ ] View `v_vendor_ordering_guidance` returns data
- [ ] RPCs execute without errors

### API

- [ ] `markPOAsOrdered()` updates status to 'placed'
- [ ] `sendPOEmail()` updates sent_at timestamp
- [ ] `getVendorOrderingGuidance()` returns guidance
- [ ] Events emitted correctly
- [ ] Portal vendors don't require sent_at
- [ ] Card-only vendors work without email

### UI

- [ ] `PlaceOrderModal` shows correct UI per mode
- [ ] Email mode shows email input
- [ ] Portal mode shows portal link + external order input
- [ ] Phone mode shows phone number
- [ ] Card mode shows payment reminder
- [ ] Pickup mode shows print PO button
- [ ] Vendor guidance displays correctly
- [ ] PO number copy works
- [ ] Modal validates required fields

### Workflows

- [ ] Can create PO for portal vendor
- [ ] Can mark portal PO as ordered
- [ ] Can receive without sending PO
- [ ] Can send email PO (legacy workflow)
- [ ] Can track external order numbers
- [ ] Can receive with either PO # or external #

---

## 📊 Success Metrics

| Metric | Before | After |
|--------|--------|-------|
| Vendor support | Email POs only | All ordering modes |
| PO validity | Required "sent" | Valid when created |
| Receiving flexibility | Blocked without confirmation | Always works |
| Portal vendor support | Workarounds/hacks | First-class support |
| Card purchase tracking | Manual notes | Structured tracking |
| User confusion | "Why can't I receive?" | Clear guidance per vendor |

---

## 🎓 Key Takeaways

### For Developers

1. **PO ≠ Order Placement:** PO is internal authorization; ordering is vendor-specific
2. **Sending is Optional:** Many vendors never receive the PO
3. **Receiving is Universal:** Always works regardless of ordering mode
4. **Config-Driven:** Vendor behavior comes from config, not code
5. **Events Stay Clean:** Clear distinction between ordered_externally vs sent

### For Users

1. **Less Confusion:** System guides you based on vendor type
2. **More Flexibility:** Use portals, phone, card - all supported
3. **Better Tracking:** External order numbers captured
4. **Faster Workflow:** No waiting for "PO accepted" before receiving
5. **Clear Guidance:** Modal shows exactly what to do per vendor

### For System

1. **Data Integrity:** Inventory still correct (receiving is gate)
2. **Auditability:** All actions tracked with events
3. **Scalability:** Add new ordering modes without code changes
4. **Compatibility:** Backwards compatible with email POs
5. **Real-World Ready:** Handles Uline, Grainger, HD Supply, etc.

---

**Result: A PO system that matches how construction teams actually work with vendors! 🎉**
