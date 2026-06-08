'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, MapPin } from 'lucide-react';
import { InventoryRPC } from '@/lib/rpc/inventory';

/** Minimal asset shape the transfer modal needs (satisfied by both the list
 *  row and the detail page). */
export interface TransferableAsset {
  id: string;
  asset_tag: string;
  location_id: string | null;
  location?: { name?: string | null } | null;
  catalog_item?: { name?: string | null } | null;
}

interface LocationOption {
  id: string;
  name: string;
}

export function AssetTransferModal({
  asset,
  onClose,
  onComplete,
}: {
  asset: TransferableAsset;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [toLocationId, setToLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await InventoryRPC.getLocations({ active: true });
        setLocations((data || []).map((l: any) => ({ id: l.id, name: l.name })));
      } catch (err) {
        console.error('Error loading locations:', err);
      }
    })();
  }, []);

  const currentLocationName =
    asset.location?.name ||
    locations.find((l) => l.id === asset.location_id)?.name ||
    (asset.location_id ? 'Unknown location' : 'No location set');

  const destinations = locations.filter((l) => l.id !== asset.location_id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!toLocationId) {
      setError('Choose a destination location.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await InventoryRPC.transferAsset({
        asset_id: asset.id,
        to_location_id: toLocationId,
        notes: notes.trim() || undefined,
        last_event_id: crypto.randomUUID(),
      });
      onComplete();
    } catch (err: any) {
      setError(err.message || 'Failed to transfer asset.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Transfer Asset</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-sm text-muted-foreground">Asset</div>
            <div className="font-medium font-mono">{asset.asset_tag}</div>
            {asset.catalog_item?.name && (
              <div className="text-sm">{asset.catalog_item.name}</div>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          {/* From → To */}
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" /> {currentLocationName}
            </span>
            <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">destination ↓</span>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Move To *</label>
            <select
              value={toLocationId}
              onChange={(e) => setToLocationId(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              required
            >
              <option value="">-- Select destination --</option>
              {destinations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            {destinations.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                No other locations available. Add a location first.
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={2}
              placeholder="Reason for the move (optional)..."
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !toLocationId}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Moving...' : 'Transfer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
