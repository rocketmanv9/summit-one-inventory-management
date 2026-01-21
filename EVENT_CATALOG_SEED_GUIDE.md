# EVENT CATALOG SEED - QUICK REFERENCE

## What This Does
Seeds your production database with the complete event catalog (46 events total):

**Supply Chain Events (12):**
- Vendor events (2): created, updated
- Purchase Order events (7): created, submitted, approved, in_transit, cancelled, received, closed
- Receipt events (3): created, line_added, posted

**Inventory Events (34):**
- Catalog item events (4)
- Location events (3)
- Stock movement events (5)
- Transfer events (3)
- Reservation events (3)
- Asset events (5)
- Cycle count events (5)
- Adjustment events (2)
- Category events (2)
- System/Legacy events (2)

## Option 1: Using Supabase CLI (Recommended)

```powershell
# Make sure you're linked to your project first
supabase link --project-ref YOUR_PROJECT_REF

# Run the seed script
.\seed_production_events.ps1
```

## Option 2: Using Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Click **New Query**
4. Copy the contents of `supabase/migrations/20260121000008_seed_production_event_catalog.sql`
5. Paste into the query editor
6. Click **Run**

## Option 3: Manual Migration Push

```powershell
# Push all pending migrations (including the event catalog seed)
supabase db push
```

## Verification

After seeding, verify the events were registered:

### In Supabase Dashboard:
```sql
SELECT 
    event_name,
    version,
    producer,
    status,
    description
FROM public.event_catalog
WHERE event_name LIKE 'inventory.%'
ORDER BY event_name;
```

### In Your App:
Navigate to: `/debug` page and check the "Event Catalog" section

## Events Included

### Stock Events
- `inventory.stock.adjusted` - Stock level changes

### Catalog Events  
- `inventory.item.created` - New catalog items

### Purchase Order Events
- `inventory.po.placed` - PO placed with vendor
- `inventory.po.received` - PO received
- `inventory.po.cancelled` - PO cancelled

### Receipt Events
- `inventory.receipt.created` - Goods received

### Transfer Events
- `inventory.transfer.created` - Transfer created
- `inventory.transfer.shipped` - Transfer shipped
- `inventory.transfer.received` - Transfer received

### Cycle Count Events
- `inventory.cycle_count.discrepancy` - Count variance found

### Reservation Events
- `inventory.reservation.created` - Inventory reserved
- `inventory.reservation.fulfilled` - Reservation fulfilled

### Alert Events
- `inventory.alert.low_stock` - Stock below reorder point

## Troubleshooting

**Migration already applied:**
The migration has a `DELETE` statement at the top to clean up any existing test events, so it's safe to run multiple times.

**Connection issues:**
```powershell
# Check current link
supabase link --project-ref show

# Relink if needed
supabase link --project-ref YOUR_PROJECT_REF
```

**Permission denied:**
Make sure you're using service role credentials or have admin access to the database.

## What Happens Next

Once seeded:
1. ✅ Event catalog is populated
2. ✅ Events are visible in `/debug` page
3. ✅ Triggers can emit events when inventory actions occur
4. ✅ Event-driven architecture is fully functional
5. ✅ Future event subscribers can discover available events

## Need Help?

Check the migration file directly:
`supabase/migrations/20260121000008_seed_production_event_catalog.sql`

The file includes:
- Full event definitions with schemas
- Example payloads for each event
- Validation queries
- Success verification messages
