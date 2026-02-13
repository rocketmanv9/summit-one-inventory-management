# Summit One Inventory Management

## What this is
Summit One Inventory Management is a Next.js microservice in the Summit One ecosystem. It handles multi-tenant inventory, procurement, assets, and related workflows backed by Supabase (Postgres + RLS).

## Tech stack
- Next.js 16 (App Router)
- TypeScript
- Supabase (Postgres + RLS)
- Tailwind CSS + shadcn/ui

## Getting started

### Prereqs
- Node.js 20+
- Supabase CLI (for local Postgres)

### Environment variables
Copy [.env.example](.env.example) to [.env.local](.env.local) and fill in values. Required keys used by the app:

- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_JWT_SECRET
- CORE_EXCHANGE_URL
- CORE_SUPABASE_ANON_KEY
- NEXT_PUBLIC_CORE_APP_URL

Commonly used for local dev and tooling:

- SUPABASE_SERVICE_ROLE_KEY
- DATABASE_URL
- DIRECT_URL
- WEBHOOK_SECRET
- NEXT_PUBLIC_APP_URL
- NEXT_PUBLIC_SERVICE_BASE_URL
- NEXT_PUBLIC_SERVICE_NAME
- NEXT_PUBLIC_SERVICE_SLUG
- NEXT_PUBLIC_TENANT_ID

### Run locally
1. Install dependencies: `npm install`
2. Start Supabase (local): `npm run sb:start`
3. Run the app: `npm run dev`
4. Open `http://localhost:3000`

## Project structure
- [src/app](src/app) - App Router routes, layouts, API routes
- [src/components](src/components) - UI components
- [src/lib](src/lib) - auth utilities, API client shim, RPC wrappers
- [src/hooks](src/hooks) - client hooks
- [supabase/migrations](supabase/migrations) - database migrations
- [supabase/functions](supabase/functions) - edge functions
- [supabase/snippets](supabase/snippets) - utility SQL scripts

## Auth
This service uses Summit One Core ticket-based SSO and mints Supabase-compatible JWTs. See [docs/AUTH.md](docs/AUTH.md) for the full flow and implementation details.

## Deployment
This service is designed to deploy on Vercel. No Vercel config file is currently present in the repo.

## Scripts
From the [scripts](scripts) directory:
- [scripts/audit-idempotency.mjs](scripts/audit-idempotency.mjs)
- [scripts/check-frontend-idempotency.mjs](scripts/check-frontend-idempotency.mjs)
- [scripts/check-idempotency.mjs](scripts/check-idempotency.mjs)
- [scripts/dev-auth.js](scripts/dev-auth.js)
- [scripts/dev-auth.ps1](scripts/dev-auth.ps1)
- [scripts/dev-auth.py](scripts/dev-auth.py)
- [scripts/dev-auth.sh](scripts/dev-auth.sh)
- [scripts/scan-debug-violations.mjs](scripts/scan-debug-violations.mjs)
