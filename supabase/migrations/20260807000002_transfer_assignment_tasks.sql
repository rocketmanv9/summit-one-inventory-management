-- Transfers as assignable work (prompt 09).
--
-- A transfer can be assigned to one or more people. Each assignee gets a row in
-- public.tasks (task_type 'transfer', related_entity_type 'transfer',
-- related_entity_id = transfer id, last_event_id 'transfer_<id>_<userId>' so one
-- row per assignee supports the multi-assignee ask without a join table). The
-- task rows are created by the assign API route (mirrors cycle-count tasks).
--
-- This migration adds:
--   1. inventory.transfers.assigned_to_user_ids uuid[] — a denormalized summary
--      so the web/mobile transfer lists can render "assigned to N people" badges
--      without a per-row tasks query. Written by the assign route.
--   2. A trigger that auto-completes every open sibling transfer task when the
--      transfer reaches a terminal state (completed / cancelled). First completer
--      "wins" by advancing the transfer's status through the real receive flow;
--      the header transition fans out and closes the other assignees' tasks. The
--      existing public.emit_task_event trigger turns each of those into a
--      task.completed outbox event.

ALTER TABLE inventory.transfers
  ADD COLUMN IF NOT EXISTS assigned_to_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

COMMENT ON COLUMN inventory.transfers.assigned_to_user_ids IS
  'Denormalized summary of the users this transfer is assigned to (one public.tasks row exists per id). Written by POST /api/inventory/transfers/[id]/assign for list badges; the tasks table is the source of truth.';

-- When a transfer becomes terminal, close any still-open tasks that point at it.
-- SECURITY DEFINER: the trigger runs in the inventory schema but writes to
-- public.tasks; definer rights let it update sibling tasks regardless of the
-- caller's RLS. Scoped strictly to this transfer's own tasks (tenant_id +
-- related_entity_id), so it can only ever touch its own rows.
CREATE OR REPLACE FUNCTION inventory.transfer_autocomplete_tasks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, inventory
AS $$
BEGIN
  IF NEW.status IN ('completed', 'cancelled')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.tasks t
       SET status = 'done',
           completed_at = COALESCE(t.completed_at, now()),
           -- Credit whoever received it when completed; on cancel there's no
           -- receiver, so leave completed_by null.
           completed_by_user_id = COALESCE(
             t.completed_by_user_id,
             CASE WHEN NEW.status = 'completed' THEN NEW.received_by_user_id ELSE NULL END
           ),
           updated_at = now()
     WHERE t.tenant_id = NEW.tenant_id
       AND t.related_entity_type = 'transfer'
       AND t.related_entity_id = NEW.id
       AND t.status NOT IN ('done', 'cancelled');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transfers_autocomplete_tasks ON inventory.transfers;
CREATE TRIGGER transfers_autocomplete_tasks
  AFTER UPDATE OF status ON inventory.transfers
  FOR EACH ROW
  EXECUTE FUNCTION inventory.transfer_autocomplete_tasks();
