'use client';

import { useRouter } from 'next/navigation';
import { LayoutDashboard, ArrowRight } from 'lucide-react';
import type { AiDashboardLinkDisplay } from '@/lib/ai/types';

interface AiDashboardLinkProps {
  data: AiDashboardLinkDisplay;
}

export function AiDashboardLink({ data }: AiDashboardLinkProps) {
  const router = useRouter();

  return (
    <div className="mt-2 rounded-lg border border-green-200 bg-gradient-to-br from-green-50 to-white p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
          <LayoutDashboard className="w-5 h-5 text-green-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">
            {data.dashboardName}
          </div>
          <div className="text-xs text-gray-500">Dashboard created</div>
        </div>
        <button
          onClick={() => router.push(`/dashboard/${data.dashboardId}`)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-100 rounded-md hover:bg-green-200 transition-colors"
        >
          View Dashboard
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
