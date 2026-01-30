# Summit One Authentication & Authorization System

Complete guide to the multi-tenant, event-driven auth architecture.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Multi-Tenant Architecture](#multi-tenant-architecture)
3. [Authentication Flow (SSO)](#authentication-flow-sso)
4. [Authorization (RLS Policies)](#authorization-rls-policies)
5. [Event-Driven Architecture](#event-driven-architecture)
6. [Setting Up a New Microservice](#setting-up-a-new-microservice)
7. [Testing Auth Locally](#testing-auth-locally)
8. [Common Patterns](#common-patterns)
9. [Troubleshooting](#troubleshooting)

---

## System Overview

Summit One uses a **centralized authentication system** with **distributed microservices**:

```
┌─────────────────────────────────────────────────────────────┐
│                    SUMMIT ONE CORE DB                       │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │   Tenants    │  │   Profiles   │  │ Tenant Members  │  │
│  │              │  │              │  │                 │  │
│  │  - Acme Inc  │  │  - user@co   │  │  - user + role  │  │
│  │  - Beta LLC  │  │  - admin@co  │  │  - admin/member │  │
│  └──────────────┘  └──────────────┘  └─────────────────┘  │
│                                                             │
│  ┌────────────────────────────────────────────────────┐    │
│  │           EVENTS OUTBOX (Event Bus)                │    │
│  │  - tenant.membership.created                       │    │
│  │  - tenant.profile.updated                          │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ Events
                          ▼
        ┌─────────────────────────────────────────┐
        │    EVENT POLLER (Edge Function)         │
        │  - Runs every minute via pg_cron        │
        │  - Delivers events to subscribed hooks  │
        └─────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │   HR     │    │   CRM    │    │   ERP    │
    │ Service  │    │ Service  │    │ Service  │
    │          │    │          │    │          │
    │ Own DB   │    │ Own DB   │    │ Own DB   │
    └──────────┘    └──────────┘    └──────────┘
```

**Key Principles:**
- **Single Source of Truth**: Core DB owns users, tenants, and memberships
- **JWT-based SSO**: Core generates short-lived tokens for microservices
- **Event-Driven**: All changes emit events to keep services in sync
- **Row-Level Security**: Every table filtered by `tenant_id`

---

## Multi-Tenant Architecture

### Database Schema

#### 1. Tenants Table
```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 2. Profiles Table (Users)
```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  active_tenant_id UUID REFERENCES tenants(id),  -- Current context
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 3. Tenant Memberships (Many-to-Many)
```sql
CREATE TABLE tenant_memberships (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES profiles(id),
  role membership_role NOT NULL,  -- owner, admin, member, billing
  status TEXT DEFAULT 'active',
  PRIMARY KEY (tenant_id, user_id)  -- Composite key
);
```

### Tenant Context Switching

Users can belong to **multiple tenants**. The active tenant is stored in `profiles.active_tenant_id`:

```sql
-- Switch active tenant
UPDATE profiles 
SET active_tenant_id = 'new-tenant-uuid'
WHERE id = auth.uid();
```

All RLS policies use this active tenant for authorization.

---

## Authentication Flow (SSO)

### Overview

Microservices **DO NOT** handle authentication directly. Instead:

1. User authenticates with **Core** (Supabase Auth)
2. Core generates a **short-lived JWT** (5 minutes)
3. User is redirected to microservice with token
4. Microservice validates token with Core
5. Microservice creates local session

### Step-by-Step Flow

```
┌──────┐                    ┌──────────┐                  ┌─────────────┐
│ User │                    │   Core   │                  │ Microservice│
└──┬───┘                    └────┬─────┘                  └──────┬──────┘
   │                             │                               │
   │ 1. Click "Open HR App"      │                               │
   ├────────────────────────────►│                               │
   │                             │                               │
   │ 2. POST /api/auth/generate-sso-token                        │
   │    { target_service: "hr" } │                               │
   │◄────────────────────────────┤                               │
   │ { token: "jwt...", url }    │                               │
   │                             │                               │
   │ 3. Redirect to HR with token│                               │
   ├─────────────────────────────┼──────────────────────────────►│
   │  /auth/callback?            │                               │
   │    core_token=jwt...&       │                               │
   │    core_env=dev             │                               │
   │                             │                               │
   │                             │ 4. POST /api/auth/validate    │
   │                             │    { token: "jwt..." }        │
   │                             │◄──────────────────────────────┤
   │                             │                               │
   │                             │ 5. Return user data           │
   │                             ├──────────────────────────────►│
   │                             │ { user_id, tenant_id, email } │
   │                             │                               │
   │ 6. Set microservice session │                               │
   │    & redirect to dashboard  │                               │
   │◄────────────────────────────┼───────────────────────────────┤
   │                             │                               │
```

### Core API Endpoints

#### Generate SSO Token
**Endpoint:** `POST /api/auth/generate-sso-token`

**Request:**
```json
{
  "target_service": "hr",
  "target_org": "optional-tenant-id"
}
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "redirect_url": "https://hr.summit.com/auth/callback?core_token=...&core_env=dev"
}
```

**Token Payload (JWT):**
```json
{
  "user_id": "uuid",
  "email": "user@example.com",
  "tenant_id": "uuid",
  "tenant_slug": "acme-inc",
  "role": "admin",
  "exp": 1704484800  // 5 minutes from now
}
```

#### Validate SSO Token
**Endpoint:** `POST /api/auth/validate-sso-token`

**Request:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "env": "dev"
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "user_id": "uuid",
    "email": "user@example.com",
    "tenant_id": "uuid",
    "tenant_slug": "acme-inc",
    "role": "admin"
  }
}
```

### Environment-Specific Secrets

Each environment (dev/stage/prod) has its own JWT secret:

**.env.local (Core):**
```env
# SSO Secrets - MUST match microservice configs
NEXT_PUBLIC_SSO_SECRET_DEV=dev-secret-key-change-in-production
NEXT_PUBLIC_SSO_SECRET_STAGE=stage-secret-key-change-in-production
NEXT_PUBLIC_SSO_SECRET_PROD=prod-secret-key-change-in-production
```

**Microservice .env:**
```env
CORE_SSO_SECRET_DEV=dev-secret-key-change-in-production
CORE_SSO_SECRET_STAGE=stage-secret-key-change-in-production
CORE_SSO_SECRET_PROD=prod-secret-key-change-in-production
```

⚠️ **CRITICAL**: These secrets must match between Core and all microservices!

---

## Authorization (RLS Policies)

### How RLS Works

Every table in every microservice database must:

1. **Add `tenant_id` column**
2. **Enable Row Level Security**
3. **Create policies scoped by tenant**

### Example: HR Service Database

```sql
-- 1. Create table with tenant_id
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,  -- ← REQUIRED
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Enable RLS
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- 3. Create tenant-scoped policies
CREATE POLICY "employees_tenant_isolation"
ON employees
FOR ALL
TO authenticated
USING (tenant_id = current_setting('app.current_tenant_id')::UUID)
WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

### Setting Tenant Context

In your microservice, set the tenant context **per-request**:

```typescript
// Middleware example (Next.js)
export async function middleware(request: NextRequest) {
  const session = await getSession(request);
  
  if (session?.tenant_id) {
    // Set Postgres session variable for RLS
    await db.query(
      `SET app.current_tenant_id = $1`,
      [session.tenant_id]
    );
  }
  
  return NextResponse.next();
}
```

### RLS Policy Patterns

#### Read/Write for Tenant Members
```sql
CREATE POLICY "tenant_members_all"
ON table_name
FOR ALL
TO authenticated
USING (tenant_id = current_setting('app.current_tenant_id')::UUID)
WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::UUID);
```

#### Admin-Only Writes
```sql
CREATE POLICY "tenant_admins_write"
ON table_name
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = current_setting('app.current_tenant_id')::UUID
  AND current_setting('app.user_role')::TEXT IN ('owner', 'admin')
);
```

#### Service Role Bypass (for system operations)
```sql
CREATE POLICY "service_role_all"
ON table_name
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
```

---

## Event-Driven Architecture

### Event Flow

```
1. Core DB Change
   └─► Trigger on table (INSERT/UPDATE/DELETE)
       └─► Insert into events_outbox

2. Event Poller (runs every minute)
   └─► Fetch pending events from events_outbox
       └─► Create event_deliveries for each subscription
           └─► POST to microservice webhooks

3. Microservice Webhook
   └─► Verify HMAC signature
       └─► Check idempotency (delivery_id)
           └─► Process event
               └─► Acknowledge (200 OK)
```

### Events Outbox Schema

```sql
CREATE TABLE events_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,  -- NULL for system events
  event_type TEXT NOT NULL,  -- e.g., 'tenant.membership.created'
  aggregate_type TEXT,
  aggregate_id UUID,
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'pending',  -- pending, published, failed
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Event Subscriptions

Microservices register webhooks to receive events:

```sql
INSERT INTO event_subscriptions (
  name,
  endpoint_url,
  event_types,  -- Array of patterns to match
  secret,       -- For HMAC signature verification
  is_active
) VALUES (
  'HR Service Events',
  'https://hr.summit.com/api/webhooks/core-events',
  ARRAY['tenant.membership.*', 'tenant.profile.updated'],
  'webhook-secret-from-env',
  true
);
```

### Webhook Implementation

```typescript
// /api/webhooks/core-events/route.ts
import { createHmac } from 'crypto';

export async function POST(req: Request) {
  const signature = req.headers.get('x-summit-signature');
  const rawBody = await req.text();
  
  // 1. Verify HMAC signature
  const expectedSignature = createHmac('sha256', process.env.WEBHOOK_SECRET!)
    .update(rawBody)
    .digest('hex');
    
  if (signature !== expectedSignature) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }
  
  const event = JSON.parse(rawBody);
  
  // 2. Check idempotency (prevent duplicate processing)
  const existing = await db.query(
    'SELECT id FROM processed_events WHERE delivery_id = $1',
    [event.delivery_id]
  );
  
  if (existing.rows.length > 0) {
    return Response.json({ status: 'already_processed' });
  }
  
  // 3. Process event based on type
  switch (event.event_type) {
    case 'tenant.membership.created':
      await handleMembershipCreated(event.payload);
      break;
    case 'tenant.membership.updated':
      await handleMembershipUpdated(event.payload);
      break;
    case 'tenant.profile.updated':
      await handleProfileUpdated(event.payload);
      break;
  }
  
  // 4. Record processing
  await db.query(
    'INSERT INTO processed_events (delivery_id, event_type, processed_at) VALUES ($1, $2, NOW())',
    [event.delivery_id, event.event_type]
  );
  
  return Response.json({ status: 'processed' });
}
```

### Event Types Reference

| Event Type | Trigger | Payload |
|------------|---------|---------|
| `tenant.created` | New tenant signup | `{ tenant_id, name, slug }` |
| `tenant.membership.created` | User added to tenant | `{ user_id, tenant_id, role }` |
| `tenant.membership.updated` | Role changed | `{ user_id, tenant_id, old_role, new_role }` |
| `tenant.membership.deleted` | User removed | `{ user_id, tenant_id }` |
| `tenant.profile.updated` | User profile changed | `{ user_id, email, first_name, last_name }` |

---

## Setting Up a New Microservice

### Prerequisites Checklist

- [ ] Core DB is running with event system enabled
- [ ] Event poller Edge Function is deployed
- [ ] SSO secrets are configured (dev/stage/prod)
- [ ] Microservice has its own Supabase project or Postgres database

### Step 1: Database Schema

Create your microservice database with tenant isolation:

```sql
-- 1. Add tenant_id to ALL tables
CREATE TABLE your_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,  -- CRITICAL: Every table needs this
  -- your columns here
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Enable RLS on ALL tables
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;

-- 3. Create tenant isolation policy
CREATE POLICY "your_table_tenant_isolation"
ON your_table
FOR ALL
TO authenticated
USING (tenant_id = current_setting('app.current_tenant_id')::UUID)
WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- 4. Service role bypass (for webhooks)
CREATE POLICY "your_table_service_role"
ON your_table
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 5. Create idempotency tracking table
CREATE TABLE processed_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Step 2: Environment Variables

**.env.local** (and .env.dev, .env.stage, .env.prod):
```env
# Database (your microservice database)
DATABASE_URL=postgresql://postgres:password@localhost:5432/hr_service
DIRECT_URL=postgresql://postgres:password@localhost:5432/hr_service

# Core SSO Integration
CORE_API_URL_DEV=http://localhost:3000
CORE_API_URL_STAGE=https://stage-core.summit.com
CORE_API_URL_PROD=https://core.summit.com

CORE_SSO_SECRET_DEV=dev-secret-key-change-in-production
CORE_SSO_SECRET_STAGE=stage-secret-key-change-in-production
CORE_SSO_SECRET_PROD=prod-secret-key-change-in-production

# Webhook Secret (for receiving events)
WEBHOOK_SECRET=your-webhook-secret-here

# Your Supabase (if using)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Step 3: Implement AuthGate Component

```typescript
// components/AuthGate.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const coreToken = searchParams.get('core_token');
    const coreEnv = searchParams.get('core_env') || 'dev';
    
    if (coreToken) {
      // Exchange SSO token for local session
      handleSSOCallback(coreToken, coreEnv);
    } else {
      // Check for existing session
      checkSession();
    }
  }, [searchParams]);
  
  async function handleSSOCallback(token: string, env: string) {
    try {
      const response = await fetch('/api/auth/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, env }),
      });
      
      if (response.ok) {
        const session = await response.json();
        setSession(session);
        router.replace('/dashboard'); // Remove token from URL
      } else {
        redirectToCore();
      }
    } catch (error) {
      console.error('SSO callback error:', error);
      redirectToCore();
    } finally {
      setLoading(false);
    }
  }
  
  async function checkSession() {
    try {
      const response = await fetch('/api/auth/session');
      if (response.ok) {
        const session = await response.json();
        setSession(session);
      } else {
        redirectToCore();
      }
    } catch (error) {
      redirectToCore();
    } finally {
      setLoading(false);
    }
  }
  
  function redirectToCore() {
    const coreUrl = process.env.NEXT_PUBLIC_CORE_URL || 'http://localhost:3000';
    window.location.href = `${coreUrl}/dashboard`;
  }
  
  if (loading) {
    return <div>Loading...</div>;
  }
  
  if (!session) {
    return null; // Redirecting to core
  }
  
  return <>{children}</>;
}
```

### Step 4: API Route Handlers

```typescript
// /api/auth/callback/route.ts
import { NextRequest } from 'next/server';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';

export async function POST(req: NextRequest) {
  const { token, env } = await req.json();
  
  // Get environment-specific secret
  const secret = process.env[`CORE_SSO_SECRET_${env.toUpperCase()}`];
  
  if (!secret) {
    return Response.json({ error: 'Invalid environment' }, { status: 400 });
  }
  
  try {
    // Verify JWT from Core
    const decoded = jwt.verify(token, secret) as {
      user_id: string;
      email: string;
      tenant_id: string;
      tenant_slug: string;
      role: string;
    };
    
    // Create local session
    const session = {
      userId: decoded.user_id,
      email: decoded.email,
      tenantId: decoded.tenant_id,
      tenantSlug: decoded.tenant_slug,
      role: decoded.role,
    };
    
    // Store in HTTP-only cookie
    cookies().set('session', JSON.stringify(session), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    
    return Response.json(session);
  } catch (error) {
    console.error('Token verification failed:', error);
    return Response.json({ error: 'Invalid token' }, { status: 401 });
  }
}
```

```typescript
// /api/auth/session/route.ts
import { cookies } from 'next/headers';

export async function GET() {
  const sessionCookie = cookies().get('session');
  
  if (!sessionCookie) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }
  
  try {
    const session = JSON.parse(sessionCookie.value);
    return Response.json(session);
  } catch (error) {
    return Response.json({ error: 'Invalid session' }, { status: 401 });
  }
}
```

### Step 5: Database Middleware

```typescript
// lib/db-middleware.ts
import { createClient } from '@supabase/supabase-js';

export async function setTenantContext(tenantId: string, userId: string, role: string) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  
  // Set session variables for RLS policies
  await supabase.rpc('set_session_context', {
    p_tenant_id: tenantId,
    p_user_id: userId,
    p_role: role,
  });
}

// Database function to create (run this in your microservice DB):
/*
CREATE OR REPLACE FUNCTION set_session_context(
  p_tenant_id UUID,
  p_user_id UUID,
  p_role TEXT
) RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_tenant_id', p_tenant_id::TEXT, false);
  PERFORM set_config('app.current_user_id', p_user_id::TEXT, false);
  PERFORM set_config('app.user_role', p_role, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
*/
```

### Step 6: Register Event Subscription

In Core's Supabase database:

```sql
INSERT INTO public.event_subscriptions (
  name,
  endpoint_url,
  event_types,
  secret,
  is_active,
  max_attempts
) VALUES (
  'Your Microservice Name',
  'https://your-service.com/api/webhooks/core-events',
  ARRAY[
    'tenant.membership.*',
    'tenant.profile.updated',
    'tenant.created'
  ],
  'your-webhook-secret-from-env',
  true,
  5
);
```

### Step 7: Implement Webhook Handler

See [Event-Driven Architecture](#event-driven-architecture) section above.

---

## Testing Auth Locally

### 1. Start Local Environment

```bash
# Terminal 1: Start Core
cd summit-one-core
npm run dev

# Terminal 2: Start Supabase (if not running)
supabase start

# Terminal 3: Start Event Poller
supabase functions serve events-poller --env-file supabase/functions/events-poller/.env --no-verify-jwt

# Terminal 4: Start your microservice
cd your-microservice
npm run dev
```

### 2. Create Test Tenant & User

In Supabase Studio (http://127.0.0.1:54323):

```sql
-- Create tenant
INSERT INTO tenants (id, name, slug) VALUES 
('00000000-0000-0000-0000-000000000001', 'Test Org', 'test-org');

-- Create user (must match auth.users)
-- First sign up via Supabase Auth UI, then:
INSERT INTO tenant_memberships (tenant_id, user_id, role, status) VALUES 
('00000000-0000-0000-0000-000000000001', 'your-user-id-from-auth', 'owner', 'active');

-- Set active tenant
UPDATE profiles 
SET active_tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE id = 'your-user-id-from-auth';
```

### 3. Test SSO Flow

1. Login to Core at http://localhost:3000
2. Click button to open microservice (e.g., "Open HR App")
3. Core generates SSO token and redirects to: `http://localhost:3001/auth/callback?core_token=...&core_env=dev`
4. Microservice validates token and creates session
5. Verify you're logged in to microservice

### 4. Test Event Delivery

```sql
-- In Core DB, manually insert an event
INSERT INTO events_outbox (
  tenant_id,
  event_type,
  aggregate_type,
  aggregate_id,
  payload
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'tenant.membership.created',
  'tenant_membership',
  gen_random_uuid(),
  '{"user_id": "test", "role": "member"}'::jsonb
);

-- Wait up to 1 minute for poller to run
-- Check event_deliveries table
SELECT * FROM event_deliveries ORDER BY created_at DESC LIMIT 5;

-- Check your microservice webhook logs
```

---

## Common Patterns

### Syncing User Data

When Core emits `tenant.profile.updated`, sync to your microservice:

```typescript
async function handleProfileUpdated(payload: any) {
  const { user_id, email, first_name, last_name } = payload.new;
  
  await db.query(`
    INSERT INTO users (id, email, first_name, last_name)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      updated_at = NOW()
  `, [user_id, email, first_name, last_name]);
}
```

### Handling Membership Changes

```typescript
async function handleMembershipCreated(payload: any) {
  const { user_id, tenant_id, role } = payload;
  
  // Create local permissions record
  await db.query(`
    INSERT INTO user_permissions (user_id, tenant_id, role)
    VALUES ($1, $2, $3)
  `, [user_id, tenant_id, role]);
  
  // Send welcome email, provision resources, etc.
}
```

### Cross-Service Communication

Use events, not direct API calls:

```typescript
// ❌ BAD: Direct API call
await fetch('https://crm-service.com/api/customers', {
  method: 'POST',
  body: JSON.stringify({ name: 'Acme' })
});

// ✅ GOOD: Emit event
await db.query(`
  INSERT INTO events_outbox (tenant_id, event_type, payload)
  VALUES ($1, 'hr.employee.hired', $2)
`, [tenantId, { employee_id, start_date }]);

// CRM service will receive 'hr.employee.hired' event and react accordingly
```

---

## Troubleshooting

### Issue: "Invalid token" when redirecting to microservice

**Cause:** SSO secrets don't match between Core and microservice

**Fix:**
1. Check `.env.local` in Core for `NEXT_PUBLIC_SSO_SECRET_DEV`
2. Check microservice `.env` for `CORE_SSO_SECRET_DEV`
3. Ensure they are identical
4. Restart both services

### Issue: "Permission denied" errors in RLS policies

**Cause:** Tenant context not set or incorrect

**Debug:**
```sql
-- Check current session variables
SELECT 
  current_setting('app.current_tenant_id', true) as tenant_id,
  current_setting('app.current_user_id', true) as user_id,
  current_setting('app.user_role', true) as role;
```

**Fix:** Ensure middleware is calling `setTenantContext()` on every request

### Issue: Events not being delivered

**Checks:**
1. Is pg_cron job running?
   ```sql
   SELECT * FROM cron.job WHERE jobname = 'event-poller';
   ```

2. Are subscriptions active?
   ```sql
   SELECT * FROM event_subscriptions WHERE is_active = true;
   ```

3. Are there pending deliveries?
   ```sql
   SELECT * FROM event_deliveries 
   WHERE status IN ('pending', 'retrying')
   ORDER BY created_at DESC;
   ```

4. Check poller logs in terminal running `supabase functions serve`

### Issue: Duplicate event processing

**Cause:** Missing idempotency check

**Fix:** Always check `delivery_id` before processing:
```typescript
const existing = await db.query(
  'SELECT id FROM processed_events WHERE delivery_id = $1',
  [event.delivery_id]
);

if (existing.rows.length > 0) {
  return Response.json({ status: 'already_processed' });
}
```

### Issue: User can see data from other tenants

**CRITICAL:** This is a security breach!

**Immediate Actions:**
1. Check RLS is enabled: `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';`
2. Verify policies exist: `SELECT * FROM pg_policies WHERE tablename = 'your_table';`
3. Test with different tenant contexts
4. Review all queries to ensure they filter by `tenant_id`

---

## Security Checklist

Before deploying to production:

- [ ] All tables have `tenant_id` column
- [ ] RLS is enabled on all tables
- [ ] RLS policies filter by `tenant_id`
- [ ] SSO secrets are strong and unique per environment
- [ ] Webhook secrets are strong and unique
- [ ] HTTPS is enforced for all API endpoints
- [ ] JWT tokens expire (5 minutes for SSO tokens)
- [ ] Session cookies are HTTP-only and secure
- [ ] Idempotency checks prevent duplicate event processing
- [ ] HMAC signatures verified on all webhooks
- [ ] Service role keys are never exposed to frontend
- [ ] Database connection strings use SSL

---

## Additional Resources

- [MICROSERVICE_SETUP.md](./MICROSERVICE_SETUP.md) - Detailed microservice setup guide
- [EVENT_SYSTEM_SETUP.md](./EVENT_SYSTEM_SETUP.md) - Event system deployment guide
- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [JWT Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)

---

## Support

For questions or issues:
1. Check this documentation
2. Review the troubleshooting section
3. Check Supabase logs and Edge Function logs
4. Verify all environment variables are set correctly
