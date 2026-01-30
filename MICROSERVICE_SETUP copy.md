# Adding a New Microservice to Summit One

This guide explains how to create a new event-driven microservice that integrates with Summit One Core's multi-tenant authentication and event system.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Quick Start Checklist](#quick-start-checklist)
3. [Step-by-Step Setup](#step-by-step-setup)
4. [Event Subscription](#event-subscription)
5. [Testing](#testing)
6. [Deployment](#deployment)

---

## Prerequisites

- Access to Summit One Core (dev/stage/prod environments)
- Your microservice repository with branches: `dev`, `stage`, `main`
- Vercel account (for deployment)
- Cloudflare account (for domains)
- Separate Supabase projects for dev/stage/prod (if your service needs a database)

---

## Quick Start Checklist

- [ ] Create microservice repo with dev/stage/main branches
- [ ] Create databases (if needed): dev, stage, prod with **hard isolation**
- [ ] Set up Vercel deployment (main → Production, dev/stage → Preview)
- [ ] Configure Cloudflare domains: `yourservice.summit-one.app`, `stage-yourservice.summit-one.app`, `dev-yourservice.summit-one.app`
- [ ] Implement AuthGate SSO callback route
- [ ] Create webhook endpoint for event subscriptions
- [ ] Implement idempotent event processing
- [ ] Register webhook subscription in Command Center
- [ ] Test SSO flow and event delivery
- [ ] Deploy to production

---

## Step-by-Step Setup

### 1. **Create Microservice Database** (if needed)

```sql
-- Every table MUST have tenant_id for isolation
CREATE TABLE your_service_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,  -- CRITICAL: Required for multi-tenancy
  user_id UUID,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index on tenant_id for performance
CREATE INDEX idx_your_data_tenant ON your_service_data(tenant_id);

-- Enable Row Level Security
ALTER TABLE your_service_data ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policy
CREATE POLICY "tenant_isolation" ON your_service_data
  FOR ALL USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::UUID
  );

-- Idempotency table (CRITICAL)
CREATE TABLE processed_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  tenant_id UUID NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  payload JSONB
);

CREATE INDEX idx_processed_events_tenant ON processed_events(tenant_id);
```

### 2. **Set Up Environment Variables**

Create `.env.local` (dev), `.env.staging`, `.env.production`:

```bash
# ===== CORE AUTH (SSO) - REQUIRED =====
# DEV
NEXT_PUBLIC_SUPABASE_URL=https://hoizrypzbzmtorhknkxq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# STAGE
# NEXT_PUBLIC_SUPABASE_URL=https://tbyfbawdrtcqvnbcuwus.supabase.co
# NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# PROD
# NEXT_PUBLIC_SUPABASE_URL=https://weehhkgcxvpaadkxkugf.supabase.co
# NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# ===== SERVICE CONFIGURATION =====
EXPO_PUBLIC_ENV=development  # or staging, production
NEXT_PUBLIC_SERVICE_BASE_URL=https://dev-yourservice.summit-one.app

# ===== SERVER SECRETS (NOT PUBLIC) =====
DATABASE_URL=postgresql://...  # Your microservice DB
WEBHOOK_SIGNING_SECRET=...     # From Summit One when you register
EVENT_POLLER_SECRET=...        # Random secret for security
SUMMIT_ENV=development         # or staging, production
```

### 3. **Implement AuthGate SSO Callback**

Create `/app/auth/callback/route.ts`:

```typescript
// app/auth/callback/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const coreToken = searchParams.get('core_token');
  const coreEnv = searchParams.get('core_env');
  const targetOrg = searchParams.get('target_org');

  if (!coreToken) {
    return NextResponse.redirect(new URL('/error?message=missing_token', request.url));
  }

  // Get Core URL based on environment
  const coreUrls = {
    development: 'https://hoizrypzbzmtorhknkxq.supabase.co',
    staging: 'https://tbyfbawdrtcqvnbcuwus.supabase.co',
    production: 'https://weehhkgcxvpaadkxkugf.supabase.co',
  };
  
  const coreUrl = coreUrls[coreEnv as keyof typeof coreUrls] || coreUrls.development;

  try {
    // Validate token with Core
    const response = await fetch(`${coreUrl}/api/auth/validate-sso-token`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${coreToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Token validation failed');
    }

    const userData = await response.json();
    const tenantId = userData.app_metadata?.active_tenant_id || 
                     userData.app_metadata?.tenant_id || 
                     targetOrg;

    // Store session in your microservice's Supabase
    // (This assumes you're using Supabase in your microservice)
    // If not, implement your own session management
    
    // Store active tenant
    cookies().set('active_tenant_id', tenantId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    // Store user info
    cookies().set('user_id', userData.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
    });

    // Redirect to dashboard
    return NextResponse.redirect(new URL('/dashboard', request.url));
  } catch (error) {
    console.error('SSO callback error:', error);
    return NextResponse.redirect(
      new URL('/error?message=auth_failed', request.url)
    );
  }
}
```

### 4. **Create Webhook Event Handler**

Create `/app/api/webhooks/events/route.ts`:

```typescript
// app/api/webhooks/events/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Verify webhook signature (if enabled)
function verifySignature(signature: string | null, payload: any): boolean {
  if (!process.env.WEBHOOK_SIGNING_SECRET) return true; // Skip if not configured
  
  // Implement HMAC verification here
  // const expectedSignature = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  // return signature === `sha256=${expectedSignature}`;
  return true;
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const { event_id, event_type, tenant_id, payload: eventData } = payload;

    // Verify signature
    const signature = request.headers.get('x-webhook-signature');
    if (!verifySignature(signature, payload)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // IDEMPOTENCY CHECK - Critical!
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: existing } = await supabase
      .from('processed_events')
      .select('event_id')
      .eq('event_id', event_id)
      .single();

    if (existing) {
      console.log(`Event ${event_id} already processed, skipping`);
      return NextResponse.json({ status: 'already_processed' });
    }

    // Process the event
    console.log(`Processing event: ${event_type} for tenant: ${tenant_id}`);
    
    // YOUR BUSINESS LOGIC HERE
    switch (event_type) {
      case 'profile.created':
        await handleProfileCreated(eventData, tenant_id);
        break;
      
      case 'profile.updated':
        await handleProfileUpdated(eventData, tenant_id);
        break;
      
      case 'tenant.membership.created':
        await handleMembershipCreated(eventData, tenant_id);
        break;
      
      default:
        console.log(`Unhandled event type: ${event_type}`);
    }

    // Mark as processed (in atomic transaction with your business logic)
    await supabase.from('processed_events').insert({
      event_id,
      event_type,
      tenant_id,
      payload: eventData,
    });

    return NextResponse.json({ status: 'processed' });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Processing failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

async function handleProfileCreated(data: any, tenantId: string) {
  // Your logic here
  console.log('New profile created:', data);
}

async function handleProfileUpdated(data: any, tenantId: string) {
  // Your logic here
  console.log('Profile updated:', data);
}

async function handleMembershipCreated(data: any, tenantId: string) {
  // Your logic here
  console.log('New membership:', data);
}
```

### 5. **Register Your Webhook Subscription**

After deploying your service, register it with Summit One Core:

```sql
-- Run this in Summit One Core database (or via Command Center UI)
INSERT INTO public.event_subscriptions (
  name,
  endpoint_url,
  event_types,
  is_active,
  max_attempts,
  secret,
  tenant_id
) VALUES (
  'YourService - Production',
  'https://yourservice.summit-one.app/api/webhooks/events',
  ARRAY['profile.*', 'tenant.membership.*'],  -- Subscribe to these event patterns
  true,
  5,
  'your-webhook-secret-here',  -- Generate a strong random secret
  NULL  -- NULL = global subscription, or specify a tenant_id for tenant-specific
);
```

### 6. **Middleware for Tenant Isolation**

Create `middleware.ts` at your project root:

```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const tenantId = request.cookies.get('active_tenant_id')?.value;
  const userId = request.cookies.get('user_id')?.value;

  // Protect all routes except auth callback and public pages
  const isPublicRoute = 
    request.nextUrl.pathname.startsWith('/auth/callback') ||
    request.nextUrl.pathname.startsWith('/error') ||
    request.nextUrl.pathname.startsWith('/_next');

  if (!isPublicRoute && (!tenantId || !userId)) {
    // Redirect to core for authentication
    const coreUrl = getCoreUrl(process.env.EXPO_PUBLIC_ENV || 'development');
    return NextResponse.redirect(coreUrl);
  }

  // Add tenant context to headers for API routes
  const requestHeaders = new Headers(request.headers);
  if (tenantId) requestHeaders.set('x-tenant-id', tenantId);
  if (userId) requestHeaders.set('x-user-id', userId);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

function getCoreUrl(env: string): string {
  const urls = {
    development: 'https://dev-core.summit-one.app',
    staging: 'https://stage-core.summit-one.app',
    production: 'https://core.summit-one.app',
  };
  return urls[env as keyof typeof urls] || urls.development;
}
```

---

## Event Subscription

### Available Event Types

Core publishes these events (subscribe using wildcard patterns):

- `profile.*` - All profile events
- `profile.created` - New profile created
- `profile.updated` - Profile updated
- `profile.deleted` - Profile deleted
- `tenant.*` - All tenant events
- `tenant.created` - New organization created
- `tenant.updated` - Organization updated
- `tenant.membership.*` - All membership events
- `tenant.membership.created` - User joined organization
- `tenant.membership.updated` - Membership role changed
- `tenant.membership.deleted` - User removed from organization

### Webhook Payload Format

```json
{
  "event_id": "123e4567-e89b-12d3-a456-426614174000",
  "event_type": "profile.created",
  "tenant_id": "org-uuid-here",
  "payload": {
    "op": "INSERT",
    "new": {
      "id": "user-uuid",
      "tenant_id": "org-uuid",
      "first_name": "John",
      "last_name": "Doe",
      ...
    }
  },
  "delivery_id": "delivery-uuid",
  "attempt": 1
}
```

---

## Testing

### Test SSO Flow

1. Deploy your service to dev
2. In Summit One Core dashboard, click link to your service
3. Should redirect with `?core_token=...&core_env=development&target_org=...`
4. Your callback should validate token and create session
5. User should land on your dashboard with tenant context

### Test Event Delivery

```sql
-- Manually trigger a test event in Core
INSERT INTO public.events_outbox (
  tenant_id,
  event_type,
  aggregate_type,
  aggregate_id,
  payload,
  status
) VALUES (
  'your-test-tenant-id',
  'test.event',
  'test',
  gen_random_uuid(),
  '{"message": "test event"}'::jsonb,
  'pending'
);

-- Event poller will pick this up within 1 minute and deliver to your webhook
```

### Monitor Deliveries

```sql
-- Check delivery status
SELECT 
  ed.status,
  ed.attempts,
  ed.error_message,
  ed.created_at,
  eo.event_type
FROM event_deliveries ed
JOIN events_outbox eo ON eo.id = ed.event_id
JOIN event_subscriptions es ON es.id = ed.subscription_id
WHERE es.name = 'YourService - Production'
ORDER BY ed.created_at DESC
LIMIT 20;

-- Get stats
SELECT public.get_event_delivery_stats(null, 24);
```

---

## Deployment

### Vercel Configuration

1. Connect your repo to Vercel
2. Configure environments:
   - **Production**: `main` branch → `yourservice.summit-one.app`
   - **Preview (Stage)**: `stage` branch → `stage-yourservice.summit-one.app`
   - **Preview (Dev)**: `dev` branch → `dev-yourservice.summit-one.app`

3. Set environment variables per deployment:

```bash
# In Vercel dashboard → Settings → Environment Variables

# For Production deployment:
EXPO_PUBLIC_ENV=production
NEXT_PUBLIC_SUPABASE_URL=https://weehhkgcxvpaadkxkugf.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
DATABASE_URL=...
WEBHOOK_SIGNING_SECRET=...

# Repeat for Preview (stage) and Preview (dev) with their respective values
```

### GitHub Actions for Supabase Sync

Create `.github/workflows/supabase-sync.yml`:

```yaml
name: Supabase DB Sync

on:
  push:
    branches:
      - dev
      - stage
      - main

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set environment
        id: set-env
        run: |
          if [[ "${{ github.ref }}" == "refs/heads/main" ]]; then
            echo "ENV=prod" >> $GITHUB_OUTPUT
          elif [[ "${{ github.ref }}" == "refs/heads/stage" ]]; then
            echo "ENV=stage" >> $GITHUB_OUTPUT
          else
            echo "ENV=dev" >> $GITHUB_OUTPUT
          fi
      
      - uses: supabase/setup-cli@v1
      
      - name: Run migrations
        run: |
          supabase db push --project-id ${{ secrets[format('{0}_PROJECT_ID', steps.set-env.outputs.ENV)] }} --password ${{ secrets[format('{0}_DB_PASSWORD', steps.set-env.outputs.ENV)] }}
```

---

## Security Checklist

✅ **Always filter by `tenant_id` from JWT/cookies** - Never trust client input  
✅ **Validate JWT on every request** - Use middleware  
✅ **Enable RLS on all tables** - Defense in depth  
✅ **Index `tenant_id` columns** - Performance  
✅ **Implement idempotency** - Use `processed_events` table  
✅ **Use HMAC signatures** - Verify webhook authenticity  
✅ **Store secrets in vault** - Never commit to Git  
✅ **Test cross-tenant isolation** - Try accessing other tenant's data  

---

## Support

- Review existing microservices in the org for examples
- Check Summit One Core docs for latest event types
- Monitor `dead_events` table for delivery failures
- Use `retry_event_delivery(delivery_id)` to manually retry failed events

---

**Remember:** The key principle is **tenant isolation by default**. Every database query must be scoped to the tenant from the JWT/session. RLS policies enforce this at the database level as a safety net.
