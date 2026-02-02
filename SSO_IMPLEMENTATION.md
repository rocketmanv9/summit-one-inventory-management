# Ticket-Based SSO Implementation

## Overview

The application now uses a **ticket-based SSO system** instead of JWT-based authentication. This means:

- **Core Service** generates temporary, single-use tickets (64-hex strings)
- **Inventory Service** validates tickets by calling back to Core
- **Sessions** are stored server-side (in-memory for dev, can use Redis for production)
- **Instant Revocation** - Core can instantly invalidate a ticket

## Flow

```
1. User clicks "Inventory" in Core
2. Core generates ticket → stores server-side
3. Core redirects to: /api/auth/sso-callback?ticket=<64hex>&target_service=inventory
4. Inventory validates ticket with Core
5. Inventory creates session → sets session cookie
6. User is authenticated for all subsequent requests
```

## API Routes

### POST /api/auth/sso-callback?ticket=<64hex>
**Purpose:** Exchange ticket for session

```bash
curl "http://localhost:3000/api/auth/sso-callback?ticket=abc123...def456"
```

**Response (on success):**
```json
{
  "success": true,
  "user": {
    "id": "user-123",
    "email": "user@example.com",
    "tenant_id": "tenant-abc",
    "role": "admin"
  },
  "sessionId": "..."
}
```

Sets `inventory_session_id` cookie (httpOnly, 1 hour).

### GET /api/auth/me
**Purpose:** Get current user information

```bash
curl -b "inventory_session_id=..." http://localhost:3000/api/auth/me
```

**Response:**
```json
{
  "data": {
    "userId": "user-123",
    "tenantId": "tenant-abc",
    "role": "admin",
    "email": "user@example.com",
    "name": "John Doe"
  },
  "authenticated": true
}
```

### POST /api/auth/logout
**Purpose:** Logout user

```bash
curl -X POST -b "inventory_session_id=..." http://localhost:3000/api/auth/logout
```

Returns 200 and clears session cookie.

## Using in API Routes

### Get Current User

```typescript
import { getAuthUser } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // Use user.id, user.tenant_id, user.role, etc.
  const { tenant_id, id, role } = user;
  
  // ... rest of handler
}
```

### Protect Route (Middleware Approach)

```typescript
import { requireAuth } from '@/lib/auth';

export async function POST(request: NextRequest) {
  // This returns error response if not authenticated
  const authError = await requireAuth(request);
  if (authError) return authError;
  
  const user = await getAuthUser(request);
  // Now user is guaranteed to exist
}
```

## Environment Variables

Add to `.env.local`:

```bash
# Core Service
CORE_SERVICE_URL=http://localhost:3001
SERVICE_AUTH_TOKEN=your-service-token

# Session
SESSION_DURATION_SECONDS=3600
```

## Session Management

### In-Memory Store (Development)
- Sessions stored in `Map<string, Session>`
- Auto-cleaned up after expiry
- Lost on server restart

### Redis Store (Production - Future)
- Can swap implementation in `src/lib/auth/session.ts`
- Set `REDIS_URL` environment variable
- Allows horizontal scaling

## Key Features

### 🔒 Security
- Sessions are server-side (cannot be forged)
- Single-use tickets prevent replay attacks
- Session cookies are `httpOnly` and `secure`
- Automatic expiry (1 hour sliding window)

### ⚡ Performance
- Ticket validation cached in session
- Automatic session extension on each request
- No database round-trip after initial exchange

### 🔄 Revocation
- Core can instantly revoke tickets
- Server-side sessions can be invalidated immediately
- No waiting for JWT expiry

## Testing Locally

1. **Start Inventory Service:**
```bash
npm run dev
```

2. **Call SSO Callback Manually (for testing):**
```bash
# This would normally come from Core with a real ticket
curl "http://localhost:3000/api/auth/sso-callback?ticket=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

Note: This will fail unless you have Core running and the ticket is valid.

3. **Test without Core (Mock):**
See `__tests__/security/` for mock implementations.

## Migration Path

### From JWT (Old):
```typescript
// OLD: JWT in Authorization header
const token = request.headers.get('Authorization')?.split(' ')[1];
const user = await supabase.auth.getUser(token);
```

### To Ticket-Based (New):
```typescript
// NEW: Session from cookie
const user = await getAuthUser(request);
```

## File Structure

```
src/
├── lib/auth/
│   ├── index.ts              # High-level auth functions
│   ├── ticket-validator.ts   # Validates tickets with Core
│   └── session.ts            # Session storage/retrieval
├── app/api/auth/
│   ├── me/route.ts          # GET user info
│   ├── sso-callback/route.ts # POST ticket exchange
│   └── logout/route.ts       # POST logout
├── middleware.ts             # Handles ticket redirect
└── .env.example              # Example config
```

## Troubleshooting

### "No SSO ticket provided"
- Check that Core is sending `?ticket=...` in redirect URL
- Check that middleware is catching the ticket

### "Core validation failed"
- Verify `CORE_SERVICE_URL` is correct
- Verify `SERVICE_AUTH_TOKEN` is provided
- Check Core service logs

### Session expires immediately
- Check `SESSION_DURATION_SECONDS` environment variable
- Verify cookie settings in `src/lib/auth/index.ts`

### Cookie not persisting
- Check browser accepts cookies (not private/incognito)
- Verify `sameSite=lax` is compatible with your domain setup
