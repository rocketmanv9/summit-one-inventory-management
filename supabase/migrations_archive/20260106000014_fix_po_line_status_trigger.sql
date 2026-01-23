-- Check and fix purchase_order_lines status issue
-- Remove any default that might be interfering and check for triggers

-- First, remove the default completely
ALTER TABLE inventory.purchase_order_lines 
ALTER COLUMN status DROP DEFAULT;

-- Now set it to 'open' explicitly
ALTER TABLE inventory.purchase_order_lines 
ALTER COLUMN status SET DEFAULT 'open';

-- Add pending to the constraint temporarily so existing data doesn't break
ALTER TABLE inventory.purchase_order_lines 
DROP CONSTRAINT IF EXISTS purchase_order_lines_status_check;

ALTER TABLE inventory.purchase_order_lines 
ADD CONSTRAINT purchase_order_lines_status_check CHECK (status IN (
    'open',
    'partially_received',
    'fully_received',
    'cancelled',
    'pending'  -- Temporary - for transition
));
