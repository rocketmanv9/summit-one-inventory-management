'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Loader2 } from 'lucide-react';
import { InventoryRPC } from '@/lib/rpc/inventory';

interface LocationType {
  id: string;
  name: string;
  code?: string;
}

interface AddLocationModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (location: { id: string; name: string }) => void;
}

export function AddLocationModal({ open, onClose, onSuccess }: AddLocationModalProps) {
  const [name, setName] = useState('');
  const [locationTypeId, setLocationTypeId] = useState('');
  const [address, setAddress] = useState('');
  const [locationTypes, setLocationTypes] = useState<LocationType[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setLocationTypeId('');
    setAddress('');
    setError(null);
    setSubmitting(false);
    loadLocationTypes();
  }, [open]);

  async function loadLocationTypes() {
    try {
      const data = await InventoryRPC.getLocationTypes();
      setLocationTypes(data || []);
      if (data && data.length > 0 && !locationTypeId) {
        setLocationTypeId(data[0].id);
      }
    } catch (err) {
      console.error('Error loading location types:', err);
    }
  }

  async function handleSubmit() {
    if (!name.trim()) {
      setError('Location name is required.');
      return;
    }
    if (!locationTypeId) {
      setError('Location type is required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await InventoryRPC.createLocation({
        name: name.trim(),
        location_type_id: locationTypeId,
        address: address.trim() || undefined,
        last_event_id: crypto.randomUUID(),
      });

      onSuccess({ id: result.id, name: name.trim() });
    } catch (err: any) {
      setError(err.message || 'Failed to create location.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Location</DialogTitle>
          <DialogDescription>
            Add a new storage location for inventory.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="loc-name">Location Name <span className="text-red-500">*</span></Label>
            <Input
              id="loc-name"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setName(e.target.value); if (error) setError(null); }}
              placeholder="e.g., Main Warehouse, Yard A, Truck #5"
              disabled={submitting}
              autoFocus
              aria-required="true"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="loc-type">Location Type <span className="text-red-500">*</span></Label>
            <select
              id="loc-type"
              value={locationTypeId}
              onChange={(e) => setLocationTypeId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              disabled={submitting}
              aria-required="true"
            >
              <option value="">-- Select Type --</option>
              {locationTypes.map((lt) => (
                <option key={lt.id} value={lt.id}>{lt.name}</option>
              ))}
            </select>
            {locationTypes.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No location types found. Create one in Settings first.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="loc-address">Address</Label>
            <Input
              id="loc-address"
              value={address}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAddress(e.target.value)}
              placeholder="Physical address or description"
              disabled={submitting}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Location
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
