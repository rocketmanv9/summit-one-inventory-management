'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/supabase/client';
import type { Dashboard, DashboardWidget, WidgetRegistryEntry } from '@/types/dashboard';

export function useDashboards() {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const supabase = createClient();

  useEffect(() => {
    async function fetchDashboards() {
      try {
        const { data, error } = await supabase
          .from('dashboards')
          .select('*')
          .order('is_default', { ascending: false })
          .order('name');

        if (error) throw error;
        setDashboards(data || []);
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

export function useDashboard(id: string | null) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const supabase = createClient();

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    async function fetchDashboard() {
      try {
        const { data, error } = await supabase
          .from('dashboards')
          .select('*')
          .eq('id', id)
          .single();

        if (error) throw error;
        setDashboard(data);
      } catch (e) {
        setError(e as Error);
      } finally {
        setLoading(false);
      }
    }

    fetchDashboard();
  }, [id]);

  return { dashboard, loading, error };
}

export function useDashboardWidgets(dashboardId: string | null) {
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const supabase = createClient();

  useEffect(() => {
    if (!dashboardId) {
      setLoading(false);
      return;
    }

    async function fetchWidgets() {
      try {
        const { data, error } = await supabase
          .from('dashboard_widgets')
          .select('*')
          .eq('dashboard_id', dashboardId)
          .order('created_at');

        if (error) throw error;
        setWidgets(data || []);
      } catch (e) {
        setError(e as Error);
      } finally {
        setLoading(false);
      }
    }

    fetchWidgets();
  }, [dashboardId]);

  const updateWidget = async (widgetId: string, updates: Partial<DashboardWidget>) => {
    const { error } = await supabase
      .from('dashboard_widgets')
      .update(updates)
      .eq('id', widgetId);

    if (!error) {
      setWidgets(prev => prev.map(w => w.id === widgetId ? { ...w, ...updates } : w));
    }

    return { error };
  };

  const deleteWidget = async (widgetId: string) => {
    const { error } = await supabase
      .from('dashboard_widgets')
      .delete()
      .eq('id', widgetId);

    if (!error) {
      setWidgets(prev => prev.filter(w => w.id !== widgetId));
    }

    return { error };
  };

  return { widgets, loading, error, updateWidget, deleteWidget };
}

export function useWidgetRegistry() {
  const [widgets, setWidgets] = useState<WidgetRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const supabase = createClient();

  useEffect(() => {
    async function fetchRegistry() {
      try {
        const { data, error } = await supabase
          .from('widget_registry')
          .select('*')
          .eq('is_enabled', true)
          .order('domain')
          .order('name');

        if (error) throw error;
        setWidgets(data || []);
      } catch (e) {
        setError(e as Error);
      } finally {
        setLoading(false);
      }
    }

    fetchRegistry();
  }, []);

  return { widgets, loading, error };
}

export async function saveLayout(widgets: DashboardWidget[]) {
  const supabase = createClient();
  const updates = widgets.map(widget => ({
    id: widget.id,
    layout: widget.layout,
  }));

  const { error } = await supabase
    .from('dashboard_widgets')
    .upsert(updates);

  return { error };
}

export async function saveWidgetConfig(
  widgetId: string,
  config: Record<string, any>,
  title?: string,
  refresh_seconds?: number
) {
  const supabase = createClient();
  const updates: any = { config };
  if (title !== undefined) updates.title = title;
  if (refresh_seconds !== undefined) updates.refresh_seconds = refresh_seconds;

  const { error } = await supabase
    .from('dashboard_widgets')
    .update(updates)
    .eq('id', widgetId);

  return { error };
}
