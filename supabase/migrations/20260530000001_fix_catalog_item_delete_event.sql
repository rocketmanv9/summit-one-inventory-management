-- Fix: emit_catalog_item_event() had no DELETE branch, so hard-deleting a
-- catalog item left v_event_name NULL and emit_event() raised a NOT NULL
-- violation on events_outbox.event_type — i.e. deleting an item was broken for
-- any tenant. The trigger is declared AFTER INSERT OR DELETE OR UPDATE, so the
-- DELETE path must be handled (and RETURN OLD). This adds a
-- `catalog_item.deleted` event and corrects the return value.

CREATE OR REPLACE FUNCTION inventory.emit_catalog_item_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_event_name TEXT; v_payload JSONB; v_changes JSONB;
BEGIN
  IF TG_OP='INSERT' THEN
    v_event_name := 'inventory.item.created';
    v_payload := jsonb_build_object('item_id',NEW.id,'sku',NEW.sku,'name',NEW.name,'category_id',NEW.category_id,'tracking_mode',NEW.tracking_mode,'uom_term_id',NEW.uom_term_id,'tenant_id',NEW.tenant_id,'created_at',NEW.created_at);
  ELSIF TG_OP='UPDATE' THEN
    IF OLD.active=TRUE AND NEW.active=FALSE THEN v_event_name:='catalog_item.deactivated'; v_payload:=jsonb_build_object('item_id',NEW.id,'tenant_id',NEW.tenant_id,'deactivated_at',NEW.updated_at);
    ELSIF OLD.active=FALSE AND NEW.active=TRUE THEN v_event_name:='catalog_item.reactivated'; v_payload:=jsonb_build_object('item_id',NEW.id,'tenant_id',NEW.tenant_id,'reactivated_at',NEW.updated_at);
    ELSE
      v_event_name:='catalog_item.updated'; v_changes:=jsonb_build_object();
      IF OLD.name!=NEW.name THEN v_changes:=v_changes||jsonb_build_object('name',jsonb_build_object('old',OLD.name,'new',NEW.name)); END IF;
      IF OLD.sku!=NEW.sku THEN v_changes:=v_changes||jsonb_build_object('sku',jsonb_build_object('old',OLD.sku,'new',NEW.sku)); END IF;
      IF OLD.uom_term_id IS DISTINCT FROM NEW.uom_term_id THEN v_changes:=v_changes||jsonb_build_object('uom_term_id',jsonb_build_object('old',OLD.uom_term_id,'new',NEW.uom_term_id)); END IF;
      IF OLD.category_id IS DISTINCT FROM NEW.category_id THEN v_changes:=v_changes||jsonb_build_object('category_id',jsonb_build_object('old',OLD.category_id,'new',NEW.category_id)); END IF;
      v_payload:=jsonb_build_object('item_id',NEW.id,'tenant_id',NEW.tenant_id,'changes',v_changes,'updated_at',NEW.updated_at);
    END IF;
  ELSIF TG_OP='DELETE' THEN
    v_event_name:='catalog_item.deleted';
    v_payload:=jsonb_build_object('item_id',OLD.id,'sku',OLD.sku,'name',OLD.name,'category_id',OLD.category_id,'tenant_id',OLD.tenant_id);
  END IF;

  PERFORM public.emit_event(p_type:=v_event_name,p_payload:=v_payload,p_tenant_id:=COALESCE(NEW.tenant_id,OLD.tenant_id));

  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;
