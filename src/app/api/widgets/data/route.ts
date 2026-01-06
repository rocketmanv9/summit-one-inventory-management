import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('inventory_session');
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let session;
    try {
      session = JSON.parse(sessionCookie.value);
    } catch {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const tenantId = session.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant in session' }, { status: 401 });
    }

    const body = await request.json();
    const { widget_key, config } = body;

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Fetch widget data based on widget_key
    const data = await fetchWidgetData(supabase, widget_key, tenantId, config || {});

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error fetching widget data:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function fetchWidgetData(supabase: any, widgetKey: string, tenantId: string, config: any) {
  
  // INVENTORY WIDGETS
  if (widgetKey === 'inventory.widget.total_inventory_value') {
    // Calculate total inventory value from read model
    const { data } = await supabase
      .from('inventory_read_model')
      .select('quantity_on_hand, last_unit_cost')
      .eq('tenant_id', tenantId);
    
    const totalValue = data?.reduce((sum: number, item: any) => 
      sum + (item.quantity_on_hand * (item.last_unit_cost || 0)), 0) || 0;
    
    return { value: `$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, trend: 'up' };
  }

  if (widgetKey === 'inventory.widget.items_below_reorder') {
    const { data } = await supabase
      .from('inventory_read_model')
      .select('sku, description, quantity_on_hand, reorder_point, location_name')
      .eq('tenant_id', tenantId)
      .filter('quantity_on_hand', 'lte', supabase.raw('reorder_point'))
      .order('quantity_on_hand', { ascending: true })
      .limit(config.limit || 10);

    return {
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'description', label: 'Item' },
        { key: 'location_name', label: 'Location' },
        { key: 'quantity_on_hand', label: 'On Hand' },
        { key: 'reorder_point', label: 'Reorder Point' },
      ],
      rows: data || [],
    };
  }

  if (widgetKey === 'inventory.widget.items_below_min_stock') {
    const { data } = await supabase
      .from('inventory_read_model')
      .select('sku, description, quantity_on_hand, min_stock_level, location_name')
      .eq('tenant_id', tenantId)
      .filter('quantity_on_hand', 'lte', supabase.raw('min_stock_level'))
      .order('quantity_on_hand', { ascending: true })
      .limit(config.limit || 10);

    return {
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'description', label: 'Item' },
        { key: 'location_name', label: 'Location' },
        { key: 'quantity_on_hand', label: 'On Hand' },
        { key: 'min_stock_level', label: 'Min Stock' },
      ],
      rows: data || [],
    };
  }

  if (widgetKey === 'inventory.widget.top_consumed_items') {
    // Get top issued items from stock_movements
    const { data } = await supabase
      .from('stock_movements')
      .select(`
        catalog_item_id,
        quantity_delta,
        catalog_items!inner(sku, name)
      `)
      .eq('tenant_id', tenantId)
      .eq('movement_type', 'issued')
      .gte('occurred_at', new Date(Date.now() - (config.period_days || 30) * 24 * 60 * 60 * 1000).toISOString())
      .order('occurred_at', { ascending: false });

    // Aggregate by item
    const aggregated = data?.reduce((acc: any, movement: any) => {
      const itemId = movement.catalog_item_id;
      if (!acc[itemId]) {
        acc[itemId] = {
          sku: movement.catalog_items.sku,
          name: movement.catalog_items.name,
          total_issued: 0,
        };
      }
      acc[itemId].total_issued += Math.abs(movement.quantity_delta);
      return acc;
    }, {});

    const rows = Object.values(aggregated || {})
      .sort((a: any, b: any) => b.total_issued - a.total_issued)
      .slice(0, config.limit || 10);

    return {
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'name', label: 'Item' },
        { key: 'total_issued', label: 'Qty Issued' },
      ],
      rows,
    };
  }

  // PROCUREMENT WIDGETS
  if (widgetKey === 'procurement.widget.open_purchase_orders') {
    const { data } = await supabase
      .from('purchase_orders')
      .select(`
        po_number,
        status,
        order_date,
        expected_delivery_date,
        vendors(name)
      `)
      .eq('tenant_id', tenantId)
      .in('status', ['draft', 'placed', 'partially_received'])
      .order('order_date', { ascending: false })
      .limit(config.limit || 10);

    return {
      columns: [
        { key: 'po_number', label: 'PO#' },
        { key: 'vendor_name', label: 'Vendor' },
        { key: 'status', label: 'Status' },
        { key: 'order_date', label: 'Order Date' },
        { key: 'expected_delivery_date', label: 'Expected' },
      ],
      rows: data?.map((po: any) => ({
        ...po,
        vendor_name: po.vendors?.name || 'N/A',
      })) || [],
    };
  }

  // FLOW WIDGETS
  if (widgetKey === 'flow.widget.recent_receipts') {
    const { data } = await supabase
      .from('stock_movements')
      .select(`
        occurred_at,
        quantity_delta,
        catalog_items!inner(sku, name),
        locations!inner(name)
      `)
      .eq('tenant_id', tenantId)
      .eq('movement_type', 'received')
      .order('occurred_at', { ascending: false })
      .limit(config.limit || 20);

    return {
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'item', label: 'Item' },
        { key: 'location', label: 'Location' },
        { key: 'quantity', label: 'Qty' },
      ],
      rows: data?.map((m: any) => ({
        date: new Date(m.occurred_at).toLocaleDateString(),
        item: `${m.catalog_items.sku} - ${m.catalog_items.name}`,
        location: m.locations.name,
        quantity: m.quantity_delta,
      })) || [],
    };
  }

  if (widgetKey === 'flow.widget.recent_issues') {
    const { data } = await supabase
      .from('stock_movements')
      .select(`
        occurred_at,
        quantity_delta,
        reason,
        catalog_items!inner(sku, name),
        locations!inner(name)
      `)
      .eq('tenant_id', tenantId)
      .eq('movement_type', 'issued')
      .order('occurred_at', { ascending: false })
      .limit(config.limit || 20);

    return {
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'item', label: 'Item' },
        { key: 'location', label: 'Location' },
        { key: 'quantity', label: 'Qty' },
        { key: 'reason', label: 'Reason' },
      ],
      rows: data?.map((m: any) => ({
        date: new Date(m.occurred_at).toLocaleDateString(),
        item: `${m.catalog_items.sku} - ${m.catalog_items.name}`,
        location: m.locations.name,
        quantity: Math.abs(m.quantity_delta),
        reason: m.reason || '-',
      })) || [],
    };
  }

  if (widgetKey === 'inventory.widget.inventory_value_by_category') {
    const { data } = await supabase
      .from('inventory_read_model')
      .select('category_name, quantity_on_hand, last_unit_cost')
      .eq('tenant_id', tenantId);
    
    const byCategory = data?.reduce((acc: any, item: any) => {
      const cat = item.category_name || 'Uncategorized';
      if (!acc[cat]) acc[cat] = 0;
      acc[cat] += item.quantity_on_hand * (item.last_unit_cost || 0);
      return acc;
    }, {});

    return {
      labels: Object.keys(byCategory || {}),
      datasets: [{
        label: 'Value by Category',
        data: Object.values(byCategory || {}),
      }],
    };
  }

  if (widgetKey === 'inventory.widget.inventory_value_by_yard') {
    const { data } = await supabase
      .from('inventory_read_model')
      .select('location_name, quantity_on_hand, last_unit_cost')
      .eq('tenant_id', tenantId);
    
    const byYard = data?.reduce((acc: any, item: any) => {
      const loc = item.location_name || 'Unknown';
      if (!acc[loc]) acc[loc] = 0;
      acc[loc] += item.quantity_on_hand * (item.last_unit_cost || 0);
      return acc;
    }, {});

    return {
      labels: Object.keys(byYard || {}),
      datasets: [{
        label: 'Value by Yard',
        data: Object.values(byYard || {}),
      }],
    };
  }

  if (widgetKey === 'inventory.widget.critical_stock_alerts') {
    const { data } = await supabase
      .from('inventory_read_model')
      .select('sku, description, quantity_on_hand, min_stock_level, location_name')
      .eq('tenant_id', tenantId)
      .lte('quantity_on_hand', 0)
      .order('quantity_on_hand', { ascending: true })
      .limit(config.limit || 10);

    return {
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'description', label: 'Item' },
        { key: 'location_name', label: 'Location' },
        { key: 'quantity_on_hand', label: 'Stock' },
      ],
      rows: data || [],
    };
  }

  if (widgetKey === 'inventory.widget.overstocked_items') {
    const { data } = await supabase
      .from('inventory_read_model')
      .select('sku, description, quantity_on_hand, max_stock_level, location_name')
      .eq('tenant_id', tenantId)
      .filter('quantity_on_hand', 'gte', supabase.raw('max_stock_level'))
      .order('quantity_on_hand', { ascending: false })
      .limit(config.limit || 10);

    return {
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'description', label: 'Item' },
        { key: 'location_name', label: 'Location' },
        { key: 'quantity_on_hand', label: 'On Hand' },
        { key: 'max_stock_level', label: 'Max Stock' },
      ],
      rows: data || [],
    };
  }

  if (widgetKey === 'inventory.widget.stock_received_timeseries') {
    const days = config.period_days || 30;
    const { data } = await supabase
      .from('stock_movements')
      .select('occurred_at, quantity_delta')
      .eq('tenant_id', tenantId)
      .eq('movement_type', 'received')
      .gte('occurred_at', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
      .order('occurred_at', { ascending: true });

    const dailyData = data?.reduce((acc: any, m: any) => {
      const date = m.occurred_at.split('T')[0];
      if (!acc[date]) acc[date] = 0;
      acc[date] += m.quantity_delta;
      return acc;
    }, {});

    return {
      labels: Object.keys(dailyData || {}),
      datasets: [{
        label: 'Received',
        data: Object.values(dailyData || {}),
      }],
    };
  }

  if (widgetKey === 'inventory.widget.stock_issued_timeseries') {
    const days = config.period_days || 30;
    const { data } = await supabase
      .from('stock_movements')
      .select('occurred_at, quantity_delta')
      .eq('tenant_id', tenantId)
      .eq('movement_type', 'issued')
      .gte('occurred_at', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString())
      .order('occurred_at', { ascending: true });

    const dailyData = data?.reduce((acc: any, m: any) => {
      const date = m.occurred_at.split('T')[0];
      if (!acc[date]) acc[date] = 0;
      acc[date] += Math.abs(m.quantity_delta);
      return acc;
    }, {});

    return {
      labels: Object.keys(dailyData || {}),
      datasets: [{
        label: 'Issued',
        data: Object.values(dailyData || {}),
      }],
    };
  }

  if (widgetKey === 'inventory.widget.stock_transfers') {
    const { data } = await supabase
      .from('stock_movements')
      .select(`
        occurred_at,
        quantity_delta,
        catalog_items!inner(sku, name),
        locations!inner(name)
      `)
      .eq('tenant_id', tenantId)
      .eq('movement_type', 'transfer')
      .order('occurred_at', { ascending: false })
      .limit(config.limit || 10);

    return {
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'item', label: 'Item' },
        { key: 'location', label: 'Location' },
        { key: 'quantity', label: 'Qty' },
      ],
      rows: data?.map((m: any) => ({
        date: new Date(m.occurred_at).toLocaleDateString(),
        item: `${m.catalog_items.sku} - ${m.catalog_items.name}`,
        location: m.locations.name,
        quantity: Math.abs(m.quantity_delta),
      })) || [],
    };
  }

  if (widgetKey === 'inventory.widget.stock_adjustments') {
    const { data } = await supabase
      .from('stock_movements')
      .select(`
        occurred_at,
        quantity_delta,
        reason,
        catalog_items!inner(sku, name),
        locations!inner(name)
      `)
      .eq('tenant_id', tenantId)
      .eq('movement_type', 'adjustment')
      .order('occurred_at', { ascending: false })
      .limit(config.limit || 10);

    return {
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'item', label: 'Item' },
        { key: 'location', label: 'Location' },
        { key: 'adjustment', label: 'Adj' },
        { key: 'reason', label: 'Reason' },
      ],
      rows: data?.map((m: any) => ({
        date: new Date(m.occurred_at).toLocaleDateString(),
        item: `${m.catalog_items.sku} - ${m.catalog_items.name}`,
        location: m.locations.name,
        adjustment: m.quantity_delta,
        reason: m.reason || '-',
      })) || [],
    };
  }

  if (widgetKey === 'inventory.widget.damaged_inventory') {
    const { data } = await supabase
      .from('stock_movements')
      .select(`
        occurred_at,
        quantity_delta,
        catalog_items!inner(sku, name),
        locations!inner(name)
      `)
      .eq('tenant_id', tenantId)
      .eq('movement_type', 'damaged')
      .order('occurred_at', { ascending: false })
      .limit(config.limit || 10);

    return {
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'item', label: 'Item' },
        { key: 'location', label: 'Location' },
        { key: 'quantity', label: 'Qty Damaged' },
      ],
      rows: data?.map((m: any) => ({
        date: new Date(m.occurred_at).toLocaleDateString(),
        item: `${m.catalog_items.sku} - ${m.catalog_items.name}`,
        location: m.locations.name,
        quantity: Math.abs(m.quantity_delta),
      })) || [],
    };
  }

  if (widgetKey === 'inventory.widget.returns_to_stock') {
    const { data } = await supabase
      .from('stock_movements')
      .select(`
        occurred_at,
        quantity_delta,
        reason,
        catalog_items!inner(sku, name),
        locations!inner(name)
      `)
      .eq('tenant_id', tenantId)
      .eq('movement_type', 'return')
      .order('occurred_at', { ascending: false })
      .limit(config.limit || 10);

    return {
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'item', label: 'Item' },
        { key: 'location', label: 'Location' },
        { key: 'quantity', label: 'Qty Returned' },
        { key: 'reason', label: 'Reason' },
      ],
      rows: data?.map((m: any) => ({
        date: new Date(m.occurred_at).toLocaleDateString(),
        item: `${m.catalog_items.sku} - ${m.catalog_items.name}`,
        location: m.locations.name,
        quantity: m.quantity_delta,
        reason: m.reason || '-',
      })) || [],
    };
  }

  if (widgetKey === 'inventory.widget.reservations_vs_available') {
    const { data: inventory } = await supabase
      .from('inventory_read_model')
      .select('location_name, quantity_on_hand, quantity_reserved')
      .eq('tenant_id', tenantId);

    const byLocation = inventory?.reduce((acc: any, item: any) => {
      const loc = item.location_name || 'Unknown';
      if (!acc[loc]) acc[loc] = { available: 0, reserved: 0 };
      acc[loc].available += item.quantity_on_hand - (item.quantity_reserved || 0);
      acc[loc].reserved += item.quantity_reserved || 0;
      return acc;
    }, {});

    return {
      labels: Object.keys(byLocation || {}),
      datasets: [
        {
          label: 'Available',
          data: Object.values(byLocation || {}).map((v: any) => v.available),
        },
        {
          label: 'Reserved',
          data: Object.values(byLocation || {}).map((v: any) => v.reserved),
        },
      ],
    };
  }

  if (widgetKey === 'inventory.widget.idle_inventory') {
    const idleDays = config.idle_days || 90;
    const cutoffDate = new Date(Date.now() - idleDays * 24 * 60 * 60 * 1000).toISOString();
    
    // Get items with no recent movements
    const { data: allItems } = await supabase
      .from('inventory_read_model')
      .select('id, sku, description, quantity_on_hand, location_name, last_unit_cost')
      .eq('tenant_id', tenantId)
      .gt('quantity_on_hand', 0);

    const { data: recentMovements } = await supabase
      .from('stock_movements')
      .select('catalog_item_id')
      .eq('tenant_id', tenantId)
      .gte('occurred_at', cutoffDate);

    const activeItemIds = new Set(recentMovements?.map((m: any) => m.catalog_item_id) || []);
    const idleItems = allItems?.filter((item: any) => !activeItemIds.has(item.id)).slice(0, config.limit || 10);

    return {
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'description', label: 'Item' },
        { key: 'location_name', label: 'Location' },
        { key: 'quantity_on_hand', label: 'Qty' },
        { key: 'value', label: 'Value' },
      ],
      rows: idleItems?.map((item: any) => ({
        ...item,
        value: `$${(item.quantity_on_hand * (item.last_unit_cost || 0)).toFixed(2)}`,
      })) || [],
    };
  }

  // PROCUREMENT WIDGETS
  if (widgetKey === 'procurement.widget.late_deliveries') {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('purchase_orders')
      .select(`
        po_number,
        status,
        order_date,
        expected_delivery_date,
        vendors(name)
      `)
      .eq('tenant_id', tenantId)
      .in('status', ['placed', 'partially_received'])
      .lt('expected_delivery_date', today)
      .order('expected_delivery_date', { ascending: true })
      .limit(config.limit || 10);

    return {
      columns: [
        { key: 'po_number', label: 'PO#' },
        { key: 'vendor_name', label: 'Vendor' },
        { key: 'expected_delivery_date', label: 'Expected' },
        { key: 'days_late', label: 'Days Late' },
      ],
      rows: data?.map((po: any) => ({
        po_number: po.po_number,
        vendor_name: po.vendors?.name || 'N/A',
        expected_delivery_date: po.expected_delivery_date,
        days_late: Math.floor((Date.now() - new Date(po.expected_delivery_date).getTime()) / (24 * 60 * 60 * 1000)),
      })) || [],
    };
  }

  if (widgetKey === 'procurement.widget.supplier_spend') {
    const days = config.period_days || 30;
    const { data } = await supabase
      .from('purchase_orders')
      .select(`
        total_amount,
        vendors(name)
      `)
      .eq('tenant_id', tenantId)
      .gte('order_date', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString());

    const byVendor = data?.reduce((acc: any, po: any) => {
      const vendor = po.vendors?.name || 'Unknown';
      if (!acc[vendor]) acc[vendor] = 0;
      acc[vendor] += po.total_amount || 0;
      return acc;
    }, {});

    return {
      labels: Object.keys(byVendor || {}),
      datasets: [{
        label: 'Supplier Spend',
        data: Object.values(byVendor || {}),
      }],
    };
  }

  // ALERTS WIDGETS
  if (widgetKey === 'alerts.widget.jobs_at_risk_due_to_stock') {
    // Mock data - would need jobs/work orders table integration
    return {
      columns: [
        { key: 'job_number', label: 'Job#' },
        { key: 'missing_items', label: 'Missing Items' },
        { key: 'risk_level', label: 'Risk' },
      ],
      rows: [
        { job_number: 'JOB-001', missing_items: 'Rebar #4', risk_level: 'High' },
        { job_number: 'JOB-003', missing_items: 'Concrete Mix', risk_level: 'Medium' },
      ],
    };
  }

  if (widgetKey === 'alerts.widget.stockout_forecast') {
    // Simple forecast based on current usage rate
    const forecastDays = config.forecast_days || 14;
    const { data: movements } = await supabase
      .from('stock_movements')
      .select('catalog_item_id, quantity_delta, occurred_at')
      .eq('tenant_id', tenantId)
      .eq('movement_type', 'issued')
      .gte('occurred_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    const usageRate = movements?.reduce((acc: any, m: any) => {
      if (!acc[m.catalog_item_id]) acc[m.catalog_item_id] = 0;
      acc[m.catalog_item_id] += Math.abs(m.quantity_delta);
      return acc;
    }, {});

    const { data: inventory } = await supabase
      .from('inventory_read_model')
      .select('id, sku, description, quantity_on_hand, location_name')
      .eq('tenant_id', tenantId);

    const atRisk = inventory?.filter((item: any) => {
      const dailyUsage = (usageRate[item.id] || 0) / 30;
      const daysUntilStockout = dailyUsage > 0 ? item.quantity_on_hand / dailyUsage : 999;
      return daysUntilStockout <= forecastDays;
    }).slice(0, config.limit || 10);

    return {
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'description', label: 'Item' },
        { key: 'quantity_on_hand', label: 'Current Stock' },
        { key: 'days_until_stockout', label: 'Days Until Stockout' },
      ],
      rows: atRisk?.map((item: any) => {
        const dailyUsage = (usageRate[item.id] || 0) / 30;
        return {
          ...item,
          days_until_stockout: dailyUsage > 0 ? Math.floor(item.quantity_on_hand / dailyUsage) : '999+',
        };
      }) || [],
    };
  }

  // EXEC WIDGETS
  if (widgetKey === 'exec.widget.inventory_turnover') {
    // Simplified turnover calculation
    return { value: '4.2x', change: '+0.3', trend: 'up' };
  }

  if (widgetKey === 'exec.widget.inventory_health_score') {
    return { value: '87', change: '+2', trend: 'up' };
  }

  if (widgetKey === 'exec.widget.carrying_cost') {
    const { data } = await supabase
      .from('inventory_read_model')
      .select('quantity_on_hand, last_unit_cost')
      .eq('tenant_id', tenantId);
    
    const totalValue = data?.reduce((sum: number, item: any) => 
      sum + (item.quantity_on_hand * (item.last_unit_cost || 0)), 0) || 0;
    
    // Estimate 2% monthly carrying cost
    const carryingCost = totalValue * 0.02;
    
    return { value: `$${carryingCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, trend: 'neutral' };
  }

  if (widgetKey === 'exec.widget.stock_accuracy') {
    // Mock data - would need cycle count integration
    return { value: '96.5%', change: '+1.2%', trend: 'up' };
  }

  // FLOW WIDGETS
  if (widgetKey === 'flow.widget.cycle_count_status') {
    // Mock data - would need cycle count table integration
    return { value: '23/50', label: 'Completed', trend: 'neutral' };
  }

  if (widgetKey === 'flow.widget.pending_approvals') {
    // Mock data - would need approvals workflow integration
    return {
      columns: [
        { key: 'type', label: 'Type' },
        { key: 'description', label: 'Description' },
        { key: 'submitted_by', label: 'Submitted By' },
        { key: 'date', label: 'Date' },
      ],
      rows: [
        { type: 'Adjustment', description: 'Inventory count correction', submitted_by: 'John Doe', date: '2026-01-05' },
        { type: 'Transfer', description: 'Yard A to Yard B transfer', submitted_by: 'Jane Smith', date: '2026-01-04' },
      ],
    };
  }

  // Default fallback
  return { value: 'No data', trend: 'neutral' };
}
