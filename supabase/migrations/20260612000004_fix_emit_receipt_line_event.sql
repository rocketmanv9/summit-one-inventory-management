-- Fix "function public.emit_event(unknown, jsonb, uuid) is not unique" when
-- creating a receipt.
--
-- public.emit_event has two 7-parameter overloads (one chassis-style with
-- p_type/p_actor_id/..., one with p_event_type/p_scope/...), both with
-- defaults — so a positional 3-argument call matches both and Postgres
-- refuses to pick. emit_receipt_line_event was the ONLY caller (of 19) still
-- using positional notation; every sibling trigger uses named `p_type :=`
-- arguments, which resolve unambiguously. Bring it in line.
CREATE OR REPLACE FUNCTION supply_chain.emit_receipt_line_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_payload JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_payload := jsonb_build_object(
            'receipt_id', NEW.receipt_id,
            'line_id', NEW.id,
            'catalog_item_id', NEW.catalog_item_id,
            'qty_received', NEW.qty_received,
            'po_line_id', NEW.po_line_id,
            'tenant_id', NEW.tenant_id,
            'created_at', NEW.created_at
        );

        PERFORM public.emit_event(
            p_type := 'supply_chain.receipt.line_added',
            p_payload := v_payload,
            p_tenant_id := NEW.tenant_id
        );
    END IF;

    RETURN NEW;
END;
$function$;
