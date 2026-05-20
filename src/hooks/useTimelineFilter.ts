'use client';

import { useMemo } from 'react';
import type { GlobeData, GlobeTransfer } from '@/lib/rpc/operations';

/**
 * Derives the visual status of a transfer at a given point in time,
 * based on its temporal milestones.
 */
function deriveTransferStatus(transfer: GlobeTransfer, currentTime: Date): string {
  const completedAt = transfer.completed_at ? new Date(transfer.completed_at) : null;
  const initiatedAt = transfer.initiated_at ? new Date(transfer.initiated_at) : null;

  if (completedAt && currentTime >= completedAt) return 'completed';
  if (initiatedAt && currentTime >= initiatedAt) return 'in_transit';
  return 'draft';
}

/**
 * Client-side filtering hook for status multi-select and timeline playback.
 *
 * - Status filtering: keeps only items matching selected statuses (empty = show all).
 * - Timeline filtering (when currentTime is set): shows items whose created_at <= currentTime
 *   and overrides transfer visual status based on temporal milestones.
 * - Locations and vendors pass through unchanged (static entities).
 */
export function useTimelineFilter(
  data: GlobeData | null,
  currentTime: Date | null,
  transferStatuses: string[],
  poStatuses: string[],
): GlobeData | null {
  return useMemo(() => {
    if (!data) return null;

    let transfers = data.transfers;
    let purchaseOrders = data.purchaseOrders;

    // Timeline filtering: only show items created before currentTime
    if (currentTime) {
      transfers = transfers
        .filter((t) => new Date(t.created_at) <= currentTime)
        .map((t) => ({
          ...t,
          status: deriveTransferStatus(t, currentTime),
        }));

      purchaseOrders = purchaseOrders.filter(
        (po) => new Date(po.created_at) <= currentTime,
      );
    }

    // Status filtering (empty array = show all)
    if (transferStatuses.length > 0) {
      transfers = transfers.filter((t) => transferStatuses.includes(t.status));
    }

    if (poStatuses.length > 0) {
      purchaseOrders = purchaseOrders.filter((po) => poStatuses.includes(po.status));
    }

    return {
      locations: data.locations,
      vendors: data.vendors,
      transfers,
      purchaseOrders,
    };
  }, [data, currentTime, transferStatuses, poStatuses]);
}
