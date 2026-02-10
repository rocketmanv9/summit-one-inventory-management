# Receiving Page Fix Summary

## Issue Reported
User reported: "The receiving page needs some work, i cant see the open pos or receipts or anything, and the receive items modal is kinda trash. should autopopulate more."

## Root Causes Identified

### 1. RLS Policy Issues on Receipts Tables
- **Problem**: `receipts` and `receipt_lines` tables had RLS policies that only checked `(auth.jwt() ->> 'app_metadata' ->> 'tenant_id')::uuid`
- **Impact**: Queries returned empty arrays because JWT `tenant_id` could be in either `app_metadata` or root
- **Solution**: Created migration `20260209000027_fix_receipts_rls_and_rpc.sql` with:
  - Updated RLS policies to support both JWT paths using COALESCE
  - Added service role bypass for triggers/functions
  - Pattern matches purchase_orders RLS fix from migration 20260209000026

### 2. RPC Function Parameter Mismatch
- **Problem**: `rpc_get_recent_receipts` required `p_tenant_id` parameter but TypeScript wasn't passing it
- **Impact**: Function calls failed
- **Solution**: Refactored RPC to extract `tenant_id` from JWT like other RPCs:
  ```sql
  v_tenant_id := COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::UUID,
    (auth.jwt() ->> 'tenant_id')::UUID
  );
  ```

### 3. Receive Modal UX Issues
- **Problems**:
  - No context about PO vendor, expected delivery date, or status
  - Location not pre-populated from PO's `delivery_location_id`
  - Line quantities not pre-filled (user had to type remaining qty for every line)
  - No quick-fill buttons
  - No visual feedback for which lines have quantities entered
  - Small modal size
  - No autofocus on packing slip field

## Fixes Applied

### Database Migration: 20260209000027_fix_receipts_rls_and_rpc.sql

1. **Fixed receipts table RLS**:
   ```sql
   CREATE POLICY "receipts_tenant_rls" ON supply_chain.receipts
     FOR ALL
     USING (
       current_role = 'service_role'::text
       OR tenant_id = COALESCE(
         NULLIF(current_setting('app.current_tenant_id', true), '')::uuid,
         NULLIF(current_setting('app.tenant_id', true), '')::uuid,
         (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
         (auth.jwt() ->> 'tenant_id')::uuid
       )
     )
   ```

2. **Fixed receipt_lines table RLS**: Same pattern as receipts

3. **Updated rpc_get_recent_receipts**:
   - Removed `p_tenant_id` parameter
   - Added JWT extraction with COALESCE for both paths
   - Added vendor snapshot fields to output
   - Enhanced output columns: vendor_code, packing_slip_no, notes, received_by_user_id

### Frontend Improvements: receiving/page.tsx

1. **Auto-population**:
   - Location pre-filled from PO's `delivery_location_id`
   - Line quantities pre-filled with `qty_remaining` (user can adjust)
   - `qty_received: line.qty_remaining > 0 ? line.qty_remaining.toString() : ''`

2. **Enhanced Modal Header**:
   ```tsx
   <div className="flex items-center gap-4 text-sm text-muted-foreground">
     <span><strong>Vendor:</strong> {poDetail.vendor_name} ({poDetail.vendor_code})</span>
     <span>•</span>
     <span><strong>Status:</strong> {poDetail.status}</span>
     <span>•</span>
     <span><strong>Expected:</strong> {new Date(poDetail.expected_delivery_date).toLocaleDateString()}</span>
   </div>
   ```

3. **Quick-Fill Buttons**:
   - "Fill All Remaining" - populates all lines with remaining qty
   - "Clear All" - clears all qty fields

4. **Visual Feedback**:
   - Lines with quantities entered: green border + green background + checkmark
   - Lines without quantities: gray border + gray background
   - Remaining qty highlighted in orange

5. **Better Layout**:
   - Increased modal width: `max-w-4xl` → `max-w-5xl`
   - Scrollable line items section: `max-h-96 overflow-y-auto`
   - Sticky header and footer for better UX
   - Auto-focus on packing slip field
   - Max validation: `max={line.qty_remaining}` on qty input

6. **Improved Buttons**:
   - Sticky footer with border-top
   - Loading spinner animation
   - Icon indicators (✓ for complete, ⟳ for processing)
   - Better visual hierarchy

## Testing Checklist

- [x] Migration applied successfully
- [ ] Open POs appear in receiving page
- [ ] Recent receipts appear in receiving page
- [ ] Clicking "Receive Items" opens modal with PO data
- [ ] Modal shows vendor name/code in header
- [ ] Location pre-populated from PO
- [ ] Line quantities pre-filled with remaining qty
- [ ] "Fill All Remaining" button works
- [ ] "Clear All" button works
- [ ] Green highlight appears when qty entered
- [ ] Packing slip field auto-focused
- [ ] Receipt creates successfully
- [ ] Data refreshes after receipt creation

## Architecture Compliance

✅ **NO API routes** - All data access via RPC functions:
- `SupplyChainRPC.getOpenPOsForReceiving()`
- `SupplyChainRPC.getRecentReceipts(30)`
- `SupplyChainRPC.getPOReceivingDetail(poId)`
- `SupplyChainRPC.createReceipt(params)`
- `InventoryRPC.getLocations()`

✅ **Consistent JWT extraction** across all supply_chain RPCs

✅ **RLS policies** support both JWT paths + service role bypass

## Files Modified

1. `supabase/migrations/20260209000027_fix_receipts_rls_and_rpc.sql` (new)
2. `src/app/(dashboard)/inventory/receiving/page.tsx` (enhanced)

## Notes

- The pattern established here (COALESCE for JWT paths in RLS) should be applied to all future RLS policies
- Consider creating a shared SQL function for tenant_id extraction to reduce duplication
- Modal improvements follow industry best practices for receiving workflows (pre-fill, quick actions, visual feedback)
