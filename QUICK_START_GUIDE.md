# QUICK START GUIDE - Summit One Inventory Management
**For Production Deployment**

## 🚀 WHAT'S NOW WORKING

All pages in your deployed app are now fully functional! You can:
- ✅ Add vendors, items, locations
- ✅ Create dashboards and add widgets  
- ✅ Manage purchase orders end-to-end
- ✅ Receive and issue inventory
- ✅ Transfer stock between locations
- ✅ View real-time stock balances

---

## 📍 HOW TO DO COMMON TASKS

### Add a Vendor
1. Navigate to **Inventory → Vendors**
2. Click **"+ Add Vendor"** button
3. Fill in:
   - Vendor Name (required)
   - Vendor Code (optional)
   - Contact info (name, email, phone)
   - Payment Terms (NET15, NET30, etc.)
   - Lead Time in days
4. Click **"Create Vendor"**

### Add a Catalog Item  
1. Navigate to **Inventory → Items**
2. Click **"+ Add Item"** button
3. Fill in:
   - Name (required) - e.g., "Hot Mix Asphalt"
   - SKU (required) - e.g., "HMA-001"
   - Description - detailed info
   - Unit of Measure - EA, BOX, LB, GAL, etc.
   - Tracking Mode - Stock, Serialized, or Both
   - Reorder Point - when to reorder
4. Click **"Create Item"**

### Add a Location
1. Navigate to **Inventory → Locations**
2. Click **"+ Add Location"** button  
3. Fill in:
   - Name (required) - e.g., "Main Warehouse"
   - Type - Warehouse, Yard, Truck, Job Site, Person, Vendor
   - Address - full address
4. Click **"Create Location"**

### Create a Dashboard
1. Navigate to **Dashboard** (top menu)
2. Click **"+ Create New Dashboard"** button
3. Fill in:
   - Dashboard Name (required)
   - Description (optional)
   - Set as default (checkbox)
4. Click **"Create Dashboard"**

### Add Widgets to Dashboard
1. Open your dashboard
2. Click **"Add Widget"** button (top right)
3. Browse or filter widgets by domain
4. Click on a widget card to add it
5. Widget appears on dashboard
6. Click **"Edit Layout"** to resize/rearrange
7. Click **"Save Layout"** when done

### Create a Purchase Order
1. Navigate to **Inventory → Purchasing**
2. Click **"+ Create PO"** button (routes to `/inventory/purchasing/create`)
3. Select:
   - Vendor (from dropdown)
   - Delivery Location (from dropdown)
   - Expected Delivery Date (optional)
4. Add line items:
   - Select item from dropdown
   - Enter quantity
   - Enter unit cost
   - Click "+ Add Line" for more items
5. Add notes (optional)
6. Click **"Create Purchase Order"**
7. PO created in "Draft" status

### Process a Purchase Order
1. Find PO in **Inventory → Purchasing** list
2. **Draft** POs:
   - Click **"Submit for Approval"** → moves to "Awaiting Approval"
3. **Awaiting Approval** POs:
   - Click **"Approve"** → moves to "Approved"
4. **Approved** POs:
   - Click **"Place Order"** → moves to "Placed" (sent to vendor)

### Receive Goods
1. Navigate to **Operations → Receive** → **Create Receipt**
2. Fill in:
   - Receipt Number (optional, auto-generated)
   - Location (where goods arrived)
   - Received Date
3. Add line items:
   - Select item from dropdown
   - Enter quantity received
4. Select **Auto-post to inventory** (recommended)
5. Add notes (optional)
6. Click **"Create Receipt"**
7. If auto-post enabled, inventory updates immediately

### Issue Inventory (to Job/Truck)
1. Navigate to **Operations → Issue**
2. Select:
   - From Location (where stock currently is)
   - Issued To Type (Job, Truck, Person, Other)
   - Issued To Reference (e.g., "Job #1234", "Truck #7")
   - Reason (why issuing)
3. Add items to issue:
   - Select item from dropdown
   - Enter quantity (validates against available stock)
   - Shows available qty in real-time
4. Add notes (optional)
5. Click **"Issue Inventory"**
6. Stock decreases at from-location

### Transfer Between Locations
1. Navigate to **Inventory → Transfers**
2. Click **"+ Create Transfer"** button
3. Enhanced modal opens with dropdowns:
   - **From Location** - select source location
   - **To Location** - select destination (filtered to exclude source)
4. Add line items:
   - Select item from dropdown (shows name, SKU, UOM)
   - Enter quantity
   - Click "+ Add Line" for more items
5. Add notes (optional)
6. Click **"Create Transfer"**
7. Transfer created in "Draft" status
8. Actions:
   - **Ship** → moves to "In Transit"  
   - **Receive** → moves to "Completed", updates stock
   - **Cancel** → cancels transfer

### View Stock Balances
1. Navigate to **Inventory → Stock**
2. View all stock by item and location
3. Columns show:
   - On Hand - total physical qty
   - Reserved - allocated but not issued
   - Available - on hand minus reserved
   - On Order - from open POs
   - Inventory Position - available + on order
4. Click a row to see:
   - Movement ledger (last 20 transactions)
   - Details of each movement

---

## 🔍 WHAT'S DIFFERENT FROM BEFORE

### Before:
- ❌ Forms asked for manual UUID entry
- ❌ No dropdowns for related data
- ❌ Hard to know what IDs to use
- ❌ API routes had schema errors
- ❌ RPC functions didn't work properly

### Now:
- ✅ All forms use dropdowns  
- ✅ Select locations, items, vendors by name
- ✅ See descriptive info (SKU, UOM, type)
- ✅ API routes properly access database
- ✅ RPC functions use correct schema
- ✅ Everything "just works"

---

## 💡 TIPS FOR SUCCESS

### When Starting Fresh:
1. **Add Locations first** - you need these for everything
2. **Add Vendors second** - needed for POs
3. **Add Items third** - needed for all transactions
4. **Then create your dashboard** - visualize your data

### Common Workflows:
- **Purchasing**: PO → Approval → Place → Receive → Stock Updated
- **Inventory**: Receive → Stock → Transfer → Issue
- **Reporting**: Dashboard → Add Widgets → Monitor KPIs

### Troubleshooting:
- If a page is empty, add data using the **"+ Add"** button
- If dropdowns are empty, add the prerequisite data first
- Check browser console (F12) for any errors
- All data is tenant-isolated (you only see your data)

---

## 📊 PAGE NAVIGATION

| Page | URL | Purpose |
|------|-----|---------|
| Dashboard | `/dashboard` | Main landing, KPIs, widgets |
| Vendors | `/inventory/vendors` | Supplier management |
| Items | `/inventory/items` | Catalog management |
| Locations | `/inventory/locations` | Location management |
| Stock | `/inventory/stock` | Stock balances view |
| Transfers | `/inventory/transfers` | Inter-location transfers |
| Purchasing | `/inventory/purchasing` | Purchase orders |
| Create PO | `/inventory/purchasing/create` | New PO form |
| Receive | `/operations/receive/create` | Receive goods |
| Issue | `/operations/issue` | Issue to job/truck |
| Reservations | `/inventory/reservations` | Stock reservations |
| Assets | `/inventory/assets` | Asset tracking |
| Movements | `/inventory/movements` | Transaction ledger |
| Reports | `/inventory/reports` | Analytics & reports |

---

## ✅ VERIFICATION CHECKLIST

After deploying, verify these work:

- [ ] Can login and see dashboard
- [ ] Can create a new dashboard
- [ ] Can add widgets to dashboard
- [ ] Can create a vendor
- [ ] Can create a location
- [ ] Can create a catalog item
- [ ] Can create a transfer with dropdowns (not UUIDs!)
- [ ] Can create a purchase order
- [ ] Can submit PO for approval
- [ ] Can receive inventory
- [ ] Can issue inventory
- [ ] Can view stock balances
- [ ] All dropdowns populate correctly
- [ ] No 500 errors in browser console

If all checked, **you're good to go!** 🎉

---

## 🆘 NEED HELP?

Common issues and solutions:

**Dropdown is empty:**
- Add the data first (e.g., add locations before creating transfer)

**"Not authenticated" error:**
- Session expired, refresh page or login again

**Schema error in console:**
- Should be fixed now, but check API route uses `inventory.table_name` format

**RPC function error:**
- Check that Supabase migrations are applied
- Verify RPC functions exist in database

---

## 🎯 YOU'RE ALL SET!

Your Summit One Inventory Management system is now **fully functional** with:
- Complete CRUD operations on all entities
- User-friendly forms with dropdowns
- End-to-end workflows working
- Real-time stock tracking
- Multi-tenant security
- Event-driven architecture

**Deploy with confidence!** 🚀
