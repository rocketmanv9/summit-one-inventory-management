'use client';

import { useState, useEffect } from 'react';
import { createBrowserAuthedClient } from '@/supabase/client';
import { getAuthToken, getStoredAccessToken, getTenantIdFromToken, getUserIdFromToken, handleSupabaseAuthError } from '@/lib/auth-token';
import { AppError } from '@rocketmanv9/chassis/errors';
import type { Dashboard, DashboardWidget, WidgetRegistryEntry } from '@/types/dashboard';

type DashboardStats = {
  totalInventory: number;
  lowStockItems: number;
  pendingOrders: number;
};

type DashboardWidgetSummary = {
  id: string;
  title: string | null;
  widgetType: string;
  position: number;
};

/**
 * Resolve tenant ID — awaits async token fetch on first load,
 * then falls back to the synchronous cache for subsequent calls.
 */
async function resolveTenantId(): Promise<string | null> {
  // Try synchronous cache first (instant on subsequent calls)
  const cached = getStoredAccessToken();
  if (cached) return getTenantIdFromToken(cached);

  // First load: wait for the token to be fetched
  const token = await getAuthToken();
  return token ? getTenantIdFromToken(token) : null;
}

export function useDashboards() {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const supabase = createBrowserAuthedClient();

  useEffect(() => {
    async function fetchDashboards() {
      try {
        const tenantId = await resolveTenantId();
        if (!tenantId) {
          throw AppError.unauthorized('Missing tenant context. Please log in again.');
        }

        const { data, error } = await supabase
          .from('dashboards')
          .select('*')
          .eq('tenant_id', tenantId)
          .is('deleted_at', null);

        if (error) {
          handleSupabaseAuthError(error);
          throw error;
        }

        setDashboards((data as Dashboard[]) || []);
      } catch (e) {
        setError(e as Error);
      } finally {
        setLoading(false);
      }
    }

    fetchDashboards();
  }, []);

  return { dashboards, loading, error };
}

export function useDashboardOverview() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [widgets, setWidgets] = useState<DashboardWidgetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchOverview() {
      try {
        const tenantId = await resolveTenantId();
        if (!tenantId) {
          throw AppError.unauthorized('Missing tenant context. Please log in again.');
        }

        const supabase = createBrowserAuthedClient();

        const statsQuery = await supabase
          .from('dashboard_stats')
          .select('*')
          .eq('tenant_id', tenantId)
          .single();
        const widgetsQuery = await supabase
          .from('widgets')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('position');

        if (statsQuery.error) {
          handleSupabaseAuthError(statsQuery.error);
          console.error('Stats error:', statsQuery.error);
          throw AppError.internal(statsQuery.error.message || 'Failed to load dashboard stats');
        }

        if (widgetsQuery.error) {
          handleSupabaseAuthError(widgetsQuery.error);
          console.error('Widgets error:', widgetsQuery.error);
          throw AppError.internal(widgetsQuery.error.message || 'Failed to load widgets');
        }

        if (!isMounted) return;

        const statsRow = statsQuery.data as {
          total_inventory?: number | null;
          low_stock_items?: number | null;
          pending_orders?: number | null;
        } | null;

        setStats(
          statsRow
            ? {
                totalInventory: statsRow.total_inventory ?? 0,
                lowStockItems: statsRow.low_stock_items ?? 0,
                pendingOrders: statsRow.pending_orders ?? 0,
              }
            : null
        );

        const mappedWidgets = (widgetsQuery.data || []).map((widget: any) => ({
          id: widget.id as string,
          title: widget.title as string | null,
          widgetType: widget.widget_type as string,
          position: typeof widget.position === 'number' ? widget.position : 0,
        }));

        setWidgets(mappedWidgets);
      } catch (e) {
        if (isMounted) {
          setError(e as Error);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchOverview();

    return () => {
      isMounted = false;
    };
  }, []);

  return { stats, widgets, loading, error };
}

export function useDashboard(id: string | null) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchDashboard = async () => {
    if (!id) {
      setLoading(false);
      return;
    }

    try {
      const tenantId = await resolveTenantId();
      if (!tenantId) {
        throw AppError.unauthorized('Missing tenant context. Please log in again.');
      }

      const supabase = createBrowserAuthedClient();
      const { data, error } = await supabase
        .from('dashboards')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .single();

      if (error) {
        handleSupabaseAuthError(error);
        throw error;
      }

      setDashboard(data as Dashboard);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, [id]);

  const refetch = () => {
    setLoading(true);
    return fetchDashboard();
  };

  return { dashboard, loading, error, refetch };
}

export function useDashboardWidgets(dashboardId: string | null) {
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const supabase = createBrowserAuthedClient();

  const fetchWidgets = async () => {
    if (!dashboardId) {
      setLoading(false);
      return;
    }

    try {
      const tenantId = await resolveTenantId();
      if (!tenantId) {
        throw AppError.unauthorized('Missing tenant context. Please log in again.');
      }

      const { data, error } = await supabase
        .from('dashboard_widgets')
        .select('*')
        .eq('dashboard_id', dashboardId)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false });

      if (error) {
        handleSupabaseAuthError(error);
        throw error;
      }

      setWidgets((data as DashboardWidget[]) || []);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWidgets();
  }, [dashboardId]);

  const updateWidget = async (widgetId: string, updates: Partial<DashboardWidget>) => {
    const tenantId = await resolveTenantId();
    if (!tenantId) {
      return { error: AppError.unauthorized('Missing tenant context. Please log in again.') };
    }

    const lastEventId = `ui_widget_${crypto.randomUUID()}`;
    const { error } = await supabase
      .from('dashboard_widgets')
      .update({ ...updates, last_event_id: lastEventId })
      .eq('id', widgetId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .neq('last_event_id', lastEventId);

    if (error) {
      handleSupabaseAuthError(error);
    } else {
      setWidgets(prev => prev.map(w => w.id === widgetId ? { ...w, ...updates } : w));
    }

    return { error };
  };

  const deleteWidget = async (widgetId: string) => {
    console.log('Deleting widget:', widgetId);
    
    try {
      const tenantId = await resolveTenantId();
      if (!tenantId) {
        throw AppError.unauthorized('Missing tenant context. Please log in again.');
      }

      const lastEventId = `ui_widget_${crypto.randomUUID()}`;
      const { error } = await supabase
        .from('dashboard_widgets')
        .update({ deleted_at: new Date().toISOString(), last_event_id: lastEventId })
        .eq('id', widgetId)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .neq('last_event_id', lastEventId);

      if (error) {
        handleSupabaseAuthError(error);
        throw error;
      }

      console.log('Widget deleted successfully');
      setWidgets(prev => prev.filter(w => w.id !== widgetId));
      await fetchWidgets();

      return { error: null };
    } catch (error) {
      console.error('Delete error:', error);
      return { error };
    }
  };

  const refetch = () => {
    setLoading(true);
    return fetchWidgets();
  };

  return { widgets, loading, error, updateWidget, deleteWidget, refetch };
}

export function useWidgetRegistry() {
  const [widgets, setWidgets] = useState<WidgetRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchRegistry() {
      try {
        const supabase = createBrowserAuthedClient();
        const { data, error } = await supabase
          .from('widget_registry')
          .select('*')
          .eq('is_enabled', true);

        if (error) {
          handleSupabaseAuthError(error);
          throw error;
        }

        console.log('[useWidgetRegistry] Fetched widgets:', data?.length || 0, 'widgets');
        console.log('[useWidgetRegistry] Sample:', data?.[0]);
        setWidgets(data || []);
      } catch (e) {
        console.error('[useWidgetRegistry] Error:', e);
        setError(e as Error);
      } finally {
        setLoading(false);
      }
    }

    fetchRegistry();
  }, []);

  return { widgets, loading, error };
}

export async function saveLayout(dashboardId: string, widgets: DashboardWidget[]) {
  try {
    const tenantId = await resolveTenantId();
    if (!tenantId) {
      throw AppError.unauthorized('Missing tenant context. Please log in again.');
    }

    const supabase = createBrowserAuthedClient();
    const updates = widgets.map(widget =>
      supabase
        .from('dashboard_widgets')
        .update({ layout: widget.layout, last_event_id: `ui_widget_layout_${crypto.randomUUID()}` })
        .eq('id', widget.id)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
    );

    const results = await Promise.all(updates);
    const firstError = results.find(result => result.error)?.error;
    if (firstError) {
      handleSupabaseAuthError(firstError as any);
      throw firstError;
    }

    return { error: null };
  } catch (error) {
    console.error('Error saving layout:', error);
    return { error: error as Error };
  }
}

export async function saveWidgetConfig(
  widgetId: string,
  config: Record<string, any>,
  title?: string,
  refresh_seconds?: number
) {
  const tenantId = await resolveTenantId();
  if (!tenantId) {
    return { error: AppError.unauthorized('Missing tenant context. Please log in again.') };
  }

  const supabase = createBrowserAuthedClient();
  const updates: any = { config };
  if (title !== undefined) updates.title = title;
  if (refresh_seconds !== undefined) updates.refresh_seconds = refresh_seconds;
  updates.last_event_id = `ui_widget_config_${crypto.randomUUID()}`;

  const { error } = await supabase
    .from('dashboard_widgets')
    .update(updates)
    .eq('id', widgetId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .neq('last_event_id', updates.last_event_id);

  if (error) {
    handleSupabaseAuthError(error);
  }

  return { error };
}
