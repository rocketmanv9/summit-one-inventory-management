-- Add atomic PO number generation to prevent race conditions
-- This migration creates a function that generates PO numbers using database sequences

-- Create sequence for PO numbers per tenant (will be used in function)
CREATE TABLE IF NOT EXISTS supply_chain.po_number_sequences (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  current_year integer NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
  current_sequence integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on the sequences table
ALTER TABLE supply_chain.po_number_sequences ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for sequences table
CREATE POLICY "Users can manage their tenant's PO sequences"
  ON supply_chain.po_number_sequences
  FOR ALL
  TO authenticated
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- Create atomic PO number generation function
CREATE OR REPLACE FUNCTION supply_chain.generate_po_number(
  p_tenant_id uuid,
  p_format text DEFAULT 'sequential-year',
  p_prefix text DEFAULT ''
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_year integer;
  v_year_short text;
  v_next_number integer;
  v_po_number text;
  v_format_prefix text;
BEGIN
  -- Get current year
  v_year := EXTRACT(YEAR FROM CURRENT_DATE);
  v_year_short := RIGHT(v_year::text, 2);
  
  -- Lock the row for this tenant to prevent race conditions
  -- Insert if doesn't exist, or update and return next sequence
  INSERT INTO supply_chain.po_number_sequences (tenant_id, current_year, current_sequence)
  VALUES (p_tenant_id, v_year, 1)
  ON CONFLICT (tenant_id) DO UPDATE
  SET 
    -- Reset sequence if year changed
    current_sequence = CASE 
      WHEN po_number_sequences.current_year <> v_year THEN 1
      ELSE po_number_sequences.current_sequence + 1
    END,
    current_year = v_year,
    updated_at = now()
  RETURNING current_sequence INTO v_next_number;
  
  -- Build PO number based on format
  IF p_format = 'sequential-year' THEN
    -- Format: YY-#### or PREFIX-YY-####
    IF p_prefix <> '' THEN
      v_po_number := p_prefix || '-' || v_year_short || '-' || LPAD(v_next_number::text, 4, '0');
    ELSE
      v_po_number := v_year_short || '-' || LPAD(v_next_number::text, 4, '0');
    END IF;
  ELSIF p_format = 'sequential' THEN
    -- Format: #### or PREFIX-####
    IF p_prefix <> '' THEN
      v_po_number := p_prefix || '-' || LPAD(v_next_number::text, 4, '0');
    ELSE
      v_po_number := LPAD(v_next_number::text, 4, '0');
    END IF;
  ELSE
    -- Default to PREFIX-#### format
    v_format_prefix := COALESCE(NULLIF(p_prefix, ''), 'PO');
    v_po_number := v_format_prefix || '-' || LPAD(v_next_number::text, 4, '0');
  END IF;
  
  RETURN v_po_number;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION supply_chain.generate_po_number(uuid, text, text) TO authenticated;

-- Add comment
COMMENT ON FUNCTION supply_chain.generate_po_number IS 'Atomically generates unique PO numbers with configurable format, preventing race conditions';
