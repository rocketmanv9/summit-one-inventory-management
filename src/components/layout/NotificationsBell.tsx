'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { authenticatedFetch, apiWrite } from '@/lib/api-client';

interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

const TYPE_ICONS: Record<string, string> = {
  count_assigned: '📋',
  count_ready: '▶️',
  po_arrival: '📦',
  po_suggestion: '✉️',
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The top-nav bell: unread badge + dropdown feed, polled every 60s. */
export function NotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/notifications');
      if (!res.ok) return;
      const { data } = await res.json();
      setNotifications(data?.notifications || []);
      setUnread(data?.unread || 0);
    } catch {
      // polling — fail silently
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const markRead = useCallback(async (ids?: string[]) => {
    // Optimistic — the poll corrects any miss.
    setNotifications((prev) =>
      prev.map((n) => (!ids || ids.includes(n.id) ? { ...n, read_at: n.read_at || new Date().toISOString() } : n))
    );
    setUnread((prev) => (ids ? Math.max(0, prev - ids.length) : 0));
    try {
      await apiWrite('/api/notifications', { method: 'POST', body: ids ? { ids } : {} });
    } catch {
      // next poll restores the truth
    }
  }, []);

  const handleItemClick = (n: AppNotification) => {
    if (!n.read_at) markRead([n.id]);
    setOpen(false);
    if (n.link) router.push(n.link);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 hover:bg-muted"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 max-w-[90vw] rounded-lg border border-border bg-popover shadow-lg z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button
                onClick={() => markRead()}
                className="text-xs text-primary hover:underline font-medium"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Nothing yet — count assignments, deliveries, and alerts show up here.
              </div>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleItemClick(n)}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left border-b last:border-0 hover:bg-muted/60 ${
                    n.read_at ? 'opacity-60' : ''
                  }`}
                >
                  <span className="text-lg leading-none mt-0.5">{TYPE_ICONS[n.type] || '🔔'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-snug">{n.title}</span>
                    {n.body && (
                      <span className="block text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</span>
                    )}
                    <span className="block text-[11px] text-muted-foreground mt-1">{timeAgo(n.created_at)}</span>
                  </span>
                  {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
