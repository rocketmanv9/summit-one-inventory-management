# Quick Reference: Asset Assignment Types

## 🚀 Quick Start

### Access Settings
```
Navigate: Settings > Asset Assignment Types
URL: /settings/assignment-types
```

### Add New Assignment Type
```
1. Click "+ Add Assignment Type"
2. Fill in:
   - Type Key: lowercase_key (e.g., contractor, tool_crib)
   - Display Name: Friendly Name (e.g., Contractor, Tool Crib)
   - Icon: 🔧 (optional emoji)
   - Description: When to use this type
   - Sort Order: 100 (lower = appears first)
   - Requires ID: ✓ (checked = ID required when assigning)
3. Click "Create"
```

### Assign Asset
```
1. Go to Inventory > Assets
2. Click "Assign" button on any asset
3. Select assignment type from dropdown
4. Enter ID/reference
5. Add notes (optional)
6. Click "Assign Asset"
```

## 📋 Default Types

| Icon | Type | Use Case |
|------|------|----------|
| 👤 | Employee | Individual employee custody |
| 👥 | Crew | Work crew or team |
| 🚛 | Vehicle | Company vehicle/truck |
| 🏗️ | Job Site | Specific job/project |
| 📍 | Yard/Location | Yard, warehouse, storage |
| 🏢 | Department | Department or division |

## 🔧 Common Examples

### Assign to Yard
```
Type: Yard/Location
ID: Main Yard
Notes: Long-term storage
```

### Assign to Crew
```
Type: Crew
ID: Paving Team 2
Notes: Highway 50 project
```

### Assign to Individual
```
Type: Employee
ID: EMP-1234
Notes: Daily equipment checkout
```

### Create "Contractor" Type
```
Type Key: contractor
Display Name: Contractor
Icon: 🔨
Description: Assign to external subcontractor
Sort Order: 80
Requires ID: Yes
```

## 🎯 Best Practices

### When to Create Custom Types
- ✅ Your organization has unique assignment categories
- ✅ You need different validation rules
- ✅ You want to track specific custody types
- ❌ Don't create types that overlap (e.g., "Employee" and "Worker")

### Naming Conventions
- **Type Key**: lowercase, underscores for spaces (tool_crib, contractor_crew)
- **Display Name**: Title Case (Tool Crib, Contractor Crew)
- **Icon**: Single emoji that represents the category

### Sort Order Guidelines
```
10-19: People (Employee, Crew)
20-39: Equipment (Vehicle, Tool)
40-59: Locations (Yard, Warehouse, Job Site)
60-99: Organizations (Department, Division)
100+: Custom/Other
```

## 🚫 Restrictions

### Cannot Delete
- System types (employee, vehicle, job, yard)
- Types currently in use (check usage count)

### Cannot Change
- Type key (locked after creation)

### Can Deactivate
- Any type (including system types)
- Hides from dropdowns
- Preserves historical assignments

## 📊 Usage Monitoring

### Check Type Usage
```sql
SELECT type_key, display_name, usage_count 
FROM inventory.v_assignment_types
WHERE tenant_id = 'your-tenant-id'
ORDER BY usage_count DESC;
```

### View in UI
- Settings > Asset Assignment Types
- "Usage" column shows active assignment count
- Cannot delete types with usage > 0

## 🔐 Permissions

### Who Can Manage Types?
- Admin users with access to Settings
- Service role (for automation)

### Who Can Assign Assets?
- Any authenticated user with inventory access
- Uses active types only

## 🐛 Troubleshooting

### "Invalid assignment type" error
**Cause**: Type doesn't exist or is inactive
**Fix**: Check Settings > Assignment Types, activate or create type

### Can't delete type
**Cause**: Type is in use or is system type
**Fix**: 
- If in use: Return all assets first, then delete
- If system: Deactivate instead

### Type not appearing in dropdown
**Cause**: Type is inactive
**Fix**: Settings > Assignment Types > Activate

## 📱 Mobile Usage

Assignment types work on mobile:
```
1. Open Assets page
2. Tap asset > Assign
3. Select type from dropdown
4. Enter ID (keyboard auto-suggests)
5. Tap "Assign Asset"
```

## 🔮 Advanced

### Seed Types for New Tenant
```sql
SELECT inventory.seed_default_assignment_types('new-tenant-uuid');
```

### Bulk Create Types via API
```typescript
const types = [
  { type_key: 'contractor', display_name: 'Contractor', icon: '🔨' },
  { type_key: 'tool_crib', display_name: 'Tool Crib', icon: '🧰' },
  { type_key: 'rental', display_name: 'Rental', icon: '💸' },
];

for (const type of types) {
  await fetch('/api/inventory/assignment-types', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(type),
  });
}
```

### Custom Validation
You can add business logic:
```typescript
// Before assigning to contractor, verify contract status
if (assigned_to_type === 'contractor') {
  const contract = await checkContractStatus(assigned_to_id);
  if (!contract.active) {
    throw new Error('Contractor contract is not active');
  }
}
```

## 📞 Support

If you need help:
1. Check ASSET_ASSIGNMENT_TYPES_COMPLETE.md for full documentation
2. Review database schema in migration file
3. Check API endpoints in `/api/inventory/assignment-types`
