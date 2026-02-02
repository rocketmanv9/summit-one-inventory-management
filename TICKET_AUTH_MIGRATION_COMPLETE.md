# Inventory Service - Ticket-Based Auth Migration Complete

## Summary

Successfully updated the Inventory Management microservice to work with Core's new **ticket-based SSO system** (migrated from JWT tokens).

## Changes Made

### 1. Updated Ticket Validator ([ticket-validator.ts](src/lib/auth/ticket-validator.ts))
- Changed endpoint from `/api/sso/validate` to `/api/auth/validate-ticket`
- Updated to use `NEXT_PUBLIC_CORE_URL` instead of `CORE_SERVICE_URL`
- Removed `X-Service-Auth` header (not needed for ticket validation)
- Now calls Core at: `https://dev.summit-one.app/api/auth/validate-ticket`

### 2. Updated Environment Configuration ([.env.local](.env.local))
- Kept `NEXT_PUBLIC_CORE_URL=https://dev.summit-one.app`
- Deprecated `CORE_SSO_SECRET` (no longer needed for tickets)
- Removed `CORE_SERVICE_URL` and `SERVICE_AUTH_TOKEN` (obsolete)

### 3. Cleaned Up Auth Code
- **AuthGate Component:** Removed JWT `core_token` handling (middleware now handles `?ticket=` params)
- **Middleware:** Already correctly redirects `?ticket=...` to `/api/auth/sso-callback`
- **Old Route:** Deprecated `/auth/callback` (JWT-based) - see [DEPRECATED.md](src/app/auth/callback/DEPRECATED.md)
- **SSO Callback:** Already implements ticket validation via `/api/auth/sso-callback`

### 4. Updated Tests ([debug-auth-requirements.test.ts](__tests__/security/debug-auth-requirements.test.ts))
- Migrated from JWT-based auth to ticket-based session cookies
- Tests now expect `inventory_session_id` cookie instead of `Authorization: Bearer JWT`
- Added placeholders for Core ticket generation (needs Core endpoint)
- Marked tests as skipped until Core implements `/api/auth/generate-sso-ticket`

## Current SSO Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User clicks "Inventory Management" in Core dashboard    │
└──────────────────────────┬──────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. Core generates 64-hex ticket, stores hash in DB         │
│    Calls: sso-generate Edge Function                       │
└──────────────────────────┬──────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. Core redirects to:                                       │
│    https://inventory.summit-one.app/                        │
│      ?ticket=abc123...&target_service=inventory             │
└──────────────────────────┬──────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. Inventory middleware catches ?ticket param               │
│    Redirects to: /api/auth/sso-callback?ticket=...         │
└──────────────────────────┬──────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. SSO callback validates ticket with Core:                │
│    POST https://dev.summit-one.app/api/auth/validate-ticket│
│    Body: { ticket: "abc123...", service: "inventory" }     │
└──────────────────────────┬──────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. Core calls consume_auth_ticket() DB function             │
│    Returns: { user: { id, email, tenant_id, role } }       │
└──────────────────────────┬──────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ 7. Inventory creates session (in-memory + cookie)          │
│    Sets cookie: inventory_session_id=<session-uuid>        │
│    Redirects to: /dashboard                                │
└─────────────────────────────────────────────────────────────┘
```

## What Core Needs to Implement

⚠️ **BLOCKER:** Core must create the `/api/auth/validate-ticket` endpoint.

See full specification: [CORE_TICKET_ENDPOINT_REQUIRED.md](CORE_TICKET_ENDPOINT_REQUIRED.md)

**Quick summary:**
- **Endpoint:** `POST /api/auth/validate-ticket`
- **Input:** `{ ticket: string, service: string }`
- **Output:** `{ user: { id, email, tenant_id, role, name } }`
- **Implementation:** Calls `consume_auth_ticket()` DB function with SHA-256 hash of ticket

## Testing

Once Core implements the endpoint:

```bash
# 1. Start Core locally (must have ticket generation working)
# 2. Start Inventory service
npm run dev

# 3. Navigate to Core dashboard
# 4. Click "Inventory Management" button
# 5. Should redirect to Inventory with ticket
# 6. Ticket gets validated, session created, redirect to /dashboard
```

## File Changes Summary

| File | Status | Change |
|------|--------|--------|
| [ticket-validator.ts](src/lib/auth/ticket-validator.ts) | ✅ Updated | New Core endpoint URL |
| [.env.local](.env.local) | ✅ Updated | Deprecated old JWT vars |
| [AuthGate.tsx](src/components/AuthGate.tsx) | ✅ Updated | Removed JWT token handling |
| [/auth/callback](src/app/auth/callback) | ⚠️ Deprecated | Marked for removal |
| [debug-auth-requirements.test.ts](__tests__/security/debug-auth-requirements.test.ts) | ✅ Updated | Ticket-based tests |
| [CORE_TICKET_ENDPOINT_REQUIRED.md](CORE_TICKET_ENDPOINT_REQUIRED.md) | ✅ Created | Core implementation spec |

## Next Steps

1. **Core Team:** Implement `/api/auth/validate-ticket` endpoint (see [spec](CORE_TICKET_ENDPOINT_REQUIRED.md))
2. **Test locally:** Verify SSO flow from Core → Inventory
3. **Deploy to dev:** Update Inventory's `NEXT_PUBLIC_CORE_URL` if needed
4. **E2E test:** Full SSO flow in deployed dev environment
5. **Enable tests:** Uncomment skipped tests once Core endpoint is live

## Environment Variables

Current configuration:

```bash
# Required
NEXT_PUBLIC_CORE_URL=https://dev.summit-one.app     # Core base URL
NEXT_PUBLIC_SUPABASE_URL=<inventory-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<key>
SUPABASE_SERVICE_ROLE_KEY=<key>

# Deprecated (no longer used)
# CORE_SSO_SECRET=...
# CORE_SERVICE_URL=...
# SERVICE_AUTH_TOKEN=...
```

## Questions?

- **"Why tickets instead of JWTs?"** - Tickets are server-side, single-use, short-lived (30s), and can be instantly revoked
- **"What if Core endpoint isn't ready?"** - Inventory auth will fail; SSO flow breaks at ticket validation step
- **"Can we test without Core?"** - Not easily; you'd need to mock Core's ticket validation endpoint

---

**Status:** ✅ Ready for Core endpoint implementation  
**Last Updated:** February 2, 2026  
**Author:** GitHub Copilot
