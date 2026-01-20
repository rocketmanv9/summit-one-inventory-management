const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'http://127.0.0.1:55321';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function addAllWidgets() {
  try {
    const tenantId = 'ae837809-1a24-4ab5-ba06-34fd98c05f48';
    
    // Get the default dashboard
    const { data: dashboards, error: dashError } = await supabase
      .from('dashboards')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('is_default', true)
      .limit(1);
    
    if (dashError) throw dashError;
    if (!dashboards || dashboards.length === 0) {
      throw new Error('No default dashboard found');
    }
    
    const dashboardId = dashboards[0].id;
    console.log('Dashboard ID:', dashboardId);
    
    // Delete existing widgets
    const { error: deleteError } = await supabase
      .from('dashboard_widgets')
      .delete()
      .eq('dashboard_id', dashboardId);
    
    if (deleteError) throw deleteError;
    console.log('Deleted existing widgets');
    
    // Get all widget types
    const { data: widgets, error: widgetsError } = await supabase
      .from('widget_registry')
      .select('widget_key, name, default_width, default_height, default_config')
      .order('widget_key');
    
    if (widgetsError) throw widgetsError;
    console.log(`Found ${widgets.length} widget types`);
    
    // Insert one of each widget type
    let yPosition = 0;
    for (const widget of widgets) {
      const { error: insertError } = await supabase
        .from('dashboard_widgets')
        .insert({
          dashboard_id: dashboardId,
          widget_key: widget.widget_key,
          title: widget.name,
          layout: {
            x: 0,
            y: yPosition,
            w: widget.default_width,
            h: widget.default_height
          },
          config: widget.default_config || {},
          refresh_seconds: 300,
          tenant_id: tenantId
        });
      
      if (insertError) {
        console.error(`Error adding ${widget.name}:`, insertError);
      } else {
        console.log(`Added: ${widget.name}`);
      }
      
      yPosition += widget.default_height;
    }
    
    console.log('\nAll widgets added successfully!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

addAllWidgets();
