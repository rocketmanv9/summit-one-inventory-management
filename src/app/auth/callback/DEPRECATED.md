# DEPRECATED

This route is deprecated as of the migration to ticket-based SSO (February 2026).

The new ticket-based authentication flow uses:
- **Entry Point**: `/auth-gate` (client page that handles ticket redirect)
- **API Callback**: `/api/auth/sso-callback` (server route that validates tickets with Core)
- **Middleware**: Automatically redirects `?ticket=...` URLs to the API callback

## Migration Notes

This file (`/auth/callback/route.ts`) handled JWT-based SSO tokens from Core using the old flow:
1. Core sends user to `?core_token=JWT`
2. This route validates JWT with Core's `/api/auth/validate-sso-token`
3. Creates Supabase user session

**New flow** (ticket-based):
1. Core sends user to `?ticket=64hex` 
2. Middleware redirects to `/api/auth/sso-callback?ticket=...`
3. API route validates ticket with Core's `/api/auth/validate-ticket`
4. Creates in-memory session with cookie

## Should this file be deleted?

Keep it temporarily for reference, but it should not be actively used. Consider removing after confirming the new flow works in production.
