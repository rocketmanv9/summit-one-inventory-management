# 🚀 Quick Setup Guide - Production Testing

## Problem
You're seeing these errors:
- `{"error":"Tenant not found"}` - No tenant in database
- `{"error":"Failed to fetch events"}` - No session cookie (not authenticated)

## Root Cause
The app expects SSO authentication from Summit Core, which provides:
1. Session cookie with tenant context
2. Tenant data synced from Core

When accessing the deployed app directly, you have neither.

## Solution: Development Login Flow

### Step 1: Seed Production Database

Run this SQL in Supabase SQL Editor:

```sql
-- File: seed_production_tenant.sql
-- Creates test tenant + sample locations + catalog items

BEGIN;

INSERT INTO public.tenants (id, name, slug, industry, metadata)
VALUES (
    'ba964c21-05a0-4a71-92ea-47ec7cfe0bbd'::uuid,
    'Summit One Demo',
    'summit-one-demo',
    'construction',
    '{}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW();

INSERT INTO inventory.locations (tenant_id, name, location_type, is_active)
VALUES
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Main Warehouse', 'warehouse', true),
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Yard A', 'yard', true),
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Field Office', 'office', true)
ON CONFLICT DO NOTHING;

INSERT INTO inventory.catalog_items (tenant_id, name, sku, uom, tracking_mode, reorder_point, is_active)
VALUES
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Hot Mix Asphalt (HMA)', 'HMA-001', 'TON', 'stock', 50, true),
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Ready-Mix Concrete 3000 PSI', 'RMC-3000', 'YD3', 'stock', 25, true),
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Rebar #4', 'REB-4', 'EA', 'stock', 100, true),
  ('ba964c21-05a0-4a71-92ea-47ec7cfe0bbd', 'Diesel Fuel', 'FUEL-DSL', 'GAL', 'stock', 500, true)
ON CONFLICT DO NOTHING;

COMMIT;
```

### Step 2: Add Environment Variable to Vercel

In Vercel dashboard → Settings → Environment Variables:

```
ALLOW_DEV_SESSION=true
```

This allows the `/api/dev-session` endpoint to work in production for testing.

### Step 3: Redeploy

After adding the env var, redeploy the app.

### Step 4: Login via Dev Login Page

1. Visit: `https://your-app.vercel.app/dev-login`
2. Click "Create Dev Session & Login"
3. You'll be redirected to `/dashboard` with a valid session cookie
4. All API routes will now work ✅

## What This Does

1. **seed_production_tenant.sql** - Creates test tenant with sample data
2. **ALLOW_DEV_SESSION** - Enables `/api/dev-session` endpoint in production
3. **/dev-login** - UI to create session cookie with tenant context
4. **Session Cookie** - Contains `{ tenantId, userId, role, email }`
5. **Middleware** - Extracts tenant from cookie → sets `x-tenant-id` header
6. **API Routes** - Read `x-tenant-id` header → query tenant-scoped data

## After Setup

You can now:
- ✅ View dashboard
- ✅ Add vendors
- ✅ Create catalog items
- ✅ Add widgets to dashboard
- ✅ View event catalog on debug page
- ✅ Receive inventory
- ✅ Create transfers

## Production SSO Flow (Future)

In production with Summit Core:
1. User clicks "Inventory" in Core
2. Core generates JWT token with tenant/user metadata
3. Core redirects to `/auth/callback?core_token=...`
4. App verifies JWT, creates session cookie
5. User lands on dashboard - fully authenticated

For now, use `/dev-login` to bypass SSO for testing.
