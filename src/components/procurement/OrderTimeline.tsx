'use client';

interface TimelineEntry {
  id: string;
  action: string;
  old_value?: Record<string, unknown>;
  new_value?: Record<string, unknown>;
  actor_user_id?: string;
  created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  submitted: 'Order submitted to provider',
  cancelled: 'Order cancelled',
  items_received: 'Items received',
  status_synced: 'Status synced from provider',
};

export function OrderTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">No activity recorded yet.</p>
    );
  }

  return (
    <div className="space-y-0">
      {entries.map((entry, idx) => (
        <div key={entry.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="h-2.5 w-2.5 rounded-full bg-primary mt-1.5" />
            {idx < entries.length - 1 && <div className="w-px flex-1 bg-border" />}
          </div>
          <div className="pb-4">
            <p className="text-sm font-medium">
              {ACTION_LABELS[entry.action] || entry.action}
            </p>
            {entry.new_value?.status != null && (
              <p className="text-xs text-muted-foreground">
                Status: {String(entry.old_value?.status ?? '?')} → {String(entry.new_value.status)}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(entry.created_at).toLocaleString()}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
