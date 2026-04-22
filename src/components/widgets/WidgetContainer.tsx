'use client';

import type { DashboardWidget } from '@/types/dashboard';
import { getWidgetComponent } from './WidgetRegistry';

interface WidgetContainerProps {
  widget: DashboardWidget;
}

export function WidgetContainer({ widget }: WidgetContainerProps) {
  const WidgetComponent = getWidgetComponent(widget.widget_key);
  
  return <WidgetComponent widget={widget} />;
}
