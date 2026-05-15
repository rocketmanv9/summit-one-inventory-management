'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { StatusChip } from '@/components/ui/StatusChip';
import { ProvisioningRPC } from '@/lib/rpc/provisioning';
import { CheckCircle, XCircle, RotateCcw, Ban, Package, Clock } from 'lucide-react';

interface RequestLine {
  id: string;
  catalog_item_id: string;
  catalog_item_name?: string;
  qty: number;
  fulfillment_method: string | null;
  provider_id: string | null;
  provider_name?: string | null;
  status: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  substitute_catalog_item_id: string | null;
  notes: string | null;
}

interface HistoryEntry {
  id: string;
  action: string;
  actor: string | null;
  notes: string | null;
  created_at: string;
}

interface RequestDetail {
  id: string;
  employee_id: string;
  employee_name: string | null;
  trigger_event: string | null;
  status: string | null;
  priority: number | null;
  needed_by: string | null;
  delivery_method: string | null;
  shipping_address: Record<string, unknown> | null;
  employee_attributes: Record<string, unknown> | null;
  lines: RequestLine[];
  history: HistoryEntry[];
  created_at: string;
  updated_at: string | null;
}

export default function ProvisioningRequestDetailPage() {
  const params = useParams();
  const requestId = params.id as string;
  const [request, setRequest] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [substituteModal, setSubstituteModal] = useState<{ lineId: string } | null>(null);
  const [substituteItemId, setSubstituteItemId] = useState('');
  const [substituteReason, setSubstituteReason] = useState('');

  useEffect(() => {
    fetchRequest();
  }, [requestId]);

  const fetchRequest = async () => {
    setLoading(true);
    try {
      const data = await ProvisioningRPC.getRequest(requestId);
      setRequest(data?.data || data);
    } catch (error) {
      console.error('Error fetching request:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    setActionLoading('approve');
    try {
      await ProvisioningRPC.approveRequest(requestId);
      fetchRequest();
    } catch (error) {
      console.error('Error approving request:', error);
      alert('Failed to approve request');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    const reason = prompt('Rejection reason:');
    if (!reason) return;
    setActionLoading('reject');
    try {
      await ProvisioningRPC.rejectRequest(requestId, reason);
      fetchRequest();
    } catch (error) {
      console.error('Error rejecting request:', error);
      alert('Failed to reject request');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async () => {
    const reason = prompt('Cancellation reason:');
    if (!reason) return;
    setActionLoading('cancel');
    try {
      await ProvisioningRPC.cancelRequest(requestId, reason);
      fetchRequest();
    } catch (error) {
      console.error('Error cancelling request:', error);
      alert('Failed to cancel request');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRetry = async () => {
    if (!confirm('Retry all failed lines?')) return;
    setActionLoading('retry');
    try {
      const failedLineIds = request?.lines
        .filter((l) => l.status === 'failed')
        .map((l) => l.id);
      await ProvisioningRPC.retryRequest(requestId, failedLineIds);
      fetchRequest();
    } catch (error) {
      console.error('Error retrying request:', error);
      alert('Failed to retry request');
    } finally {
      setActionLoading(null);
    }
  };

  const handleIssueLine = async (lineId: string) => {
    if (!confirm('Mark this line as issued?')) return;
    try {
      await ProvisioningRPC.issueLine(requestId, lineId);
      fetchRequest();
    } catch (error) {
      console.error('Error issuing line:', error);
      alert('Failed to issue line');
    }
  };

  const handleSubstituteLine = async () => {
    if (!substituteModal || !substituteItemId || !substituteReason) return;
    try {
      await ProvisioningRPC.substituteLine(requestId, substituteModal.lineId, substituteItemId, substituteReason);
      setSubstituteModal(null);
      setSubstituteItemId('');
      setSubstituteReason('');
      fetchRequest();
    } catch (error) {
      console.error('Error substituting line:', error);
      alert('Failed to substitute line');
    }
  };

  const handleCancelLine = async (lineId: string) => {
    const reason = prompt('Cancel reason:');
    if (!reason) return;
    try {
      await ProvisioningRPC.cancelLine(requestId, lineId, reason);
      fetchRequest();
    } catch (error) {
      console.error('Error cancelling line:', error);
      alert('Failed to cancel line');
    }
  };

  const lineColumns = [
    {
      key: 'catalog_item_name',
      header: 'Item',
      render: (row: RequestLine) => (
        <div>
          <div className="font-medium">{row.catalog_item_name || row.catalog_item_id}</div>
          {row.substitute_catalog_item_id && (
            <div className="text-xs text-amber-600">Substituted</div>
          )}
        </div>
      ),
    },
    {
      key: 'qty',
      header: 'Qty',
      className: 'text-right font-mono',
      render: (row: RequestLine) => row.qty,
    },
    {
      key: 'fulfillment_method',
      header: 'Method',
      render: (row: RequestLine) => (
        <span className="inline-flex px-2 py-1 text-xs font-medium rounded bg-gray-100 text-gray-700">
          {row.fulfillment_method?.replace(/_/g, ' ') || '-'}
        </span>
      ),
    },
    {
      key: 'provider_name',
      header: 'Provider',
      render: (row: RequestLine) => row.provider_name || row.provider_id || '-',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: RequestLine) => <StatusChip status={row.status} />,
    },
    {
      key: 'tracking',
      header: 'Tracking',
      render: (row: RequestLine) => {
        if (!row.tracking_number) return <span className="text-muted-foreground">-</span>;
        return row.tracking_url ? (
          <a href={row.tracking_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-sm">
            {row.tracking_number}
          </a>
        ) : (
          <span className="text-sm font-mono">{row.tracking_number}</span>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: RequestLine) => {
        const isPending = row.status === 'pending' || row.status === 'approved';
        const isFailed = row.status === 'failed';
        const isCancelled = row.status === 'cancelled' || row.status === 'issued';
        if (isCancelled) return null;

        return (
          <div className="flex gap-1">
            {(isPending || isFailed) && (
              <button
                onClick={(e) => { e.stopPropagation(); handleIssueLine(row.id); }}
                className="px-2 py-1 text-xs rounded bg-green-600 hover:bg-green-700 text-white"
                title="Issue this line"
              >
                Issue
              </button>
            )}
            {isPending && (
              <button
                onClick={(e) => { e.stopPropagation(); setSubstituteModal({ lineId: row.id }); }}
                className="px-2 py-1 text-xs rounded bg-amber-600 hover:bg-amber-700 text-white"
                title="Substitute item"
              >
                Sub
              </button>
            )}
            {(isPending || isFailed) && (
              <button
                onClick={(e) => { e.stopPropagation(); handleCancelLine(row.id); }}
                className="px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-700 text-white"
                title="Cancel this line"
              >
                Cancel
              </button>
            )}
          </div>
        );
      },
    },
  ];

  if (loading) {
    return (
      <AppShell>
        <div className="space-y-6">
          <div className="animate-pulse">
            <div className="h-10 bg-gray-200 rounded w-1/3 mb-4" />
            <div className="h-6 bg-gray-200 rounded w-1/4 mb-8" />
            <div className="h-64 bg-gray-200 rounded" />
          </div>
        </div>
      </AppShell>
    );
  }

  if (!request) {
    return (
      <AppShell>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Request not found</p>
        </div>
      </AppShell>
    );
  }

  const isAwaitingApproval = request.status === 'awaiting_approval';
  const hasFailed = request.lines?.some((l) => l.status === 'failed');
  const isTerminal = request.status === 'cancelled' || request.status === 'fulfilled';

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={`${request.employee_name || request.employee_id}`}
          description={`Request ${request.id.slice(0, 8)}... - ${request.trigger_event?.replace(/_/g, ' ') || 'Manual'}`}
          backHref="/provisioning/requests"
          actions={
            <div className="flex items-center gap-2">
              <StatusChip status={request.status} size="md" />
              {isAwaitingApproval && (
                <button
                  onClick={handleApprove}
                  disabled={actionLoading === 'approve'}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md flex items-center gap-2 disabled:opacity-50"
                >
                  <CheckCircle className="h-4 w-4" />
                  {actionLoading === 'approve' ? 'Approving...' : 'Approve'}
                </button>
              )}
              {isAwaitingApproval && (
                <button
                  onClick={handleReject}
                  disabled={actionLoading === 'reject'}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md flex items-center gap-2 disabled:opacity-50"
                >
                  <XCircle className="h-4 w-4" />
                  {actionLoading === 'reject' ? 'Rejecting...' : 'Reject'}
                </button>
              )}
              {!isTerminal && (
                <button
                  onClick={handleCancel}
                  disabled={actionLoading === 'cancel'}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50"
                >
                  <Ban className="h-4 w-4" />
                  {actionLoading === 'cancel' ? 'Cancelling...' : 'Cancel'}
                </button>
              )}
              {hasFailed && (
                <button
                  onClick={handleRetry}
                  disabled={actionLoading === 'retry'}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-md flex items-center gap-2 disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  {actionLoading === 'retry' ? 'Retrying...' : 'Retry Failed'}
                </button>
              )}
            </div>
          }
        />

        {/* Employee Attributes */}
        {request.employee_attributes && Object.keys(request.employee_attributes).length > 0 && (
          <div className="rounded-lg border bg-card p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Package className="h-4 w-4" />
              Employee Attributes
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(request.employee_attributes).map(([key, value]) => (
                <div key={key} className="text-sm">
                  <div className="text-muted-foreground text-xs">{key.replace(/_/g, ' ')}</div>
                  <div className="font-medium">{String(value)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Request metadata row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="rounded-lg border bg-card p-3">
            <div className="text-xs text-muted-foreground">Priority</div>
            <div className="text-lg font-bold">{request.priority ?? 0}</div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-xs text-muted-foreground">Delivery</div>
            <div className="text-lg font-bold">{request.delivery_method?.replace(/_/g, ' ') || '-'}</div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-xs text-muted-foreground">Needed By</div>
            <div className="text-lg font-bold">
              {request.needed_by ? new Date(request.needed_by).toLocaleDateString() : '-'}
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-xs text-muted-foreground">Created</div>
            <div className="text-lg font-bold">{new Date(request.created_at).toLocaleDateString()}</div>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="text-xs text-muted-foreground">Lines</div>
            <div className="text-lg font-bold">{request.lines?.length || 0}</div>
          </div>
        </div>

        {/* Lines table */}
        <div>
          <h3 className="text-lg font-semibold mb-3">Request Lines</h3>
          <DataTable
            data={request.lines || []}
            columns={lineColumns}
            emptyMessage="No lines in this request"
            rowKey={(row) => row.id}
          />
        </div>

        {/* History timeline */}
        {request.history && request.history.length > 0 && (
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Clock className="h-5 w-5" />
              History
            </h3>
            <div className="rounded-lg border bg-card divide-y">
              {request.history.map((entry) => (
                <div key={entry.id} className="p-4 flex items-start gap-4">
                  <div className="w-2 h-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{entry.action.replace(/_/g, ' ')}</span>
                      {entry.actor && (
                        <span className="text-xs text-muted-foreground">by {entry.actor}</span>
                      )}
                    </div>
                    {entry.notes && (
                      <p className="text-sm text-muted-foreground mt-1">{entry.notes}</p>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(entry.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Substitute Modal */}
        {substituteModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h2 className="text-xl font-semibold mb-4">Substitute Item</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Substitute Item ID *</label>
                  <input
                    type="text"
                    value={substituteItemId}
                    onChange={(e) => setSubstituteItemId(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Catalog item ID..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Reason *</label>
                  <textarea
                    value={substituteReason}
                    onChange={(e) => setSubstituteReason(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    rows={3}
                    placeholder="Reason for substitution..."
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => { setSubstituteModal(null); setSubstituteItemId(''); setSubstituteReason(''); }}
                    className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubstituteLine}
                    disabled={!substituteItemId || !substituteReason}
                    className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                  >
                    Substitute
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
