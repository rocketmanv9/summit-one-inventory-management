# Microservice Auth & Ticketing - Agent Task List

**AI Agent Instructions: Implement ticket-based SSO authentication for your microservice**

---

## Overview for the Agent

You are responsible for setting up authentication and ticketing for a microservice that integrates with Summit One Core. This document contains all tasks, code templates, and validation steps.

**High-Level Flow:**
```
Core generates ticket → Redirect to microservice → Exchange ticket → Create session → Protected routes work
```

**Key Security Rule:** EVERY query must filter by `tenant_id`. Never skip this.

---

## Task 1: Gather Requirements

**Objective:** Collect configuration from Core team before starting

**Checklist:**
- [ ] `NEXT_PUBLIC_SUPABASE_URL` (development, staging, production)
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` (development, staging, production)
- [ ] `CORE_SSO_SECRET` (shared secret for HMAC validation)
- [ ] Confirmation your service is registered in Core
- [ ] Confirm callback path: `/auth/callback`
- [ ] Node.js 18+ installed
- [ ] Framework selected: Next.js 15 or Express

**Contact Core Team For:**
- Development Supabase URL and keys
- Staging Supabase URL and keys
- Production Supabase URL and keys
- SSO Secret for HMAC-SHA256 validation
- Service registration confirmation

---

## Task 2: Setup Environment Variables

**Objective:** Create `.env.local`, `.env.staging`, `.env.production`

### Step 2a: Development Environment

**File:** `.env.local`

```bash
# Core Configuration
NEXT_PUBLIC_SUPABASE_URL=https://hoizrypzbzmtorhknkxq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Service Configuration
NEXT_PUBLIC_SERVICE_NAME=your-service-name
NEXT_PUBLIC_SERVICE_BASE_URL=http://localhost:3001
NODE_ENV=development

# Security
CORE_SSO_SECRET=sso-secret-from-core-team

# Database (optional)
# DATABASE_URL=postgresql://user:password@localhost:5432/service_db
```

### Step 2b: Staging Environment

**File:** `.env.staging`

```bash
NEXT_PUBLIC_SUPABASE_URL=https://staging-core.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=staging-key
NEXT_PUBLIC_SERVICE_BASE_URL=https://your-service.staging.summit-one.app
NODE_ENV=production
CORE_SSO_SECRET=staging-secret
```

### Step 2c: Production Environment

**File:** `.env.production`

```bash
NEXT_PUBLIC_SUPABASE_URL=https://core.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=prod-key
NEXT_PUBLIC_SERVICE_BASE_URL=https://your-service.summit-one.app
NODE_ENV=production
CORE_SSO_SECRET=prod-secret
```

**Validation:**
```bash
# Verify files created
ls -la .env.*

# Verify .env.local is in .gitignore
grep ".env.local" .gitignore
```

---

## Task 3: Create Auth Callback Route

**Objective:** Implement `/auth/callback` to receive and exchange tickets

**For Next.js (App Router):**

**File:** `src/app/auth/callback/route.ts`

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticket = searchParams.get('ticket');
    const targetOrg = searchParams.get('target_org');

    console.log('[Auth Callback] Request:', { ticketLength: ticket?.length, targetOrg });

    // Validate ticket
    if (!ticket || ticket.length !== 32) {
      console.error('[Auth Callback] Invalid ticket');
      return NextResponse.redirect(new URL('/error?msg=no_ticket', request.url));
    }

    const coreUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!coreUrl || !anonKey) {
      throw new Error('Missing Core configuration');
    }

    // Exchange ticket with Core
    console.log('[Auth Callback] Exchanging ticket...');
    
    const exchangeResponse = await fetch(`${coreUrl}/functions/v1/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ ticket, target_org: targetOrg }),
      signal: AbortSignal.timeout(5000),
    });

    if (!exchangeResponse.ok) {
      throw new Error(`Exchange failed: ${exchangeResponse.status}`);
    }

    const userData = await exchangeResponse.json();
    
    if (!userData.user?.id || !userData.target_tenant_id) {
      throw new Error('Invalid response from Core');
    }

    const { user, target_tenant_id } = userData;

    console.log('[Auth Callback] Success:', { userId: user.id, tenantId: target_tenant_id });

    // Create session cookies
    const cookieStore = await cookies();
    
    cookieStore.set('user_id', user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 604800, // 7 days
      path: '/',
    });

    cookieStore.set('tenant_id', target_tenant_id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 604800,
      path: '/',
    });

    cookieStore.set('user_email', user.email, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 604800,
      path: '/',
    });

    return NextResponse.redirect(new URL('/dashboard', request.url));

  } catch (error) {
    console.error('[Auth Callback] Error:', error);
    return NextResponse.redirect(
      new URL(`/error?msg=${encodeURIComponent(error instanceof Error ? error.message : 'Unknown error')}`, request.url)
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
```

**For Express:**

```typescript
app.get('/auth/callback', async (req: Request, res: Response) => {
  try {
    const { ticket, target_org } = req.query;

    if (!ticket || typeof ticket !== 'string' || ticket.length !== 32) {
      return res.redirect('/error?msg=no_ticket');
    }

    const exchangeResponse = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/exchange`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ ticket, target_org }),
      }
    );

    if (!exchangeResponse.ok) throw new Error('Exchange failed');

    const userData = await exchangeResponse.json();
    const { user, target_tenant_id } = userData;

    req.session.userId = user.id;
    req.session.tenantId = target_tenant_id;
    req.session.userEmail = user.email;

    res.redirect('/dashboard');

  } catch (error) {
    console.error('[Auth Callback] Error:', error);
    res.redirect('/error?msg=auth_failed');
  }
});
```

**Validation:**
- [ ] File exists at `src/app/auth/callback/route.ts`
- [ ] No TypeScript errors
- [ ] Handles all error cases
- [ ] Logs to console for debugging

---

## Task 4: Create Middleware

**Objective:** Protect all routes and inject user context

**File:** `src/middleware.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_ROUTES = ['/auth/callback', '/error', '/health', '/api/health'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes
  if (PUBLIC_ROUTES.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Check for session
  const userId = request.cookies.get('user_id')?.value;
  const tenantId = request.cookies.get('tenant_id')?.value;

  if (!userId || !tenantId) {
    console.log('[Middleware] No session:', { pathname, hasUserId: !!userId, hasTenantId: !!tenantId });
    return NextResponse.redirect(new URL('/error?msg=not_authenticated', request.url));
  }

  // Inject user context
  const headers = new Headers(request.headers);
  headers.set('x-user-id', userId);
  headers.set('x-tenant-id', tenantId);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public).*)'],
};
```

**For Express:**

```typescript
export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  if (req.path.startsWith('/auth/callback') || req.path.startsWith('/error')) {
    return next();
  }

  const userId = req.session?.userId;
  const tenantId = req.session?.tenantId;

  if (!userId || !tenantId) {
    return res.redirect('/error?msg=not_authenticated');
  }

  req.userId = userId;
  req.tenantId = tenantId;
  next();
}

app.use(authMiddleware);
```

**Validation:**
- [ ] File exists at `src/middleware.ts`
- [ ] No TypeScript errors
- [ ] Returns NextResponse.next() for authenticated requests
- [ ] Redirects to /error for unauthenticated requests

---

## Task 5: Create Auth Helper Functions

**Objective:** Create reusable functions for checking authentication in routes

**File:** `src/lib/auth.ts`

```typescript
import { cookies, headers } from 'next/headers';

export async function getAuthContext() {
  const headersList = await headers();
  const cookieStore = await cookies();

  let userId = headersList.get('x-user-id') || cookieStore.get('user_id')?.value;
  let tenantId = headersList.get('x-tenant-id') || cookieStore.get('tenant_id')?.value;
  const userEmail = cookieStore.get('user_email')?.value;

  if (!userId || !tenantId) {
    return null;
  }

  return { userId, tenantId, userEmail };
}

export async function requireAuth() {
  const auth = await getAuthContext();
  if (!auth) {
    throw new Error('Authentication required');
  }
  return auth;
}

export async function getCurrentTenantId(): Promise<string> {
  const auth = await requireAuth();
  return auth.tenantId;
}
```

**Validation:**
- [ ] File exists at `src/lib/auth.ts`
- [ ] No TypeScript errors
- [ ] Exports all three functions

---

## Task 6: Create Protected API Routes

**Objective:** Implement API routes that filter by tenant_id

**Example Route:** `src/app/api/items/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const { tenantId, userId } = await requireAuth();

    // TODO: Query your database with tenant_id filter
    // CRITICAL: Always filter by tenantId
    // const items = await db.query(
    //   'SELECT * FROM items WHERE tenant_id = $1',
    //   [tenantId]
    // );

    return NextResponse.json({
      success: true,
      tenantId,
      userId,
      data: [],
    });

  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: error instanceof Error && error.message === 'Authentication required' ? 401 : 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { tenantId, userId } = await requireAuth();
    const body = await request.json();

    // TODO: Insert with tenant_id
    // const result = await db.query(
    //   'INSERT INTO items (tenant_id, user_id, name) VALUES ($1, $2, $3) RETURNING *',
    //   [tenantId, userId, body.name]
    // );

    return NextResponse.json({ success: true }, { status: 201 });

  } catch (error) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
```

**Validation:**
- [ ] All routes use `requireAuth()`
- [ ] All database queries filter by `tenantId`
- [ ] No unfiltered queries that could leak cross-tenant data

---

## Task 7: Setup Database (If Applicable)

**Objective:** Create tables with tenant isolation

**Create Migration:** `supabase/migrations/TIMESTAMP_create_items.sql`

```sql
-- Create items table
CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_items_tenant_id ON items(tenant_id);
CREATE INDEX idx_items_tenant_user ON items(tenant_id, user_id);

-- Row-Level Security
ALTER TABLE items ENABLE ROW LEVEL SECURITY;

CREATE POLICY items_tenant_isolation ON items
  FOR ALL USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::UUID
  );
```

**Apply Migrations:**

```bash
# For Supabase
supabase migration new create_items
supabase db push

# Or for raw PostgreSQL
psql $DATABASE_URL -f supabase/migrations/timestamp_create_items.sql
```

**Validation:**
- [ ] Migration file created
- [ ] Tables created with tenant_id column
- [ ] Indexes created on tenant_id
- [ ] RLS policies enabled
- [ ] Test query with tenant filter works

---

## Task 8: Test Authentication Flow

**Objective:** Verify the complete flow works end-to-end

### Step 8a: Start Development Server

```bash
npm run dev
# or
yarn dev
# or
npm start  # for Express
```

**Verify:** Service running on `http://localhost:3001`

### Step 8b: Test Callback Route

Open browser and navigate to:
```
http://localhost:3001/auth/callback?ticket=AbCdEfGhIjKlMnOpQrStUvWxYz123456&target_org=test-org-uuid
```

**Expected:**
- [ ] Route logs received ticket
- [ ] Exchange attempt logged
- [ ] Redirect to `/dashboard` or `/error`
- [ ] Cookies set in browser (check DevTools)

### Step 8c: Test Protected Routes

```bash
# Test with session cookie
curl http://localhost:3001/api/items \
  -H "Cookie: user_id=test-user; tenant_id=test-tenant"

# Expected: 200 response with data

# Test without session
curl http://localhost:3001/api/items

# Expected: 401 or redirect to /error
```

### Step 8d: Test from Core

1. Go to Summit One Core (development instance)
2. Click "Open [Your Service]"
3. Should redirect to your callback route
4. Should exchange ticket
5. Should create session and redirect to `/dashboard`

**Validation Checklist:**
- [ ] Callback route receives ticket parameter
- [ ] Ticket exchange succeeds (check logs)
- [ ] Redirects to `/dashboard` on success
- [ ] Session cookies created (httpOnly, secure, sameSite)
- [ ] Protected routes accept valid session
- [ ] Protected routes reject missing session
- [ ] No TypeScript errors

---

## Task 9: Implement Tenant Isolation Tests

**Objective:** Verify users cannot access other tenants' data

### Test: Cross-Tenant Access Prevention

```typescript
// Create two requests with different tenant_ids
const tenant1Response = await fetch('/api/items', {
  headers: { Cookie: 'tenant_id=tenant-1; user_id=user-1' },
});
const tenant1Data = await tenant1Response.json();

const tenant2Response = await fetch('/api/items', {
  headers: { Cookie: 'tenant_id=tenant-2; user_id=user-1' },
});
const tenant2Data = await tenant2Response.json();

// Verify they see different data
assert(tenant1Data.tenantId === 'tenant-1');
assert(tenant2Data.tenantId === 'tenant-2');
assert(tenant1Data.data.length === 0); // Or expected count
```

**Validation:**
- [ ] Users only see data from their tenant
- [ ] RLS policies enforced
- [ ] Database queries properly filtered

---

## Task 10: Prepare for Deployment

**Objective:** Ready the service for staging and production

### Step 10a: Security Checklist

- [ ] HTTPS enabled for production
- [ ] `CORE_SSO_SECRET` stored in secrets manager (not committed)
- [ ] Rate limiting enabled on `/auth/callback`
- [ ] Error messages don't leak tenant_id or user_id
- [ ] Database backups configured
- [ ] Logging configured (Sentry, DataDog, etc.)
- [ ] CORS properly configured
- [ ] Security headers set (X-Frame-Options, etc.)

### Step 10b: Register Service with Core Team

Provide this information:

```
Service: your-service-name
Framework: Next.js 15 / Express
Status: Ready for integration

URLs:
- Development: http://localhost:3001
- Staging: https://your-service.staging.summit-one.app
- Production: https://your-service.summit-one.app

Callback: /auth/callback
Database: Yes/No
Webhook Support: Yes/No

Contact: your-email@company.com
```

### Step 10c: Deploy to Staging

```bash
# Update .env.staging with actual staging secrets
git push origin main:staging

# Deploy to staging environment
# (Vercel, Heroku, AWS, etc. - depends on your setup)
```

**Validation:**
- [ ] Service deployed to staging
- [ ] `.env.staging` configured with staging URLs
- [ ] Staging env vars set in deployment platform
- [ ] Test callback route on staging
- [ ] Test API routes on staging

### Step 10d: Deploy to Production

```bash
git push origin main

# Deploy to production
# (Vercel, Heroku, AWS, etc.)
```

**Validation:**
- [ ] Service deployed to production
- [ ] `.env.production` configured with production URLs
- [ ] Production env vars set in deployment platform
- [ ] Test complete flow in production
- [ ] Monitor logs for errors

---

## Task 11: Security Audit

**Objective:** Verify all security requirements met

### Security Checklist

**Authentication:**
- [ ] HTTPS enforced in production
- [ ] Tickets validated before exchange
- [ ] Cookies set as httpOnly
- [ ] Cookies set as secure (production)
- [ ] sameSite: 'lax' on all cookies
- [ ] Request timeout (5 seconds) on exchange

**Data Isolation:**
- [ ] Every query filters by tenant_id
- [ ] RLS policies on all tables
- [ ] Parameterized queries used (no string concatenation)
- [ ] No bulk operations across tenants
- [ ] Error messages don't leak tenant_id

**Secrets:**
- [ ] CORE_SSO_SECRET in .gitignore
- [ ] Environment variables set correctly
- [ ] No secrets in logs
- [ ] Secrets rotated regularly

**Rate Limiting:**
- [ ] Auth callback limited to 5 requests/15 minutes
- [ ] API endpoints limited to 100 requests/minute
- [ ] Rate limit errors returned gracefully

---

## Task 12: Documentation & Handoff

**Objective:** Document everything for future maintenance

### Create Documentation

1. **README.md update:**
   - How to set up development environment
   - How to run tests
   - How to deploy

2. **ARCHITECTURE.md:**
   - High-level architecture
   - How SSO works
   - Tenant isolation approach
   - Database schema

3. **DEPLOYMENT.md:**
   - Staging deployment steps
   - Production deployment steps
   - Rollback procedures
   - Troubleshooting guide

4. **API.md:**
   - List all endpoints
   - Authentication requirements
   - Example requests/responses
   - Error codes

### Troubleshooting Guide

Create a file documenting:

```markdown
# Troubleshooting Guide

## "Invalid ticket" Error
- [ ] Check CORE_SSO_SECRET matches Core
- [ ] Verify ticket is exactly 32 characters
- [ ] Check ticket hasn't expired (>2 minutes)
- [ ] Verify Core URL is correct

## "Not authenticated" Error
- [ ] Check user_id and tenant_id cookies exist
- [ ] Verify cookies are httpOnly
- [ ] Check middleware is configured correctly
- [ ] Clear browser cookies and try again

## "Missing tenant_id" Error
- [ ] Check session creation in callback
- [ ] Verify target_tenant_id returned from Core
- [ ] Check tenant_id cookie is set
- [ ] Review middleware logs

## Cannot Access Cross-Tenant Data
- GOOD! This is the security model working
- Verify RLS policies are enabled
- Confirm queries filter by tenant_id
```

**Validation:**
- [ ] README updated with setup instructions
- [ ] Architecture documented
- [ ] Deployment guide created
- [ ] API documentation complete
- [ ] Troubleshooting guide created

---

## Completion Checklist

When all tasks are done, verify:

- [ ] Task 1: Requirements gathered from Core team
- [ ] Task 2: Environment variables configured (dev, staging, prod)
- [ ] Task 3: Callback route implemented and tested
- [ ] Task 4: Middleware implemented and protecting routes
- [ ] Task 5: Auth helper functions created
- [ ] Task 6: API routes implemented with tenant isolation
- [ ] Task 7: Database schema created (if needed)
- [ ] Task 8: End-to-end flow tested locally
- [ ] Task 9: Tenant isolation verified
- [ ] Task 10: Ready for deployment
- [ ] Task 11: Security audit passed
- [ ] Task 12: Documentation complete

**Final Validation:**
```bash
# Run tests
npm test

# Build for production
npm run build

# Check for TypeScript errors
npx tsc --noEmit

# Check for security issues
npm audit

# Verify git is clean
git status
```

---

## Reference: Key Concepts

**Ticket:** 32-char code, 2-min lifetime, HMAC-SHA256 hashed, one-time use

**Session:** Created locally, stored in httpOnly cookies, 7-day lifetime

**Tenant:** Organization/workspace, users isolated by tenant_id

**Security Rule:** Every query must filter by tenant_id. No exceptions.

**Error Handling:** Log detailed errors server-side, return generic messages to client

---

## Getting Help

If stuck on any task:

1. Check the troubleshooting section in this document
2. Review console logs for error messages
3. Verify all environment variables are set
4. Contact Core team with specific error message
5. Check browser DevTools (Network, Application tabs)
