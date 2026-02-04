# Auth & Ticketing System - Testing Guide

## Overview

The ticket-based SSO authentication system has been successfully implemented. This guide will help you test the authentication flow.

## What Was Implemented

### 1. Auth Callback Route
- **File**: [src/app/auth/callback/route.ts](src/app/auth/callback/route.ts)
- **Endpoint**: `/auth/callback`
- **Purpose**: Receives ticket from Core, exchanges it for user data, creates session cookies

### 2. Auth Helper Functions
- **File**: [src/lib/auth.ts](src/lib/auth.ts)
- **Functions**:
  - `getAuthContext()` - Get auth info (returns null if not authenticated)
  - `requireAuth()` - Require authentication (throws error if not authenticated)
  - `getCurrentTenantId()` - Get tenant ID
  - `getCurrentUserId()` - Get user ID
  - `clearAuth()` - Clear session cookies

### 3. Middleware Protection
- **File**: [src/middleware.ts](src/middleware.ts)
- **Purpose**: Protects all routes except public ones
- **Public Routes**:
  - `/auth/callback`
  - `/error`
  - `/health`
  - `/api/health`
  - `/dev-login`
  - `/test`

### 4. Error Page
- **File**: [src/app/error/page.tsx](src/app/error/page.tsx)
- **Purpose**: Shows user-friendly error messages for auth failures

### 5. Logout Route
- **File**: [src/app/api/auth/logout/route.ts](src/app/api/auth/logout/route.ts)
- **Endpoints**: `GET /api/auth/logout` and `POST /api/auth/logout`
- **Purpose**: Clears session and redirects to Core

### 6. Health Check
- **File**: [src/app/api/health/route.ts](src/app/api/health/route.ts)
- **Endpoint**: `GET /api/health`
- **Purpose**: Unauthenticated health check for monitoring

## Environment Configuration

The following environment variables are already configured in `.env.local`:

```env
# Core SSO Integration
NEXT_PUBLIC_CORE_URL=https://dev.summit-one.app
NEXT_PUBLIC_CORE_SUPABASE_URL=https://qcgkvmmbgfslttqokajr.supabase.co
NEXT_PUBLIC_CORE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
NEXT_PUBLIC_CORE_APP_URL=https://dev.summit-one.app
CORE_SSO_SECRET=gL5eMvCMU@9C9YpH
```

## Testing Instructions

### Test 1: Health Check (No Auth Required)

```bash
curl http://localhost:3000/api/health
```

**Expected Response**:
```json
{
  "status": "healthy",
  "service": "inventory-management",
  "timestamp": "2026-02-04T...",
  "env": "development"
}
```

### Test 2: Protected Route Without Auth

```bash
curl http://localhost:3000/dashboard
```

**Expected**: Redirect to `/error?msg=not_authenticated`

### Test 3: Callback Route With Invalid Ticket

```bash
curl "http://localhost:3000/auth/callback?ticket=invalid"
```

**Expected**: Redirect to `/error?msg=no_ticket`

### Test 4: Complete Flow From Core

1. **Start the development server**:
   ```bash
   npm run dev
   ```

2. **Go to Summit One Core**: https://dev.summit-one.app

3. **Navigate to Inventory Management service**:
   - Core should redirect to: `http://localhost:3000/auth/callback?ticket=<32-char-ticket>&target_org=<tenant-id>`

4. **Callback exchanges ticket**:
   - Check server logs for: `[Auth Callback] Exchanging ticket...`
   - Should see: `[Auth Callback] Success: { userId: '...', tenantId: '...' }`

5. **Redirect to dashboard**:
   - Should redirect to `/dashboard`
   - Session cookies should be set (check browser DevTools → Application → Cookies)

### Test 5: Verify Session Cookies

After successful auth, check browser DevTools:

**Expected Cookies**:
- `user_id` (httpOnly, 7-day expiry)
- `tenant_id` (httpOnly, 7-day expiry)
- `user_email` (httpOnly, 7-day expiry)

### Test 6: Protected API Routes

```bash
# With session cookies
curl http://localhost:3000/api/items \
  -H "Cookie: user_id=<user-id>; tenant_id=<tenant-id>"
```

**Expected**: Should work and return data filtered by tenant_id

### Test 7: Logout

```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Cookie: user_id=<user-id>; tenant_id=<tenant-id>"
```

**Expected**:
```json
{
  "success": true,
  "redirectUrl": "https://dev.summit-one.app"
}
```

## Key Security Features

✅ **Ticket Validation**: Only 32-character tickets accepted
✅ **Timeout Protection**: 5-second timeout on ticket exchange
✅ **HttpOnly Cookies**: Prevents XSS attacks
✅ **Secure Cookies**: HTTPS-only in production
✅ **SameSite Protection**: Prevents CSRF attacks
✅ **Middleware Protection**: All routes except public ones require auth
✅ **User Context Injection**: Headers set for downstream use

## Troubleshooting

### "Invalid ticket" Error
- ✓ Check `CORE_SSO_SECRET` matches Core
- ✓ Verify ticket is exactly 32 characters
- ✓ Check ticket hasn't expired (>2 minutes)
- ✓ Verify `NEXT_PUBLIC_CORE_SUPABASE_URL` is correct

### "Not authenticated" Error
- ✓ Check `user_id` and `tenant_id` cookies exist
- ✓ Verify cookies are httpOnly
- ✓ Check middleware is configured correctly
- ✓ Clear browser cookies and try again

### "Exchange failed" Error
- ✓ Check `NEXT_PUBLIC_CORE_SUPABASE_ANON_KEY` is correct
- ✓ Verify Core's `sso-exchange` function is running
- ✓ Check server logs for detailed error message
- ✓ Verify network connectivity to Core

### "Missing Core configuration" Error
- ✓ Check `.env.local` has all required variables
- ✓ Restart development server after changing `.env.local`
- ✓ Verify environment variables are loaded

## Next Steps

### For API Routes

Update your API routes to use the auth helpers:

```typescript
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const { tenantId, userId } = await requireAuth();
    
    // Query with tenant isolation
    const items = await db.query(
      'SELECT * FROM items WHERE tenant_id = $1',
      [tenantId]
    );
    
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: error instanceof Error && error.message === 'Authentication required' ? 401 : 500 }
    );
  }
}
```

### For Server Components

```typescript
import { requireAuth } from '@/lib/auth';

export default async function DashboardPage() {
  const { userId, tenantId, userEmail } = await requireAuth();
  
  return (
    <div>
      <h1>Welcome {userEmail}</h1>
      <p>Tenant: {tenantId}</p>
    </div>
  );
}
```

### Critical: Tenant Isolation

**EVERY database query MUST filter by tenant_id**:

```sql
-- ✅ CORRECT
SELECT * FROM items WHERE tenant_id = $1;

-- ❌ WRONG - Cross-tenant data leak!
SELECT * FROM items;
```

## Deployment Checklist

Before deploying to staging/production:

- [ ] Environment variables configured for staging
- [ ] Environment variables configured for production
- [ ] HTTPS enabled for production
- [ ] `CORE_SSO_SECRET` stored in secrets manager
- [ ] Rate limiting enabled on `/auth/callback`
- [ ] Logging configured (Sentry, DataDog, etc.)
- [ ] Security headers set (CSP, X-Frame-Options, etc.)
- [ ] Test complete flow in staging
- [ ] Monitor logs for errors

## Support

If you encounter any issues:

1. Check server logs for detailed error messages
2. Verify all environment variables are set correctly
3. Test the health check endpoint
4. Contact Core team for SSO configuration issues
