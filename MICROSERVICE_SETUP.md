# Summit One Microservice Setup Guide

**Complete guide for creating a new microservice in the Summit One ecosystem**

This document provides step-by-step instructions to create a new microservice that integrates seamlessly with Summit One Core. It includes all necessary code templates, migration patterns, and configuration details. This guide is designed to enable one-shot setup - everything you need is here.

---

## 📖 Table of Contents

### Getting Started
- [⚡ Quick Start (TL;DR)](#-quick-start-tldr) - Minimal steps for experienced devs
- [🏗️ Architecture Overview](#️-architecture-overview) - How Summit One works
- [🚀 Setup Checklist](#-quick-setup-checklist) - 9 phases to complete setup

### Implementation
- [Phase 1: Project Initialization](#phase-1-project-initialization-15-min)
- [Phase 2: Environment Setup](#phase-2-environment-setup-10-min)
- [Phase 3: Database Migrations](#phase-3-database-migrations-30-60-min)
- [Phase 4: File Structure](#phase-4-project-file-structure-10-min)
- [Phase 5: Authentication](#phase-5-authentication-implementation-45-min)
- [Phase 6: Webhooks](#phase-6-webhook-integration-25-min)
- [Phase 7: Business APIs](#phase-7-business-logic-apis-30-min)
- [Phase 8: Middleware](#phase-8-middleware-setup-15-min)
- [Phase 9: Testing](#phase-9-testing--validation-30-min)

### Resources
- [🔗 Core Integration](#-core-integration--service-registration) - Register your service
- [📋 Code Templates](#-complete-code-templates) - Copy-paste ready code
- [📊 Database Patterns](#-database-design-patterns) - Table designs
- [🔧 Configuration](#-configuration-files) - Config files
- [🚨 Troubleshooting](#-common-pitfalls--solutions) - Common issues
- [📋 Pre-Deployment](#-pre-deployment-checklist) - Production checklist
- [✅ Success Criteria](#-success-criteria) - When you're done

---



### Summit One Ecosystem
Summit One uses a **microservice architecture** where:
- **Core** (`localhost:3000`) - Central authentication, user management, tenant management
- **Microservices** (`localhost:3001+`) - Domain-specific services (Inventory, CRM, Finance, etc.)

### Key Principles

1. **Centralized Authentication**
   - Users authenticate ONLY with Core
   - Core issues JWT tokens containing user/tenant information
   - Microservices validate JWTs but don't manage users

2. **Multi-Tenancy**
   - Every data record belongs to a tenant
   - Row-Level Security (RLS) enforces tenant isolation at database level
   - No shared data between tenants

3. **Event-Driven Communication**
   - Core publishes events (tenant.created, user.updated, etc.)
   - Microservices subscribe via webhooks
   - Idempotency ensures duplicate events are ignored

4. **Database Isolation**
   - Each microservice has its own Supabase instance
   - Tenant data is synced via events
   - No direct database connections between services

### Technology Stack
- **Frontend**: Next.js 14+ (App Router)
- **Database**: Supabase (PostgreSQL + RLS + Auth)
- **Auth**: JWT tokens from Core's Supabase
- **Events**: HMAC-signed webhooks

---

## ⚡ Quick Start (TL;DR)

For AI agents or experienced developers, here's the absolute minimum to get started:

1. **Create Next.js project**: `npx create-next-app@latest summit-one-[SERVICE] --typescript --tailwind --app`
2. **Install deps**: `npm install @supabase/supabase-js jose jsonwebtoken`
3. **Init Supabase**: `npx supabase init` → Configure ports in `config.toml` → `npx supabase start`
4. **Create `.env.local`**: Copy Core's Supabase URL/key, set unique WEBHOOK_SECRET, match CORE_SSO_SECRET_DEV
5. **Migrations**: Create 6 migrations (schema, tenants, events, domain tables, RLS enable, RLS policies)
6. **Auth files**: Create auth-middleware.ts, db-middleware.ts, AuthGate.tsx, auth/callback/route.ts, auth/session/route.ts
7. **Webhooks**: Create api/webhooks/core-events/route.ts
8. **Middleware**: Create middleware.ts to inject tenant headers
9. **Layout**: Wrap app in AuthGate
10. **Register**: Add service to Core's navigation with SSO link

See full templates below for all file contents.

---

## 🚀 Quick Setup Checklist

### Phase 1: Project Initialization (15 min)

- [ ] **Create Next.js project**
  ```bash
  npx create-next-app@latest summit-one-[SERVICE_NAME] --typescript --tailwind --app
  cd summit-one-[SERVICE_NAME]
  ```
  Replace `[SERVICE_NAME]` with your service (e.g., `crm`, `finance`, `hr`)

- [ ] **Install required dependencies**
  ```bash
  npm install @supabase/supabase-js@^2.48.1 jose@^6.1.3 jsonwebtoken@^9.0.3 react-grid-layout@^1.3.4
  npm install -D @types/jsonwebtoken @types/react-grid-layout
  ```

- [ ] **Initialize Supabase**
  ```bash
  npx supabase init
  ```
  This creates `supabase/` folder with `config.toml`

- [ ] **Configure custom ports** (Edit `supabase/config.toml`)
  - **CRITICAL**: Each service needs unique ports to avoid conflicts
  - Core uses: API=54321, DB=54322, Studio=54323, Inbucket=54324
  - Choose ports for your service (e.g., 55321-55324, 56321-56324, etc.)
  - See "Port Configuration" section below for complete config

- [ ] **Start Supabase**
  ```bash
  npx supabase start
  ```
  Note the `anon key` and `service_role key` from output - you'll need these

### ================================
  # DATABASE - Local Supabase
  # ================================
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
  NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
  SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
  DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55322/postgres

  # ================================
  # CORE INTEGRATION
  # ================================
  # Core's API URL
  CORE_API_URL_DEV=http://localhost:3000
  NEXT_PUBLIC_CORE_URL=http://localhost:3000
  
  # Core's Supabase instance (for JWT validation)
  CORE_SUPABASE_URL=http://127.0.0.1:54321
  CORE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
  
  # SSO Secret - MUST MATCH Core's NEXT_PUBLIC_SSO_SECRET_DEV
  CORE_SSO_SECRET_DEV=dev-secret-key-change-in-production

  # ================================
  # WEBHOOK SECURITY
  # ================================
  # Shared secret for webhook HMAC signatures
  WEBHOOK_SECRET=[SERVICE_NAME]-webhook-secret-change-in-production

  # ================================
  # SERVICE IDENTIFICATION
  # ================================
  NEXT_PUBLIC_SERVICE_NAME=[Your Service Display Name]
  NEXT_PUBLIC_SERVICE_SLUG=[service-slug]
  NEXT_PUBLIC_ENV=dev
  ```

- [ ] **⚠️ CRITICAL: Environment Variable Setup**
  1. Get `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from `npx supabase status`
  2. Get Core's values by running `npx supabase status` in Core project
  3. **MUST MATCH**: `CORE_SSO_SECRET_DEV` = Core's `NEXT_PUBLIC_SSO_SECRET_DEV`
  4. Choose unique `WEBHOOK_SECRET` for this service
  5. Update `[SERVICE_NAME]`, `[Your Service Display Name]`, `[service-slug]`

- [ ] **⚠️ CRITICAL: Match SSO Secret**
  - `CORE_SSO_SECRET_DEV` MUST match Core's `NEXT_PUBLIC_SSO_SECRET_DEV`
  - This enables JWT validation across services

---

### 🎉 For Inventory Service: Production Migration Ready!

**The inventory service now has a production-ready migration:**

📄 **Migration File:** `supabase/migrations/20260116000000_production_inventory_hardening.sql`

This comprehensive migration includes:
- ✅ Ledger-first append-only design
- ✅ AI-assist layer (suggestions, aliases, decision traces)
- ✅ Safe RPCs for all operations
- ✅ Read models for frontend
- ✅ Full RLS + idempotency
- ✅ Events outbox integration

📚 **Documentation:**
- `PRODUCTION_INVENTORY_IMPLEMENTATION.md` - Complete testing guide
- `AI_AGENT_QUICK_REFERENCE.md` - AI agent integration guide

**To apply:**
```bash
npx supabase db reset  # Fresh start with new migration
# Or: npx supabase migration up
```

**Then test:**
```sql
-- Bootstrap your tenant
SELECT inventory.rpc_inventory_bootstrap_tenant(
    'your-tenant-id'::uuid,
    'your-user-id'::uuid
);
```

See `PRODUCTION_INVENTORY_IMPLEMENTATION.md` for complete testing checklist.

---

  -- Grant permissions
  GRANT USAGE ON SCHEMA [SERVICE] TO authenticated;
  GRANT USAGE ON SCHEMA [SERVICE] TO service_role;
  GRANT ALL ON ALL TABLES IN SCHEMA [SERVICE] TO service_role;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA [SERVICE] TO service_role;
  GRANT ALL ON ALL FUNCTIONS IN SCHEMA [SERVICE] TO service_role;

  -- Default privileges for future objects
  ALTER DEFAULT PRIVILEGES IN SCHEMA [SERVICE] 
      GRANT ALL ON TABLES TO service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA [SERVICE] 
      GRANT ALL ON SEQUENCES TO service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA [SERVICE] 
      GRANT ALL ON FUNCTIONS TO service_role;

  COMMENT ON SCHEMA [SERVICE] IS 'Microservice schema for [SERVICE_NAME]';
  ```

- [ ] **Migration 02: Tenants table** (`supabase/migrations/20260113000002_add_tenants_table.sql`)
  ```sql
  -- Synced from Core via webhooks
  CREATE TABLE IF NOT EXISTS public.tenants (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT,
      industry TEXT,
      address JSONB,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX idx_tenants_slug ON public.tenants(slug) WHERE slug IS NOT NULL;
  CREATE INDEX idx_tenants_synced_at ON public.tenants(synced_at DESC);

  GRANT SELECT ON public.tenants TO authenticated;
  GRANT ALL ON public.tenants TO service_role;

  COMMENT ON TABLE public.tenants IS 'Tenant data synced from Core via webhooks';
  ```

- [ ] **Migration 03: Event tracking** (`supabase/migrations/20260113000003_add_event_tracking.sql`)
  ```sql
  -- Idempotency tracking for webhook events
  CREATE TABLE IF NOT EXISTS public.processed_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      delivery_id UUID UNIQUE NOT NULL,
      event_type TEXT NOT NULL,
      tenant_id UUID NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      payload JSONB NULL,
      processing_time_ms INTEGER,
      status TEXT DEFAULT 'success' CHECK (status IN ('success', 'failed', 'skipped'))
  );

  CREATE INDEX idx_processed_events_delivery_id ON public.processed_events(delivery_id);
  CREATE INDEX idx_processed_events_event_type ON public.processed_events(event_type);
  CREATE INDEX idx_processed_events_processed_at ON public.processed_events(processed_at DESC);
  CREATE INDEX idx_processed_events_tenant_id ON public.processed_events(tenant_id) WHERE tenant_id IS NOT NULL;

  GRANT SELECT ON public.processed_events TO authenticated;
  GRANT ALL ON public.processed_events TO service_role;

  COMMENT ON TABLE public.processed_events IS 'Tracks processed webhook events for idempotency';
  
  -- Session context function (used by RLS policies)
  CREATE OR REPLACE FUNCTION public.set_session_context(
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

  COMMENT ON FUNCTION public.set_session_context IS 'Sets session variables for RLS policies';
  ```

- [ ] **Migration 04: Domain tables** (`supabase/migrations/20260113000004_create_domain_tables.sql`)
  
  **Create YOUR business logic tables here.** Example template:
  
  ```sql
  -- Example: CRM Contacts table (customize for your domain)
  CREATE TABLE [SERVICE].contacts (
      -- Primary key
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      
      -- Tenant isolation (REQUIRED)
      tenant_id UUID NOT NULL,
      
      -- Your domain fields
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      company TEXT,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
      tags TEXT[],
      custom_fields JSONB,
      
      -- Audit fields (REQUIRED)
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by UUID REFERENCES auth.users(id),
      updated_by UUID REFERENCES auth.users(id)
  );

  -- Required indexes for performance
  CREATE INDEX idx_contacts_tenant_id ON [SERVICE].contacts(tenant_id);
  CREATE INDEX idx_contacts_tenant_created ON [SERVICE].contacts(tenant_id, created_at DESC);
  CREATE INDEX idx_contacts_status ON [SERVICE].contacts(tenant_id, status);
  CREATE INDEX idx_contacts_email ON [SERVICE].contacts(email) WHERE email IS NOT NULL;

  -- Update trigger for updated_at
  CREATE OR REPLACE FUNCTION update_updated_at_column()
  RETURNS TRIGGER AS $$
  BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  CREATE TRIGGER update_contacts_updated_at 
      BEFORE UPDATE ON [SERVICE].contacts
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

  COMMENT ON TABLE [SERVICE].contacts IS 'Customer relationship contacts';
  ```
  
  **Repeat for each table in your domain**

- [ ] **Migration 05: Enable RLS** (`supabase/migrations/20260113000005_enable_rls.sql`)
  ```sql
  -- Enable Row Level Security on ALL tables
  ALTER TABLE [SERVICE].contacts ENABLE ROW LEVEL SECURITY;
  -- Add more tables as needed
  ```

- [ ] **Migration 06: RLS Policies** (`supabase/migrations/20260113000006_create_rls_policies.sql`)
  ```sql
  -- CRITICAL: Every table needs tenant isolation policy
  
  -- Basic tenant isolation (all operations)
  CREATE POLICY contacts_tenant_isolation ON [SERVICE].contacts
      FOR ALL
      USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

  -- Optional: More granular policies by operation
  CREATE POLICY contacts_select ON [SERVICE].contacts
      FOR SELECT
      USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

  CREATE POLICY contacts_insert ON [SERVICE].contacts
      FOR INSERT
      WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

  CREATE POLICY contacts_update ON [SERVICE].contacts
      FOR UPDATE
      USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
      WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

  -- Optional: Role-based access control
  CREATE POLICY contacts_delete_admin_only ON [SERVICE].contacts
      FOR DELETE
      USING (
          tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
          AND (auth.jwt() -> 'app_metadata' ->> 'role') IN ('admin', 'owner')
      );

  -- Repeat for all tables
  ```

- [ ] **Run migrations**
  ```bash
  npx supabase db reset  # Fresh start
  # Or: npx supabase migration up
  ```

### Phase 4: Project File Structure (10 min)

Create this exact folder structure:

```
summit-one-[SERVICE]/
├── .env.local                          # ✅ Created in Phase 2
├── next.config.ts
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── supabase/
│   ├── config.toml                     # ✅ Configured in Phase 1
│   └── migrations/                     # ✅ Created in Phase 3
│       ├── 20260113000001_init_schema.sql
│       ├── 20260113000002_add_tenants_table.sql
│       ├── 20260113000003_add_event_tracking.sql
│       ├── 20260113000004_create_domain_tables.sql
│       ├── 20260113000005_enable_rls.sql
│       └── 20260113000006_create_rls_policies.sql
├── src/
│   ├── lib/
│   │   ├── auth-middleware.ts          # ⬅️ Create next
│   │   ├── db-middleware.ts            # ⬅️ Create next
│   │   └── utils.ts                    # Optional
│   ├── components/
│   │   └── AuthGate.tsx                # ⬅️ Create next
│   ├── app/
│   │   ├── globals.css
│   │   ├── layout.tsx                  # ⬅️ Modify to wrap with AuthGate
│   │   ├── page.tsx                    # Your dashboard/home page
│   │   ├── auth/
│   │   │   └── callback/
│   │   │       └── route.ts            # ⬅️ Create next - SSO callback
│   │   └── api/
│   │       ├── auth/
│   │       │   └── session/
│   │       │       └── route.ts        # ⬅️ Create next - Session check
│   │       ├── webhooks/
│   │       │   └── core-events/
│   │       │       └── route.ts        # ⬅️ Create next - Webhook receiver
│   │       └── [your-domain]/          # Your business logic APIs
│   │           └── route.ts
└── README.md
```

- [ ] **Verify folder structure** matches above

### Phase 5: Authentication Implementation (45 min)

Follow this order to create all auth-related files:

#### Step 1: Auth Middleware (`src/lib/auth-middleware.ts`)

- [ ] **Create `src/lib/auth-middleware.ts`** - Copy template from "Auth Middleware Template" section below

**What it does:**
- Validates JWT tokens from Authorization headers
- Extracts user/tenant info from JWT claims
- Verifies token with Core's Supabase instance

#### Step 2: Database Middleware (`src/lib/db-middleware.ts`)

- [ ] **Create `src/lib/db-middleware.ts`** - Copy template from "Database Middleware Template" section below

**What it does:**
- Helper functions to get tenant/user from headers
- Session context management for RLS
- Supabase client creation

#### Step 3: Auth Callback Route (`src/app/auth/callback/route.ts`)

- [ ] **Create `src/app/auth/callback/route.ts`** - Copy template from "Auth Callback Template" section below

**What it does:**
- Receives SSO redirect from Core with `core_token` parameter
- Validates token with Core
- Creates local session cookie
- Redirects to dashboard

#### Step 4: Session Route (`src/app/api/auth/session/route.ts`)

- [ ] **Create `src/app/api/auth/session/route.ts`** - Copy template from "Session API Template" section below

**What it does:**
- Returns current session information
- Used by AuthGate to check authentication status
- Handles session validation and expiry

#### Step 5: AuthGate Component (`src/components/AuthGate.tsx`)

- [ ] **Create `src/components/AuthGate.tsx`** - Copy template from "AuthGate Template" section below

**What it does:**
- Client-side auth guard
- Checks for valid session on mount
- Redirects to Core if not authenticated
- Shows loading state during auth check

#### Step 6: Update Layout (`src/app/layout.tsx`)

- [ ] **Wrap your app with AuthGate**
  ```tsx
  import type { Metadata } from 'next';
  import { AuthGate } from '@/components/AuthGate';
  import './globals.css';

  export const metadata: Metadata = {
    title: process.env.NEXT_PUBLIC_SERVICE_NAME || 'Summit One Service',
    description: 'Summit One Microservice',
  };

  export default function RootLayout({
    children,
  }: {
    children: React.ReactNode;
  }) {
    return (
      <html lang="en">
        <body>
          <AuthGate>
            {children}
          </AuthGate>
        </body>
      </html>
    );
  }
  ```

### Phase 6: Webhook Integration (25 min)

#### Step 1: Create Webhook Endpoint (`src/app/api/webhooks/core-events/route.ts`)

- [ ] **Create `src/app/api/webhooks/core-events/route.ts`** - Copy template from "Webhook Endpoint Template" section below

**What it does:**
- Receives events from Core (tenant.created, tenant.updated, etc.)
- Verifies HMAC signature for security
- Checks idempotency using `processed_events` table
- Processes events and syncs data

**Common events to handle:**
- `tenant.created` - New tenant registered, create local record
- `tenant.updated` - Tenant info changed, update local record
- `tenant.deleted` - Tenant removed, handle cleanup
- `user.updated` - User info changed (optional)
- Custom events specific to your domain

#### Step 2: Register Webhook in Core

- [ ] **Add webhook subscription in Core's database**
  
  Run this SQL in Core's Supabase:
  ```sql
  -- Check if event_subscriptions table exists
  SELECT * FROM event_subscriptions WHERE name = '[Your Service Name]';
  
  -- If not exists, insert:
  INSERT INTO event_subscriptions (
      name,
      endpoint_url,
      secret,
      event_types,
      active,
      retry_config
  ) VALUES (
      '[Your Service Name]',  -- e.g., 'CRM Service'
      'http://localhost:3001/api/webhooks/core-events',  -- Your service URL
      '[WEBHOOK_SECRET from .env]',  -- Same as your WEBHOOK_SECRET
      ARRAY['tenant.created', 'tenant.updated', 'tenant.deleted'],  -- Events to receive
      true,
      '{"max_retries": 3, "retry_delay_seconds": 60}'::jsonb
  );
  ```

- [ ] **Verify webhook registration**
  ```sql
  SELECT id, name, endpoint_url, event_types, active 
  FROM event_subscriptions 
  WHERE active = true;
  ```

### Phase 7: Business Logic APIs (30 min)

Create your domain-specific API routes following tenant-isolated patterns.

- [ ] **Create example API route** (`src/app/api/[your-resource]/route.ts`)

**Example: CRM Contacts API**

Create `src/app/api/contacts/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, getUserIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@supabase/supabase-js';

// GET /api/contacts - List contacts for authenticated tenant
export async function GET(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  const userId = getUserIdFromHeaders(request.headers);
  
  if (!tenantId || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    const 8: Middleware Setup (15 min)

Create Next.js middleware to inject tenant context into requests.

- [ ] **Create `src/middleware.ts`** in project root:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  // Skip middleware for public routes
  const publicPaths = ['/auth/callback', '/api/webhooks'];
  const isPublicPath = publicPaths.some(path => 
    request.nextUrl.pathname.startsWith(path)
  );
  
  if (isPublicPath) {
    return NextResponse.next();
  }
  
  // Check for session cookie
  const sessionCookie = request.cookies.get('session');
  
  if (!sessionCookie) {
    // Not authenticated - redirect to Core
    const coreUrl = process.env.NEXT_PUBLIC_CORE_URL || 'http://localhost:3000';
    return NextResponse.redirect(`${coreUrl}/dashboard`);
  }
  
  try {
    const session = JSON.parse(sessionCookie.value);
    
    // Add tenant/user info to request headers for API routes
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-tenant-id', session.tenantId);
    requestHeaders.set('x-user-id', session.userId);
    requestHeaders.set('x-user-role', session.role);
    
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } catch (error) {
    console.error('Session parse error:', error);
    const coreUrl = process.env.NEXT_PUBLIC_CORE_URL || 'http://localhost:3000';
    return NextResponse.redirect(`${coreUrl}/dashboard`);
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)',
  ],
};
```

**What this does:**
- Checks for session cookie on all routes
- Redirects to Core if not authenticated
- Injects `x-tenant-id`, `x-user-id`, `x-user-role` headers
- Allows public paths (auth callback, webhooks) to skip auth check
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    
    // CRITICAL: Always filter by tenant_id
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    return NextResponse.json({ 
      data,
      meta: { tenantId, count: data?.length || 0 }
    });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contacts' },
      { status: 500 }
    );
  }
}

// POST /api/contacts - Create new contact
export async function POST(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  const userId = getUserIdFromHeaders(request.headers);
  
  if (!tenantId || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    const body = await request.json();
    const { first_name, last_name, email, phone, company } = body;
    
    // Validate required fields
    if (!first_name || !last_name) {
      return NextResponse.json(
        { error: 'First name and last name are required' },
        { status: 400 }
      );
    }
    
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    
    // CRITICAL: Always set tenant_id and created_by
    const { data, error } = await supabase
      .from('contacts')
      .insert({
        tenant_id: tenantId,
        first_name,
        last_name,
        email,
        phone,
        company,
        created_by: userId,
        updated_by: userId
      })
      .select()
      .single();
    
    if (error) throw error;
    
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error('Error creating contact:', error);
    return NextResponse.json(
      { error: 'Failed to create contact' },
      { status: 500 }
    );
  }
}
```

**Key Patterns:**
1. Always get `tenantId` from headers
2. Always filter queries by `tenant_id`
3. Always set `tenant_id` on INSERT
4. Track `created_by` and `updated_by`
5. Return proper HTTP status codes
6. Handle errors gracefully

- [ ] **Create API routes for each resource** in your domain
- [ ] **Follow the tenant isolation pattern** shown above

### Phase 7: Testing & Validation (20 min)

### Phase 9: Testing & Validation (30 min)

#### Test 1: SSO Authentication Flow

- [ ] **Start all services**
  ```bash
  # Terminal 1: Core
  cd summit-one-core
  npx supabase start
  npm run dev

  # Terminal 2: Your microservice
  cd summit-one-[SERVICE]
  npx supabase start
  npm run dev
  ```

- [ ] **Test SSO redirect**
  1. Login to Core at http://localhost:3000
  2. In Core, add a link to your service: `http://localhost:3001?core_token={TOKEN}&core_env=dev`
  3. Click the link
  4. Should redirect and authenticate automatically
  5. Check cookies in DevTools - should see `session` cookie

- [ ] **Verify session persistence**
  1. Refresh the page
  2. Should remain authenticated (not redirect to Core)
  3. Navigate to different pages
  4. Session should persist

#### Test 2: Tenant Isolation

- [ ] **Create test data for multiple tenants**
  ```sql
  -- In your service's Supabase Studio
  
  -- Insert test data for Tenant A
  INSERT INTO [SCHEMA].contacts (tenant_id, first_name, last_name, email)
  VALUES 
    ('tenant-a-uuid', 'Alice', 'Anderson', 'alice@tenant-a.com'),
    ('tenant-a-uuid', 'Bob', 'Brown', 'bob@tenant-a.com');
  
  -- Insert test data for Tenant B
  INSERT INTO [SCHEMA].contacts (tenant_id, first_name, last_name, email)
  VALUES 
    ('tenant-b-uuid', 'Charlie', 'Chen', 'charlie@tenant-b.com'),
    ('tenant-b-uuid', 'Diana', 'Davis', 'diana@tenant-b.com');
  ```

- [ ] **Test RLS policies**
  1. Login as Tenant A user
  2. Query `/api/contacts`
  3. Should only see Alice and Bob
  4. Login as Tenant B user
  5. Should only see Charlie and Diana

- [ ] **Test API security**
  ```bash
  # Try to access without auth
  curl http://localhost:3001/api/contacts
  # Should return 401

  # Try with session cookie (get from browser DevTools)
  curl http://localhost:3001/api/contacts -H "Cookie: session=..."
  # Should return data for that tenant only
  ```

#### Test 3: Webhook Processing

- [ ] **Send test webhook**
  ```bash
  # Create test event payload
  curl -X POST http://localhost:3001/api/webhooks/core-events \
    -H "Content-Type: application/json" \
    -H "x-event-type: tenant.created" \
    -H "x-event-signature: sha256=$(echo -n '{"payload":{"id":"test-tenant","name":"Test Tenant"}}' | openssl dgst -sha256 -hmac 'your-webhook-secret' | awk '{print $2}')" \
    -d '{"payload":{"id":"test-tenant","name":"Test Tenant"}}'
  ```

- [ ] **Verify processing**
  ```sql
  -- Check processed_events table
  SELECT * FROM public.processed_events ORDER BY processed_at DESC LIMIT 10;
  
  -- Check tenants table
  SELECT * FROM public.tenants WHERE id = 'test-tenant';
  ```

- [ ] **Test idempotency**
  1. Send same webhook again (same delivery_id)
  2. Should return `already_processed`
  3. Check processed_events - should still have only one record

#### Test 4: Error Scenarios

- [ ] **Expired JWT**
  1. Create session with past expiry
  2. Try to access protected route
  3. Should redirect to Core

- [ ] **Missing tenant_id**
  1. Try API request without session
  2. Should return 401 Unauthorized

- [ ] **Invalid webhook signature**
  1. Send webhook with wrong signature
  2. Should return 401 Invalid signature

- [ ] **RLS policy enforcement**
  1. Try to insert data with wrong tenant_id
  2. Should be blocked by RLS policy

---

---

## 🔗 Core Integration & Service Registration

### Register Service in Core

Your microservice needs to be registered in Summit One Core so users can access it.

#### Option 1: Add Navigation Link in Core

Edit Core's navigation to include your service:

```typescript
// In Core: src/components/layout/Sidebar.tsx (or similar)
const services = [
  {
    name: 'Inventory',
    href: generateServiceURL('inventory', user),
    icon: PackageIcon,
  },
  {
    name: 'Your Service Name',
    href: generateServiceURL('[SERVICE_SLUG]', user),
    icon: YourIcon,
  },
  // ...
];

function generateServiceURL(serviceSlug: string, user: any) {
  const services = {
    'inventory': 'http://localhost:3001',
    '[SERVICE_SLUG]': 'http://localhost:3001', // Update port
  };
  
  const baseURL = services[serviceSlug];
  const token = generateSSO Token(user); // Core's SSO function
  
  return `${baseURL}?core_token=${token}&core_env=dev`;
}
```

#### Option 2: Services Registry Table

If Core has a services registry:

```sql
-- In Core's Supabase
INSERT INTO services (
  name,
  slug,
  url_dev,
  url_prod,
  webhook_secret,
  icon,
  description,
  active
) VALUES (
  'Your Service Name',
  '[SERVICE_SLUG]',
  'http://localhost:3001',
  'https://[SERVICE].summit-one.app',
  '[WEBHOOK_SECRET]',
  'IconName',
  'Service description',
  true
);
```

### Core Event Types Reference

Events your service might receive from Core:

| Event Type | Description | Payload Fields |
|------------|-------------|----------------|
| `tenant.created` | New tenant registered | `id`, `name`, `slug`, `industry` |
| `tenant.updated` | Tenant info changed | `id`, `name`, `slug`, `industry` |
| `tenant.deleted` | Tenant removed | `id` |
| `tenant.membership.created` | User added to tenant | `tenant_id`, `user_id`, `role` |
| `tenant.membership.updated` | User role changed | `tenant_id`, `user_id`, `role` |
| `tenant.membership.removed` | User removed from tenant | `tenant_id`, `user_id` |
| `user.updated` | User profile changed | `id`, `email`, `full_name` |
| `user.deleted` | User account deleted | `id` |

### JWT Claims Reference

Token from Core contains these claims:

```json
{
  "sub": "user-uuid",                    // User ID
  "email": "user@example.com",
  "tenant_id": "tenant-uuid",            // Current tenant
  "app_metadata": {
    "tenant_id": "tenant-uuid",
    "role": "admin|manager|user",        // User's role in tenant
    "modules": ["inventory", "crm"],     // Enabled modules
    "permissions": ["read", "write"]     // Optional: Granular permissions
  },
  "user_metadata": {
    "full_name": "John Doe",
    "avatar_url": "https://..."
  },
  "iss": "https://core.summit-one.app",
  "aud": "authenticated",
  "exp": 1234567890,                     // Expiration timestamp
  "iat": 1234567800                      // Issued at timestamp
}
```

---

## 📊 Database Design Patterns

### Required Fields on Every Table

```sql
CREATE TABLE [SCHEMA].[TABLE_NAME] (
    -- Primary key
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Tenant isolation (MANDATORY)
    tenant_id UUID NOT NULL,
    
    -- Your business fields
    -- ...
    
    -- Audit fields (MANDATORY)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id),
    
    -- Optional but recommended
    deleted_at TIMESTAMPTZ,  -- For soft deletes
    version INTEGER DEFAULT 1  -- For optimistic locking
);

-- Required indexes
CREATE INDEX idx_[TABLE]_tenant ON [SCHEMA].[TABLE_NAME](tenant_id);
CREATE INDEX idx_[TABLE]_tenant_created ON [SCHEMA].[TABLE_NAME](tenant_id, created_at DESC);

-- Optional indexes
CREATE INDEX idx_[TABLE]_created_by ON [SCHEMA].[TABLE_NAME](created_by);
CREATE INDEX idx_[TABLE]_deleted ON [SCHEMA].[TABLE_NAME](tenant_id, deleted_at) WHERE deleted_at IS NULL;
```

### Common Table Patterns

#### 1. Reference Data (Categories, Types, etc.)

```sql
CREATE TABLE [SCHEMA].categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    parent_id UUID REFERENCES [SCHEMA].categories(id),
    sort_order INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id),
    
    UNIQUE(tenant_id, slug)  -- Unique slug per tenant
);
```

#### 2. Transactional Data (Orders, Invoices, etc.)

```sql
CREATE TABLE [SCHEMA].orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    order_number TEXT NOT NULL,
    customer_id UUID REFERENCES [SCHEMA].customers(id),
    status TEXT NOT NULL CHECK (status IN ('draft', 'pending', 'confirmed', 'cancelled')),
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    notes TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    updated_by UUID REFERENCES auth.users(id),
    
    UNIQUE(tenant_id, order_number)
);

-- Line items
CREATE TABLE [SCHEMA].order_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    order_id UUID NOT NULL REFERENCES [SCHEMA].orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES [SCHEMA].products(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(12,2) NOT NULL,
    line_total DECIMAL(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 3. Activity/Audit Log

```sql
CREATE TABLE [SCHEMA].activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID REFERENCES auth.users(id),
    action TEXT NOT NULL,  -- 'created', 'updated', 'deleted', etc.
    entity_type TEXT NOT NULL,  -- 'contact', 'order', etc.
    entity_id UUID NOT NULL,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_log_tenant_created ON [SCHEMA].activity_log(tenant_id, created_at DESC);
CREATE INDEX idx_activity_log_entity ON [SCHEMA].activity_log(entity_type, entity_id);
```

---

## 🔧 Configuration Files

### Port Configuration

### Auth Callback Template

**Create `src/app/auth/callback/route.ts`:**

```typescript
/**
 * SSO Callback Route
 * Receives core_token from Summit One Core and creates local session
 */
import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

interface TokenPayload {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
  fullName: string;
  exp: number;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const coreToken = searchParams.get('core_token');
  const coreEnv = searchParams.get('core_env') || 'dev';
  
  if (!coreToken) {
    return NextResponse.json(
      { error: 'Missing core_token parameter' },
      { status: 400 }
    );
  }
  
  try {
    // Get SSO secret based on environment
    const ssoSecret = coreEnv === 'dev' 
      ? process.env.CORE_SSO_SECRET_DEV
      : process.env.CORE_SSO_SECRET_PROD;
    
    if (!ssoSecret) {
      console.error('SSO secret not configured');
      return NextResponse.json(
        { error: 'SSO not configured' },
        { status: 500 }
      );
    }
    
    // Verify and decode JWT
    const secretKey = new TextEncoder().encode(ssoSecret);
    const { payload } = await jwtVerify(coreToken, secretKey);
    
    const tokenData = payload as unknown as TokenPayload;
    
    // Validate required fields
    if (!tokenData.userId || !tokenData.tenantId) {
      return NextResponse.json(
        { error: 'Invalid token payload' },
        { status: 400 }
      );
    }
    
    // Create session object
    const session = {
      userId: tokenData.userId,
      email: tokenData.email,
      tenantId: tokenData.tenantId,
      role: tokenData.role || 'user',
      fullName: tokenData.fullName,
      expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
    };
    
    // Create response with session cookie
    const response = NextResponse.redirect(new URL('/', request.url));
    
    response.cookies.set('session', JSON.stringify(session), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    });
    
    return response;
  } catch (error) {
    console.error('SSO callback error:', error);
    
    // Redirect back to Core on error
    const coreUrl = process.env.NEXT_PUBLIC_CORE_URL || 'http://localhost:3000';
    return NextResponse.redirect(`${coreUrl}/dashboard?error=sso_failed`);
  }
}
```

---

### Session API Template

**Create `src/app/api/auth/session/route.ts`:**

```typescript
/**
 * Session API Route
 * Returns current session info or 401 if not authenticated
 */
import { NextRequest, NextResponse } from 'next/server';

interface Session {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
  fullName: string;
  expiresAt: number;
}

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get('session');
  
  if (!sessionCookie) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }
  
  try {
    const session: Session = JSON.parse(sessionCookie.value);
    
    // Check if session is expired
    if (session.expiresAt < Date.now()) {
      return NextResponse.json(
        { error: 'Session expired' },
        { status: 401 }
      );
    }
    
    // Return session info (exclude sensitive data if needed)
    return NextResponse.json({
      userId: session.userId,
      email: session.email,
      tenantId: session.tenantId,
      role: session.role,
      fullName: session.fullName,
    });
  } catch (error) {
    console.error('Session parse error:', error);
    return NextResponse.json(
      { error: 'Invalid session' },
      { status: 401 }
    );
  }
}

// Optional: DELETE to logout
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  
  response.cookies.set('session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  
  return response;
}
```

---

### Auth Middleware Template

**Create `src/lib/auth-middleware.ts`:**

```typescript
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: string;
  modules: string[];
  email?: string;
}

function decodeJwtPayload(token: string): any {
  const payloadPart = token.split('.')[1];
  if (!payloadPart) return null;
  
  try {
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (error) {
    console.error('Failed to decode JWT:', error);
    return null;
  }
}

export async function validateJWT(request: NextRequest): Promise<AuthContext | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  const authUrl = process.env.CORE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const authAnonKey = process.env.CORE_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const supabase = createClient(authUrl!, authAnonKey!, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const jwtPayload = decodeJwtPayload(token);
  const tenantId = user.app_metadata?.tenant_id ?? jwtPayload?.tenant_id;
  const role = user.app_metadata?.role ?? 'user';
  const modules = user.app_metadata?.modules ?? [];

  if (!tenantId) return null;

  return {
    userId: user.id,
    tenantId,
    role,
    modules,
    email: user.email
  };
}
```

### Database Middleware Template

Copy this to `src/lib/db-middleware.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';

export interface SessionContext {
  tenantId: string;
  userId: string;
  role: string;
}

export async function setTenantContext(context: SessionContext) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  
  const { error } = await supabase.rpc('set_session_context', {
    p_tenant_id: context.tenantId,
    p_user_id: context.userId,
    p_role: context.role,
  });
  
  if (error) throw error;
}

export function getTenantIdFromHeaders(headers: Headers): string | null {
  return headers.get('x-tenant-id');
}

export function getUserIdFromHeaders(headers: Headers): string | null {
  return headers.get('x-user-id');
}
```

### Webhook Endpoint Template

Copy this to `src/app/api/webhooks/core-events/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';

export async function POST(req: NextRequest) {
  try {
    // 1. Verify HMAC signature
    const signature = req.headers.get('x-event-signature');
    const eventType = req.headers.get('x-event-type');
    const rawBody = await req.text();
    
    if (!signature || !eventType) {
      return NextResponse.json({ error: 'Missing headers' }, { status: 400 });
    }
    
    const hmac = createHmac('sha256', process.env.WEBHOOK_SECRET!);
    const expectedSignature = 'sha256=' + hmac.update(rawBody).digest('hex');
    
    if (signature !== expectedSignature) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
    
    const body = JSON.parse(rawBody);
    const payload = body.payload;
    const deliveryId = body.delivery_id || `${eventType}-${Date.now()}`;
    
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    
    // 2. Check idempotency
    const { data: existing } = await supabase
      .from('processed_events')
      .select('id')
      .eq('delivery_id', deliveryId)
      .single();
    
    if (existing) {
      return NextResponse.json({ status: 'already_processed' });
    }
    
    // 3. Process event
    await processEvent(supabase, eventType, payload);
    
    // 4. Record processing
    await supabase.from('processed_events').insert({
      delivery_id: deliveryId,
      event_type: eventType,
      tenant_id: payload?.tenant_id || null,
      payload: payload,
    });
    
    return NextResponse.json({ status: 'processed' });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

async function processEvent(supabase: any, eventType: string, payload: any) {
  switch (eventType) {
    case 'tenant.created':
      await supabase.from('tenants').upsert({
        id: payload.id,
        name: payload.name,
        slug: payload.slug,
        synced_at: new Date().toISOString()
      });
      break;
    
    case 'tenant.updated':
      await supabase.from('tenants').update({
        name: payload.name,
        slug: payload.slug,
        synced_at: new Date().toISOString()
      }).eq('id', payload.id);
      break;
  }
}
```

### AuthGate Component Template

Copy this to `src/components/AuthGate.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    checkSession();
  }, []);
  
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
  
  return <>{children}</>;
}
```

---

## 🔧 Port Configuration

Edit `supabase/config.toml` to use unique ports (avoid conflicts with Core):

```toml
[api]
port = 55321  # Choose unused port

[db]
port = 55322  # Choose unused port

[studio]
port = 55323  # Choose unused port

[inbucket]
port = 55324  # Choose unused port
```

---

## 📊 Database Best Practices

### Required Fields on Every Table

```sql
CREATE TABLE my_service.my_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,  -- ✅ CRITICAL
  
  -- Your domain fields here
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  
  -- Audit fields (ALWAYS include)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);

-- Required indexes
CREATE INDEX idx_my_table_tenant_id ON my_service.my_table(tenant_id);
CREATE INDEX idx_my_table_created_at ON my_service.my_table(tenant_id, created_at DESC);
```

### RLS Policy Pattern

Every table needs tenant isolation:

```sql
-- Enable RLS
ALTER TABLE my_service.my_table ENABLE ROW LEVEL SECURITY;

-- Basic tenant isolation (REQUIRED)
CREATE POLICY my_table_tenant_isolation ON my_service.my_table
  FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Optional: Role-based access
CREATE POLICY my_table_admin_all ON my_service.my_table
  FOR ALL
  USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

CREATE POLICY my_table_user_read ON my_service.my_table
  FOR SELECT
  USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
  );
```

---

## 🔐 Security Checklist

- [ ] **All tables have `tenant_id` column**
- [ ] **All tables have RLS enabled**
- [ ] **All tables have tenant isolation policy**
- [ ] **All API routes filter by tenant_id**
- [ ] **JWT validation on all protected routes**
- [ ] **Webhook signature verification**
- [ ] **Service role key only used server-side**
- [ ] **No hardcoded secrets (use .env)**
- [ ] **CORS properly configured**
- [ ] **Error messages don't leak sensitive data**

---

## 🧪 Testing Checklist

### Auth Testing
- [ ] SSO redirect works from Core
- [ ] Session persists across page refreshes
- [ ] Invalid JWT returns 401
- [ ] Expired session redirects to Core

### Tenant Isolation Testing
- [ ] Create test data for Tenant A
- [ ] Log in as Tenant B user
- [ ] Verify Tenant B cannot see Tenant A data
- [ ] Try direct API calls with wrong tenant_id

### Webhook Testing
- [ ] Send test webhook from Core
- [ ] Verify signature validation
- [ ] Test duplicate delivery (idempotency)
- [ ] Test invalid signature (should reject)

---

## 📦 Package.json Scripts

Add these helpful scripts:

```json
{
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "sb:start": "supabase start",
    "sb:stop": "supabase stop --no-backup",
    "sb:reset": "supabase db reset",
    "sb:status": "supabase status",
    "dev:all": "npm run sb:start && npm run dev"
  }
}
```

---

## 🚨 Common Pitfalls & Solutions

### Authentication Issues

#### Issue: SSO redirect fails with "Invalid signature"
**Solution**: 
- Verify `CORE_SSO_SECRET_DEV` matches Core's `NEXT_PUBLIC_SSO_SECRET_DEV` exactly
- Check there are no extra spaces or newlines in .env values
- Restart both Core and microservice after changing secrets

#### Issue: Session cookie not persisting
**Solution**:
- Check cookie settings in auth/callback/route.ts
- Ensure `httpOnly: true`, `secure: false` (dev), `sameSite: 'lax'`
- Clear browser cookies and try again
- Check browser DevTools → Application → Cookies

#### Issue: "Not authenticated" on every request
**Solution**:
- Verify middleware.ts is reading session cookie correctly
- Check session expiry hasn't passed
- Ensure middleware isn't blocking auth callback route
- Check middleware config matcher pattern

### Database/RLS Issues

#### Issue: RLS blocks all queries even with valid JWT
**Solution**:
- Check JWT claim structure matches RLS policies
- Policy uses: `(auth.jwt() ->> 'tenant_id')::uuid`
- Core's JWT should have `tenant_id` at root level OR in `app_metadata`
- Use Supabase SQL Editor to test: `SELECT auth.jwt()` to see actual claims

#### Issue: Can see other tenants' data
**Solution**:
- **CRITICAL SECURITY ISSUE** - Fix immediately
- Verify RLS is enabled: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- Check policies exist: `SELECT * FROM pg_policies WHERE tablename = 'your_table'`
- Test with different tenant users
- Always filter by tenant_id in queries even with RLS

#### Issue: "permission denied for schema"
**Solution**:
- Grant schema usage: `GRANT USAGE ON SCHEMA [SCHEMA] TO authenticated`
- Grant table access: `GRANT SELECT, INSERT, UPDATE, DELETE ON [TABLE] TO authenticated`
- Check service_role has ALL privileges

### Webhook Issues

#### Issue: Webhooks not being received
**Solution**:
- Check webhook endpoint is registered in Core's event_subscriptions table
- Verify URL is correct and accessible from Core
- Check firewall/network isn't blocking requests
- Test manually with curl to verify endpoint works

#### Issue: Webhook signature validation fails
**Solution**:
- Verify `WEBHOOK_SECRET` matches Core's subscription secret exactly
- Check signature header format: `x-event-signature: sha256=<hash>`
- Test HMAC generation: signature should be hex digest of rawBody
- Don't parse JSON before verification - use raw body text

#### Issue: Events being processed multiple times
**Solution**:
- Check idempotency logic using delivery_id
- Verify processed_events table has UNIQUE constraint on delivery_id
- Check for race conditions in concurrent webhook processing
- Ensure delivery_id is being extracted correctly from webhook payload

### Performance Issues

#### Issue: Queries are slow
**Solution**:
- Add indexes on tenant_id: `CREATE INDEX ON table(tenant_id)`
- Add compound indexes: `CREATE INDEX ON table(tenant_id, created_at DESC)`
- Use EXPLAIN ANALYZE to find slow queries
- Consider partitioning large tables by tenant_id

#### Issue: Too many database connections
**Solution**:
- Don't create new Supabase client on every request
- Use connection pooling
- Close connections properly
- Use service_role key only when needed

### Development Issues

#### Issue: Port conflicts
**Solution**:
- Check which ports are in use: `netstat -ano | findstr :5432` (Windows) or `lsof -i :5432` (Mac/Linux)
- Update supabase/config.toml with unique ports
- Stop all Supabase instances: `npx supabase stop` in all projects
- Start again with custom ports

#### Issue: Migrations fail
**Solution**:
- Check migration syntax in Supabase Studio SQL editor first
- Run migrations in order (check timestamps)
- Use `npx supabase db reset` to start fresh
- Check migration status: `npx supabase migration list`

#### Issue: Can't access Supabase Studio
**Solution**:
- Check if Supabase is running: `npx supabase status`
- Verify port in browser URL matches config.toml
- Try `npx supabase stop` then `npx supabase start`
- Check Docker is running

---

## 📋 Pre-Deployment Checklist

### Security
- [ ] All environment variables use production secrets (not dev defaults)
- [ ] `WEBHOOK_SECRET` is strong and unique
- [ ] `CORE_SSO_SECRET` matches production Core
- [ ] Database credentials are rotated from defaults
- [ ] API keys are not committed to git (.env.local in .gitignore)
- [ ] CORS configured correctly (only allow Core domain)
- [ ] Rate limiting enabled on public endpoints
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (sanitize inputs)

### Database
- [ ] All tables have RLS enabled
- [ ] All tables have tenant isolation policies
- [ ] Indexes created for performance
- [ ] Backups configured
- [ ] Migration rollback plan exists
- [ ] Database monitoring set up

### Application
- [ ] Error logging configured (Sentry, LogRocket, etc.)
- [ ] Performance monitoring enabled
- [ ] Health check endpoint created (`/api/health`)
- [ ] Graceful shutdown handling
- [ ] Session timeout appropriate for use case
- [ ] Cookie settings use `secure: true` in production

### Testing
- [ ] Unit tests for business logic
- [ ] Integration tests for APIs
- [ ] E2E tests for critical user flows
- [ ] Load testing completed
- [ ] Security scan passed
- [ ] Penetration testing done

### Documentation
- [ ] API documentation created
- [ ] README updated with setup instructions
- [ ] Environment variables documented
- [ ] Deployment process documented
- [ ] Incident response plan created

### Infrastructure
- [ ] SSL/TLS certificates configured
- [ ] CDN configured (if needed)
- [ ] Load balancer configured (if needed)
- [ ] Auto-scaling set up
- [ ] Monitoring alerts configured
- [ ] Log aggregation set up

---

## 🎓 Learning Resources

### Supabase
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Database Functions](https://supabase.com/docs/guides/database/functions)
- [Realtime](https://supabase.com/docs/guides/realtime)

### Next.js
- [App Router](https://nextjs.org/docs/app)
- [Middleware](https://nextjs.org/docs/app/building-your-application/routing/middleware)
- [Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)

### Security
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [JWT Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)
- [Multi-Tenancy Security](https://www.nginx.com/blog/microservices-march-multi-tenant-security/)

---

## 📞 Support & Help

If you encounter issues:

1. **Check this guide** - Most common issues are covered above
2. **Review reference implementation** - Look at Inventory service code
3. **Test with curl** - Isolate issues by testing APIs directly
4. **Check logs** - Both application and Supabase logs
5. **Verify environment** - Double-check all .env variables

Common debugging commands:

```bash
# Check Supabase status
npx supabase status

# View database logs
npx supabase db logs

# Test webhook locally
curl -X POST http://localhost:3001/api/webhooks/core-events \
  -H "Content-Type: application/json" \
  -H "x-event-type: tenant.created" \
  -H "x-event-signature: sha256=..." \
  -d '{"payload":{}}'

# Test API with session
curl http://localhost:3001/api/your-resource \
  -H "Cookie: session=..."

# Check database from CLI
npx supabase db connect
```

---

## 🚨 Common Pitfalls

1. **Forgetting tenant_id filter** → Data leak across tenants  
   **Fix**: Always include `.eq('tenant_id', tenantId)` in queries

2. **Mismatched SSO secrets** → Auth fails silently  
   **Fix**: Verify CORE_SSO_SECRET_DEV matches Core exactly

3. **Missing RLS policies** → Bypass tenant isolation  
   **Fix**: Enable RLS and create policies on ALL tables

4. **Not checking idempotency** → Duplicate webhook processing  
   **Fix**: Use processed_events table with UNIQUE delivery_id

5. **Wrong Supabase URL for JWT validation** → All auth fails  
   **Fix**: Use CORE_SUPABASE_URL for JWT validation, not local URL

6. **Port conflicts** → Services won't start  
   **Fix**: Configure unique ports in supabase/config.toml

7. **Missing indexes on tenant_id** → Slow queries  
   **Fix**: CREATE INDEX on tenant_id for all tables

8. **Using anon key server-side** → RLS blocks queries  
   **Fix**: Use service_role key for server-side queries

9. **Not setting tenant_id on INSERT** → NULL constraint violation  
   **Fix**: Always set tenant_id from headers on create

10. **Parsing webhook body before signature check** → Security vulnerability  
    **Fix**: Verify signature on raw body text first

---

## ✅ Success Criteria

Your microservice is production-ready when:

- [ ] **Authentication**: Users can SSO from Core without manual login
- [ ] **Authorization**: Users only see their tenant's data
- [ ] **Security**: RLS policies prevent cross-tenant data access
- [ ] **Events**: Webhooks process successfully with idempotency
- [ ] **Performance**: API responses < 200ms for simple queries
- [ ] **Reliability**: 99.9% uptime, graceful error handling
- [ ] **Monitoring**: Logs, metrics, and alerts configured
- [ ] **Documentation**: Team can deploy and maintain without you

---

## 🎯 Summary

This guide covers everything needed to create a fully-functional Summit One microservice:

### What You've Built
✅ Multi-tenant microservice with complete isolation  
✅ SSO integration with Summit One Core  
✅ Event-driven architecture with webhooks  
✅ Row-Level Security for data protection  
✅ Production-ready authentication system  
✅ Scalable database architecture  

### Key Files Created
- **6 migrations** - Database schema with RLS
- **5 auth files** - Complete SSO flow
- **1 webhook handler** - Event processing
- **1 middleware** - Request context injection
- **N API routes** - Your business logic

### Next Steps
1. Customize domain tables for your business logic
2. Create frontend components using the session
3. Add custom event handlers as needed
4. Implement business-specific API endpoints
5. Test thoroughly with multiple tenants
6. Deploy to production environment

### Remember
- **Always filter by tenant_id** in every query
- **Never trust client input** - validate everything
- **Test with multiple tenants** before going live
- **Monitor RLS policies** - they're your last line of defense

---

**You're now ready to build secure, scalable microservices in the Summit One ecosystem!** 🚀

---

## 📚 Reference Files (From Inventory Service)

For complete working examples, see these files in the inventory service:

- [src/lib/auth-middleware.ts](src/lib/auth-middleware.ts) - JWT validation  
- [src/lib/db-middleware.ts](src/lib/db-middleware.ts) - Tenant context  
- [src/app/api/webhooks/core-events/route.ts](src/app/api/webhooks/core-events/route.ts) - Webhook processing  
- [supabase/migrations/20260105000001_add_tenants_table.sql](supabase/migrations/20260105000001_add_tenants_table.sql) - Tenants table  
- [supabase/migrations/20260102000006_add_dev_auth_support.sql](supabase/migrations/20260102000006_add_dev_auth_support.sql) - RLS policies  
- [src/components/AuthGate.tsx](src/components/AuthGate.tsx) - Auth guard  
- [src/app/api/inventory/items/route.ts](src/app/api/inventory/items/route.ts) - Tenant-isolated API

---



## 📚 Reference Files

Look at these files in the inventory service for examples:
- [src/lib/auth-middleware.ts](src/lib/auth-middleware.ts) - JWT validation
- [src/lib/db-middleware.ts](src/lib/db-middleware.ts) - Tenant context
- [src/app/api/webhooks/core-events/route.ts](src/app/api/webhooks/core-events/route.ts) - Webhook processing
- [supabase/migrations/20260105000001_add_tenants_table.sql](supabase/migrations/20260105000001_add_tenants_table.sql) - Tenants table
- [supabase/migrations/20260102000006_add_dev_auth_support.sql](supabase/migrations/20260102000006_add_dev_auth_support.sql) - RLS policies

---

---

## 💡 Migration Naming Convention

Follow this pattern for consistent migration ordering:

```
20260102000000_init_schema.sql              # Schema creation
20260102000001_create_config_tables.sql     # Configuration
20260102000002_create_reference_tables.sql  # Reference data
20260102000003_create_domain_tables.sql     # Your core tables
20260102000004_enable_rls.sql               # Row Level Security
20260102000005_add_tenants_table.sql        # Tenant sync
20260102000006_add_event_tracking.sql       # Idempotency
```

Format: `YYYYMMDDHHMMSS_descriptive_name.sql`

---

## 🔄 Authentication Flow Diagram

```
┌─────────────────┐
│  Summit One     │
│  Core           │◄──────────────┐
│  (Port 3000)    │               │
└────────┬────────┘               │
         │ 1. User clicks         │
         │    service link        │
         │                        │
         ▼                        │
┌─────────────────┐               │
│  Generate JWT   │               │
│  - userId       │               │
│  - tenantId     │               │
│  - role         │               │
│  - modules      │               │
└────────┬────────┘               │
         │                        │
         │ 2. Redirect with       │
         │    core_token param    │
         │                        │
         ▼                        │
┌─────────────────┐               │
│  Microservice   │               │
│  (Port 3001)    │               │
│                 │               │
│  AuthGate       │               │
└────────┬────────┘               │
         │                        │
         │ 3. Validate JWT        │
         ├────────────────────────┘
         │    with Core's
         │    Supabase URL
         │
         ▼
┌─────────────────┐
│  Create Session │
│  - 7 day cookie │
│  - HTTP-only    │
│  - Secure       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  User accesses  │
│  microservice   │
│  features       │
└─────────────────┘
```

---

## 🎯 Key Architecture Decisions

### Why Separate Supabase Instances?
- **Isolation**: Each service owns its data
- **Scalability**: Services can scale independently
- **Security**: Compromised service doesn't expose all data
- **Flexibility**: Different schemas, policies per service

### Why JWT from Core?
- **Single Source of Truth**: Auth managed centrally
- **Simplicity**: No user table duplication
- **Security**: Token rotation and revocation in one place

### Why RLS Policies?
- **Defense in Depth**: Even if app code fails, data is protected
- **Performance**: Database-level filtering
- **Audit**: Built-in tenant isolation enforcement

---

## 📋 Production Deployment Checklist

- [ ] Update all secrets (SSO, webhook, database)
- [ ] Configure production Supabase project
- [ ] Set JWT secret alignment between Core and service
- [ ] Configure webhook URLs (use HTTPS)
- [ ] Enable SSL/TLS for database connections
- [ ] Set up database backups
- [ ] Configure monitoring and logging
- [ ] Test RLS policies thoroughly
- [ ] Load test tenant isolation
- [ ] Document environment variables
- [ ] Set up CI/CD pipeline
- [ ] Configure rate limiting
- [ ] Enable CORS appropriately

---

## Prerequisites (Reference)

1. Summit One Core must be running at `http://localhost:3000` (or configured CORE_API_URL)
2. Docker Desktop installed and running
3. Node.js 18+ installed

## Environment Variables (Reference)

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
