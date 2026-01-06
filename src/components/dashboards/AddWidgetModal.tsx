'use client';

import { useState } from 'react';
import { useWidgetRegistry } from '@/hooks/useDashboards';
import type { WidgetRegistryEntry } from '@/types/dashboard';
import { createClient } from '@/supabase/client';

interface AddWidgetModalProps {
  dashboardId: string;
  onClose: () => void;
  onAdded: () => void;
}

export function AddWidgetModal({ dashboardId, onClose, onAdded }: AddWidgetModalProps) {
  const { widgets: registryWidgets, loading } = useWidgetRegistry();
  const [selectedDomain, setSelectedDomain] = useState<string>('all');
  const [adding, setAdding] = useState(false);
  const supabase = createClient();

  const domains = ['all', ...Array.from(new Set(registryWidgets.map(w => w.domain)))];
  
  const filteredWidgets = selectedDomain === 'all'
    ? registryWidgets
    : registryWidgets.filter(w => w.domain === selectedDomain);

  const handleAddWidget = async (widget: WidgetRegistryEntry) => {
    setAdding(true);
    try {
      // Find highest y position to add new widget at bottom
      const { data: existingWidgets } = await supabase
        .from('dashboard_widgets')
        .select('layout')
        .eq('dashboard_id', dashboardId);

      let maxY = 0;
      existingWidgets?.forEach((w: any) => {
        const y = (w.layout as any)?.y || 0;
        const h = (w.layout as any)?.h || 1;
        maxY = Math.max(maxY, y + h);
      });

      // Insert new widget
      const { error } = await supabase
        .from('dashboard_widgets')
        .insert({
          dashboard_id: dashboardId,
          widget_key: widget.widget_key,
          title: widget.name,
          layout: {
            x: 0,
            y: maxY,
            w: widget.default_width,
            h: widget.default_height,
          },
          config: widget.default_config || {},
          refresh_seconds: 300,
          created_by: 'user',
          updated_by: 'user',
        });

      if (error) throw error;

      onAdded();
      onClose();
    } catch (error) {
      console.error('Error adding widget:', error);
      alert('Failed to add widget. Please try again.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Add Widget</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {/* Domain Filter */}
        <div className="px-6 py-3 border-b border-gray-200 bg-gray-50">
          <div className="flex gap-2 flex-wrap">
            {domains.map(domain => (
              <button
                key={domain}
                onClick={() => setSelectedDomain(domain)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  selectedDomain === domain
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                }`}
              >
                {domain === 'all' ? 'All' : domain.charAt(0).toUpperCase() + domain.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Widget Grid */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="animate-pulse grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-32 bg-gray-200 rounded"></div>
              ))}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredWidgets.map((widget) => (
                <button
                  key={widget.widget_key}
                  onClick={() => handleAddWidget(widget)}
                  disabled={adding}
                  className="text-left p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-400 hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-semibold text-gray-900">{widget.name}</h4>
                    <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded">
                      {widget.domain}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 line-clamp-2">
                    {widget.description}
                  </p>
                  <div className="mt-3 text-xs text-gray-500">
                    Size: {widget.default_width}×{widget.default_height}
                  </div>
                </button>
              ))}
            </div>
          )}

          {!loading && filteredWidgets.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              No widgets available in this category
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
