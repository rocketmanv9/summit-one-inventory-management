# Production Auth Setup - Inventory Microservice

## Overview

This service uses **Supabase JWTs from Core** as the primary authentication mechanism. No auth bypasses - strict RLS enforcement.

## JWT Claims Structure

Expected claims in the JWT token from Core:

```json
{
  "sub": "user-uuid",              // User ID (maps to auth.uid())
  "email": "user@example.com",
  "app_metadata": {
    "tenant_id": "uuid",           // ✅ Required - tenant isolation
    "role": "admin|manager|user",  // ✅ Required - role-based access
    "modules": ["inventory", "..."] // ✅ Required - module permissions
  }
}
```

## Environment Variables

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...  # Server-side only
```

## Database Schema

### Audit Fields (All Tables)

Every table includes:
- `tenant_id` UUID NOT NULL - Tenant isolation
- `created_at` TIMESTAMPTZ NOT NULL
- `updated_at` TIMESTAMPTZ NOT NULL  
- `created_by` UUID → auth.users(id) - Auto-set from auth.uid()
- `updated_by` UUID → auth.users(id) - Auto-set from auth.uid()

### Indexes

All tables have:
- `tenant_id` indexed
- Compound indexes: `(tenant_id, created_at)`, etc.
- Created by indexed for audit queries

## RLS Policies

### Tenant Isolation (All Tables)

```sql
CREATE POLICY {table}_tenant_isolation ON inventory.{table}
    FOR ALL
    USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
```

**No COALESCE bypasses** - JWT tenant_id claim is required.

### Role-Based Policies

Example - Only admins can delete catalog items:

```sql
CREATE POLICY catalog_items_delete_admin_only ON inventory.catalog_items
    FOR DELETE
    USING (
        tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    );
```

Example - Admins can modify approved POs:

```sql
CREATE POLICY purchase_orders_update_admin_or_draft ON inventory.purchase_orders
    FOR UPDATE
    USING (
        tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
        AND (status = 'draft' OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
    );
```

## API Routes

### Auth Middleware

All API routes use auth middleware:

```typescript
import { withAuth, withRole, withModule } from '@/lib/auth-middleware';

// Requires authentication
export const GET = withAuth(async (req, authContext) => {
  // authContext: { userId, tenantId, role, modules, email }
  // RLS automatically filters by tenantId
});

// Requires specific role
export const DELETE = withRole('admin', async (req, authContext) => {
  // Only admins can access
});

// Requires module access
export const POST = withModule('inventory', async (req, authContext) => {
  // Only users with 'inventory' module can access
});
```

### Request Format

All requests must include Bearer token:

```http
GET /api/inventory/items
Authorization: Bearer <supabase-jwt-token>
```

### Response Format

```json
{
  "data": [...],
  "meta": {
    "tenantId": "uuid",
    "count": 10
  }
}
```

## Supabase Client Usage

### Browser/Client Components

```typescript
import { supabase } from '@/supabase/client';

// User must be authenticated - session includes JWT
const { data } = await supabase
  .from('catalog_items')
  .select('*');
// RLS automatically filters by user's tenant_id from JWT
```

### API Routes (Server-side)

```typescript
import { createAuthenticatedClient } from '@/supabase/client';

export const GET = withAuth(async (req, authContext) => {
  const token = req.headers.get('authorization')!.substring(7);
  const supabase = createAuthenticatedClient(token);
  
  // RLS uses JWT claims from token
  const { data } = await supabase
    .from('catalog_items')
    .select('*');
});
```

### Service Role (Background Jobs)

```typescript
import { supabaseAdmin } from '@/supabase/client';

// ⚠️ Bypasses RLS - must manually filter!
const { data } = await supabaseAdmin
  .from('catalog_items')
  .select('*')
  .eq('tenant_id', tenantId); // Manual filtering required!
```

## Events & Outbox Pattern

### Events Outbox Table

Domain events are published to `inventory.events_outbox`:

```typescript
{
  tenant_id: "uuid",
  scope: "tenant" | "profile" | "global",
  event_type: "item.created",
  aggregate_type: "catalog_item",
  aggregate_id: "uuid",
  actor_user_id: "uuid",  // From auth.uid()
  payload: {...},
  metadata: {...}
}
```

### Auto-Publishing

Events are automatically published from ledger tables:
- `inventory_events` → outbox
- `asset_events` → outbox  
- `procurement_events` → outbox

### Manual Publishing

```sql
SELECT inventory.publish_event(
  'tenant-uuid',
  'tenant',
  'item.updated',
  'catalog_item',
  'item-uuid',
  '{"sku": "ABC-123"}'::jsonb
);
```

## Service-to-Service Auth

For internal microservice calls (not from web app):

### Request Format

```http
GET /api/internal/inventory/sync
X-Service-Auth: <service-jwt-token>
```

### Service JWT Structure

```json
{
  "service_id": "job-service",
  "scope": "global",
  "iat": 1234567890,
  "exp": 1234567900
}
```

**Note**: Service JWT implementation is TODO - currently validates user JWTs only.

## Authorization Matrix

| Action | Role Required | Module Required |
|--------|---------------|-----------------|
| View items | any | inventory |
| Create items | user+ | inventory |
| Update items | user+ | inventory |
| Delete items | admin | inventory |
| Approve POs | manager+ | inventory |
| Delete POs | admin | inventory |
| View events | user+ | inventory |
| Publish events | service | - |

## Security Checklist

✅ All tables have `tenant_id` NOT NULL  
✅ All tables have RLS enabled  
✅ RLS policies check `auth.jwt() ->> 'tenant_id'`  
✅ Audit fields (created_by, updated_by) auto-set from auth.uid()  
✅ API routes use auth middleware  
✅ No COALESCE bypasses in RLS  
✅ Service role access is explicit and logged  
✅ Events include tenant_id and actor_user_id  

## Testing

### Setup Test User

In Supabase Auth, create user with app_metadata:

```json
{
  "tenant_id": "ae837809-1a24-4ab5-ba06-34fd98c05f48",
  "role": "admin",
  "modules": ["inventory", "dashboard"]
}
```

### Get Access Token

```typescript
const { data: { session } } = await supabase.auth.signInWithPassword({
  email: 'test@example.com',
  password: 'password'
});

const accessToken = session.access_token;
```

### Test API

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/inventory/items
```

## Migration Notes

Tenant ID for seed data: **ae837809-1a24-4ab5-ba06-34fd98c05f48**

All sample data uses this tenant ID. When implementing real auth, users must have this tenant_id in their JWT app_metadata to see the seed data.
