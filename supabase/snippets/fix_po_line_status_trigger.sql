-- Fix the PO line status trigger to use correct status values
CREATE OR REPLACE FUNCTION supply_chain.update_po_line_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.qty_received = 0 THEN
        NEW.status := 'pending';
    ELSIF NEW.qty_received >= NEW.qty_ordered THEN
        NEW.status := 'fully_received';  -- Fixed: was 'received', should be 'fully_received'
    ELSE
        NEW.status := 'partially_received';
    END IF;
    
    RETURN NEW;
END;
$$;
