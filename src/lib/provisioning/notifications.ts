/**
 * Provisioning Notifications
 *
 * CRUD operations for the provisioning.notifications table.
 * Used by the notification bell UI and provisioning orchestrator
 * to surface events to managers, admins, and HR.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface NotificationParams {
  recipientRole?: 'manager' | 'admin' | 'hr' | 'all';
  notificationType: string;
  title: string;
  body?: string;
  severity?: 'info' | 'warning' | 'error' | 'success';
  requestId?: string;
  employeeId?: string;
}

export interface Notification {
  id: string;
  tenant_id: string;
  created_at: string;
  recipient_role: string;
  notification_type: string;
  title: string;
  body: string | null;
  severity: string;
  request_id: string | null;
  employee_id: string | null;
  is_read: boolean;
  read_at: string | null;
}

function provisioningSchema(supabase: SupabaseClient) {
  return (supabase as any).schema('provisioning');
}

export async function createNotification(
  supabase: SupabaseClient,
  tenantId: string,
  params: NotificationParams,
  lastEventId: string,
): Promise<Notification> {
  const { data, error } = await provisioningSchema(supabase)
    .from('notifications')
    .upsert(
      {
        tenant_id: tenantId,
        recipient_role: params.recipientRole ?? 'all',
        notification_type: params.notificationType,
        title: params.title,
        body: params.body ?? null,
        severity: params.severity ?? 'info',
        request_id: params.requestId ?? null,
        employee_id: params.employeeId ?? null,
        is_read: false,
        last_event_id: lastEventId,
      },
      { onConflict: 'last_event_id' },
    )
    .select()
    .single();

  if (error) throw error;
  return data as Notification;
}

export async function getNotifications(
  supabase: SupabaseClient,
  tenantId: string,
  options?: { unreadOnly?: boolean; limit?: number },
): Promise<Notification[]> {
  const limit = options?.limit ?? 50;

  let query = provisioningSchema(supabase)
    .from('notifications')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (options?.unreadOnly) {
    query = query.eq('is_read', false);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Notification[];
}

export async function getUnreadCount(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<number> {
  const { count, error } = await provisioningSchema(supabase)
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('is_read', false);

  if (error) throw error;
  return count ?? 0;
}

export async function markRead(
  supabase: SupabaseClient,
  tenantId: string,
  notificationId: string,
): Promise<void> {
  const { error } = await provisioningSchema(supabase)
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', notificationId);

  if (error) throw error;
}

export async function markAllRead(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<void> {
  const { error } = await provisioningSchema(supabase)
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('is_read', false);

  if (error) throw error;
}
