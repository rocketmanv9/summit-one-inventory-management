'use client';

import type { AiDataDisplay } from '@/lib/ai/types';
import { AiMetricCard } from './AiMetricCard';
import { AiDataTable } from './AiDataTable';
import { AiBarChart } from './AiBarChart';
import { AiDashboardLink } from './AiDashboardLink';
import { PoDraftCard } from './PoDraftCard';
import { ItemNotFoundCard } from './ItemNotFoundCard';

interface AiDataRendererProps {
  data: AiDataDisplay;
  /**
   * Sends a follow-up user message into the chat. Cards that carry an inline
   * next-step action (e.g. the item-not-found grace card's "Add & keep going")
   * use it to continue the procure playbook without leaving chat.
   */
  onSend?: (message: string) => void;
  disabled?: boolean;
}

/**
 * Dispatcher component that routes an AiDataDisplay to the right renderer.
 * Used inline in chat messages when a server-side query returns structured data.
 */
export function AiDataRenderer({ data, onSend, disabled }: AiDataRendererProps) {
  switch (data.displayType) {
    case 'metric':
      return <AiMetricCard data={data} />;
    case 'table':
      return <AiDataTable data={data} />;
    case 'chart':
      return <AiBarChart data={data} />;
    case 'dashboard_link':
      return <AiDashboardLink data={data} />;
    case 'po_draft':
      return <PoDraftCard data={data} />;
    case 'item_not_found':
      return <ItemNotFoundCard data={data} onSend={onSend} disabled={disabled} />;
    default:
      return null;
  }
}
