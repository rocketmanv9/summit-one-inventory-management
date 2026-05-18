'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';

interface NotificationItem {
  id: string;
  notification_type: string;
  title: string;
  body: string | null;
  severity: string;
  request_id: string | null;
  is_read: boolean;
  created_at: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  info: '#3b82f6',
  warning: '#eab308',
  error: '#ef4444',
  success: '#22c55e',
};

function timeAgo(dateString: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateString).getTime()) / 1000,
  );
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch(
        '/api/provisioning/notifications?unread_only=true&limit=1',
      );
      if (!res.ok) return;
      const json = await res.json();
      setUnreadCount(json.unread_count ?? 0);
    } catch {
      // ignore fetch errors silently
    }
  }, []);

  // Poll unread count on mount and every 30s
  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30_000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        '/api/provisioning/notifications?unread_only=true&limit=20',
      );
      if (!res.ok) return;
      const json = await res.json();
      setNotifications(json.data ?? []);
      setUnreadCount(json.unread_count ?? 0);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const toggleDropdown = () => {
    const next = !open;
    setOpen(next);
    if (next) fetchNotifications();
  };

  const handleNotificationClick = async (n: NotificationItem) => {
    // Mark as read
    try {
      await fetch('/api/provisioning/notifications', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ notification_id: n.id }),
      });
      setNotifications((prev) => prev.filter((x) => x.id !== n.id));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      // ignore
    }

    if (n.request_id) {
      setOpen(false);
      router.push(`/provisioning/requests/${n.request_id}`);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await fetch('/api/provisioning/notifications', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ mark_all_read: true }),
      });
      setNotifications([]);
      setUnreadCount(0);
    } catch {
      // ignore
    }
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={toggleDropdown}
        aria-label="Notifications"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          position: 'relative',
          padding: '4px',
        }}
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              background: '#ef4444',
              color: '#fff',
              borderRadius: '9999px',
              fontSize: '10px',
              fontWeight: 700,
              minWidth: '16px',
              height: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: '8px',
            width: '360px',
            maxHeight: '420px',
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            zIndex: 50,
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: '14px' }}>
              Notifications
            </span>
            {notifications.length > 0 && (
              <button
                onClick={handleMarkAllRead}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#3b82f6',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {loading && (
            <div style={{ padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>
              Loading...
            </div>
          )}

          {!loading && notifications.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>
              No unread notifications
            </div>
          )}

          {!loading &&
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleNotificationClick(n)}
                style={{
                  display: 'flex',
                  gap: '10px',
                  padding: '10px 16px',
                  width: '100%',
                  border: 'none',
                  borderBottom: '1px solid #f3f4f6',
                  background: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: SEVERITY_COLORS[n.severity] ?? '#9ca3af',
                    flexShrink: 0,
                    marginTop: '5px',
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: '13px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {n.title}
                  </div>
                  {n.body && (
                    <div
                      style={{
                        fontSize: '12px',
                        color: '#6b7280',
                        marginTop: '2px',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {n.body}
                    </div>
                  )}
                  <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                    {timeAgo(n.created_at)}
                  </div>
                </div>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
