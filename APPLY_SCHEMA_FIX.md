# Schema/API Mismatch Fix - Apply to Production

## Quick Steps

1. **Go to Supabase SQL Editor:**
   - Open https://supabase.com/dashboard/project/cwmsvmywairkwdmvkdmw/sql
   
2. **Run the migration:**
   - Open file: `supabase/migrations/20260122000001_fix_schema_api_mismatches.sql`
   - Copy ALL content
   - Paste into SQL Editor
   - Click "Run" button

3. **Verify success:**
   - You should see output messages confirming each table was fixed
   - Final message: "SCHEMA/API MISMATCH FIX COMPLETE"

## What This Fixes

### Dashboards (public schema)
- ✓ Adds `scope`, `owner_user_id`, `role_key` columns
- ✓ Fixes "Failed to create dashboard" error

### Catalog Items (inventory schema)
- ✓ Adds `description` field
- ✓ Adds `unit_of_measure` (APIs use this instead of `uom`)
- ✓ Adds `reorder_point`, `min_stock_level`, `max_stock_level`
- ✓ Fixes catalog item creation

### Locations (inventory schema)
- ✓ Adds `address` field
- ✓ Fixes location creation

### Assets (inventory schema)
- ✓ Adds `location_id` (APIs use this instead of `home_location_id`)
- ✓ Adds `purchase_date`, `purchase_cost`, `warranty_expires`
- ✓ Fixes asset creation

## After Running

Try creating a dashboard again - it should work!

All inventory CRUD operations (items, locations, assets) should now work correctly.
