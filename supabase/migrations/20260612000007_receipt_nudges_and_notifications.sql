-- 1. Receipt nudges: track when we last reminded someone that an in-transit
--    PO looks delivered but was never confirmed received (re-nudge cadence).
ALTER TABLE supply_chain.purchase_orders
  ADD COLUMN IF NOT EXISTS receipt_nudge_sent_at TIMESTAMPTZ;

-- 2. In-app notifications: the feed behind the top-nav bell. user_id NULL
--    means tenant-wide (any signed-in user of the tenant sees it).
CREATE TABLE public.notifications (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  user_id        UUID,
  type           TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT,
  link           TEXT,
  read_at        TIMESTAMPTZ,
  last_event_id  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, last_event_id)
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"
  ON public.notifications
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_tenant_access"
  ON public.notifications
  FOR ALL TO authenticated
  USING (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));

CREATE INDEX idx_notifications_tenant_id ON public.notifications (tenant_id);
CREATE INDEX idx_notifications_feed
  ON public.notifications (tenant_id, user_id, created_at DESC);
CREATE INDEX idx_notifications_unread
  ON public.notifications (tenant_id, user_id)
  WHERE read_at IS NULL;
