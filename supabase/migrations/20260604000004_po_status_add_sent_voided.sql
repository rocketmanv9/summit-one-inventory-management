-- Extend the PO header status check to support the simplified flow.
--
-- The UI collapses POs into Draft → Sent → Partially Received → Received →
-- Cancelled. "Send PO" now stamps status = 'sent', and the draft delete path
-- (lib/api/purchase-orders.deletePurchaseOrder) stamps 'voided'. Neither value
-- was permitted by purchase_orders_status_check, so both writes failed.
--
-- Add 'sent' and 'voided' to the allowed set. Existing values are preserved so
-- legacy rows (approved/placed/acknowledged/…) remain valid; the UI buckets
-- them via src/lib/po/po-status.ts.

ALTER TABLE supply_chain.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_status_check;

ALTER TABLE supply_chain.purchase_orders
  ADD CONSTRAINT purchase_orders_status_check
  CHECK (status = ANY (ARRAY[
    'draft',
    'awaiting_approval',
    'approved',
    'sent',
    'placed',
    'acknowledged',
    'partially_received',
    'fully_received',
    'cancelled',
    'voided',
    'closed'
  ]));
