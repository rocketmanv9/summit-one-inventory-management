-- Add amazon_punchout value to supply_chain.ordering_mode enum.
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
-- Supabase migrations run each file outside a transaction when they contain
-- ADD VALUE, so this must be the first statement.

ALTER TYPE supply_chain.ordering_mode ADD VALUE IF NOT EXISTS 'amazon_punchout';

-- Recreate the ordering guidance view with the new enum value
CREATE OR REPLACE VIEW supply_chain.v_vendor_ordering_guidance AS
SELECT
  id            AS vendor_id,
  tenant_id,
  name          AS vendor_name,
  ordering_mode,
  po_required,
  accepts_net_terms,
  default_payment_method,
  portal_url,
  phone_number,
  po_email,
  notes_for_buyers,
  requires_external_order_number,
  CASE ordering_mode
    WHEN 'email_po'::supply_chain.ordering_mode
      THEN 'Email PO to: ' || COALESCE(po_email, contact_email, 'No email on file')
    WHEN 'portal_with_po_ref'::supply_chain.ordering_mode
      THEN 'Order via portal: ' || COALESCE(portal_url, 'No portal URL on file') || E'\nReference PO # during checkout'
    WHEN 'phone_with_po_ref'::supply_chain.ordering_mode
      THEN 'Call: ' || COALESCE(phone_number, 'No phone on file') || E'\nReference PO # when ordering'
    WHEN 'card_only_internal_po'::supply_chain.ordering_mode
      THEN 'Order with company card. PO is for internal tracking only.'
    WHEN 'pickup_only'::supply_chain.ordering_mode
      THEN 'In-person pickup. Bring PO or reference PO #.'
    WHEN 'amazon_punchout'::supply_chain.ordering_mode
      THEN 'Order via Amazon Business punchout. Items are selected on Amazon and submitted automatically.'
    WHEN 'mixed'::supply_chain.ordering_mode
      THEN 'Multiple ordering methods available. See notes.'
    ELSE 'Contact vendor to place order'
  END AS ordering_instructions,
  CASE
    WHEN accepts_net_terms THEN 'Invoice - ' || COALESCE(payment_terms, 'Net 30')
    ELSE 'Card payment required'
  END AS payment_guidance,
  CASE
    WHEN requires_external_order_number THEN 'External order # required for receiving'
    ELSE 'Can receive with PO # or external order #'
  END AS receiving_notes
FROM supply_chain.vendors v
WHERE active = true;

COMMENT ON VIEW supply_chain.v_vendor_ordering_guidance IS
  'Provides ordering instructions and guidance per vendor based on their configuration.
Use this to drive UI hints and help users order correctly.';
