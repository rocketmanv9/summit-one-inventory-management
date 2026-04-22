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

Copy [.env.example](.env.example) to `.env.local` and fill in values.

#### ✅ REQUIRED (App will not function without these):

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon public key | `eyJhbG...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) | `eyJhbG...` |
| `SUPABASE_JWT_SECRET` | Supabase JWT secret | `your-secret-32-chars+` |
| `CORE_EXCHANGE_URL` | Summit Core SSO exchange endpoint | `https://core.app/api/auth/exchange` |
| `CORE_SUPABASE_ANON_KEY` | Core's Supabase anon key | `eyJhbG...` |
| `NEXT_PUBLIC_CORE_APP_URL` | Summit Core app URL | `https://core.app` |
| `NEXT_PUBLIC_APP_URL` | This app's URL | `http://localhost:3000` |

#### 🔧 OPTIONAL (Recommended for production):

| Variable | Description | When needed |
|----------|-------------|-------------|
| `DATABASE_URL` | Direct DB connection | Migrations, scripts |
| `WEBHOOK_SECRET` | Webhook signature verification | Core webhooks |
| `EVENTS_WEBHOOK_URL` | Event consumer endpoint | Event-driven integrations |
| `SENTRY_DSN` | Error tracking | Production monitoring |
| `UPSTASH_REDIS_REST_URL` | Rate limiting | Production API protection |
| `OPENAI_API_KEY` | AI chat | NLP features |

See [.env.example](.env.example) for full list and descriptions.

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

This service is designed to deploy on Vercel with branch-based environments:

- **main** → Production
- **stage** → Staging
- **dev** → Development

### Vercel Setup

1. **Import project** to Vercel from GitHub
2. **Set environment variables** in Vercel Dashboard for each environment:
   - Go to Project Settings > Environment Variables
   - Set all REQUIRED variables listed above
   - Use environment-specific values (dev/stage/prod)
3. **Deploy** - Vercel auto-deploys on git push
4. **Database migrations** run automatically via GitHub Actions (see `.github/workflows/supabase-sync.yml`)

### Production Checklist

Before deploying to production, ensure:

- [ ] All REQUIRED environment variables are set
- [ ] `SENTRY_DSN` configured for error tracking
- [ ] `UPSTASH_REDIS_*` configured for rate limiting
- [ ] Supabase project is on paid plan (RLS, cron jobs)
- [ ] Events poller cron is scheduled (see `supabase/config.toml`)
- [ ] Database backups are enabled in Supabase
- [ ] SSL certificates are valid
- [ ] CORS is properly configured

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
