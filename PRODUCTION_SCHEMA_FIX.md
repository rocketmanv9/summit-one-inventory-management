# Production Schema Qualification Fix

## Issue Summary
Production deployment was failing with the following errors:
- `GET /api/tenant 404 (Not Found)`
- `GET /api/inventory/* 500 (Internal Server Error)`
- `Could not find the table 'public.inventory.catalog_items' in the schema cache`

## Root Cause
The Supabase client in `db-middleware.ts` is configured with `{db: {schema: 'inventory'}}`, but queries were using `.from('inventory.catalog_items')` with schema prefix.

PostgREST interprets this combination incorrectly:
- Client schema: `inventory`
- Query: `.from('inventory.catalog_items')`
- Result: PostgREST looks for `public.inventory.catalog_items` (treating `inventory.catalog_items` as a table name in the public schema)

## Solution
Remove the schema prefix from all `.from()` calls when using the configured client, since the schema is already set in the client configuration.

### Files Fixed
1. **src/app/api/inventory/items/route.ts**
   - Changed `.from('inventory.catalog_items')` → `.from('catalog_items')`
   - Changed `.from('inventory.item_categories')` → `.from('item_categories')`

2. **src/app/api/inventory/locations/route.ts**
   - Changed `.from('inventory.locations')` → `.from('locations')`

3. **src/app/api/inventory/vendors/route.ts**
   - Changed `.from('inventory.vendors')` → `.from('vendors')`

4. **src/lib/rpc/inventory.ts**
   - Fixed all inventory schema table references:
     - `catalog_items`
     - `locations`
     - `stock_balances`
     - `mv_low_stock_summary`
     - `mv_inventory_summary`
     - `transfers`
     - `reservations`

5. **src/lib/rpc/supply-chain.ts**
   - Fixed `getVendors()` to use `.from('vendors')` instead of `.from('inventory.vendors')`
   - **Note:** `supply_chain.purchase_orders` and `supply_chain.receipts` are left as-is because:
     - This file uses `@/supabase/client` which has NO schema configured
     - Therefore, explicit schema qualification is required for supply_chain tables

## Pattern Rules
1. **For inventory schema tables:**
   - Use `createClient()` from `@/lib/db-middleware` (schema: 'inventory')
   - Use `.from('table_name')` WITHOUT schema prefix

2. **For supply_chain schema tables:**
   - Use `createClient()` from `@/supabase/client` (NO schema configured)
   - Use `.from('supply_chain.table_name')` WITH schema prefix

3. **For public schema tables (tenants, etc.):**
   - Either client can be used
   - Use `.schema('public').from('table_name')` or just `.from('table_name')` if no schema is configured

## Expected Results
After deploying these changes:
- All `/api/inventory/*` endpoints should return proper data
- Schema lookup errors should be resolved
- Queries will correctly target `inventory.catalog_items` instead of `public.inventory.catalog_items`

## Deployment Steps
1. Commit and push these changes
2. Vercel will auto-deploy
3. Verify production console shows no schema errors
4. Test all inventory API endpoints

## /api/tenant 404 Issue
The `/api/tenant/route.ts` file exists and should work. If the 404 persists after this deployment:
1. Check Vercel build logs for route compilation
2. Verify the route appears in the build output
3. Try clearing Vercel's build cache and redeploying
