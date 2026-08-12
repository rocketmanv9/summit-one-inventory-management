-- Fix PO line-status trigger writing a constraint-invalid value.
--
-- supply_chain.update_po_line_status() (BEFORE INSERT/UPDATE on
-- purchase_order_lines) set a fully-received line's status to 'received', but
-- purchase_order_lines_status_check only allows
--   ('open','partially_received','fully_received','cancelled','pending').
-- So receiving a line in full raised a check-constraint violation. This never
-- surfaced because the PO receiving UI was only just wired up.
--
-- 'fully_received' is also the value the companion trigger
-- update_po_status_from_lines() already keys off to roll a PO up to
-- 'fully_received', so this aligns the two triggers as well.

CREATE OR REPLACE FUNCTION supply_chain.update_po_line_status()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.qty_received = 0 THEN
        NEW.status := 'pending';
    ELSIF NEW.qty_received >= NEW.qty_ordered THEN
        NEW.status := 'fully_received';
    ELSE
        NEW.status := 'partially_received';
    END IF;

    RETURN NEW;
END;
$function$;
