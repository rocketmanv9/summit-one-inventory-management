-- Allow 'ai_suggest' as a vendor_email_domains source.
-- The AI vendor quick-add flow (POST /api/ai/vendor-suggest → POST
-- /api/inventory/vendors with email_domains) records the suggested sender
-- domains so the email → item-suggestions scanner can match this vendor.

ALTER TABLE supply_chain.vendor_email_domains
  DROP CONSTRAINT IF EXISTS vendor_email_domains_source_check;

ALTER TABLE supply_chain.vendor_email_domains
  ADD CONSTRAINT vendor_email_domains_source_check
  CHECK (source IN ('derived', 'manual', 'parser', 'ai_suggest'));
