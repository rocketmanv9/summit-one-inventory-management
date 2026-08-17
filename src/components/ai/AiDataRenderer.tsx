'use client';

import type { AiDataDisplay } from '@/lib/ai/types';
import { AiMetricCard } from './AiMetricCard';
import { AiDataTable } from './AiDataTable';
import { AiBarChart } from './AiBarChart';
import { AiDashboardLink } from './AiDashboardLink';
import { PoDraftCard } from './PoDraftCard';

interface AiDataRendererProps {
  data: AiDataDisplay;
}

/**
 * Dispatcher component that routes an AiDataDisplay to the right renderer.
 * Used inline in chat messages when a server-side query returns structured data.
 */
export function AiDataRenderer({ data }: AiDataRendererProps) {
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
    default:
      return null;
  }
}
