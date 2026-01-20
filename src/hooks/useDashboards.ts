'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/supabase/client';
import type { Dashboard, DashboardWidget, WidgetRegistryEntry } from '@/types/dashboard';

export function useDashboards() {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchDashboards() {
      try {
        const response = await fetch('/api/dashboards');
        if (!response.ok) throw new Error('Failed to fetch dashboards');
        
        const { data } = await response.json();
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

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }

    async function fetchDashboard() {
      try {
        const response = await fetch(`/api/dashboards/${id}`);
        if (!response.ok) throw new Error('Failed to fetch dashboard');
        
        const { data } = await response.json();
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

  const fetchWidgets = async () => {
    if (!dashboardId) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/dashboards/${dashboardId}/widgets`);
      if (!response.ok) throw new Error('Failed to fetch widgets');
      
      const { data } = await response.json();
      setWidgets(data || []);
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
    console.log('Deleting widget:', widgetId);
    
    try {
      const response = await fetch(`/api/dashboards/${dashboardId}/widgets/${widgetId}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete widget');
      }
      
      console.log('Widget deleted successfully');
      setWidgets(prev => prev.filter(w => w.id !== widgetId));
      // Force refetch to ensure sync
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
        const response = await fetch('/api/widgets');
        if (!response.ok) throw new Error('Failed to fetch widget registry');
        
        const { data } = await response.json();
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

export async function saveLayout(dashboardId: string, widgets: DashboardWidget[]) {
  try {
    const response = await fetch('/api/widgets/layout', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ dashboardId, widgets }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to save layout');
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
