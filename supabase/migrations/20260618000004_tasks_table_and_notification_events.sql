-- Tasks + outbound notification/task events for the mobile push microservice.
--
-- Two halves:
--   1. public.tasks — user-facing action items (to-dos) that surface in-app and,
--      via the events below, get pushed to the mobile app.
--   2. Outbox event emission on BOTH public.notifications (previously silent —
--      insertNotification only wrote the row, no event) and public.tasks, so the
--      existing events_outbox -> Command Center poller carries them to any
--      downstream consumer (the mobile push service listens to these events).
--
-- Consumption model (product decision): downstream services subscribe to the
-- existing OUTBOX event stream, NOT to these tables directly. The contract the
-- mobile app codes against is the event payload below, not the row shape.

BEGIN;

-- ============================================================================
-- 1. public.tasks
-- ============================================================================
CREATE TABLE public.tasks (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id            UUID NOT NULL,
  -- Assignment. NULL assignee = unassigned / visible to the whole tenant.
  assigned_to_user_id  UUID,
  created_by_user_id   UUID,
  -- What the task is. task_type lets the mobile app route to the right screen.
  task_type            TEXT NOT NULL DEFAULT 'custom',
  title                TEXT NOT NULL,
  description          TEXT,
  status               TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open', 'in_progress', 'blocked', 'done', 'cancelled')),
  priority             TEXT NOT NULL DEFAULT 'normal'
                         CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  due_at               TIMESTAMPTZ,
  -- Deep-link + entity linkage so a notification/task can open the right record.
  related_entity_type  TEXT,
  related_entity_id    UUID,
  link                 TEXT,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Lifecycle.
  completed_at         TIMESTAMPTZ,
  completed_by_user_id UUID,
  -- Idempotency: repo-wide pattern — every mutation table carries last_event_id
  -- with a UNIQUE (tenant_id, last_event_id) guard for retry-safe upserts.
  last_event_id        TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, last_event_id)
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"
  ON public.tasks
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_tenant_access"
  ON public.tasks
  FOR ALL TO authenticated
  USING (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));

CREATE INDEX idx_tasks_tenant_id ON public.tasks (tenant_id);
CREATE INDEX idx_tasks_assignee  ON public.tasks (tenant_id, assigned_to_user_id, status);
CREATE INDEX idx_tasks_open      ON public.tasks (tenant_id, due_at)
  WHERE status IN ('open', 'in_progress', 'blocked');

CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 2a. Task -> outbox events
--   INSERT                      -> task.created
--   status -> 'done'            -> task.completed
--   status -> 'cancelled'       -> task.cancelled
--   assignee changed            -> task.assigned
--   anything else               -> task.updated
-- emit_event(p_type:=...) is the named-arg overload (NOT the positional one —
-- positional calls hit the "not unique" overload ambiguity).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.emit_task_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_event_name TEXT;
  v_payload    JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_name := 'task.created';
  ELSE
    IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
      v_event_name := 'task.completed';
    ELSIF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
      v_event_name := 'task.cancelled';
    ELSIF NEW.assigned_to_user_id IS DISTINCT FROM OLD.assigned_to_user_id THEN
      v_event_name := 'task.assigned';
    ELSE
      v_event_name := 'task.updated';
    END IF;
  END IF;

  v_payload := jsonb_build_object(
    'task_id',             NEW.id,
    'tenant_id',           NEW.tenant_id,
    'task_type',           NEW.task_type,
    'title',               NEW.title,
    'description',         NEW.description,
    'status',              NEW.status,
    'priority',            NEW.priority,
    'assigned_to_user_id', NEW.assigned_to_user_id,
    'due_at',              NEW.due_at,
    'related_entity_type', NEW.related_entity_type,
    'related_entity_id',   NEW.related_entity_id,
    'link',                NEW.link,
    'updated_at',          NEW.updated_at
  );

  PERFORM public.emit_event(
    p_type      := v_event_name,
    p_payload   := v_payload,
    p_tenant_id := NEW.tenant_id
  );

  RETURN NEW;
END;
$function$;

CREATE TRIGGER tasks_emit_event
  AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.emit_task_event();

-- ============================================================================
-- 2b. Notification -> outbox event (notification.created)
--   insertNotification() upserts with ON CONFLICT DO NOTHING, so a deduped
--   write inserts no row and this AFTER INSERT trigger never fires twice for
--   the same (tenant_id, last_event_id) — no duplicate push events.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.emit_notification_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  PERFORM public.emit_event(
    p_type    := 'notification.created',
    p_payload := jsonb_build_object(
      'notification_id', NEW.id,
      'tenant_id',       NEW.tenant_id,
      'user_id',         NEW.user_id,   -- NULL = tenant-wide; consumer fans out
      'type',            NEW.type,
      'title',           NEW.title,
      'body',            NEW.body,
      'link',            NEW.link,
      'created_at',      NEW.created_at
    ),
    p_tenant_id := NEW.tenant_id
  );
  RETURN NEW;
END;
$function$;

CREATE TRIGGER notifications_emit_event
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.emit_notification_event();

-- ============================================================================
-- 3. Register the new events (event_catalog v1 + event_definitions v2).
--    The emit_event(p_type:=...) overload tolerates unregistered events, but
--    registering keeps the catalog/drift-audit and CC routing complete.
-- ============================================================================
SELECT public.register_event('notification.created', 'Notification Created', 'Emitted when an in-app notification is created (consumed by the mobile push service)', '{"notification_id":"uuid","user_id":"uuid","type":"po_arrival","title":"..."}'::jsonb, NULL, 'notification');
SELECT public.register_event('task.created',   'Task Created',   'Emitted when a task is created',          '{"task_id":"uuid","assigned_to_user_id":"uuid","title":"..."}'::jsonb, NULL, 'task');
SELECT public.register_event('task.updated',   'Task Updated',   'Emitted when a task is updated',          '{"task_id":"uuid","status":"in_progress"}'::jsonb,                     NULL, 'task');
SELECT public.register_event('task.assigned',  'Task Assigned',  'Emitted when a task is (re)assigned',     '{"task_id":"uuid","assigned_to_user_id":"uuid"}'::jsonb,                NULL, 'task');
SELECT public.register_event('task.completed', 'Task Completed', 'Emitted when a task is completed',        '{"task_id":"uuid"}'::jsonb,                                            NULL, 'task');
SELECT public.register_event('task.cancelled', 'Task Cancelled', 'Emitted when a task is cancelled',        '{"task_id":"uuid"}'::jsonb,                                            NULL, 'task');

SELECT public.register_event('notification.created', 1, 'inventory', 'In-app notification created');
SELECT public.register_event('task.created',   1, 'inventory', 'Task created');
SELECT public.register_event('task.updated',   1, 'inventory', 'Task updated');
SELECT public.register_event('task.assigned',  1, 'inventory', 'Task assigned');
SELECT public.register_event('task.completed', 1, 'inventory', 'Task completed');
SELECT public.register_event('task.cancelled', 1, 'inventory', 'Task cancelled');

COMMIT;
