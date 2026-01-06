'use client';

import { useState, useCallback } from 'react';
import GridLayout, { Layout } from 'react-grid-layout';
import type { DashboardWidget } from '@/types/dashboard';
import { WidgetContainer } from '@/components/widgets/WidgetContainer';
import { saveLayout } from '@/hooks/useDashboards';
import 'react-grid-layout/css/styles.css';

interface EditableDashboardGridProps {
  widgets: DashboardWidget[];
  isEditMode: boolean;
  onWidgetUpdate: (widgetId: string, updates: Partial<DashboardWidget>) => Promise<any>;
  onWidgetDelete: (widgetId: string) => Promise<any>;
}

export function EditableDashboardGrid({
  widgets,
  isEditMode,
  onWidgetUpdate,
  onWidgetDelete,
}: EditableDashboardGridProps) {
  const [layouts, setLayouts] = useState<Layout[]>(
    widgets.map(w => ({
      i: w.id,
      x: w.layout?.x || 0,
      y: w.layout?.y || 0,
      w: w.layout?.w || 4,
      h: w.layout?.h || 1,
    }))
  );
  const [selectedWidget, setSelectedWidget] = useState<string | null>(null);

  const handleLayoutChange = useCallback((newLayout: Layout[]) => {
    setLayouts(newLayout);
  }, []);

  const handleSaveLayout = async () => {
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

    const { error } = await saveLayout(updatedWidgets);
    if (error) {
      console.error('Error saving layout:', error);
      alert('Failed to save layout. Please try again.');
    } else {
      alert('Layout saved successfully!');
    }
  };

  const handleDeleteWidget = async (widgetId: string) => {
    if (!confirm('Are you sure you want to delete this widget?')) return;
    
    const { error } = await onWidgetDelete(widgetId);
    if (error) {
      console.error('Error deleting widget:', error);
      alert('Failed to delete widget. Please try again.');
    }
  };

  if (!isEditMode) {
    // Static grid for view mode
    return (
      <div className="grid grid-cols-12 gap-4 auto-rows-[200px]">
        {widgets.map((widget) => {
          const { x, y, w, h } = widget.layout || { x: 0, y: 0, w: 4, h: 1 };
          return (
            <div
              key={widget.id}
              style={{
                gridColumn: `${x + 1} / span ${w}`,
                gridRow: `${y + 1} / span ${h}`,
              }}
              className="min-h-0"
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
      {/* Edit Mode Controls */}
      <div className="mb-4 flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-blue-900">✏️ Edit Mode</span>
          <span className="text-xs text-blue-700">Drag widgets to rearrange • Resize from corners</span>
        </div>
        <button
          onClick={handleSaveLayout}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
        >
          Save Layout
        </button>
      </div>

      {/* Draggable Grid */}
      <GridLayout
        className="layout"
        layout={layouts}
        cols={12}
        rowHeight={200}
        width={1200}
        onLayoutChange={handleLayoutChange}
        isDraggable={true}
        isResizable={true}
        compactType={null}
        preventCollision={false}
        margin={[16, 16]}
      >
        {widgets.map((widget) => (
          <div
            key={widget.id}
            className={`relative cursor-move ${
              selectedWidget === widget.id ? 'ring-2 ring-blue-500' : ''
            }`}
            onClick={() => setSelectedWidget(widget.id)}
          >
            {/* Widget Controls */}
            <div className="absolute top-2 right-2 z-10 flex gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedWidget(widget.id);
                }}
                className="p-1.5 bg-white border border-gray-300 rounded shadow-sm hover:bg-gray-50"
                title="Configure"
              >
                ⚙️
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteWidget(widget.id);
                }}
                className="p-1.5 bg-white border border-red-300 text-red-600 rounded shadow-sm hover:bg-red-50"
                title="Delete"
              >
                🗑️
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
  const [title, setTitle] = useState(widget.title);
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
