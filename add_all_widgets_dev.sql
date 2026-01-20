-- Add one of each widget type to the dev user's default dashboard
DO $$
DECLARE
    v_dashboard_id UUID;
    v_tenant_id UUID := 'ae837809-1a24-4ab5-ba06-34fd98c05f48';
    v_widget RECORD;
    v_y_position INT := 0;
BEGIN
    -- Get the default dashboard for the dev tenant
    SELECT id INTO v_dashboard_id
    FROM public.dashboards
    WHERE tenant_id = v_tenant_id
    AND is_default = true
    LIMIT 1;
    
    IF v_dashboard_id IS NULL THEN
        RAISE EXCEPTION 'No default dashboard found for tenant %', v_tenant_id;
    END IF;
    
    RAISE NOTICE 'Adding widgets to dashboard: %', v_dashboard_id;
    
    -- Delete existing widgets first (optional - comment out if you want to keep existing)
    DELETE FROM public.dashboard_widgets 
    WHERE dashboard_id = v_dashboard_id;
    
    -- Insert one widget of each type
    FOR v_widget IN 
        SELECT widget_key, name, default_width, default_height, default_config
        FROM public.widget_registry
        ORDER BY widget_key
    LOOP
        INSERT INTO public.dashboard_widgets (
            dashboard_id,
            widget_key,
            title,
            layout,
            config,
            refresh_seconds,
            tenant_id
        ) VALUES (
            v_dashboard_id,
            v_widget.widget_key,
            v_widget.name,
            jsonb_build_object(
                'x', 0,
                'y', v_y_position,
                'w', v_widget.default_width,
                'h', v_widget.default_height
            ),
            COALESCE(v_widget.default_config, '{}'::jsonb),
            300,
            v_tenant_id
        );
        
        RAISE NOTICE 'Added widget: %', v_widget.name;
        
        -- Increment Y position for next widget
        v_y_position := v_y_position + v_widget.default_height;
    END LOOP;
    
    RAISE NOTICE 'Successfully added all widgets!';
END $$;
