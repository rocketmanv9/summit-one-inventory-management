# Summit One Inventory Management - Microservice Setup

This microservice is part of the Summit One ecosystem and follows the centralized authentication architecture.

## Architecture Overview

- **Authentication**: SSO via Summit One Core (JWT-based)
- **Multi-tenant**: All data isolated by `tenant_id` using RLS policies
- **Event-driven**: Receives events from Core's event system
- **Database**: Own Supabase instance with tenant isolation

## Prerequisites

1. Summit One Core must be running at `http://localhost:3000` (or configured CORE_API_URL)
2. Docker Desktop installed and running
3. Node.js 18+ installed

## Environment Variables

The `.env.local` file is configured with:

```env
# Database (Local Supabase)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres

# Core Integration (MUST match Core's SSO secrets)
CORE_API_URL_DEV=http://localhost:3000
CORE_SSO_SECRET_DEV=dev-secret-key-change-in-production

# Webhook Secret (for receiving events from Core)
WEBHOOK_SECRET=inventory-webhook-secret-change-in-production

# Service Info
NEXT_PUBLIC_SERVICE_NAME=Inventory Management
NEXT_PUBLIC_SERVICE_SLUG=inventory
NEXT_PUBLIC_ENV=dev
```

### ⚠️ CRITICAL: SSO Secret Matching

The `CORE_SSO_SECRET_DEV` **MUST** match `NEXT_PUBLIC_SSO_SECRET_DEV` in Summit One Core's `.env.local`. If they don't match, SSO authentication will fail.

## Local Development Setup

### 1. Start Local Supabase

```bash
npx supabase start
```

This will start Supabase on custom ports to avoid conflicts with Core:
- Studio: http://127.0.0.1:55323
- API: http://127.0.0.1:55321
- DB: postgresql://127.0.0.1:55322

### 2. Install Dependencies

```bash
npm install
```

### 3. Start Development Server

```bash
npm run dev
```

The inventory service will run on `http://localhost:3001` (or next available port).

## Authentication Flow

1. User logs in to **Summit One Core** at `http://localhost:3000`
2. User clicks button to open Inventory Management
3. Core generates short-lived JWT token (5 minutes) with user/tenant info
4. User is redirected to: `http://localhost:3001?core_token=JWT&core_env=dev`
5. AuthGate component intercepts, validates token with Core
6. Local session created in HTTP-only cookie (7 days)
7. User can now access inventory features

## Database Schema

### Tenant Isolation

All tables have `tenant_id` column and RLS policies:

```sql
-- Example from stock_balances table
CREATE POLICY "stock_balances_tenant_isolation"
ON inventory.stock_balances
FOR ALL
TO authenticated
USING (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### Session Context

Before querying, set tenant context:

```typescript
import { setTenantContext } from '@/lib/db-middleware';

// In API route
const session = getSession(request);
await setTenantContext({
  tenantId: session.tenantId,
  userId: session.userId,
  role: session.role
});

// Now all queries are automatically scoped to this tenant
```

## Event Handling

This service receives events from Core's event system via webhook.

### Webhook Endpoint

**URL**: `/api/webhooks/core-events`

**Verification**: HMAC signature using `WEBHOOK_SECRET`

**Events Handled**:
- `tenant.membership.created` - User added to tenant
- `tenant.membership.updated` - User role changed
- `tenant.membership.deleted` - User removed from tenant
- `tenant.profile.updated` - User profile changed
- `tenant.created` - New tenant created

### Registering Webhook in Core

In Summit One Core's database, run:

```sql
INSERT INTO public.event_subscriptions (
  name,
  endpoint_url,
  event_types,
  secret,
  is_active
) VALUES (
  'Inventory Management Service',
  'http://host.docker.internal:3001/api/webhooks/core-events',
  ARRAY[
    'tenant.membership.*',
    'tenant.profile.updated',
    'tenant.created'
  ],
  'inventory-webhook-secret-change-in-production', -- Must match WEBHOOK_SECRET
  true
);
```

### Idempotency

All events are tracked in `processed_events` table to prevent duplicate processing:

```sql
SELECT * FROM processed_events 
WHERE delivery_id = 'event-delivery-uuid';
```

## API Routes

### Authentication

- `POST /api/auth/callback` - Exchange SSO token for session
- `GET /api/auth/session` - Check current session
- `DELETE /api/auth/session` - Logout

### Webhooks

- `POST /api/webhooks/core-events` - Receive events from Core

### Inventory (Future)

- `/api/inventory/items` - Catalog items (tenant-scoped)
- `/api/inventory/stock` - Stock balances (tenant-scoped)
- `/api/inventory/events` - Inventory events (tenant-scoped)

## Testing Locally

### 1. Create Test Tenant in Core

In Core's Supabase Studio:

```sql
-- Create tenant
INSERT INTO tenants (id, name, slug) 
VALUES ('test-tenant-id', 'Test Company', 'test-company');

-- Add user to tenant (after signing up via Auth)
INSERT INTO tenant_memberships (tenant_id, user_id, role) 
VALUES ('test-tenant-id', 'user-id-from-auth', 'owner');

-- Set active tenant
UPDATE profiles 
SET active_tenant_id = 'test-tenant-id'
WHERE id = 'user-id-from-auth';
```

### 2. Test SSO Flow

1. Login to Core at http://localhost:3000
2. Click "Open Inventory" (or navigate to http://localhost:3001?core_token=...&core_env=dev)
3. Should be logged in automatically
4. Check browser DevTools > Application > Cookies for `session` cookie

### 3. Test Event Delivery

In Core's database:

```sql
-- Manually create an event
INSERT INTO events_outbox (
  tenant_id,
  event_type,
  aggregate_type,
  payload
) VALUES (
  'test-tenant-id',
  'tenant.membership.created',
  'tenant_membership',
  '{"user_id": "test-user", "role": "member"}'::jsonb
);
```

Wait for event poller (runs every minute), then check:

```sql
-- In Core: Check deliveries
SELECT * FROM event_deliveries 
WHERE subscription_id = (
  SELECT id FROM event_subscriptions 
  WHERE name = 'Inventory Management Service'
)
ORDER BY created_at DESC;

-- In Inventory: Check processing
SELECT * FROM processed_events 
ORDER BY processed_at DESC;
```

## Troubleshooting

### "Invalid token" on SSO redirect

**Cause**: SSO secrets don't match between Core and Inventory

**Fix**: 
1. Check Core's `.env.local` for `NEXT_PUBLIC_SSO_SECRET_DEV`
2. Check Inventory's `.env.local` for `CORE_SSO_SECRET_DEV`
3. Ensure they're identical
4. Restart both services

### "Permission denied" in database queries

**Cause**: Tenant context not set or RLS blocking access

**Debug**:
```sql
-- Check session variables
SELECT 
  current_setting('app.current_tenant_id', true) as tenant_id,
  current_setting('app.current_user_id', true) as user_id;
```

**Fix**: Ensure `setTenantContext()` is called before queries

### Events not being received

**Checks**:
1. Is webhook registered in Core? (Check `event_subscriptions` table)
2. Is Core's event poller running?
3. Check webhook URL uses `host.docker.internal` for local development
4. Verify `WEBHOOK_SECRET` matches between Core subscription and Inventory `.env.local`

### Port conflicts

If ports 55321-55327 are in use, edit `supabase/config.toml`:

```toml
[api]
port = 56321  # Change to available port

[db]
port = 56322

[studio]
port = 56323
```

Then update `.env.local` URLs to match.

## Production Deployment

### Before Deploying

- [ ] Change all secrets (SSO, webhook, database passwords)
- [ ] Update Core API URLs to production endpoints
- [ ] Set `NEXT_PUBLIC_ENV=prod`
- [ ] Configure HTTPS/SSL for all endpoints
- [ ] Register production webhook URL in Core
- [ ] Enable rate limiting on API routes
- [ ] Set up monitoring and logging
- [ ] Test tenant isolation thoroughly

### Environment Variables for Production

```env
# Production Core
CORE_API_URL_PROD=https://core.summit.com
CORE_SSO_SECRET_PROD=<strong-random-secret>
NEXT_PUBLIC_CORE_URL=https://core.summit.com

# Production Database
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
DATABASE_URL=<production-connection-string>

# Production Webhook
WEBHOOK_SECRET=<strong-random-secret>

NEXT_PUBLIC_ENV=prod
```

## Key Files

- [src/components/AuthGate.tsx](src/components/AuthGate.tsx) - SSO authentication wrapper
- [src/app/api/auth/callback/route.ts](src/app/api/auth/callback/route.ts) - SSO token exchange
- [src/app/api/auth/session/route.ts](src/app/api/auth/session/route.ts) - Session management
- [src/app/api/webhooks/core-events/route.ts](src/app/api/webhooks/core-events/route.ts) - Event handling
- [src/lib/db-middleware.ts](src/lib/db-middleware.ts) - Tenant context setting
- [supabase/migrations/20260105000000_add_rls_and_event_tracking.sql](supabase/migrations/20260105000000_add_rls_and_event_tracking.sql) - RLS policies

## Next Steps

1. Build inventory-specific features (items, stock, movements)
2. Create dashboards using read models
3. Implement real-time updates via Supabase Realtime
4. Add role-based permissions (owner, admin, member)
5. Create mobile app using same SSO pattern

## Support

For Summit One architecture questions, see:
- Main auth architecture document (provided by user)
- Core repository documentation
- Supabase RLS documentation

For inventory-specific features:
- [HOW_IT_WORKS.md](HOW_IT_WORKS.md) - Event-driven inventory architecture
- [MIGRATION_SUMMARY.md](MIGRATION_SUMMARY.md) - Database schema overview
