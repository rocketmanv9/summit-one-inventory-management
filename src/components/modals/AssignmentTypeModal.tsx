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
import { AppError } from '@rocketmanv9/chassis/errors';

interface AssignmentType {
  id: string;
  type_key: string;
  display_name: string;
  icon?: string;
  is_system: boolean;
  is_active: boolean;
  requires_id: boolean;
  description?: string | null;
  sort_order: number;
  last_event_id: string;
}

interface AssignmentTypeModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (name: string) => void;
  item?: AssignmentType;
}

export function AssignmentTypeModal({ open, onClose, onSuccess, item }: AssignmentTypeModalProps) {
  const isEdit = !!item;
  const [typeKey, setTypeKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [icon, setIcon] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState('100');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setError(null);
    setSubmitting(false);

    if (isEdit && item) {
      setTypeKey(item.type_key || '');
      setDisplayName(item.display_name || '');
      setIcon(item.icon || '');
      setDescription(item.description || '');
      setSortOrder(String(item.sort_order ?? 100));
    } else {
      setTypeKey('');
      setDisplayName('');
      setIcon('');
      setDescription('');
      setSortOrder('100');
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
      if (isEdit && item) {
        if (!item.last_event_id) {
          throw AppError.badRequest('Missing last_event_id for this assignment type. Please refresh and try again.');
        }
        await InventoryRPC.updateAssignmentType(
          item.id,
          {
            display_name: displayName.trim(),
            description: description.trim() || null,
            icon: icon.trim() || null,
            sort_order: parseInt(sortOrder) || 0,
          },
          item.last_event_id
        );
      } else {
        await InventoryRPC.createAssignmentType({
          type_key: typeKey.trim(),
          display_name: displayName.trim(),
          description: description.trim() || null,
          icon: icon.trim() || null,
          sort_order: parseInt(sortOrder) || 100,
        });
      }

      onSuccess(displayName.trim());
    } catch (err: any) {
      setError(err.message || 'Failed to save assignment type.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Assignment Type' : 'Create Assignment Type'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update assignment type details below.' : 'Define a new assignment type for asset tracking.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="at-key">Type Key <span className="text-red-500">*</span></Label>
            <Input
              id="at-key"
              value={typeKey}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setTypeKey(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''));
                if (error) setError(null);
              }}
              placeholder="e.g., crew, contractor, tool_crib"
              disabled={submitting || isEdit}
              aria-required="true"
            />
            <p className="text-xs text-muted-foreground">
              {isEdit ? 'Type key cannot be changed after creation.' : 'Lowercase, alphanumeric with underscores/hyphens only.'}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="at-name">Display Name <span className="text-red-500">*</span></Label>
            <Input
              id="at-name"
              value={displayName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setDisplayName(e.target.value); if (error) setError(null); }}
              placeholder="e.g., Crew, Contractor, Tool Crib"
              disabled={submitting}
              autoFocus={isEdit}
              aria-required="true"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="at-icon">Icon</Label>
            <Input
              id="at-icon"
              value={icon}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setIcon(e.target.value)}
              placeholder="e.g., emoji"
              maxLength={4}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">Use an emoji or leave blank.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="at-desc">Description</Label>
            <textarea
              id="at-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              rows={2}
              placeholder="Brief description of when to use this assignment type"
              disabled={submitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="at-sort">Sort Order</Label>
            <Input
              id="at-sort"
              type="number"
              value={sortOrder}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSortOrder(e.target.value)}
              placeholder="100"
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">Lower numbers appear first in lists.</p>
          </div>

          {/* "Require ID/Reference" checkbox removed: asset_assignments.assigned_to_id
              is NOT NULL, so every assignment always requires a target — the flag
              could never change behavior and only misled users. */}

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
            {isEdit ? 'Update Type' : 'Create Type'}
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
