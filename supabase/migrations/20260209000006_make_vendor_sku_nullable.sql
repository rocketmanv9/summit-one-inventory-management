-- Allow vendor_sku to be nullable on supply_chain.vendor_items

ALTER TABLE supply_chain.vendor_items
  ALTER COLUMN vendor_sku DROP NOT NULL;
