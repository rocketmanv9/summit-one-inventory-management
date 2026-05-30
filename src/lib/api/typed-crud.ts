/**
 * Shared CRUD route builders for tenant-scoped inventory/supply_chain tables.
 *
 * Centralizes the chassis write-route pattern used to migrate the direct
 * browser→Postgres writes onto routes: idempotency (key → last_event_id),
 * server-side zod validation, tenant-scoped service client, optimistic
 * concurrency (OCC) via `expected_last_event_id`, and trigger-owned event
 * emission by default. Verified end-to-end against the stage DB.
 */
import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import type { ZodType } from 'zod';
import type { EmissionOwner } from '@rocketmanv9/chassis/nextjs';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

async function tenantClient(tenantId: string) {
  return createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
}

export function idFromPath(req: Request, segment: string): string {
  const segs = new URL(req.url).pathname.split('/');
  const i = segs.indexOf(segment);
  const id = segs[i + 1];
  if (!id) throw AppError.badRequest(`Missing id after /${segment}`);
  return id;
}

interface Base {
  schema: string;
  table: string;
  segment?: string;
  returning?: string;
  emissionOwner?: EmissionOwner;
  orderBy?: string;
  limit?: number;
}

/** GET — list rows for the tenant. */
export function listRoute(opts: Base) {
  return createSessionReadRoute(async ({ session, log }) => {
    const sb = await tenantClient(session.tenantId!);
    const { data, error } = await (sb as any).schema(opts.schema)
      .from(opts.table).select('*')
      .order(opts.orderBy ?? 'name', { ascending: true })
      .limit(opts.limit ?? 200);
    if (error) { log.error(`${opts.table}.list_failed`, { error: error.message }); throw AppError.internal(error.message); }
    return Response.json({ data });
  }, { serviceName: SERVICE_NAME });
}

/** POST — create one row. Stamps last_event_id = idempotency key. */
export function createRoute<T>(opts: Base & { bodySchema: ZodType<T>; mode?: 'insert' | 'upsert'; onConflict?: string }) {
  return createSessionWriteRoute(async ({ body, supabase, idempotencyKey, log }) => {
    const t = (supabase as any).schema(opts.schema).from(opts.table);
    const row = { ...(body as any), last_event_id: idempotencyKey };
    const q = opts.mode === 'upsert'
      ? t.upsert(row, opts.onConflict ? { onConflict: opts.onConflict } : undefined)
      : t.insert(row);
    const { data, error } = await q.select(opts.returning ?? 'id, last_event_id').single();
    if (error) { log.error(`${opts.table}.create_failed`, { error: error.message }); throw AppError.internal(error.message); }
    return { data, status: 201, events: [] };
  }, { bodySchema: opts.bodySchema, emissionOwner: opts.emissionOwner ?? 'trigger', serviceName: SERVICE_NAME, scope: `POST ${opts.table}` });
}

/** PATCH /[id] — optimistic-concurrency update (body must include expected_last_event_id). 409 on stale. */
export function updateRouteOCC<T extends { expected_last_event_id: string }>(opts: Base & { bodySchema: ZodType<T> }) {
  return createSessionWriteRoute(async ({ req, body, supabase, idempotencyKey, log }) => {
    const id = idFromPath(req, opts.segment!);
    const { expected_last_event_id, ...updates } = body as any;
    const { data, error } = await (supabase as any).schema(opts.schema)
      .from(opts.table).update({ ...updates, last_event_id: idempotencyKey })
      .eq('id', id).eq('last_event_id', expected_last_event_id)
      .select(opts.returning ?? 'id, last_event_id').maybeSingle();
    if (error) { log.error(`${opts.table}.update_failed`, { error: error.message }); throw AppError.internal(error.message); }
    if (!data) throw AppError.conflict('Record was updated by someone else. Please refresh and try again.');
    return { data, status: 200, events: [] };
  }, { bodySchema: opts.bodySchema, emissionOwner: opts.emissionOwner ?? 'trigger', serviceName: SERVICE_NAME, scope: `PATCH ${opts.table}/[id]` });
}

/** DELETE /[id] — optimistic-concurrency delete (body: { expected_last_event_id }). 409 on stale. */
export function deleteRouteOCC<T extends { expected_last_event_id: string }>(opts: Base & { bodySchema: ZodType<T> }) {
  return createSessionWriteRoute(async ({ req, body, supabase, log }) => {
    const id = idFromPath(req, opts.segment!);
    const { data, error } = await (supabase as any).schema(opts.schema)
      .from(opts.table).delete()
      .eq('id', id).eq('last_event_id', (body as any).expected_last_event_id)
      .select('id').maybeSingle();
    if (error) { log.error(`${opts.table}.delete_failed`, { error: error.message }); throw AppError.internal(error.message); }
    if (!data) throw AppError.conflict('Record was updated by someone else. Please refresh and try again.');
    return { data, status: 200, events: [] };
  }, { bodySchema: opts.bodySchema, emissionOwner: opts.emissionOwner ?? 'trigger', serviceName: SERVICE_NAME, scope: `DELETE ${opts.table}/[id]` });
}

/** PATCH /[id] — plain update by id (tenant enforced by RLS; no version check). */
export function updateRoute<T>(opts: Base & { bodySchema: ZodType<T> }) {
  return createSessionWriteRoute(async ({ req, body, supabase, idempotencyKey, log }) => {
    const id = idFromPath(req, opts.segment!);
    const { data, error } = await (supabase as any).schema(opts.schema)
      .from(opts.table).update({ ...(body as any), last_event_id: idempotencyKey })
      .eq('id', id).select(opts.returning ?? 'id, last_event_id').maybeSingle();
    if (error) { log.error(`${opts.table}.update_failed`, { error: error.message }); throw AppError.internal(error.message); }
    if (!data) throw AppError.notFound('Record not found');
    return { data, status: 200, events: [] };
  }, { bodySchema: opts.bodySchema, emissionOwner: opts.emissionOwner ?? 'trigger', serviceName: SERVICE_NAME, scope: `PATCH ${opts.table}/[id]` });
}

/** DELETE /[id] — plain delete by id (tenant enforced by RLS; no version check). */
export function deleteRoute(opts: Base) {
  return createSessionWriteRoute(async ({ req, supabase, log }) => {
    const id = idFromPath(req, opts.segment!);
    const { data, error } = await (supabase as any).schema(opts.schema)
      .from(opts.table).delete().eq('id', id).select('id').maybeSingle();
    if (error) { log.error(`${opts.table}.delete_failed`, { error: error.message }); throw AppError.internal(error.message); }
    if (!data) throw AppError.notFound('Record not found');
    return { data, status: 200, events: [] };
  }, { bodySchema: 'raw', emissionOwner: opts.emissionOwner ?? 'trigger', serviceName: SERVICE_NAME, scope: `DELETE ${opts.table}/[id]` });
}
