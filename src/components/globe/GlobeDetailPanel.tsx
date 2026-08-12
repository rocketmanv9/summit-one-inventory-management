'use client';

import { X, MapPin, Truck, ShoppingCart, Building2 } from 'lucide-react';
import Link from 'next/link';
import type { GlobePoint, GlobeArc } from './GlobeVisualization';
import type { GlobeLocation, GlobeVendor, GlobeTransfer, GlobePurchaseOrder } from '@/lib/rpc/operations';

interface GlobeDetailPanelProps {
  selectedPoint: GlobePoint | null;
  selectedArc: GlobeArc | null;
  onClose: () => void;
}

export function GlobeDetailPanel({ selectedPoint, selectedArc, onClose }: GlobeDetailPanelProps) {
  if (!selectedPoint && !selectedArc) return null;

  return (
    <div className="absolute top-0 right-0 z-20 h-full w-96 bg-white/95 backdrop-blur-sm shadow-lg border-l border-gray-200 overflow-y-auto">
      <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Details</h3>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-gray-100 text-gray-500"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-4">
        {selectedPoint && <PointDetail point={selectedPoint} />}
        {selectedArc && <ArcDetail arc={selectedArc} />}
      </div>
    </div>
  );
}

function PointDetail({ point }: { point: GlobePoint }) {
  if (point.type === 'location') {
    const loc = point.data as GlobeLocation;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50">
            <MapPin className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h4 className="font-semibold text-gray-900">{loc.name}</h4>
            <span className="text-xs text-gray-500">{loc.location_type?.name || 'Location'}</span>
          </div>
        </div>

        {loc.address && (
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Address</label>
            <p className="text-sm text-gray-700 mt-1">{loc.address}</p>
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Coordinates</label>
          <p className="text-sm font-mono text-gray-700 mt-1">
            {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
          </p>
        </div>

        <div className="pt-2">
          <Link
            href={`/inventory/locations/${loc.id}`}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-primary border border-primary/30 rounded-md hover:bg-primary/5"
          >
            View Location Details
          </Link>
        </div>
      </div>
    );
  }

  const vendor = point.data as GlobeVendor;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-green-50">
          <Building2 className="h-5 w-5 text-green-600" />
        </div>
        <div>
          <h4 className="font-semibold text-gray-900">{vendor.name}</h4>
          {vendor.code && (
            <span className="text-xs font-mono text-gray-500">{vendor.code}</span>
          )}
        </div>
      </div>

      {(vendor.city || vendor.state) && (
        <div>
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Location</label>
          <p className="text-sm text-gray-700 mt-1">
            {[vendor.city, vendor.state].filter(Boolean).join(', ')}
          </p>
        </div>
      )}

      {vendor.contact_name && (
        <div>
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</label>
          <p className="text-sm text-gray-700 mt-1">{vendor.contact_name}</p>
          {vendor.contact_email && (
            <p className="text-sm text-gray-500">{vendor.contact_email}</p>
          )}
          {vendor.contact_phone && (
            <p className="text-sm text-gray-500">{vendor.contact_phone}</p>
          )}
        </div>
      )}

      <div>
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Coordinates</label>
        <p className="text-sm font-mono text-gray-700 mt-1">
          {vendor.latitude.toFixed(4)}, {vendor.longitude.toFixed(4)}
        </p>
      </div>
    </div>
  );
}

function ArcDetail({ arc }: { arc: GlobeArc }) {
  if (arc.type === 'transfer') {
    const transfer = arc.data as GlobeTransfer;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50">
            <Truck className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h4 className="font-semibold text-gray-900">Transfer</h4>
            <StatusBadge status={transfer.status} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">From</label>
            <p className="text-sm text-gray-700 mt-1">{transfer.from_location?.name || 'Unknown'}</p>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">To</label>
            <p className="text-sm text-gray-700 mt-1">{transfer.to_location?.name || 'Unknown'}</p>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Created</label>
          <p className="text-sm text-gray-700 mt-1">{new Date(transfer.created_at).toLocaleDateString()}</p>
        </div>

        {transfer.initiated_at && (
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Initiated</label>
            <p className="text-sm text-gray-700 mt-1">{new Date(transfer.initiated_at).toLocaleDateString()}</p>
          </div>
        )}

        {transfer.completed_at && (
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Completed</label>
            <p className="text-sm text-gray-700 mt-1">{new Date(transfer.completed_at).toLocaleDateString()}</p>
          </div>
        )}

        {transfer.transfer_lines.length > 0 && (
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">
              Items ({transfer.transfer_lines.length})
            </label>
            <ul className="mt-1 space-y-1">
              {transfer.transfer_lines.map((line) => (
                <li key={line.id} className="text-sm text-gray-700 flex justify-between">
                  <span>{line.catalog_items?.name || 'Unknown Item'}</span>
                  <span className="font-mono text-gray-500">{line.qty}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {transfer.notes && (
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Notes</label>
            <p className="text-sm text-gray-600 mt-1">{transfer.notes}</p>
          </div>
        )}

        <div className="pt-2">
          <Link
            href="/inventory/transfers"
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-primary border border-primary/30 rounded-md hover:bg-primary/5"
          >
            View Transfers
          </Link>
        </div>
      </div>
    );
  }

  const po = arc.data as GlobePurchaseOrder;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-purple-50">
          <ShoppingCart className="h-5 w-5 text-purple-600" />
        </div>
        <div>
          <h4 className="font-semibold text-gray-900">PO {po.po_number}</h4>
          <StatusBadge status={po.status} />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Status</label>
        <p className="text-sm text-gray-700 mt-1 capitalize">{po.status.replace(/_/g, ' ')}</p>
      </div>

      {po.needed_by_date && (
        <div>
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Needed By</label>
          <p className="text-sm text-gray-700 mt-1">{new Date(po.needed_by_date).toLocaleDateString()}</p>
        </div>
      )}

      {(po.shipments?.length ?? 0) > 0 && (
        <div>
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">📦 Shipments</label>
          <div className="mt-1 space-y-2">
            {po.shipments!.map((s, i) => {
              // Amazon Logistics TBA numbers track on Amazon's own page
              const trackUrl = s.tracking_number?.startsWith('TBA')
                ? `https://track.amazon.com/tracking/${s.tracking_number}`
                : null;
              return (
                <div key={s.tracking_number || i} className="p-2 bg-sky-50 border border-sky-200 rounded-md text-sm">
                  <div className="font-medium text-sky-900">{s.carrier || 'Carrier'}</div>
                  {s.tracking_number && (
                    trackUrl ? (
                      <a
                        href={trackUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-mono text-sky-700 underline hover:text-sky-900 break-all"
                      >
                        {s.tracking_number} ↗
                      </a>
                    ) : (
                      <div className="text-xs font-mono text-sky-700 break-all">{s.tracking_number}</div>
                    )
                  )}
                  <div className="text-xs text-sky-700 mt-0.5">
                    {s.ship_date && <>Shipped {new Date(s.ship_date).toLocaleDateString()}</>}
                    {s.delivery_date && <> · Arrives {new Date(s.delivery_date).toLocaleDateString()}</>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Created</label>
        <p className="text-sm text-gray-700 mt-1">{new Date(po.created_at).toLocaleDateString()}</p>
      </div>

      <div className="pt-2">
        <Link
          href="/inventory/purchasing"
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-primary border border-primary/30 rounded-md hover:bg-primary/5"
        >
          View Purchase Orders
        </Link>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: 'bg-amber-100 text-amber-700',
    in_transit: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-gray-100 text-gray-600',
    submitted: 'bg-blue-100 text-blue-700',
    confirmed: 'bg-indigo-100 text-indigo-700',
    partially_received: 'bg-cyan-100 text-cyan-700',
  };

  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
