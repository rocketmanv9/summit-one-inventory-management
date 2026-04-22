# Development Guide — summit-one-inventory-management

## Architecture Overview

This microservice is part of the **Summit One** platform. It follows these principles:

- **Independent deployment** — Each microservice is its own repository and deploys independently to Vercel
- **Migration-driven schema** — All database changes go through committed Supabase migrations
- **Multi-tenant** — All data access is tenant-scoped with Row Level Security
- **Idempotent** — All write operations use idempotency keys to prevent duplicates
- **Event-driven** — Domain events are published via the outbox pattern

## Environment Model

| Branch | Database | Vercel Environment | Purpose |
|--------|----------|-------------------|---------|
| `dev` | Dev Supabase project | Preview | Active development, integration testing |
| `stage` | Stage Supabase project | Preview | Pre-production validation, QA |
| `prod` | Prod Supabase project | Production | Live traffic |

Each environment has its own:

- Supabase project (separate database, auth, storage)
- Environment variables (scoped via GitHub Environments)
- Vercel deployment target

## Daily Development Workflow

### No Local Database

**We do NOT use local Postgres for normal development.**

Your development workflow:

1. Write code locally against the **dev** Supabase project
2. Environment variables in `.env.local` point to the shared dev database
3. Run `npm run dev` to start the local dev server
4. The dev server connects to the remote dev Supabase instance

### Why No Local DB?

- Supabase provides auth, RLS, edge functions, and storage — none of which replicate locally with fidelity
- The dev database is shared per microservice, ensuring all developers work against the same schema
- Schema changes are migration-driven, keeping all environments in sync
- This eliminates "works on my machine" database drift

## Schema Changes & Migrations

### Rules

1. **Never manually modify the Supabase schema** without a corresponding migration file
2. All migrations go in `supabase/migrations/`
3. Migration files must be committed to the repository
4. CI automatically applies migrations on push to dev/stage/prod
5. Migrations must be idempotent (safe to run multiple times)

### Creating a Migration

```bash
# Create a new migration file
supabase migration new <description>

# Edit the generated file in supabase/migrations/
# Then commit and push to dev branch
git add supabase/migrations/
git commit -m "Add migration: <description>"
git push origin dev
```

CI will automatically apply the migration to the dev database.

### Migration Flow

```
Developer creates migration
  -> Commits to dev branch
  -> CI applies migration to Dev DB
  -> Vercel deploys to dev environment
  -> QA validates on stage
  -> CI applies migration to Stage DB
  -> Promote to prod
  -> CI applies migration to Prod DB
  -> Vercel deploys to production
```

## CI/CD Pipeline

Every push to `dev`, `stage`, or `prod` triggers:

1. **Install dependencies** (with private package auth)
2. **Apply Supabase migrations** via `supabase db push`
3. **Build** the application
4. **Typecheck** with TypeScript
5. **Run tests**
6. **Deploy to Vercel** (only after all above succeed)

If migration fails, deployment is blocked. This prevents deploying code that expects schema changes that haven't been applied.

### Required GitHub Environment Secrets

Configure these in GitHub > Settings > Environments > [dev/stage/prod]:

| Secret | Description |
|--------|-------------|
| `SUPABASE_DB_URL` | Postgres connection string for the environment's Supabase project |
| `SUPABASE_PROJECT_REF` | (Optional) Supabase project reference ID |
| `VERCEL_TOKEN` | Vercel API token for deployment |

### Required GitHub Repository Secrets

| Secret | Description |
|--------|-------------|
| `NODE_AUTH_TOKEN` | GitHub PAT with `read:packages` for @rocketmanv9 packages |
| `VERCEL_ORG_ID` | Vercel organization/team ID |
| `VERCEL_PROJECT_ID` | Vercel project ID |

## Branch Strategy

```
dev ---------> stage ---------> prod
(develop)      (validate)       (release)
```

- **dev**: Active development. All feature branches merge here first.
- **stage**: Pre-production. Merge dev -> stage when ready for QA.
- **prod**: Production. Merge stage -> prod for releases.

Never push directly to `prod`. Always promote through `stage`.

## Vercel Configuration

This project deploys to Vercel with branch-based environments:

- Push to `prod` triggers production deployment
- Push to `dev` or `stage` triggers preview deployment

Vercel auto-deploys are **disabled**. All deployments are CI-driven to ensure migrations run first.

## Chassis Integration

This service uses `@rocketmanv9/chassis` for:

- **Auth** — JWT validation, tenant extraction, SSO
- **Events** — Outbox pattern event publishing
- **Idempotency** — Duplicate write prevention
- **Config** — Environment variable validation
- **Logging** — Structured JSON logging
- **Context** — Request context propagation

Run `npx chassis doctor` to verify your environment is correctly configured.

## Global Values (GV)

Global Values is the platform-wide taxonomy database — shared lookup tables for materials, statuses, categories, etc. Each term has a UUID (`TermId`) and a code. Tenants can override display labels and add aliases.

### Quick Start

```ts
import { getGVClient, getTenantGVClient } from '@/lib/gv';

// Read operations (use the singleton — no tenant context needed for reads)
const gv = getGVClient();
const label = await gv.displayLabel(tenantId, termId);
const labelMap = await gv.buildLabelMap(tenantId, 'materials');

// Write operations (resolveTermId, overrides, aliases — needs tenant RLS)
const tenantGV = await getTenantGVClient(tenantId);
const termId = await tenantGV.resolveTermId(tenantId, 'materials', 'Durafill');
```

### Key Rules

- **Store `TermId` in DB columns**, never raw display labels.
- Use `toTermId()` to cast validated strings; use `assertTermIds()` to validate at runtime.
- The GV database is separate from your service DB — it uses `GV_SUPABASE_URL` + `GV_SUPABASE_ANON_KEY`.

## Vendors

The Vendor SDK provides access to the platform vendor catalog and tenant-specific vendor management.

### Quick Start

```ts
import { getCatalogClient, getTenantVendorClient } from '@/lib/vendors';

// Browse the platform catalog (no tenant context needed)
const catalog = getCatalogClient();
const allVendors = await catalog.list();
const tags = await catalog.listIndustryTags();

// Tenant-scoped CRUD (needs tenant RLS)
const vendors = await getTenantVendorClient(tenantId);
const myVendors = await vendors.list({ activeOnly: true });
const adopted = await vendors.adopt([catalogVendorId]);
const custom = await vendors.create({ name: 'Acme Corp', vendor_type_id: termId });
```

### Key Rules

- **Catalog** is platform-wide (read-only for most services). **Tenant vendors** are per-tenant.
- Use `adopt()` to copy catalog vendors into a tenant's vendor list.
- The vendor DB uses the same `GV_SUPABASE_URL` + `GV_SUPABASE_ANON_KEY` credentials.

## Troubleshooting

### "Migration failed" in CI

1. Check the CI logs for the specific SQL error
2. Fix the migration file
3. Push again — migrations are idempotent

### "Cannot connect to database"

1. Verify `SUPABASE_DB_URL` is set in the correct GitHub Environment
2. Ensure the Supabase project is accessible
3. Check that the connection string includes the correct password

### "Doctor check failed"

Run locally: `npx chassis doctor --json` to see which checks failed.

Common issues:
- Missing tables: Run migrations
- Missing RPC functions: Apply all migration files in order
- Schema version mismatch: Apply latest migration
