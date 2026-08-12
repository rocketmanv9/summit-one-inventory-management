import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export interface MyTransferItem {
  task_id: string;
  transfer_id: string;
  transfer_number: string | null;
  status: string;
  /** OCC token needed by the ship action. */
  last_event_id: string | null;
  from_location_name: string | null;
  to_location_name: string | null;
  notes: string | null;
  items_summary: string | null;
  /** How many people share this transfer (multi-assignee awareness). */
  assignee_count: number;
}

// GET /api/inventory/transfers/my — open transfer tasks assigned to the signed-in
// user, resolved to the live transfer so the mobile My Day row + task screen can
// render "Move 3 × Fuel Can — Portland → Auburn" and the right status actions.
// Only tasks whose transfer is still actionable (draft / in_transit /
// partially_received) are returned; a completed/cancelled transfer's task is
// auto-closed by the transfers_autocomplete_tasks trigger, so it drops off here.
export const GET = createSessionReadRoute(async ({ session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const { data: tasks, error: taskErr } = await (supabase as any)
    .from('tasks')
    .select('id, related_entity_id, status')
    .eq('tenant_id', session.tenantId)
    .eq('assigned_to_user_id', session.userId)
    .eq('task_type', 'transfer')
    .in('status', ['open', 'in_progress', 'blocked'])
    .order('created_at', { ascending: false })
    .limit(100);
  if (taskErr) { log.error('transfers.my.tasks_failed', { error: taskErr.message }); throw AppError.internal(taskErr.message); }

  const taskByTransfer = new Map<string, { taskId: string }>();
  for (const t of tasks || []) {
    if (t.related_entity_id && !taskByTransfer.has(t.related_entity_id)) {
      taskByTransfer.set(t.related_entity_id, { taskId: t.id });
    }
  }
  const transferIds = [...taskByTransfer.keys()];
  if (transferIds.length === 0) return Response.json({ data: [] });

  const inv = (supabase as any).schema('inventory');
  const { data: transfers, error: tErr } = await inv
    .from('transfers')
    .select('id, transfer_number, status, notes, last_event_id, assigned_to_user_ids, from_location:locations!transfers_from_location_id_fkey(name), to_location:locations!transfers_to_location_id_fkey(name)')
    .eq('tenant_id', session.tenantId)
    .in('id', transferIds)
    .in('status', ['draft', 'in_transit', 'partially_received'])
    .limit(100);
  if (tErr) { log.error('transfers.my.transfers_failed', { error: tErr.message }); throw AppError.internal(tErr.message); }

  const { data: lines } = await inv
    .from('transfer_lines')
    .select('transfer_id, qty, catalog_item:catalog_items(name)')
    .in('transfer_id', transferIds)
    .eq('tenant_id', session.tenantId)
    .limit(500);
  const linesByTransfer = new Map<string, Array<{ qty: number; name: string | null }>>();
  for (const l of lines || []) {
    const arr = linesByTransfer.get(l.transfer_id) ?? [];
    arr.push({ qty: l.qty, name: l.catalog_item?.name ?? null });
    linesByTransfer.set(l.transfer_id, arr);
  }

  const items: MyTransferItem[] = (transfers || []).map((t: any) => {
    const tls = linesByTransfer.get(t.id) ?? [];
    let itemsSummary: string | null = null;
    if (tls.length > 0) {
      const first = `${tls[0].qty} × ${tls[0].name ?? 'item'}`;
      itemsSummary = tls.length === 1 ? first : `${first} +${tls.length - 1} more`;
    }
    return {
      task_id: taskByTransfer.get(t.id)!.taskId,
      transfer_id: t.id,
      transfer_number: t.transfer_number,
      status: t.status,
      last_event_id: t.last_event_id ?? null,
      from_location_name: t.from_location?.name ?? null,
      to_location_name: t.to_location?.name ?? null,
      notes: t.notes ?? null,
      items_summary: itemsSummary,
      assignee_count: (t.assigned_to_user_ids ?? []).length,
    };
  });

  return Response.json({ data: items });
}, { serviceName: SERVICE_NAME });
