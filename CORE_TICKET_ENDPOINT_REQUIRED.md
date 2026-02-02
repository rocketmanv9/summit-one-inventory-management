# Core Ticket Validation Endpoint - Required for Inventory SSO

## Overview

The Inventory Management microservice has been updated to use **ticket-based SSO** instead of JWT tokens. Core must expose an API endpoint that validates tickets and returns user data.

## Required Endpoint

### `POST /api/auth/validate-ticket`

**Purpose:** Validate a single-use SSO ticket and return user information.

**Request:**
```typescript
POST https://dev.summit-one.app/api/auth/validate-ticket

Headers:
  Content-Type: application/json

Body:
{
  ticket: string,    // 64-character hex ticket from URL
  service: string    // "inventory" or other microservice identifier
}
```

**Success Response (200):**
```typescript
{
  user: {
    id: string,          // User UUID
    email: string,       // User email
    tenant_id: string,   // Active tenant/organization ID
    role: string,        // User role ("admin", "user", etc.)
    org_id?: string,     // Same as tenant_id (optional alias)
    name?: string        // User's display name
  }
}
```

**Error Responses:**

**404 Not Found** - Ticket invalid, expired, or already used:
```typescript
{
  error: "Ticket not found or expired",
  code: "INVALID_TICKET"
}
```

**400 Bad Request** - Missing required fields:
```typescript
{
  error: "Missing ticket or service parameter",
  code: "INVALID_REQUEST"
}
```

**500 Internal Server Error** - Server error:
```typescript
{
  error: "Ticket validation failed",
  code: "VALIDATION_ERROR"
}
```

## Implementation Details

### Using the `consume_auth_ticket()` Database Function

Core has a database function `public.consume_auth_ticket()` that handles ticket validation. The API endpoint should call this function:

```typescript
// Example implementation in Core
// File: src/app/api/auth/validate-ticket/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createHash } from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const { ticket, service } = await request.json();
    
    if (!ticket || !service) {
      return NextResponse.json(
        { error: 'Missing ticket or service parameter', code: 'INVALID_REQUEST' },
        { status: 400 }
      );
    }
    
    // Validate ticket format (64-char hex)
    if (!/^[a-f0-9]{64}$/i.test(ticket)) {
      return NextResponse.json(
        { error: 'Invalid ticket format', code: 'INVALID_TICKET' },
        { status: 400 }
      );
    }
    
    // Hash the ticket (tickets are stored as SHA-256 hashes)
    const ticketHash = createHash('sha256').update(ticket).digest('hex');
    
    // Get request metadata
    const ip = request.headers.get('x-forwarded-for') || 
               request.headers.get('x-real-ip') || 
               'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';
    
    // Create Supabase client with service role
    const supabase = await createClient();
    
    // Call the consume_auth_ticket function
    // This function atomically validates and marks the ticket as used
    const { data, error } = await supabase.rpc('consume_auth_ticket', {
      p_code_hash: ticketHash,
      p_target_service: service,
      p_target_tenant_id: null, // Let function validate tenant from ticket
      p_used_by_ip: ip,
      p_used_by_user_agent: userAgent
    });
    
    if (error || !data) {
      return NextResponse.json(
        { error: 'Ticket not found or expired', code: 'INVALID_TICKET' },
        { status: 404 }
      );
    }
    
    // The function returns { user_id, target_tenant_id }
    // Fetch full user data
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(data.user_id);
    
    if (userError || !userData.user) {
      return NextResponse.json(
        { error: 'User not found', code: 'USER_NOT_FOUND' },
        { status: 404 }
      );
    }
    
    const user = userData.user;
    
    // Return user data in expected format
    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email!,
        tenant_id: data.target_tenant_id,
        role: user.app_metadata?.role || 'user',
        org_id: data.target_tenant_id,
        name: user.user_metadata?.full_name || user.email
      }
    });
    
  } catch (error) {
    console.error('Ticket validation error:', error);
    return NextResponse.json(
      { error: 'Ticket validation failed', code: 'VALIDATION_ERROR' },
      { status: 500 }
    );
  }
}
```

## Database Function Reference

The `consume_auth_ticket()` function signature:

```sql
CREATE OR REPLACE FUNCTION public.consume_auth_ticket(
  p_code_hash TEXT,
  p_target_service TEXT,
  p_target_tenant_id UUID DEFAULT NULL,
  p_used_by_ip TEXT DEFAULT NULL,
  p_used_by_user_agent TEXT DEFAULT NULL
)
RETURNS JSON
```

**Returns:**
```json
{
  "user_id": "uuid",
  "target_tenant_id": "uuid"
}
```

**Behavior:**
- Validates ticket exists and matches hash
- Checks ticket hasn't been used (`used_at IS NULL`)
- Checks ticket hasn't expired (`expires_at > NOW()`)
- Validates `target_service` matches
- Validates `target_tenant_id` if provided
- Atomically marks ticket as used
- Returns user and tenant info

## Testing the Endpoint

Once implemented, test with:

```bash
# 1. Generate a ticket in Core (via /api/auth/generate-sso-token)
# 2. Test validation endpoint
curl -X POST https://dev.summit-one.app/api/auth/validate-ticket \
  -H "Content-Type: application/json" \
  -d '{"ticket":"YOUR_64_HEX_TICKET","service":"inventory"}'
```

## Security Notes

1. **Tickets are single-use** - Once validated, they cannot be used again
2. **Short-lived** - Tickets expire after 30 seconds
3. **Service-scoped** - Ticket must match the intended service
4. **Tenant-scoped** - Ticket validates against specific tenant
5. **Hashed storage** - Only SHA-256 hash is stored, never plaintext

## Migration Checklist for Core

- [ ] Create `/api/auth/validate-ticket` route handler
- [ ] Import and use `consume_auth_ticket()` function
- [ ] Hash incoming tickets with SHA-256 before validation
- [ ] Return user data in expected format
- [ ] Test with Inventory service locally
- [ ] Deploy to dev environment
- [ ] Update Inventory's `NEXT_PUBLIC_CORE_URL` to point to Core dev
- [ ] End-to-end SSO test from Core dashboard → Inventory

## Questions?

If Core needs clarification on:
- Expected response format
- Error handling
- Rate limiting
- Additional fields in user data

Please reach out before implementation.

---

**Last Updated:** February 2, 2026  
**Status:** Required for Inventory SSO to function  
**Priority:** High
