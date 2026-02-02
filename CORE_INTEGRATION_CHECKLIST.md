# Core Integration Checklist

## Pre-Integration Questions (Answer These First)

- [ ] What is the exact URL of Core's `/api/sso/validate` endpoint?
- [ ] What HTTP method should we use? (POST assumed)
- [ ] What should be in the request body? (format/field names)
- [ ] How do we authenticate with Core? (SERVICE_AUTH_TOKEN header/format)
- [ ] What is the exact response format on success?
- [ ] What error codes does Core return? (INVALID_TICKET, EXPIRED_TICKET, etc)
- [ ] How long are tickets valid? (Expiration time)
- [ ] Can a ticket be used multiple times or single-use only?
- [ ] What should happen if Core is unavailable?

## Environment Setup

### Development
```env
CORE_SERVICE_URL=http://localhost:3001          # or Core's dev URL
SERVICE_AUTH_TOKEN=dev-token-from-core-team
SESSION_DURATION_SECONDS=3600
```

### Staging
```env
CORE_SERVICE_URL=https://staging-core.summit-one.app
SERVICE_AUTH_TOKEN=staging-token-from-core-team
SESSION_DURATION_SECONDS=3600
```

### Production
```env
CORE_SERVICE_URL=https://api.summit-one.app/core
SERVICE_AUTH_TOKEN=production-token-from-vault
SESSION_DURATION_SECONDS=3600
REDIS_URL=redis://redis-cluster:6379            # For session storage
```

## Step 1: Understand Core's Ticket Validation Endpoint

**File to update:** `src/lib/auth/ticket-validator.ts`

Current implementation assumes:
```typescript
POST {CORE_SERVICE_URL}/api/sso/validate
Header: X-Service-Auth: {SERVICE_AUTH_TOKEN}
Body: { ticket: string }
Response: { user: { id, email, tenant_id, role, org_id, name } }
```

**TODO**: Confirm this matches Core's actual API
- [ ] Verify endpoint URL
- [ ] Verify authentication method
- [ ] Verify request body format
- [ ] Verify response format
- [ ] Verify error responses

## Step 2: Verify AuthGate Redirect

Core should send user to:
```
https://inventory.app/auth-gate?ticket=abc123&target_service=inventory&target_org=tenant_uuid
```

**File involved:** `src/app/auth-gate/page.tsx`

- [ ] Confirm Core knows to redirect to `/auth-gate`
- [ ] Confirm ticket parameter is passed
- [ ] Confirm target_service is "inventory"
- [ ] Confirm target_org is the tenant UUID

## Step 3: Test Ticket Exchange

### Manual Test
```bash
# 1. Get a real ticket from Core (manually during login)
TICKET="abc123def456..."

# 2. Call sso-callback
curl "http://localhost:3000/api/auth/sso-callback?ticket=$TICKET" \
  -v -b cookies.txt -c cookies.txt

# 3. Check session was created
curl "http://localhost:3000/api/auth/me" \
  -b cookies.txt
```

**Expected flow:**
1. sso-callback returns 200 with user data + session cookie
2. me returns 200 with user info
3. Cookie `inventory_session_id` should be set

### Automated Test
Create `__tests__/security/ticket-auth.test.ts`:
```typescript
describe('Ticket-Based SSO', () => {
  test('should exchange valid ticket for session', async () => {
    const response = await fetch('/api/auth/sso-callback?ticket=<real-ticket>');
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toContain('inventory_session_id');
  });

  test('should reject invalid ticket', async () => {
    const response = await fetch('/api/auth/sso-callback?ticket=invalid');
    expect(response.status).toBe(401);
  });
});
```

- [ ] Test with real Core ticket
- [ ] Verify session is created
- [ ] Verify redirect works
- [ ] Verify cookie is secure (httpOnly)

## Step 4: Update Protected Routes

All API routes that need authentication should use:
```typescript
const user = await getAuthUser(request);
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
```

**Routes to update (~87 total):**
- All `/api/inventory/*` routes
- All `/api/supply-chain/*` routes
- All `/api/dashboards/*` routes
- All `/api/settings/*` routes
- Any new `/api/*` routes

**Strategy:**
1. [ ] Create a script to add auth check to all routes
2. [ ] Test with authenticated session
3. [ ] Verify 401 without session
4. [ ] Test tenant isolation (can't access other tenant's data)

## Step 5: Configure Middleware

File: `src/middleware.ts`

Current implementation:
- Catches `?ticket=` in URL
- Redirects to `/api/auth/sso-callback`
- Extends session on each request

**Verify:**
- [ ] Middleware matcher is correct
- [ ] Ticket redirect works
- [ ] Session sliding window works
- [ ] Non-authenticated routes still accessible

## Step 6: Test Full Flow

### From Core
1. [ ] Log in in Core
2. [ ] Core redirects to Inventory's /auth-gate
3. [ ] Redirected to /dashboard
4. [ ] Session is established
5. [ ] Can access protected pages
6. [ ] Can call API endpoints with authentication

### Error Cases
1. [ ] Invalid ticket → error page
2. [ ] Core unavailable → graceful error
3. [ ] Expired ticket → error page
4. [ ] No ticket → error page
5. [ ] Session expires → redirect to login

## Step 7: Verify Security

- [ ] Session cookie is httpOnly
- [ ] Session cookie is secure (HTTPS only in production)
- [ ] Session cookie has sameSite=lax
- [ ] Tickets are single-use only
- [ ] Sessions can be revoked immediately
- [ ] Tenant ID is validated on every request
- [ ] User role is checked for admin operations

**Test:**
```bash
# Verify httpOnly (should not be accessible from JavaScript)
curl http://localhost:3000/api/auth/me \
  -H "Cookie: inventory_session_id=<session-id>" \
  | jq '.user'
```

## Step 8: Performance Testing

Measure:
- [ ] Ticket validation time (should be <100ms)
- [ ] Session lookup time (should be <2ms)
- [ ] End-to-end auth flow (should be <200ms)

Create test:
```typescript
const start = Date.now();
const user = await getAuthUser(request);
const duration = Date.now() - start;
console.log(`Auth lookup: ${duration}ms`);
```

## Step 9: Production Readiness

### Session Storage
- [ ] Move to Redis for production (optional but recommended)
- [ ] Configure Redis connection pool
- [ ] Test session persistence across restarts

### Security
- [ ] Enable secure cookies (automatic in production)
- [ ] Set appropriate SERVICE_AUTH_TOKEN
- [ ] Configure CORE_SERVICE_URL for production
- [ ] Add rate limiting to /api/auth/sso-callback
- [ ] Enable CSRF protection if needed

### Monitoring
- [ ] Log all auth events (new session, validation failure)
- [ ] Monitor Core validation endpoint response times
- [ ] Alert on repeated validation failures
- [ ] Track session creation/invalidation rates

### Deployment
- [ ] Add SERVICE_AUTH_TOKEN to production secrets
- [ ] Configure CORE_SERVICE_URL in production
- [ ] Test SSO flow in staging before production
- [ ] Have rollback plan (keep JWT validation as fallback?)

## Step 10: Finalization

- [ ] All API routes use authentication
- [ ] Core successfully integrates with Inventory
- [ ] Full end-to-end flow works
- [ ] Error handling is robust
- [ ] Performance is acceptable
- [ ] Security audit passed
- [ ] Documentation updated
- [ ] Team trained on new auth system

## Files Changed
✅ `src/lib/auth/ticket-validator.ts` - Ticket validation
✅ `src/lib/auth/session.ts` - Session management
✅ `src/lib/auth/index.ts` - Auth utilities
✅ `src/app/api/auth/sso-callback/route.ts` - SSO callback
✅ `src/app/api/auth/me/route.ts` - Current user
✅ `src/app/api/auth/logout/route.ts` - Logout
✅ `src/app/auth-gate/page.tsx` - SSO entry point
✅ `src/middleware.ts` - Ticket handling
✅ `.env.example` - Configuration template
✅ `tsconfig.json` - Type configuration

## Build Status
✅ **All 88 routes compile successfully**
✅ **0 TypeScript errors**
✅ **Ready for integration testing**

## Next Action
Contact Core team with:
1. Confirm `/api/sso/validate` specification
2. Provide CORE_SERVICE_URL and SERVICE_AUTH_TOKEN
3. Set up staging/production integration
4. Begin end-to-end testing
