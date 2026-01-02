# Inventory Management System - Database Migrations

This directory contains SQL migrations for a comprehensive event-driven inventory management system.

## Migration Files (in execution order)

### 1. `20260102000000_init_inventory_schema.sql`
Creates the `inventory` schema and sets up permissions.

### 2. `20260102000001_create_config_tables.sql`
**Dashboard & Widget Configuration**
- `inventory.dashboards` - Customizable dashboards (per tenant/role/user)
- `inventory.dashboard_widgets` - Widget configs that query read models

### 3. `20260102000002_create_reference_tables.sql`
**Reference Data (what things are + where they can be)**
- `inventory.item_categories` - SKU categories
- `inventory.catalog_items` - SKU definitions with tracking modes
- `inventory.locations` - Universal containers (yard, truck, job, person, vendor)
- `inventory.assets` - Serialized items (VIN/serial number tracking)
- `inventory.identifiers` - Additional IDs (barcodes, MPNs, GS1)

### 4. `20260102000003_create_event_ledger_tables.sql`
**Event Ledger (source of truth)**
- `inventory.inventory_events` - Receive/issue/transfer/adjust events
- `inventory.asset_events` - Asset lifecycle events
- `inventory.procurement_events` - PO/purchasing events

**Key Features:**
- ✅ Idempotency via `last_event_id` (UNIQUE constraint)
- Helper functions for idempotent inserts
- Indexes for event processing/polling

### 5. `20260102000004_create_read_models.sql`
**Read Models (fast queryable state for dashboards)**
- `inventory.stock_balances` - Current stock levels per item/location
- `inventory.reservations` - Active reservations/allocations
- `inventory.asset_state` - Current state of each asset
- `inventory.daily_item_activity` - Aggregated activity for charts
- `inventory.daily_asset_metrics` - Asset utilization metrics

### 6. `20260102000005_create_purchasing_and_cycle_count_tables.sql`
**Optional: Purchasing & Cycle Counting**
- `inventory.purchase_orders` - PO headers
- `inventory.purchase_order_lines` - PO line items
- `inventory.receipts` - Physical receipts (with idempotency)
- `inventory.receipt_lines` - Receipt line items
- `inventory.cycle_counts` - Scheduled counts
- `inventory.cycle_count_lines` - Count results with variance

## Key Design Patterns

### 1. **Tenant Isolation**
Every table has `tenant_id` with RLS policies:
```sql
tenant_id = (auth.jwt() ->> 'tenant_id')::UUID
```

### 2. **Idempotency**
Event tables use `last_event_id` with UNIQUE constraint:
```sql
CONSTRAINT events_tenant_last_event_id_unique UNIQUE (tenant_id, last_event_id)
```

Insert pattern:
```sql
INSERT INTO inventory.inventory_events (...)
VALUES (...)
ON CONFLICT (tenant_id, last_event_id) DO NOTHING;
```

### 3. **Event-Driven Architecture**
- **Events** → Immutable ledger (source of truth)
- **Pollers** → Process events and update read models
- **Dashboards** → Query read models only

### 4. **Auto-Updated Timestamps**
All tables have `created_at` and `updated_at` with triggers:
```sql
CREATE TRIGGER update_table_updated_at
    BEFORE UPDATE ON inventory.table_name
    FOR EACH ROW
    EXECUTE FUNCTION inventory.update_updated_at_column();
```

## Running Migrations

### Local Development (Supabase CLI)
```bash
# Reset database (WARNING: destroys all data)
npx supabase db reset

# Apply all migrations
npx supabase db push

# Create a new migration
npx supabase migration new migration_name
```

### Production
```bash
# Generate migration SQL
npx supabase db diff -f migration_name

# Apply to production
npx supabase db push --linked
```

## Minimum Table Set

For MVP supporting all widget types:
- ✅ Config: `dashboards`, `dashboard_widgets`
- ✅ Reference: `catalog_items`, `assets`, `locations`
- ✅ Ledger: `inventory_events`, `asset_events`
- ✅ Read Models: `stock_balances`, `reservations`, `asset_state`

Add purchasing + cycle count tables when needed.

## Indexing Strategy

- **Primary Keys**: UUID with `uuid_generate_v4()`
- **Tenant Isolation**: Index on `tenant_id`
- **Foreign Keys**: Indexed automatically
- **JSONB Columns**: GIN indexes for querying
- **Temporal Queries**: Indexes on date/timestamp fields
- **Partial Indexes**: For active records, non-null fields

## RLS Security

All tables have RLS enabled with tenant isolation policies. Service role can bypass RLS for background processing.

## Notes

- All tables use `TIMESTAMPTZ` for timezone awareness
- Numeric columns use `NUMERIC(18, 4)` for precision
- JSON columns use `JSONB` for performance
- Computed columns use `GENERATED ALWAYS AS ... STORED`
- CASCADE deletes on detail tables, RESTRICT on reference tables
