'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { AlertTriangle, MapPin, Ruler, XCircle, RefreshCw, ArrowRight } from 'lucide-react';

interface BlockedRequest {
  id: string;
  employee_id: string;
  employee_name: string | null;
  status: string;
  blocking_reasons: Array<{ type: string; lineId?: string; catalogItemId?: string; needed?: string }>;
  created_at: string;
  trigger_event: string | null;
}

interface FailedLine {
  id: string;
  request_id: string;
  catalog_item_id: string;
  status: string;
  external_order_id: string | null;
  substitution_reason: string | null;
}

interface CategoryData {
  count: number;
  requests: BlockedRequest[];
  failed_lines?: FailedLine[];
}

type TabKey = 'needs_mapping' | 'needs_address' | 'needs_sizing' | 'failed';

const TAB_CONFIG: Array<{ key: TabKey; label: string; icon: typeof AlertTriangle; color: string; bg: string }> = [
  { key: 'needs_mapping', label: 'Missing Mapping', icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50' },
  { key: 'needs_address', label: 'Missing Address', icon: MapPin, color: 'text-blue-600', bg: 'bg-blue-50' },
  { key: 'needs_sizing', label: 'Missing Sizing', icon: Ruler, color: 'text-purple-600', bg: 'bg-purple-50' },
  { key: 'failed', label: 'Failed Orders', icon: XCircle, color: 'text-red-600', bg: 'bg-red-50' },
];

export default function FailureQueuePage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Record<TabKey, CategoryData>>({
    needs_mapping: { count: 0, requests: [] },
    needs_address: { count: 0, requests: [] },
    needs_sizing: { count: 0, requests: [] },
    failed: { count: 0, requests: [] },
  });
  const [activeTab, setActiveTab] = useState<TabKey>('needs_mapping');
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/provisioning/failure-queue');
      const result = await res.json();
      if (result.categories) {
        setCategories(result.categories);
      }
    } catch (error) {
      console.error('Error fetching failure queue:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 30000);
    return () => clearInterval(interval);
  }, [fetchQueue]);

  const handleResolve = async (requestId: string) => {
    setResolving(requestId);
    try {
      const res = await fetch(`/api/provisioning/requests/${requestId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({}),
      });
      const result = await res.json();
      if (result.data?.resolved) {
        fetchQueue();
      }
    } catch (error) {
      console.error('Error resolving blocker:', error);
    } finally {
      setResolving(null);
    }
  };

  const handleRetry = async (requestId: string) => {
    setResolving(requestId);
    try {
      await fetch(`/api/provisioning/requests/${requestId}/retry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({}),
      });
      fetchQueue();
    } catch (error) {
      console.error('Error retrying request:', error);
    } finally {
      setResolving(null);
    }
  };

  const totalCount = Object.values(categories).reduce((sum, c) => sum + c.count, 0);
  const activeCategory = categories[activeTab];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Failure Queue"
          description={`${totalCount} blocked or failed provisioning request${totalCount !== 1 ? 's' : ''}`}
          actions={
            <button
              onClick={fetchQueue}
              disabled={loading}
              className="px-3 py-2 border rounded-md hover:bg-gray-50 flex items-center gap-2 text-sm disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          }
        />

        {/* Tabs */}
        <div className="border-b">
          <nav className="flex -mb-px space-x-6">
            {TAB_CONFIG.map((tab) => {
              const count = categories[tab.key].count;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`
                    flex items-center gap-2 py-3 px-1 border-b-2 text-sm font-medium transition-colors
                    ${isActive
                      ? `border-current ${tab.color}`
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }
                  `}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                  {count > 0 && (
                    <span className={`
                      inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold
                      ${isActive ? `${tab.bg} ${tab.color}` : 'bg-gray-100 text-gray-600'}
                    `}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        {loading && activeCategory.requests.length === 0 ? (
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-gray-100 rounded-lg" />
            ))}
          </div>
        ) : activeCategory.requests.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p className="text-lg font-medium">No {TAB_CONFIG.find((t) => t.key === activeTab)?.label.toLowerCase()} issues</p>
            <p className="text-sm mt-1">All clear in this category.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeCategory.requests.map((request) => (
              <div
                key={request.id}
                className="border rounded-lg p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-gray-900">
                        {request.employee_name || request.employee_id}
                      </span>
                      {request.trigger_event && (
                        <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded bg-indigo-100 text-indigo-700">
                          {request.trigger_event.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      Created {new Date(request.created_at).toLocaleDateString()} &middot; ID: {request.id.slice(0, 8)}...
                    </div>
                    {/* Blocking reason details */}
                    {request.blocking_reasons && request.blocking_reasons.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {request.blocking_reasons.map((reason, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-yellow-50 text-yellow-800 border border-yellow-200"
                          >
                            {reason.type.replace(/_/g, ' ')}
                            {reason.catalogItemId && ` (${reason.catalogItemId.slice(0, 8)}...)`}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {activeTab === 'failed' ? (
                      <button
                        onClick={() => handleRetry(request.id)}
                        disabled={resolving === request.id}
                        className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
                      >
                        <RefreshCw className={`h-3 w-3 ${resolving === request.id ? 'animate-spin' : ''}`} />
                        Retry
                      </button>
                    ) : (
                      <button
                        onClick={() => handleResolve(request.id)}
                        disabled={resolving === request.id}
                        className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1"
                      >
                        {resolving === request.id ? (
                          <RefreshCw className="h-3 w-3 animate-spin" />
                        ) : (
                          <ArrowRight className="h-3 w-3" />
                        )}
                        Re-check
                      </button>
                    )}
                    <button
                      onClick={() => router.push(`/provisioning/requests/${request.id}`)}
                      className="px-3 py-1.5 text-sm border rounded-md hover:bg-gray-50"
                    >
                      View
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
