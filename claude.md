# CLAUDE.md — summit-one-inventory-management

## Route Rules

- **Always** use chassis route factories: `createReadRoute`, `createSessionReadRoute`, `createSessionWriteRoute`, `createWriteRoute`, `createWebhookRoute`, `createInternalRoute`.
- **Never** use bare `export async function GET/POST` — the factories handle auth, tracing, idempotency, error handling, and event emission automatically.
- Import from `@rocketmanv9/chassis/nextjs`.
- Golden path reference: `src/app/api/system/example-write/route.ts`.

```ts
// READ route (session-authenticated, traced)
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';

export const GET = createSessionReadRoute(async ({ session, log, supabase }) => {
  const { data } = await supabase.from('my_table').select('*');
  return Response.json({ data });
}, { serviceName: process.env.INTERNAL_JWT_ISSUER || '%%SERVICE_NAME%%' });

// WRITE route (session-authenticated, idempotent, event-emitting)
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const body = await req.json();
  const { data, error } = await supabase.from('my_table').upsert(body).select().single();
  if (error) throw AppError.internal(error.message);
  return {
    data,
    status: 201,
    events: [{ event_name: 'my_entity.created', payload: data, last_event_id: idempotencyKey }],
  };
}, { serviceName: process.env.INTERNAL_JWT_ISSUER || '%%SERVICE_NAME%%', scope: 'POST /api/my-entity' });
```

## Error Rules

- **Always** use `AppError` from `@rocketmanv9/chassis/errors` — never raw `throw new Error()`.
- The route factories catch `AppError` and return structured JSON responses automatically.
- `AppError.wrap(err)` converts unknown errors (including `ZodError`) into AppErrors.

| Method | Status | Use when |
|--------|--------|----------|
| `AppError.badRequest(msg)` | 400 | Invalid input, missing fields |
| `AppError.unauthorized(msg)` | 401 | Not authenticated |
| `AppError.forbidden(msg)` | 403 | Authenticated but not allowed |
| `AppError.notFound(msg)` | 404 | Resource doesn't exist |
| `AppError.conflict(msg)` | 409 | Duplicate, already exists |
| `AppError.internal(msg)` | 500 | Unexpected server error |

## Validation Rules

- **Always** validate request bodies with `zod` before processing.
- The chassis `AppError.wrap()` automatically converts `ZodError` into a 400 response.

```ts
import { z } from 'zod';

const CreateItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

// Inside your route handler:
const body = CreateItemSchema.parse(await req.json());
```

## Database Rules

- **Always** use `createTenantServiceClient()` from `@rocketmanv9/chassis/supabase` for tenant-scoped work. The session write route factory injects this as `supabase` automatically.
- **Never** use raw `createClient()` from `@supabase/supabase-js` in route handlers — including `await import('@supabase/supabase-js')`.
- All custom tables **must** have `tenant_id UUID NOT NULL` and RLS enabled.
- Use `getAdminClient()` from `src/utils/supabase/admin.ts` only for cross-tenant admin operations.
- Prefer `.upsert()` or `.onConflict()` over raw `.insert()` for idempotent retry safety.
- `createServiceClientUnsafe()` bypasses RLS entirely — only allowed in standalone scripts, migrations, and debug routes. **Never** use it in route handlers (scanner ERROR).

## Migration Rules

- Reference template: `supabase/migrations/00012_example_service_table.sql`.
- All custom tables need:
  - `id UUID DEFAULT gen_random_uuid() PRIMARY KEY`
  - `tenant_id UUID NOT NULL`
  - `created_at TIMESTAMPTZ DEFAULT now()`
  - `updated_at TIMESTAMPTZ DEFAULT now()`
  - `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` (scanner ERROR if missing)
  - Policy: service_role full access
  - Policy: authenticated users scoped to their `tenant_id`
  - Index on `tenant_id`
- Number migrations sequentially: `00013_...`, `00014_...`, etc.

## Global Values & Vendor Rules

- Use `getGVClient()` from `@/lib/gv` for GV read operations, `getTenantGVClient(tenantId)` for writes.
- Use `getCatalogClient()` from `@/lib/vendors` for catalog reads, `getTenantVendorClient(tenantId)` for tenant vendor CRUD.
- **Store `TermId` in database columns**, never raw display labels — use `toTermId()` or `resolveTermId()` to obtain them.
- Both SDKs connect to the GV Supabase project via `GV_SUPABASE_URL` + `GV_SUPABASE_ANON_KEY` (already configured by `chassis init`).
- Use `buildLabelMap()` to populate dropdowns; use `displayLabel()` for single term resolution.
- For vendor adoption, call `vendors.adopt([catalogVendorId])` — this copies contacts and addresses automatically.

## Tools, Vehicles & Equipment Rules

Three additional GV entity SDKs are available via the chassis. Each follows the same catalog + tenant client pattern as vendors.

| Entity | Catalog Client | Tenant Client | Import Path |
|--------|---------------|---------------|-------------|
| Tools | `getToolCatalogClient()` from `@/lib/tools` | `getTenantToolClient(tenantId)` from `@/lib/tools` | `@rocketmanv9/chassis/tools` |
| Vehicles | `getVehicleCatalogClient()` from `@/lib/vehicles` | `getTenantVehicleClient(tenantId)` from `@/lib/vehicles` | `@rocketmanv9/chassis/vehicles` |
| Equipment | `getEquipmentCatalogClient()` from `@/lib/equipment` | `getTenantEquipmentClient(tenantId)` from `@/lib/equipment` | `@rocketmanv9/chassis/equipment` |

- **Catalog clients** are lazy singletons (read-only, 30s cache) — use for browsing the shared GV catalog.
- **Tenant clients** are scoped per-tenant (RLS-aware) — use for CRUD, adoption, and submissions.
- API proxy routes live under `src/app/api/gv/{tools,vehicles,equipment}/` — the frontend calls these since GV is a separate Supabase project.
- GV proxy write routes return `events: []` because the GV service emits its own outbox events — this is expected and not a bug.
- For adoption: `client.adopt([catalogId1, catalogId2])` — copies contacts and addresses automatically.
- For submissions: `client.submitToCatalog(id, { tenantId, userId, email })` — proposes a custom item to the shared catalog.
- UI pages live under `src/app/(dashboard)/fleet/{tools,vehicles,equipment}/`.

## Event Rules

- All state-changing operations **must** emit outbox events.
- The `createSessionWriteRoute` handler return type enforces this — you must return `events: []`.
- Always include `last_event_id: idempotencyKey` for exactly-once delivery.
- Event names use dot notation: `entity.action` (e.g., `order.created`, `invoice.paid`).
- Do **not** call `emitOutboxEventFromContext()` manually inside a write route factory handler — return events in the `events` array instead. The factory emits them transactionally inside the idempotency guard.

```ts
return {
  data: record,
  status: 201,
  events: [{
    event_name: 'order.created',
    payload: { order_id: record.id, amount: record.amount },
    last_event_id: idempotencyKey,
  }],
};
```

## Idempotency & Retry Semantics

- The write route factories (`createWriteRoute`, `createSessionWriteRoute`) wrap your handler in an atomic idempotency guard.
- If the handler throws, the idempotency key is released so retries re-execute the handler.
- If the handler succeeds, subsequent requests with the same key return the cached result without re-executing.
- **Important:** Use `.upsert()` or `.onConflict()` for database inserts so that retries don't create duplicates.
- The `scope` option is auto-derived from the request method + pathname if omitted — you can set it explicitly for clarity.

## Side Effects (afterCommit)

For side effects that should only happen after the mutation is durable (email, external API calls, analytics):

```ts
return {
  data: record,
  status: 201,
  events: [{ event_name: 'order.created', payload: record, last_event_id: idempotencyKey }],
  afterCommit: async () => {
    await sendOrderConfirmationEmail(record.email, record.id);
  },
};
```

- `afterCommit` runs AFTER events are emitted and idempotency is committed.
- Does NOT run on idempotent replay.
- Failure is logged but does NOT fail the HTTP response.

## Upstream Fetch Validation

When calling external services, always validate the response:

```ts
import { requireOk } from '@rocketmanv9/chassis/observability';

const response = await fetch('https://billing.internal/api/charge');
await requireOk(response, 'billing charge');
const data = await response.json();
```

## Testing Rules

- Unit tests go in `tests/` — file names mirror source paths.
- Reference template: `tests/example.test.ts` for mocking patterns.
- Mock Supabase via object stubs — do not connect to real databases in unit tests.
- Mock `cookies()` from `next/headers` for auth tests.
- Mock console output: `vi.spyOn(console, 'log').mockImplementation(() => {})`.
- Run tests: `npx vitest run`.

## Directory Conventions

| Directory | Purpose |
|-----------|---------|
| `src/app/api/` | Next.js API routes (use route factories) |
| `src/app/api/system/` | System/infrastructure routes (health, debug, whoami) |
| `src/app/api/webhooks/` | Webhook endpoints |
| `src/lib/` | Shared business logic, auth helpers |
| `src/utils/` | Supabase clients, utility functions |
| `tests/` | Unit tests (vitest) |
| `supabase/migrations/` | SQL migration files |

## Enforcement (What Will Fail Your Build)

These rules are enforced by ESLint, the compliance scanner, and TypeScript — violations are hard errors:

| Violation | Caught By | Severity |
|-----------|-----------|----------|
| Bare `export async function POST` | ESLint + scanner | ERROR |
| `throw new Error()` instead of AppError | ESLint | ERROR |
| Missing route factory | Compliance scanner | ERROR |
| Missing idempotency on writes | Compliance scanner | ERROR |
| Missing auth on non-system routes | Compliance scanner | ERROR |
| Missing outbox event on writes | Compliance scanner | ERROR |
| Raw `@supabase/supabase-js` import (static or dynamic) | ESLint + scanner | ERROR |
| `createServiceClientUnsafe()` in route handlers | Compliance scanner | ERROR |
| Bare `fetch()` without tracing | Compliance scanner | ERROR |
| `CREATE TABLE` without `ENABLE ROW LEVEL SECURITY` | Compliance scanner | ERROR |
| `events: []` on write routes (no events) | Compliance scanner | WARNING |
| `req.json()` without zod validation | Compliance scanner | WARNING |
| DB queries without tenant context | Compliance scanner | WARNING |
| Manual `emitOutboxEventFromContext()` + `events: []` | Compliance scanner | WARNING |
| Admin/internal routes without role restrictions | Compliance scanner | WARNING |
| `.insert()` without `.upsert()`/`.onConflict()` | Compliance scanner | WARNING |
| `.insert()` + `events: []` (mutation without events) | Compliance scanner | WARNING |
| `fetch()` without `response.ok` check | Compliance scanner | WARNING |
| `auth: 'public'` outside system routes | Compliance scanner | WARNING |
| `.select()` without `.limit()`/`.range()` | Compliance scanner | WARNING |
| Event name not in `entity.action` format | Runtime (emitOutboxEvent) | ERROR |
| Handler exceeds 25s timeout | Runtime (route factory) | 504 |

Run `npx vitest run tests/compliance.test.ts` to check compliance locally.

## Don'ts

- **Don't** bypass RLS — `createServiceClientUnsafe` in route handlers is a scanner ERROR.
- **Don't** skip idempotency — write routes without idempotency keys are rejected (400 at runtime, ERROR at scan time).
- **Don't** return `events: []` on real mutations — the scanner flags empty event arrays as a WARNING.
- **Don't** create routes without factories — bare `export async function` is an ESLint ERROR.
- **Don't** use `new Error()` — ESLint ERROR; use `AppError.*` for proper status codes.
- **Don't** skip validation — `req.json()` without `.parse()` is a scanner WARNING.
- **Don't** hardcode tenant IDs — always derive from session or JWT claims.
- **Don't** call `emitOutboxEventFromContext()` manually inside factory handlers — use the `events` return array.
- **Don't** skip `ENABLE ROW LEVEL SECURITY` in migrations — scanner ERROR.
- **Don't** use raw `.insert()` in write route factories — prefer `.upsert()` for retry safety.
- **Don't** ignore upstream fetch errors — use `requireOk(response)` from `@rocketmanv9/chassis/observability`.
- **Don't** use `auth: 'public'` on business routes — move truly public endpoints to `app/api/system/`.
- **Don't** return unbounded queries — always add `.limit()` or `.range()` to list endpoints.
- **Don't** use non-standard event names — must be `entity.action` lowercase (e.g., `order.created`, not `OrderCreated`).
