-- Fix purchase_order_lines default status to match constraint
ALTER TABLE inventory.purchase_order_lines 
ALTER COLUMN status SET DEFAULT 'open';
