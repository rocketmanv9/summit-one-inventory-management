-- Force update the rpc_create_purchase_order function with PO number generation
DROP FUNCTION IF EXISTS supply_chain.rpc_create_purchase_order(UUID, TEXT, TEXT, DATE, TEXT, UUID, UUID, UUID, NUMERIC, TEXT, TEXT, JSONB, JSONB);
