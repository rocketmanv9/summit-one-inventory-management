'use client';

import { AppError } from '@rocketmanv9/chassis/errors';

import { useState, useEffect } from 'react';
import { MobileSessionQRDialog } from '@/components/cycle-counts/MobileSessionQRDialog';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { apiWrite, authenticatedFetch } from '@/lib/api-client';
import { useUOMLabelMap } from '@/hooks/useGVTerms';

interface CycleCount {
  id: string;
  count_number: string;
  tenant_id: string;
  location_id: string;
  count_type: string;
  is_blind: boolean;
  status: string;
  scheduled_for?: string;
  started_at?: string;
  snapshot_at?: string;
  snapshot_captured_at?: string;
  completed_at?: string;
  approved_at?: string;
  approved_by_user_id?: string;
  posted_at?: string;
  created_at: string;
  location?: { 
    id: string; 
    name: string; 
    location_types?: { name: string }; 
  };
}

export default function CycleCountsPage() {
  const [cycleCounts, setCycleCounts] = useState<CycleCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCount, setSelectedCount] = useState<CycleCount | null>(null);

  useEffect(() => {
    fetchCycleCounts();
  }, [filters]);

  const fetchCycleCounts = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);

      const res = await authenticatedFetch(`/api/inventory/cycle-counts?${params}`);
      const { data } = await res.json();
      setCycleCounts(data || []);
    } catch (error) {
      console.error('Error fetching cycle counts:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-700',
      scheduled: 'bg-cyan-100 text-cyan-700',
      in_progress: 'bg-blue-100 text-blue-700',
      under_review: 'bg-purple-100 text-purple-700',
      approved: 'bg-green-100 text-green-700',
      posted: 'bg-emerald-100 text-emerald-700',
      closed: 'bg-gray-100 text-gray-600',
      cancelled: 'bg-red-100 text-red-700',
    };
    return colors[status] || 'bg-gray-100 text-gray-600';
  };

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  };

  const columns = [
    {
      key: 'cycle_count_number',
      header: 'Count #',
      render: (row: CycleCount) => (
        <div>
          <div className="font-mono text-sm font-medium">{row.count_number}</div>
          {row.is_blind && (
            <div className="text-xs text-amber-600 mt-0.5">🔒 Blind Count</div>
          )}
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Location',
      sortable: true,
      render: (row: CycleCount) => (
        <div>
          <div className="font-medium">{row.location?.name || '-'}</div>
          <div className="text-xs text-muted-foreground capitalize">
            {row.location?.location_types?.name || ''}
          </div>
        </div>
      ),
    },
    {
      key: 'count_type',
      header: 'Type',
      render: (row: CycleCount) => (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 capitalize">
          {row.count_type.replace('_', ' ')}
        </span>
      ),
    },
    {
      key: 'scheduled_for',
      header: 'Scheduled',
      render: (row: CycleCount) => (
        <div className="text-sm">
          {formatDate(row.scheduled_for || row.started_at || row.created_at)}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: CycleCount) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(row.status)}`}>
          {row.status === 'submitted_for_review' ? 'Pending Review' : row.status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
        </span>
      ),
    },
    {
      key: 'progress',
      header: 'Progress',
      render: (row: CycleCount) => {
        if (row.status === 'draft') return <span className="text-sm text-muted-foreground">Not started</span>;
        if (row.status === 'posted' || row.status === 'closed') {
          return <span className="text-sm text-green-600 font-medium">✓ Complete</span>;
        }
        if (row.status === 'approved') {
          return <span className="text-sm text-green-600 font-medium">Approved</span>;
        }
        if (row.status === 'under_review') {
          return <span className="text-sm text-purple-600 font-medium">Under Review</span>;
        }
        if (row.snapshot_captured_at) {
          return <span className="text-sm text-blue-600">Snapshot captured</span>;
        }
        return <span className="text-sm text-muted-foreground">In progress...</span>;
      },
    },
    {
      key: 'actions',
      header: '',
      render: (row: CycleCount) => (
        <div className="flex gap-2 justify-end">
          {row.status === 'draft' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleStartCount(row);
              }}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
            >
              Start Count
            </button>
          )}
          {row.status === 'in_progress' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedCount(row);
              }}
              className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-md hover:bg-green-700 font-medium"
            >
              View Details
            </button>
          )}
          {row.status === 'under_review' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedCount(row);
              }}
              className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded-md hover:bg-purple-700 font-medium"
            >
              Review
            </button>
          )}
          {(row.status === 'approved' || row.status === 'posted') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSelectedCount(row);
              }}
              className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 font-medium"
            >
              View
            </button>
          )}
        </div>
      ),
    },
  ];

  const handleStartCount = async (cycleCount: CycleCount) => {
    if (!confirm(`Start cycle count ${cycleCount.count_number}?`)) return;

    try {
      const res = await apiWrite(`/api/inventory/cycle-counts/${cycleCount.id}/start`, {
        method: 'POST',
      });

      if (!res.ok) {
        const data = await res.json();
        throw AppError.internal(typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to start count');
      }

      fetchCycleCounts();
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    }
  };

  const filterConfig = [
    {
      key: 'status',
      label: 'Status',
      type: 'select' as const,
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'scheduled', label: 'Scheduled' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'under_review', label: 'Under Review' },
        { value: 'approved', label: 'Approved' },
        { value: 'posted', label: 'Posted' },
        { value: 'closed', label: 'Closed' },
        { value: 'cancelled', label: 'Cancelled' },
      ],
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Cycle Counts"
          description="Manage inventory cycle counts and variance reviews. Example: Physically count all asphalt mix at the plant yard, compare to system records, and approve adjustments for 5 tons that was used for equipment maintenance (variance)."
          actions={
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              + Start Cycle Count
            </button>
          }
        />

        <div className="grid grid-cols-4 gap-4">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="text-2xl font-bold text-blue-700">
              {cycleCounts.filter(c => c.status === 'draft').length}
            </div>
            <div className="text-sm text-blue-600">Draft</div>
          </div>
          <div className="p-4 bg-cyan-50 border border-cyan-200 rounded-lg">
            <div className="text-2xl font-bold text-cyan-700">
              {cycleCounts.filter(c => c.status === 'in_progress').length}
            </div>
            <div className="text-sm text-cyan-600">In Progress</div>
          </div>
          <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
            <div className="text-2xl font-bold text-purple-700">
              {cycleCounts.filter(c => c.status === 'under_review').length}
            </div>
            <div className="text-sm text-purple-600">Under Review</div>
          </div>
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="text-2xl font-bold text-green-700">
              {cycleCounts.filter(c => c.status === 'posted' || c.status === 'closed').length}
            </div>
            <div className="text-sm text-green-600">Completed</div>
          </div>
        </div>

        <FilterBar
          filters={filterConfig}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClear={() => setFilters({})}
        />

        <DataTable
          data={cycleCounts}
          columns={columns}
          loading={loading}
          emptyMessage="No cycle counts found"
          rowKey={(row) => row.id}
          onRowClick={setSelectedCount}
        />

        {selectedCount && (
          <CycleCountDetailPanel
            cycleCount={selectedCount}
            onClose={() => setSelectedCount(null)}
            onUpdate={fetchCycleCounts}
          />
        )}

        {showCreateModal && (
          <CreateCycleCountModal
            onClose={() => setShowCreateModal(false)}
            onCreated={() => {
              setShowCreateModal(false);
              fetchCycleCounts();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

function CycleCountDetailPanel({ cycleCount, onClose, onUpdate }: {
  cycleCount: CycleCount;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const uomLabels = useUOMLabelMap();
  const [countLines, setCountLines] = useState<any[]>([]);
  const [loadingLines, setLoadingLines] = useState(true);
  const [showMobileDialog, setShowMobileDialog] = useState(false);

  useEffect(() => {
    if (cycleCount.status === 'in_progress' || cycleCount.status === 'under_review') {
      fetchCountLines();
    } else {
      setCountLines([]);
      setLoadingLines(false);
    }
  }, [cycleCount.id, cycleCount.status]);

  const fetchCountLines = async () => {
    setLoadingLines(true);
    try {
      const res = await fetch(`/api/inventory/cycle-counts/${cycleCount.id}/lines`);
      const { data } = await res.json();
      
      console.log('Fetched lines:', data);
      
      // For each line, fetch assets if it's a serialized item
      const linesWithAssets = await Promise.all((data || []).map(async (line: any) => {
        console.log(`Line ${line.catalog_item?.name} tracking mode:`, line.catalog_item?.tracking_mode);
        if (line.catalog_item?.tracking_mode === 'serialized') {
          console.log(`Fetching assets for serialized item: ${line.catalog_item.name}`);
          const assetsRes = await fetch(`/api/inventory/cycle-counts/${cycleCount.id}/lines/${line.id}/assets`);
          const assetsData = await assetsRes.json();
          console.log('Assets data:', assetsData);
          return {
            ...line,
            expected_assets: assetsData.data?.expected_assets || [],
            counted_assets: assetsData.data?.counted_assets || []
          };
        }
        return line;
      }));
      
      console.log('Lines with assets:', linesWithAssets);
      setCountLines(linesWithAssets);
    } catch (error) {
      console.error('Error fetching count lines:', error);
    } finally {
      setLoadingLines(false);
    }
  };

  const updateAssetCount = async (lineId: string, assetIds: string[]) => {
    try {
      const res = await apiWrite(`/api/inventory/cycle-counts/${cycleCount.id}/lines/${lineId}/assets`, {
        method: 'POST',
        body: { asset_ids: assetIds }
      });
      
      if (!res.ok) {
        throw AppError.internal('Failed to update asset count');
      }
      
      fetchCountLines();
    } catch (error) {
      console.error('Error updating asset count:', error);
      alert('Failed to update asset count');
    }
  };

  const updateCountLine = async (lineId: string, actualQty: number | null) => {
    try {
      const res = await apiWrite(`/api/inventory/cycle-counts/${cycleCount.id}/lines/${lineId}`, {
        method: 'PATCH',
        body: { actual_qty: actualQty }
      });
      if (!res.ok) throw AppError.internal('Failed to update count');
      fetchCountLines();
    } catch (error) {
      alert('Error updating count');
    }
  };

  const handleVarianceDecision = async (lineId: string, decision: string, reason?: string) => {
    try {
      const res = await apiWrite(`/api/inventory/cycle-counts/${cycleCount.id}/lines/${lineId}/decide`, {
        method: 'POST',
        body: { decision, reason }
      });
      if (!res.ok) {
        const data = await res.json();
        throw AppError.internal(typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to record decision');
      }
      fetchCountLines();
    } catch (error: any) {
      alert(error.message || 'Error recording variance decision');
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[48rem] bg-white shadow-xl border-l z-40 overflow-y-auto">
      <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-white z-10">
        <h3 className="font-semibold">Cycle Count Details</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl">✕</button>
      </div>

      <div className="p-6 space-y-6">
        {/* Header Info */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <span className="font-mono text-lg font-bold">{cycleCount.count_number}</span>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              cycleCount.status === 'posted' ? 'bg-green-100 text-green-800' :
              cycleCount.status === 'under_review' ? 'bg-purple-100 text-purple-800' :
              cycleCount.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
              'bg-gray-100 text-gray-800'
            }`}>
              {cycleCount.status === 'under_review' ? 'Under Review' : 
               cycleCount.status === 'in_progress' ? 'In Progress' :
               cycleCount.status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </span>
          </div>

          {cycleCount.is_blind && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg mb-4">
              <div className="flex items-start gap-2">
                <span className="text-amber-600">🔒</span>
                <div>
                  <div className="text-sm font-medium text-amber-900">Blind Count Active</div>
                  <div className="text-xs text-amber-700 mt-0.5">
                    Expected quantities are hidden from counter to reduce bias
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Location Info */}
        <div className="p-4 bg-gray-50 rounded-lg border">
          <div className="text-xs text-muted-foreground mb-1">Location</div>
          <div className="font-medium text-lg">{cycleCount.location?.name || 'Unknown'}</div>
          <div className="text-sm text-muted-foreground capitalize">
            {cycleCount.location?.location_types?.name || ''}
          </div>
        </div>

        {/* Count Type */}
        <div>
          <div className="text-xs text-muted-foreground mb-2">Count Type</div>
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 capitalize">
            {cycleCount.count_type.replace('_', ' ')}
          </span>
        </div>

        {/* Item Counting Section */}
        {(cycleCount.status === 'in_progress' || cycleCount.status === 'under_review') && (
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium">Items to Count</div>
              <div className="text-xs text-muted-foreground">
                {countLines.filter(l => l.qty_counted !== null).length} / {countLines.length} counted
              </div>
            </div>

            {loadingLines ? (
              <div className="text-center py-8 text-muted-foreground">Loading items...</div>
            ) : countLines.length === 0 ? (
              <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="text-sm text-yellow-800">
                  No items found at this location. This could mean:
                  <ul className="list-disc ml-4 mt-2 space-y-1">
                    <li>The location is empty</li>
                    <li>Stock balances haven't been initialized</li>
                    <li>Items need to be received first</li>
                  </ul>
                </div>
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {countLines.map((line) => (
                  <div key={line.id} className="p-3 border rounded-lg hover:bg-gray-50">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="font-medium text-sm">{line.catalog_item?.name || 'Unknown Item'}</div>
                        <div className="text-xs text-muted-foreground">{line.catalog_item?.sku}</div>
                      </div>
                      {!cycleCount.is_blind && (
                        <div className="text-xs text-muted-foreground">
                          Expected: <span className="font-medium">{line.qty_expected}</span>
                        </div>
                      )}
                    </div>
                    
                    {cycleCount.status === 'in_progress' ? (
                      line.catalog_item?.tracking_mode === 'serialized' ? (
                        // Serialized: Show asset checkboxes
                        <div className="space-y-2">
                          <div className="text-xs font-medium text-gray-700">Select assets found:</div>
                          {line.expected_assets && line.expected_assets.length > 0 ? (
                            <div className="space-y-1">
                              {line.expected_assets.map((asset: any) => {
                                const isChecked = line.counted_assets?.some((ca: any) => ca.asset_id === asset.id) || false;
                                return (
                                  <label key={asset.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-2 rounded">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={(e) => {
                                        const currentAssetIds = line.counted_assets?.map((ca: any) => ca.asset_id) || [];
                                        const newAssetIds = e.target.checked
                                          ? [...currentAssetIds, asset.id]
                                          : currentAssetIds.filter((id: string) => id !== asset.id);
                                        updateAssetCount(line.id, newAssetIds);
                                      }}
                                      className="rounded"
                                    />
                                    <span className="flex-1">
                                      {asset.asset_tag || asset.serial_number || 'Unnamed Asset'}
                                      <span className="text-xs text-gray-500 ml-2">({asset.status})</span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="text-xs text-gray-500">No assets expected at this location</div>
                          )}
                          {line.qty_counted !== null && !cycleCount.is_blind && (
                            <div className="text-xs text-gray-600 mt-2">
                              Found: <span className="font-medium">{line.qty_counted}</span> / Expected: {line.qty_expected}
                            </div>
                          )}
                        </div>
                      ) : (
                        // Fungible: Show quantity input
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-muted-foreground">Actual Count:</label>
                          <input
                            type="number"
                            defaultValue={line.qty_counted ?? ''}
                            onBlur={(e) => {
                              const value = e.target.value === '' ? null : parseFloat(e.target.value);
                              if (value !== line.qty_counted) {
                                updateCountLine(line.id, value);
                              }
                            }}
                            className="flex-1 px-2 py-1 border rounded text-sm"
                            placeholder="Enter count"
                            step="0.01"
                          />
                          {line.qty_counted !== null && !cycleCount.is_blind && (
                            <span className={`text-xs font-medium ${
                              Math.abs((line.qty_counted || 0) - line.qty_expected) > 0.01
                                ? 'text-red-600'
                                : 'text-green-600'
                            }`}>
                              {((line.qty_counted || 0) - line.qty_expected) >= 0 ? '+' : ''}
                              {((line.qty_counted || 0) - line.qty_expected).toFixed(2)}
                            </span>
                          )}
                        </div>
                      )
                    ) : cycleCount.status === 'under_review' ? (
                      // Variance decision UI
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm">
                            Counted: <span className="font-medium">{line.qty_counted ?? 'Not counted'}</span>
                          </div>
                          {line.qty_counted !== null && Math.abs((line.qty_counted || 0) - line.qty_expected) > 0.01 && (
                            <span className="text-xs font-medium text-red-600">
                              Variance: {((line.qty_counted || 0) - line.qty_expected) >= 0 ? '+' : ''}
                              {((line.qty_counted || 0) - line.qty_expected).toFixed(2)} ({(((line.qty_counted || 0) - line.qty_expected) / line.qty_expected * 100).toFixed(1)}%)
                            </span>
                          )}
                        </div>

                        {/* For serialized items, show which assets are missing/extra */}
                        {line.catalog_item?.tracking_mode === 'serialized' && line.expected_assets && line.expected_assets.length > 0 && (
                          <div className="text-xs space-y-1">
                            {line.expected_assets.map((asset: any) => {
                              const wasCounted = line.counted_assets?.some((ca: any) => ca.asset_id === asset.id);
                              return (
                                <div key={asset.id} className={`flex items-center gap-2 ${!wasCounted ? 'text-red-600' : 'text-green-600'}`}>
                                  <span>{wasCounted ? '✓' : '✗'}</span>
                                  <span>{asset.asset_tag || asset.serial_number || 'Unnamed Asset'}</span>
                                  <span className="text-gray-500">({wasCounted ? 'Found' : 'Missing'})</span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Show variance decision UI if variance exists */}
                        {line.qty_counted !== null && Math.abs((line.qty_counted || 0) - line.qty_expected) > 0.01 && (
                          <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded">
                            {line.decision_status === 'pending' || !line.decision_status ? (
                              <div className="space-y-2">
                                <div className="text-xs font-medium text-yellow-900">Decision Required</div>
                                <select
                                  className="w-full text-xs px-2 py-1 border rounded"
                                  defaultValue=""
                                  onChange={(e) => {
                                    const reason = e.target.value;
                                    if (reason) {
                                      handleVarianceDecision(line.id, 'accepted', reason);
                                    }
                                  }}
                                >
                                  <option value="">Select reason to accept...</option>
                                  <option value="usage_not_recorded">Usage not recorded</option>
                                  <option value="transfer_not_recorded">Transfer not recorded</option>
                                  <option value="loss_theft">Loss/Theft</option>
                                  <option value="damage_disposal">Damage/Disposal</option>
                                  <option value="counting_error">Counting error</option>
                                  <option value="receiving_error">Receiving error</option>
                                  <option value="bulk_drift">Bulk estimation drift</option>
                                  <option value="unknown">Unknown</option>
                                </select>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => handleVarianceDecision(line.id, 'investigating')}
                                    className="flex-1 px-2 py-1 text-xs bg-orange-100 text-orange-700 rounded hover:bg-orange-200"
                                  >
                                    Investigate
                                  </button>
                                  <button
                                    onClick={() => handleVarianceDecision(line.id, 'rejected')}
                                    className="flex-1 px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                                  >
                                    Reject Count
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between gap-2">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                  line.decision_status === 'accepted' ? 'bg-green-100 text-green-800' :
                                  line.decision_status === 'investigating' ? 'bg-orange-100 text-orange-800' :
                                  'bg-red-100 text-red-800'
                                }`}>
                                  {line.decision_status === 'accepted' ? `✓ Accepted: ${line.decision_reason?.replace(/_/g, ' ')}` :
                                   line.decision_status === 'investigating' ? '⚠ Investigating' :
                                   '✗ Rejected'}
                                </span>
                                <button
                                  onClick={() => handleVarianceDecision(line.id, 'pending')}
                                  className="text-xs text-blue-600 hover:text-blue-800 underline"
                                >
                                  Change
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* No variance - auto-accepted */}
                        {line.qty_counted !== null && Math.abs((line.qty_counted || 0) - line.qty_expected) <= 0.01 && (
                          <div className="text-xs text-green-600">✓ Match - no adjustment needed</div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="text-sm">
                          Counted: <span className="font-medium">{line.qty_counted ?? 'Not counted'}</span>
                        </div>
                        {line.qty_counted !== null && (
                          <span className={`text-xs font-medium ${
                            Math.abs((line.qty_counted || 0) - line.qty_expected) > 0.01
                              ? 'text-red-600'
                              : 'text-green-600'
                          }`}>
                            Variance: {((line.qty_counted || 0) - line.qty_expected) >= 0 ? '+' : ''}
                            {((line.qty_counted || 0) - line.qty_expected).toFixed(2)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Timeline */}
        <div className="border-t pt-4">
          <div className="text-sm font-medium mb-3">Timeline</div>
          <div className="space-y-3">
            {cycleCount.scheduled_for && (
              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-blue-600"></div>
                </div>
                <div>
                  <div className="text-sm font-medium">Scheduled</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(cycleCount.scheduled_for).toLocaleString()}
                  </div>
                </div>
              </div>
            )}
            {cycleCount.started_at && (
              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-cyan-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-cyan-600"></div>
                </div>
                <div>
                  <div className="text-sm font-medium">Started</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(cycleCount.started_at).toLocaleString()}
                  </div>
                </div>
              </div>
            )}
            {cycleCount.snapshot_at && (
              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-purple-600"></div>
                </div>
                <div>
                  <div className="text-sm font-medium">Snapshot Captured</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(cycleCount.snapshot_at).toLocaleString()}
                  </div>
                </div>
              </div>
            )}
            {cycleCount.completed_at && (
              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-yellow-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-yellow-600"></div>
                </div>
                <div>
                  <div className="text-sm font-medium">Completed</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(cycleCount.completed_at).toLocaleString()}
                  </div>
                </div>
              </div>
            )}
            {cycleCount.approved_at && (
              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-green-600"></div>
                </div>
                <div>
                  <div className="text-sm font-medium">Approved</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(cycleCount.approved_at).toLocaleString()}
                  </div>
                </div>
              </div>
            )}
            {cycleCount.posted_at && (
              <div className="flex gap-3">
                <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-600"></div>
                </div>
                <div>
                  <div className="text-sm font-medium">Posted to Inventory</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(cycleCount.posted_at).toLocaleString()}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Next Steps */}
        {cycleCount.status === 'draft' && (
          <div className="border-t pt-4 space-y-3">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="text-sm font-medium text-blue-900 mb-2">Ready to Start</div>
              <div className="text-sm text-blue-700">
                Click "Start Count" below to begin counting. This will snapshot the current inventory
                quantities and allow you to enter actual counts.
              </div>
            </div>
            <button
              onClick={async () => {
                if (!confirm(`Start cycle count ${cycleCount.count_number}?`)) return;
                try {
                  const res = await apiWrite(`/api/inventory/cycle-counts/${cycleCount.id}/start`, {
                    method: 'POST',
                  });
                  if (!res.ok) {
                    const data = await res.json();
                    throw AppError.internal(typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to start count');
                  }
                  onClose();
                  onUpdate();
                } catch (error: any) {
                  alert(error.message || 'Error starting cycle count');
                }
              }}
              className="w-full px-4 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
            >
              Start Count
            </button>
          </div>
        )}
        
        {cycleCount.status === 'in_progress' && (
          <div className="border-t pt-4 space-y-3">
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="text-sm font-medium text-blue-900 mb-2">Next Steps</div>
              <div className="text-sm text-blue-700">
                Use a handheld RFID scanner or manually enter counts for items in this location.
                Once complete, submit the count for review.
              </div>
            </div>
            <button
              onClick={() => setShowMobileDialog(true)}
              className="w-full px-4 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-medium flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              Mobile Count (QR Code)
            </button>
            <MobileSessionQRDialog
              isOpen={showMobileDialog}
              onClose={() => setShowMobileDialog(false)}
              cycleCountId={cycleCount.id}
              cycleCountNumber={cycleCount.count_number}
            />
            <button
              onClick={async () => {
                if (!confirm('Submit this cycle count for review?')) return;
                try {
                  const res = await apiWrite(`/api/inventory/cycle-counts/${cycleCount.id}/submit`, {
                    method: 'POST',
                  });
                  if (!res.ok) {
                    const data = await res.json();
                    throw AppError.internal(typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to submit');
                  }
                  onUpdate();
                  onClose();
                } catch (error: any) {
                  alert(error.message || 'Error submitting cycle count');
                }
              }}
              className="w-full px-4 py-3 bg-purple-600 text-white rounded-md hover:bg-purple-700 font-medium"
            >
              Submit for Review
            </button>
          </div>
        )}

        {cycleCount.status === 'under_review' && (
          <div className="border-t pt-4 space-y-3">
            {/* Check if all variance has been decided */}
            {(() => {
              const varianceLines = countLines.filter(l => 
                l.qty_counted !== null && Math.abs((l.qty_counted || 0) - l.qty_expected) > 0.01
              );
              const undecidedLines = varianceLines.filter(l => 
                !l.decision_status || l.decision_status === 'pending'
              );
              
              if (undecidedLines.length > 0) {
                return (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="text-sm font-medium text-amber-900 mb-2">⚠ Variance Requires Decisions</div>
                    <div className="text-sm text-amber-700">
                      {undecidedLines.length} item(s) with variance need decisions before posting.
                      Please accept (with reason), investigate, or reject each variance above.
                    </div>
                  </div>
                );
              }

              const acceptedLines = varianceLines.filter(l => l.decision_status === 'accepted');
              const investigatingLines = varianceLines.filter(l => l.decision_status === 'investigating');
              const rejectedLines = varianceLines.filter(l => l.decision_status === 'rejected');

              // Format reason for display
              const formatReason = (reason: string | null) => {
                if (!reason) return 'No reason';
                return reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
              };

              return (
                <>
                  {/* Combined Preview of Changes */}
                  {(acceptedLines.length > 0 || investigatingLines.length > 0 || rejectedLines.length > 0 || varianceLines.length === 0) && (
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-blue-900">📋 What Will Happen When You Approve:</div>
                        <div className="text-xs font-medium text-green-700 bg-green-100 px-2 py-1 rounded">✓ Ready to Post</div>
                      </div>
                      
                      <div className="text-xs text-blue-700 space-y-0.5 pb-2 border-b border-blue-200">
                        {acceptedLines.length > 0 && <div>• {acceptedLines.length} variance(s) will be adjusted</div>}
                        {investigatingLines.length > 0 && <div>• {investigatingLines.length} variance(s) marked for investigation</div>}
                        {rejectedLines.length > 0 && <div>• {rejectedLines.length} count(s) rejected</div>}
                        {varianceLines.length === 0 && <div>• No variance detected - counts match expected</div>}
                      </div>
                      
                      {acceptedLines.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-blue-800 uppercase tracking-wide">Stock Adjustments (Inventory Will Change):</div>
                          {acceptedLines.map((line) => {
                            const item = line.catalog_item;
                            const delta = (line.qty_counted || 0) - line.qty_expected;
                            const newQty = line.qty_expected + delta;
                            return (
                              <div key={line.id} className="pl-3 border-l-2 border-blue-300">
                                <div className="text-xs font-medium text-blue-900">{item?.name || 'Unknown Item'}</div>
                                <div className="text-xs text-blue-700 mt-0.5">
                                  <span className="font-medium">Reason:</span> {formatReason(line.decision_reason)}
                                </div>
                                <div className="text-xs text-blue-700 flex items-center gap-2 mt-0.5">
                                  <span>Stock: {line.qty_expected} {uomLabels[(item as any)?.uom_term_id] || 'units'}</span>
                                  <span className={delta < 0 ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
                                    {delta >= 0 ? '+' : ''}{delta}
                                  </span>
                                  <span>→ {newQty} {uomLabels[(item as any)?.uom_term_id] || 'units'}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {investigatingLines.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-orange-800 uppercase tracking-wide">Flagged for Investigation (No Stock Change):</div>
                          {investigatingLines.map((line) => {
                            const item = line.catalog_item;
                            const delta = (line.qty_counted || 0) - line.qty_expected;
                            return (
                              <div key={line.id} className="pl-3 border-l-2 border-orange-300">
                                <div className="text-xs font-medium text-orange-900">{item?.name || 'Unknown Item'}</div>
                                <div className="text-xs text-orange-700">
                                  Variance: {delta >= 0 ? '+' : ''}{delta} {uomLabels[(item as any)?.uom_term_id] || 'units'} - Requires follow-up
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {rejectedLines.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-red-800 uppercase tracking-wide">Rejected Counts (No Stock Change):</div>
                          {rejectedLines.map((line) => {
                            const item = line.catalog_item;
                            return (
                              <div key={line.id} className="pl-3 border-l-2 border-red-300">
                                <div className="text-xs font-medium text-red-900">{item?.name || 'Unknown Item'}</div>
                                <div className="text-xs text-red-700">
                                  Count marked invalid - preserved for audit only
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}

            <button
              onClick={async () => {
                // Final validation
                const varianceLines = countLines.filter(l => 
                  l.qty_counted !== null && Math.abs((l.qty_counted || 0) - l.qty_expected) > 0.01
                );
                const undecidedLines = varianceLines.filter(l => 
                  !l.decision_status || l.decision_status === 'pending'
                );

                if (undecidedLines.length > 0) {
                  alert(`Cannot post: ${undecidedLines.length} variance line(s) require decisions.`);
                  return;
                }

                if (!confirm('Approve this cycle count and post adjustments to inventory? This will:\n\n• Create stock movements for accepted variances\n• Update inventory quantities\n• Flag items for investigation\n• Preserve rejected counts for audit\n\nThis action cannot be undone.')) {
                  return;
                }

                try {
                  const res = await apiWrite(`/api/inventory/cycle-counts/${cycleCount.id}/approve`, {
                    method: 'POST',
                  });
                  
                  if (!res.ok) {
                    const data = await res.json();
                    throw AppError.internal(typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to approve');
                  }

                  const result = await res.json();
                  
                  // Show success message with summary
                  if (result.data?.adjustments_created > 0) {
                    alert(`✓ Cycle count posted successfully!\n\n${result.data.adjustments_created} adjustment(s) created\n${result.data.reorder_suggestions?.length || 0} reorder suggestion(s) generated`);
                  } else {
                    alert('✓ Cycle count posted successfully! No adjustments needed.');
                  }

                  onUpdate();
                  onClose();
                } catch (error: any) {
                  alert(`Error: ${error.message || 'Failed to approve cycle count'}`);
                }
              }}
              disabled={(() => {
                const varianceLines = countLines.filter(l => 
                  l.qty_counted !== null && Math.abs((l.qty_counted || 0) - l.qty_expected) > 0.01
                );
                const undecidedLines = varianceLines.filter(l => 
                  !l.decision_status || l.decision_status === 'pending'
                );
                return undecidedLines.length > 0;
              })()}
              className={`w-full px-4 py-3 rounded-md font-medium transition-colors ${
                (() => {
                  const varianceLines = countLines.filter(l => 
                    l.qty_counted !== null && Math.abs((l.qty_counted || 0) - l.qty_expected) > 0.01
                  );
                  const undecidedLines = varianceLines.filter(l => 
                    !l.decision_status || l.decision_status === 'pending'
                  );
                  return undecidedLines.length > 0
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-green-600 text-white hover:bg-green-700';
                })()
              }`}
            >
              Approve & Post to Inventory
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CreateCycleCountModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    location_id: '',
    count_type: 'full',
    is_blind: false,
    scheduled_for: '',
    include_assets: true,
    include_bulk_items: true,
    specific_items: [] as string[],
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [locations, setLocations] = useState<Array<{ id: string; name: string; location_type?: { name: string } }>>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);

  useEffect(() => {
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    try {
      const res = await authenticatedFetch('/api/inventory/locations');
      const { data } = await res.json();
      setLocations(data || []);
    } catch (error) {
      console.error('Error fetching locations:', error);
    } finally {
      setLoadingLocations(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const res = await apiWrite('/api/inventory/cycle-counts', {
        method: 'POST',
        body: {
          location_id: form.location_id,
          count_type: form.count_type,
          is_blind: form.is_blind,
          scheduled_for: form.scheduled_for || undefined,
          catalog_item_ids: form.specific_items.length > 0 ? form.specific_items : null,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        const msg = typeof data.error === 'string' ? data.error : data.error?.message || 'Failed to start cycle count';
        throw AppError.internal(msg);
      }

      onCreated();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  // Set default scheduled time to now
  useEffect(() => {
    const now = new Date();
    const formatted = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setForm(prev => ({ ...prev, scheduled_for: formatted }));
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-6 py-4 border-b flex items-center justify-between z-10">
          <div>
            <h3 className="text-lg font-semibold">Schedule Cycle Count</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Create a new inventory count for physical verification
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-start gap-2">
              <span className="text-lg">⚠️</span>
              <div>
                <div className="font-medium">Error</div>
                <div>{error}</div>
              </div>
            </div>
          )}

          {/* Location Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Location <span className="text-red-500">*</span>
            </label>
            {loadingLocations ? (
              <div className="text-sm text-muted-foreground">Loading locations...</div>
            ) : (
              <select
                value={form.location_id}
                onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                required
              >
                <option value="">Select a location to count...</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} {loc.location_type?.name ? `(${loc.location_type.name})` : ''}
                  </option>
                ))}
              </select>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Choose the warehouse, yard, or bin location to count
            </p>
          </div>

          {/* Count Type */}
          <div>
            <label className="block text-sm font-medium mb-2">Count Type</label>
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, count_type: 'full' })}
                className={`p-4 border-2 rounded-lg text-center transition-all ${
                  form.count_type === 'full'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="font-medium">Full Count</div>
                <div className="text-xs text-muted-foreground mt-1">All items</div>
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, count_type: 'partial' })}
                className={`p-4 border-2 rounded-lg text-center transition-all ${
                  form.count_type === 'partial'
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="font-medium">Partial Count</div>
                <div className="text-xs text-muted-foreground mt-1">Selected items</div>
              </button>
            </div>
          </div>

          {/* Scheduled Date/Time */}
          <div>
            <label className="block text-sm font-medium mb-2">Scheduled For</label>
            <input
              type="datetime-local"
              value={form.scheduled_for}
              onChange={(e) => setForm({ ...form, scheduled_for: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-muted-foreground mt-1">
              When should this count be performed? Leave blank to start immediately.
            </p>
          </div>

          {/* Blind Count Option */}
          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <input
              type="checkbox"
              id="blind-count"
              checked={form.is_blind}
              onChange={(e) => setForm({ ...form, is_blind: e.target.checked })}
              className="mt-1 h-4 w-4 rounded border-gray-300"
            />
            <div className="flex-1">
              <label htmlFor="blind-count" className="text-sm font-medium cursor-pointer">
                Blind Count (Hide Expected Quantities)
              </label>
              <p className="text-xs text-muted-foreground mt-1">
                Recommended for accuracy. Counter won't see system quantities, reducing bias.
              </p>
            </div>
          </div>

          {/* What to Count */}
          <div>
            <label className="block text-sm font-medium mb-2">What to Count</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.include_bulk_items}
                  onChange={(e) => setForm({ ...form, include_bulk_items: e.target.checked })}
                  className="h-4 w-4"
                />
                <div>
                  <div className="text-sm font-medium">Bulk Items (SKUs)</div>
                  <div className="text-xs text-muted-foreground">
                    Fungible items tracked by quantity (e.g., concrete mix, rebar)
                  </div>
                </div>
              </label>
              <label className="flex items-center gap-2 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.include_assets}
                  onChange={(e) => setForm({ ...form, include_assets: e.target.checked })}
                  className="h-4 w-4"
                />
                <div>
                  <div className="text-sm font-medium">Serialized Assets</div>
                  <div className="text-xs text-muted-foreground">
                    Individual equipment tracked by serial number (e.g., forklifts, tools)
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium mb-2">Notes (Optional)</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Add any special instructions or context for this count..."
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !form.location_id}
              className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {saving ? 'Creating...' : form.scheduled_for ? 'Schedule Count' : 'Start Count Now'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
