/**
 * In-app notifications — the feed behind the top-nav bell.
 *
 * Best-effort writes: a notification failure must never fail the operation
 * that triggered it, so insertNotification swallows and logs. Dedupe via
 * (tenant_id, last_event_id) upsert — pass a deterministic key when the same
 * trigger can fire repeatedly (cron reruns, retries).
 */

type Logger = { warn: (msg: string, meta?: any) => void };

export interface NotificationInput {
  tenantId: string;
  /** Null/undefined = tenant-wide (everyone in the tenant sees it). */
  userId?: string | null;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  /** Deterministic idempotency key; defaults to a random UUID. */
  eventKey?: string;
}

export async function insertNotification(
  supabase: any,
  log: Logger,
  input: NotificationInput,
): Promise<void> {
  try {
    const { error } = await supabase
      .from('notifications')
      .upsert({
        tenant_id: input.tenantId,
        user_id: input.userId ?? null,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        last_event_id: input.eventKey || crypto.randomUUID(),
      }, { onConflict: 'tenant_id,last_event_id', ignoreDuplicates: true });
    if (error) log.warn('notification.insert_failed', { type: input.type, error: error.message });
  } catch (err: any) {
    log.warn('notification.insert_failed', { type: input.type, error: err?.message });
  }
}
