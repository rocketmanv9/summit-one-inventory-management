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

interface ReservationType {
  id: string;
  tenant_id: string | null;
  type_key: string;
  display_name: string;
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
  description?: string | null;
  last_event_id: string;
}

interface ReservationTypeModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (name: string) => void;
  item?: ReservationType;
}

export function ReservationTypeModal({ open, onClose, onSuccess, item }: ReservationTypeModalProps) {
  const isEdit = !!item;
  const [typeKey, setTypeKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setError(null);
    setSubmitting(false);

    if (isEdit && item) {
      setTypeKey(item.type_key || '');
      setDisplayName(item.display_name || '');
      setDescription(item.description || '');
      setSortOrder(String(item.sort_order ?? 0));
    } else {
      setTypeKey('');
      setDisplayName('');
      setDescription('');
      setSortOrder('0');
    }
  }, [open, item, isEdit]);

  async function handleSubmit() {
    if (!displayName.trim()) {
      setError('Display name is required.');
      return;
    }
    if (!isEdit && !typeKey.trim()) {
      setError('Type key is required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        type_key: typeKey.trim(),
        display_name: displayName.trim(),
        description: description.trim() || null,
        sort_order: parseInt(sortOrder || '0', 10) || 0,
      };

      if (isEdit && item) {
        await InventoryRPC.updateReservationType(item.id, {
          display_name: payload.display_name,
          description: payload.description,
          sort_order: payload.sort_order,
        });
      } else {
        await InventoryRPC.createReservationType(payload);
      }

      onSuccess(displayName.trim());
    } catch (err: any) {
      setError(err.message || 'Failed to save reservation type.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Reservation Type' : 'Add Reservation Type'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update reservation type details below.' : 'Define a new reservation type for your workflows.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="rt-name">Display Name *</Label>
            <Input
              id="rt-name"
              value={displayName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setDisplayName(e.target.value); if (error) setError(null); }}
              placeholder="e.g., Job, Project, Customer Order"
              disabled={submitting}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rt-key">Type Key *</Label>
            <Input
              id="rt-key"
              value={typeKey}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setTypeKey(e.target.value); if (error) setError(null); }}
              placeholder="job, project, custom_label"
              disabled={submitting || isEdit}
            />
            {isEdit && (
              <p className="text-xs text-muted-foreground">Type key cannot be changed after creation.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="rt-desc">Description</Label>
            <textarea
              id="rt-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              rows={3}
              disabled={submitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rt-sort">Sort Order</Label>
            <Input
              id="rt-sort"
              type="number"
              value={sortOrder}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSortOrder(e.target.value)}
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
