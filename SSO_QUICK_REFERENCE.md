# Ticket-Based SSO - Quick Reference

## TL;DR

Old way (JWT):
```typescript
const token = request.headers.get('Authorization')?.split(' ')[1];
const user = await supabase.auth.getUser(token);
```

New way (Ticket-based):
```typescript
import { getAuthUser } from '@/lib/auth';
const user = await getAuthUser(request);
```

## Common Patterns

### Check if user is authenticated

```typescript
const user = await getAuthUser(request);
if (!user) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

### Use user context in queries

```typescript
const user = await getAuthUser(request);
const { tenant_id } = user; // Use this for filtering
```

### Protect entire route

```typescript
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  // Safe to proceed with authenticated user
}
```

### With idempotency

```typescript
import { requireIdempotencyKey } from '@/lib/db-middleware';
import { getAuthUser } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const idempotencyKey = await requireIdempotencyKey(request);
  
  // Make write operations
}
```

## Key Differences

| Aspect | JWT | Ticket |
|--------|-----|--------|
| Where stored | Client (localStorage/cookie) | Server |
| Validation | Local crypto check | Call Core |
| Revocation | Instant but requires client logout | Instant everywhere |
| Expiry | Fixed lifetime | Sliding window (extends on use) |
| Session ID | Token itself | Separate cookie |

## Session Duration

- **Duration**: 1 hour
- **Extension**: Automatic on each request (sliding window)
- **Max**: Even with constant requests, session expires after 1 hour
- **Cookies**: httpOnly, secure, sameSite=lax

## Common Errors

### Error: "Unauthorized"
User not logged in or session expired. 
→ Redirect to Core login or show login page

### Error: "Core validation failed"
Ticket is invalid or Core service unreachable.
→ Check Core is running
→ Check CORE_SERVICE_URL environment variable
→ Check SERVICE_AUTH_TOKEN is set

### Session lost after reload
This is expected behavior - cookies persist but check server config.
→ Verify httpOnly cookies are set
→ Check browser cookie settings
→ Ensure secure flag matches (http/https)

## Environment Setup

```bash
# .env.local
CORE_SERVICE_URL=http://localhost:3001
SERVICE_AUTH_TOKEN=your-token-here
```

## Testing

### With curl
```bash
# After getting a real ticket from Core:
curl "http://localhost:3000/api/auth/sso-callback?ticket=abc...123"

# Then check session:
curl -b "inventory_session_id=<sessionid>" http://localhost:3000/api/auth/me
```

### With browser
1. Visit Core → click Inventory link
2. Browser redirects to inventory with ticket
3. Inventory validates and sets session cookie
4. User is authenticated

## Monitoring

Check active sessions:
```typescript
import { getSessionCount } from '@/lib/auth/session';

const count = getSessionCount();
console.log(`Active sessions: ${count}`);
```

## Help

Need more details? See:
- `SSO_IMPLEMENTATION.md` - Full documentation
- `SSO_MIGRATION_COMPLETE.md` - Implementation details
- `src/lib/auth/` - Source code with comments
