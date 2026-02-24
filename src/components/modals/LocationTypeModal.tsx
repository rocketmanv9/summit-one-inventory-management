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
import type { Database } from 'types/supabase';

type LocationTypeRow = Database['inventory']['Tables']['location_types']['Row'];

interface LocationTypeModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (name: string) => void;
  item?: LocationTypeRow;
}

export function LocationTypeModal({ open, onClose, onSuccess, item }: LocationTypeModalProps) {
  const isEdit = !!item;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toCode = (value: string) => {
    return value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  };

  useEffect(() => {
    if (!open) return;

    setError(null);
    setSubmitting(false);

    if (isEdit && item) {
      setName(item.name || '');
      setDescription(item.description || '');
    } else {
      setName('');
      setDescription('');
    }
  }, [open, item, isEdit]);

  async function handleSubmit() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Name is required.');
      return;
    }

    const code = toCode(trimmedName);
    if (!code) {
      setError('Name must include at least one letter or number.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      if (isEdit && item) {
        if (!item.last_event_id) {
          throw new Error('Missing last_event_id for this location type. Please refresh and try again.');
        }
        await InventoryRPC.updateLocationType(
          item.id,
          { name: trimmedName, description: description.trim() || null, code },
          item.last_event_id
        );
      } else {
        await InventoryRPC.createLocationType({
          name: trimmedName,
          description: description.trim() || null,
          code,
          last_event_id: crypto.randomUUID(),
        });
      }

      onSuccess(trimmedName);
    } catch (err: any) {
      setError(err.message || 'Failed to save location type.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Location Type' : 'Add Location Type'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update location type details below.' : 'Define a new location type (e.g., Warehouse, Yard, Truck).'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="lt-name">Name *</Label>
            <Input
              id="lt-name"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setName(e.target.value); if (error) setError(null); }}
              placeholder="e.g., Storage Facility"
              disabled={submitting}
              autoFocus
            />
            {name.trim() && (
              <p className="text-xs text-muted-foreground">
                Code: <span className="font-mono">{toCode(name)}</span>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="lt-desc">Description</Label>
            <textarea
              id="lt-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              rows={2}
              placeholder="Optional description"
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
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? 'Update Type' : 'Create Type'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
