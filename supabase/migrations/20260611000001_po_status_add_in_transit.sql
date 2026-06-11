-- Extend the PO header status check to support shipment tracking.
--
-- The Amazon ship-notice (ASN) webhook advances a PO to 'in_transit' when a
-- carrier shipment arrives, and src/lib/po/po-status.ts already treats both
-- 'in_transit' and 'ordered' as members of the "Sent" display bucket. Neither
-- value was permitted by purchase_orders_status_check, so the webhook's status
-- update failed with a constraint violation (the chip never reflected shipping).
--
-- Add 'in_transit' and 'ordered' to the allowed set. Existing values are
-- preserved; the UI still buckets everything via po-status.ts.

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
    'ordered',
    'in_transit',
    'partially_received',
    'fully_received',
    'cancelled',
    'voided',
    'closed'
  ]));
