# Development Setup - Tenant ID

## ✅ Tenant Created

**Tenant ID:** `ba964c21-05a0-4a71-92ea-47ec7cfe0bbd`  
**Tenant Name:** Summit One Demo  
**Slug:** summit-one-demo

## 🔑 How to Login (Dev Mode)

Since you're using the dev login system, you need to access:

```
http://localhost:3000/dev-login
```

When prompted, use this tenant ID:
```
ba964c21-05a0-4a71-92ea-47ec7cfe0bbd
```

## 📊 Sample Data Created

- ✅ **3 Locations**: Main Warehouse, Yard A, Truck 101
- ✅ **5 Catalog Items**: HMA, Concrete, Rebar, Diesel, Excavator
- ✅ **2 Vendors**: ABC Materials, XYZ Equipment

## 🚀 Quick Start

1. Make sure your dev server is running: `npm run dev`
2. Go to http://localhost:3000/dev-login
3. Enter the tenant ID above
4. You'll be redirected to the dashboard
5. Navigate to:
   - **/inventory/items** - See your 5 catalog items
   - **/inventory/stock** - View stock balances (will be empty until you create receipts)
   - **/operations/receive/create** - Create your first receipt
   - **/operations/issue** - Issue inventory
   - **/inventory/purchasing/create** - Create a purchase order

## 🐛 If You See "Error fetching tenant"

This means the JWT doesn't have the correct `tenant_id`. Make sure you:
1. Used the dev-login page
2. Entered the tenant ID correctly
3. The session was created properly

You can verify by checking the browser console or Network tab for the `/api/tenant` request.

## 📝 Notes

- All data is scoped to this tenant via RLS (Row Level Security)
- The tenant ID is stored in your JWT token
- All API calls will automatically filter by this tenant_id
- If you need to reset, just drop the tenant and re-run `seed_dev_data.sql`

---

**Next:** Try creating a receipt at `/operations/receive/create` to add inventory!
