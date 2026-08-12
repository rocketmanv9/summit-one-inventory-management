-- 20260804000002_po_approval_notifications.sql
-- Approval-flow notifications, trigger-owned so every path that moves a PO
-- through the approval states pings the right person — the browser create
-- RPC, rpc_submit_po_for_approval, the approve/reject routes, and the Amazon
-- punchout gate all flow through these same status transitions.
--
--   → awaiting_approval : notify the approver ("PO-0042 needs your approval")
--                          (tenant-wide when unrouted — any admin can take it)
--   awaiting_approval → approved : notify the buyer
--   rejected (rejected_at set)   : notify the buyer with the reason

CREATE OR REPLACE FUNCTION supply_chain.notify_po_approval_transitions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'supply_chain', 'public'
AS $$
DECLARE
  v_buyer_name TEXT;
BEGIN
  -- Landed in the inbox
  IF NEW.status = 'awaiting_approval'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'awaiting_approval') THEN
    SELECT COALESCE(name, email) INTO v_buyer_name
    FROM public.local_users
    WHERE tenant_id = NEW.tenant_id AND user_id = NEW.created_by_user_id;

    INSERT INTO public.notifications (tenant_id, user_id, type, title, body, link, last_event_id)
    VALUES (
      NEW.tenant_id,
      NEW.approver_user_id, -- null = tenant-wide (any admin can take it)
      'po_approval_requested',
      format('PO %s needs your approval', NEW.po_number),
      format('%s — %s', COALESCE(v_buyer_name, 'Someone'), COALESCE(NEW.approval_reason, 'requires sign-off')),
      '/inventory/purchasing/approvals',
      'po-approval-requested:' || NEW.id || ':' || COALESCE(NEW.last_event_id, gen_random_uuid()::text)
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
  END IF;

  -- Verdict: approved
  IF TG_OP = 'UPDATE' AND OLD.status = 'awaiting_approval' AND NEW.status = 'approved'
     AND NEW.created_by_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (tenant_id, user_id, type, title, body, link, last_event_id)
    VALUES (
      NEW.tenant_id, NEW.created_by_user_id,
      'po_approved',
      format('PO %s approved', NEW.po_number),
      'Approved — it''s ready to send to the vendor.',
      '/inventory/purchasing',
      'po-approved:' || NEW.id || ':' || COALESCE(NEW.last_event_id, gen_random_uuid()::text)
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
  END IF;

  -- Verdict: rejected (status goes back to draft with the rejection stamped)
  IF TG_OP = 'UPDATE' AND NEW.rejected_at IS NOT NULL
     AND (OLD.rejected_at IS DISTINCT FROM NEW.rejected_at)
     AND NEW.created_by_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (tenant_id, user_id, type, title, body, link, last_event_id)
    VALUES (
      NEW.tenant_id, NEW.created_by_user_id,
      'po_rejected',
      format('PO %s was not approved', NEW.po_number),
      COALESCE(NEW.rejected_reason, 'No reason given — check with your manager.'),
      '/inventory/purchasing',
      'po-rejected:' || NEW.id || ':' || NEW.rejected_at::text
    )
    ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_po_approval ON supply_chain.purchase_orders;
CREATE TRIGGER trg_notify_po_approval
  AFTER INSERT OR UPDATE OF status, rejected_at ON supply_chain.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION supply_chain.notify_po_approval_transitions();
