-- Generic PO shipment tracking (any vendor, not just Amazon punchout).
--
-- The Amazon ship-notice webhook stores shipments in
-- inventory.punchout_orders.metadata; this table is the equivalent for
-- everything else — primarily tracking numbers the email AI extracts from
-- vendor replies, but also manual entries later. The globe map merges both
-- sources to draw in-transit packages.

CREATE TABLE supply_chain.po_shipments (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id          UUID NOT NULL,
  purchase_order_id  UUID NOT NULL REFERENCES supply_chain.purchase_orders(id) ON DELETE CASCADE,
  carrier            TEXT,
  tracking_number    TEXT NOT NULL,
  ship_date          TIMESTAMPTZ,
  delivery_date      TIMESTAMPTZ,
  source             TEXT NOT NULL DEFAULT 'email'
                       CHECK (source IN ('email', 'webhook', 'manual')),
  last_event_id      TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The same tracking number mentioned in repeated emails dedupes
  UNIQUE (tenant_id, purchase_order_id, tracking_number),
  UNIQUE (tenant_id, last_event_id)
);

ALTER TABLE supply_chain.po_shipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"
  ON supply_chain.po_shipments
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_tenant_access"
  ON supply_chain.po_shipments
  FOR ALL TO authenticated
  USING (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid));

CREATE INDEX idx_po_shipments_tenant_id ON supply_chain.po_shipments (tenant_id);
CREATE INDEX idx_po_shipments_po ON supply_chain.po_shipments (tenant_id, purchase_order_id);
