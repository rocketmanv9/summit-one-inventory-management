# Ticket-Based SSO Quick Start

## What Changed

**Before (JWT):** `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
**After (Ticket):** Redirect to `/auth-gate?ticket=abc123def456...`

## For Frontend Developers

### Core → Inventory Flow
```
Core User Login
    ↓
Core creates ticket (64-char hex)
    ↓
Core redirects to: https://inventory.app/auth-gate?ticket=...&target_service=inventory&target_org=tenant_id
    ↓
AuthGate page loads, validates ticket, creates session
    ↓
User redirected to /dashboard
    ↓
Session cookie set: inventory_session_id (httpOnly)
    ↓
All subsequent requests authenticated via session
```

### What You Need to Do
1. Nothing - the flow is automatic!
2. AuthGate page handles everything
3. Existing dashboard/pages work as-is

## For API Developers

### Check Authentication
```typescript
import { getAuthUser } from '@/lib/auth';

export async function GET(request: Request) {
  const user = await getAuthUser(request);
  
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // user = { 
  //   userId: "uuid",
  //   tenantId: "uuid",
  //   role: "admin",
  //   email: "user@company.com",
  //   name: "John Doe"
  // }
  
  console.log(`Request from ${user.email} (${user.role})`);
}
```

### Protect Routes
```typescript
// Use in all API routes that need authentication
const user = await getAuthUser(request);
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
```

### With Idempotency
```typescript
import { requireIdempotencyKey } from '@/lib/idempotency';

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  // Idempotency still works exactly the same way
  const idempotencyKey = await requireIdempotencyKey(request);
  
  // Your logic here...
}
```

### Logout
```typescript
import { handleLogout } from '@/lib/auth';

export async function POST(request: Request) {
  return await handleLogout(request);
}
```

## Setup

### 1. Environment Variables
Create `.env.local`:
```env
CORE_SERVICE_URL=http://localhost:3001
SERVICE_AUTH_TOKEN=your-service-token-here
SESSION_DURATION_SECONDS=3600
```

### 2. Build & Test
```bash
npm run build     # Should compile successfully
npm run dev       # Start dev server
```

### 3. Test the Flow
1. Go to Core (http://localhost:3001)
2. Log in
3. Core redirects to Inventory's auth-gate
4. You should be redirected to dashboard
5. Session cookie `inventory_session_id` should be set

## Verify It's Working

### Check Session
```bash
curl http://localhost:3000/api/auth/me \
  -H "Cookie: inventory_session_id=<session-id>"
```

Response:
```json
{
  "userId": "user-uuid",
  "tenantId": "tenant-uuid",
  "role": "admin",
  "email": "user@company.com",
  "name": "John Doe"
}
```

### Test Logout
```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Cookie: inventory_session_id=<session-id>"
```

## Key Differences from JWT

| Aspect | JWT | Ticket |
|--------|-----|--------|
| Storage | Client (token) | Server (session) |
| Revocation | Impossible until expiry | Immediate |
| Single-use | No (reusable) | Yes (consumed) |
| Format | Large base64 blob | 64-char hex |
| Validation | Crypto signature | Database lookup |
| Refresh | Token refresh endpoint | Sliding window |
| Security | Stateless | Stateful |

## Common Tasks

### Check if User is Logged In
```typescript
const user = await getAuthUser(request);
if (user) {
  console.log('User is logged in:', user.email);
} else {
  console.log('User is not logged in');
}
```

### Get User's Organization
```typescript
const user = await getAuthUser(request);
const tenantId = user?.tenantId; // Your filter for all queries
```

### Require Admin Role
```typescript
const user = await getAuthUser(request);
if (!user || user.role !== 'admin') {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

### Access User Email in Logging
```typescript
const user = await getAuthUser(request);
console.log(`[${user?.email}] Operation completed`);
```

## Troubleshooting

### "No SSO ticket provided"
- Ensure Core is redirecting to `/auth-gate?ticket=...`
- Check URL has `?ticket=` param

### "Invalid ticket format"
- Ticket must be exactly 64 characters
- Must be hexadecimal (0-9, a-f)

### Session expires immediately
- Check SESSION_DURATION_SECONDS in .env.local
- Verify middleware is enabled (it auto-extends sessions)

### CORE_SERVICE_URL not working
- Make sure Core is running on configured URL
- Check SERVICE_AUTH_TOKEN is correct
- Verify no firewall blocking the connection

### "Unauthorized" on all requests
- Check session cookie is being set
- Verify CORE_SERVICE_URL and SERVICE_AUTH_TOKEN
- Look at browser DevTools → Network → Cookies

## Files to Know

- **src/lib/auth/index.ts** - Main auth functions (getAuthUser, handleLogout, etc)
- **src/lib/auth/session.ts** - Session management
- **src/lib/auth/ticket-validator.ts** - Ticket validation with Core
- **src/app/auth-gate/page.tsx** - SSO entry point page
- **src/app/api/auth/sso-callback/route.ts** - Ticket exchange endpoint
- **src/middleware.ts** - Handles ticket params and session extension

## Questions?

See full documentation:
- **SSO_IMPLEMENTATION.md** - Complete reference
- **SSO_MIGRATION_COMPLETE.md** - Implementation details
- **TICKET_SSO_COMPLETE.md** - Full guide with architecture
