'use client';

import { useState, useCallback, useEffect } from 'react';
import GridLayout from 'react-grid-layout';
import type { DashboardWidget } from '@/types/dashboard';
import { WidgetContainer } from '@/components/widgets/WidgetContainer';
import { saveLayout } from '@/hooks/useDashboards';
import { createBrowserAuthedClient } from '@/supabase/client';
import { getStoredAccessToken, getTenantIdFromToken } from '@/lib/auth-token';
import { AppError } from '@rocketmanv9/chassis/errors';
import 'react-grid-layout/css/styles.css';

type LayoutItem = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
};

interface EditableDashboardGridProps {
  dashboardId: string;
  widgets: DashboardWidget[];
  isEditMode: boolean;
  onWidgetUpdate: (widgetId: string, updates: Partial<DashboardWidget>) => Promise<any>;
  onWidgetDelete: (widgetId: string) => Promise<any>;
  onLayoutSaved?: () => void; // Callback to refresh widgets after layout save
  onExitEditMode?: () => void; // Callback when user exits edit mode
  onDashboardDelete?: () => void; // Callback when dashboard is deleted
}

export function EditableDashboardGrid({
  dashboardId,
  widgets,
  isEditMode,
  onWidgetUpdate,
  onWidgetDelete,
  onLayoutSaved,
  onExitEditMode,
  onDashboardDelete,
}: EditableDashboardGridProps) {
  const [layouts, setLayouts] = useState<LayoutItem[]>(
    widgets.map(w => ({
      i: w.id,
      x: w.layout?.x || 0,
      y: w.layout?.y || 0,
      w: w.layout?.w || 4,
      h: w.layout?.h || 1,
    }))
  );
  const [selectedWidget, setSelectedWidget] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasLayoutChanges, setHasLayoutChanges] = useState(false);
  const supabase = createBrowserAuthedClient();

  // Sync layouts when widgets change
  useEffect(() => {
    setLayouts(widgets.map(w => ({
      i: w.id,
      x: w.layout?.x || 0,
      y: w.layout?.y || 0,
      w: w.layout?.w || 4,
      h: w.layout?.h || 1,
    })));
    setHasLayoutChanges(false);
  }, [widgets]);

  const handleLayoutChange = useCallback((newLayout: any) => {
    setLayouts(newLayout as LayoutItem[]);
    setHasLayoutChanges(true);
  }, []);

  const handleSaveLayout = async () => {
    if (!hasLayoutChanges) {
      // No changes to save, just exit edit mode
      if (onExitEditMode) onExitEditMode();
      return;
    }

    setIsSaving(true);
    
    const updatedWidgets = widgets.map(widget => {
      const layout = layouts.find(l => l.i === widget.id);
      if (!layout) return widget;

      return {
        ...widget,
        layout: {
          x: layout.x,
          y: layout.y,
          w: layout.w,
          h: layout.h,
        },
      };
    });

    const { error } = await saveLayout(dashboardId, updatedWidgets);
    setIsSaving(false);
    
    if (error) {
      console.error('Error saving layout:', error);
      alert('Failed to save layout. Please try again.');
    } else {
      setHasLayoutChanges(false);
      // Refresh the widgets data to show updated positions
      if (onLayoutSaved) {
        onLayoutSaved();
      }
      // Exit edit mode after successful save
      if (onExitEditMode) {
        onExitEditMode();
      }
    }
  };

  const handleDeleteWidget = async (widgetId: string) => {
    const { error } = await onWidgetDelete(widgetId);
    if (error) {
      console.error('Error deleting widget:', error);
      alert('Failed to delete widget. Please try again.');
    } else {
      // Trigger refresh to get updated widget list
      if (onLayoutSaved) {
        onLayoutSaved();
      }
    }
  };

  const handleDeleteDashboard = async () => {
    if (!confirm('Are you sure you want to delete this dashboard? This action cannot be undone.')) {
      return;
    }

    try {
      const accessToken = getStoredAccessToken();
      const tenantId = accessToken ? getTenantIdFromToken(accessToken) : null;
      if (!tenantId) {
        throw AppError.unauthorized('Missing tenant context. Please log in again.');
      }

      const lastEventId = `ui_dashboard_${crypto.randomUUID()}`;
      const { error } = await supabase
        .from('dashboards')
        .update({ deleted_at: new Date().toISOString(), last_event_id: lastEventId })
        .eq('id', dashboardId)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null)
        .neq('last_event_id', lastEventId);

      if (error) throw error;

      // Call the callback to redirect user
      if (onDashboardDelete) {
        onDashboardDelete();
      }
    } catch (error) {
      console.error('Error deleting dashboard:', error);
      alert('Failed to delete dashboard. Please try again.');
    }
  };

  if (!isEditMode) {
    // Static grid for view mode
    return (
      <div className="grid grid-cols-12 gap-5 auto-rows-[200px]">
        {widgets.map((widget) => {
          const { x, y, w, h } = widget.layout || { x: 0, y: 0, w: 4, h: 1 };
          return (
            <div
              key={widget.id}
              style={{
                gridColumn: `${x + 1} / span ${w}`,
                gridRow: `${y + 1} / span ${h}`,
              }}
              className="min-h-0 transition-all duration-200 hover:scale-[1.01]"
            >
              <WidgetContainer widget={widget} />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Edit Mode Controls - Compact integrated design */}
      <div className="mb-4 flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-lg px-5 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-7 h-7 bg-blue-600 text-white rounded-full text-sm font-bold">✎</span>
            <div>
              <div className="text-sm font-bold text-blue-900">Edit Mode Active</div>
              <div className="text-xs text-blue-700">Drag to move • Resize from corners • Delete unwanted widgets</div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasLayoutChanges && (
            <span className="text-xs text-orange-600 font-medium px-2 py-1 bg-orange-50 rounded border border-orange-200">
              Unsaved changes
            </span>
          )}
          <button
            onClick={handleDeleteDashboard}
            className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-md hover:bg-red-700 transition-colors shadow-sm flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete Dashboard
          </button>
          <button
            onClick={handleSaveLayout}
            disabled={isSaving}
            className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Saving...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {hasLayoutChanges ? 'Save & Exit' : 'Exit Edit Mode'}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Draggable Grid */}
      <GridLayout
        className="layout"
        layout={layouts as any}
        onLayoutChange={handleLayoutChange}
        cols={12}
        rowHeight={200}
        width={1200}
        compactType="vertical"
        preventCollision={true}
      >
        {widgets.map((widget) => (
          <div
            key={widget.id}
            className="relative cursor-move bg-white rounded-lg border-2 transition-all border-gray-200 hover:border-blue-300 hover:shadow-lg"
          >
            {/* Widget Controls */}
            <div className="absolute top-2 right-2 z-10 flex gap-1.5">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedWidget(widget.id);
                }}
                className="p-2 bg-white border-2 border-blue-400 text-blue-600 rounded-md shadow-md hover:bg-blue-50 transition-all hover:scale-110"
                title="Configure"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteWidget(widget.id);
                }}
                className="p-2 bg-white border-2 border-red-400 text-red-600 rounded-md shadow-md hover:bg-red-50 transition-all hover:scale-110"
                title="Delete"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>

            {/* Widget Content */}
            <div className="h-full pointer-events-none">
              <WidgetContainer widget={widget} />
            </div>
          </div>
        ))}
      </GridLayout>

      {/* Widget Configuration Panel */}
      {selectedWidget && (
        <WidgetConfigPanel
          widget={widgets.find(w => w.id === selectedWidget)!}
          onClose={() => setSelectedWidget(null)}
          onSave={(updates) => {
            onWidgetUpdate(selectedWidget, updates);
            setSelectedWidget(null);
          }}
        />
      )}
    </div>
  );
}

interface WidgetConfigPanelProps {
  widget: DashboardWidget;
  onClose: () => void;
  onSave: (updates: Partial<DashboardWidget>) => void;
}

function WidgetConfigPanel({ widget, onClose, onSave }: WidgetConfigPanelProps) {
  const [title, setTitle] = useState(widget.title || '');
  const [refreshSeconds, setRefreshSeconds] = useState(widget.refresh_seconds || 0);

  const handleSave = () => {
    onSave({
      title,
      refresh_seconds: refreshSeconds,
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Configure Widget</h3>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Widget Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Auto-refresh (seconds)
            </label>
            <input
              type="number"
              value={refreshSeconds}
              onChange={(e) => setRefreshSeconds(parseInt(e.target.value) || 0)}
              min="0"
              step="30"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              0 = no auto-refresh, 60 = refresh every minute
            </p>
          </div>

          <div className="p-3 bg-gray-50 rounded text-xs text-gray-600">
            <div><strong>Widget Type:</strong> {widget.widget_key}</div>
            <div className="mt-1"><strong>ID:</strong> {widget.id}</div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
