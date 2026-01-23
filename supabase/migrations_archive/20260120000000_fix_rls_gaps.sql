-- ============================================================================
-- CRITICAL SECURITY FIX: Add RLS to tables with tenant_id but no policies
-- ============================================================================

-- Enable RLS on public.tenants
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_tenant_isolation ON public.tenants;
CREATE POLICY tenants_tenant_isolation ON public.tenants
    FOR ALL
    USING (id = (auth.jwt() ->> 'tenant_id')::UUID);

DROP POLICY IF EXISTS tenants_service_role ON public.tenants;
CREATE POLICY tenants_service_role ON public.tenants
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- Enable RLS on public.processed_events
ALTER TABLE public.processed_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS processed_events_tenant_isolation ON public.processed_events;
CREATE POLICY processed_events_tenant_isolation ON public.processed_events
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID OR tenant_id IS NULL);

DROP POLICY IF EXISTS processed_events_service_role ON public.processed_events;
CREATE POLICY processed_events_service_role ON public.processed_events
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- Enable RLS on public.events_dead_letter (if exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events_dead_letter') THEN
        ALTER TABLE public.events_dead_letter ENABLE ROW LEVEL SECURITY;
        
        DROP POLICY IF EXISTS events_dead_letter_tenant_isolation ON public.events_dead_letter;
        CREATE POLICY events_dead_letter_tenant_isolation ON public.events_dead_letter
            FOR ALL
            USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);
        
        DROP POLICY IF EXISTS events_dead_letter_service_role ON public.events_dead_letter;
        CREATE POLICY events_dead_letter_service_role ON public.events_dead_letter
            FOR ALL TO service_role
            USING (true) WITH CHECK (true);
    END IF;
END $$;

COMMENT ON POLICY tenants_tenant_isolation ON public.tenants IS 
    'Users can only see their own tenant record via JWT claim';
COMMENT ON POLICY processed_events_tenant_isolation ON public.processed_events IS 
    'Users can only see processed events for their tenant (or global events with NULL tenant_id)';

