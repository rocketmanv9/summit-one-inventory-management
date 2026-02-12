# 🎫 TICKET AUTH - QUICK REFERENCE

**Last Updated**: Working as of Feb 11, 2026

---

## 🚀 Quick Commands

### Get JWT with PowerShell
```powershell
.\scripts\dev-auth.ps1 -Ticket "YOUR_32_CHAR_TICKET_HERE"
```

### Get JWT with Bash
```bash
./scripts/dev-auth.sh YOUR_32_CHAR_TICKET_HERE
```

### Get JWT with Node.js
```bash
node scripts/dev-auth.js YOUR_32_CHAR_TICKET_HERE
```

### Get JWT with Python
```bash
python scripts/dev-auth.py YOUR_32_CHAR_TICKET_HERE
```

---

## 📋 The 3-Step Flow

```
┌─────────────────────────────────────────────┐
│ 1. Get ticket from Core (32-char hex)      │
│    Example: a1b2c3d4e5f6...                 │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ 2. Exchange with inventory service          │
│    GET /auth/callback?ticket={ticket}       │
│    Returns: Redirect with ?access_token=... │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ 3. Use JWT in requests                      │
│    Authorization: Bearer {JWT}              │
│    apikey: {SUPABASE_ANON_KEY}              │
└─────────────────────────────────────────────┘
```

---

## 🔧 Manual cURL Method

```bash
# Step 1: Exchange ticket
curl -I "http://localhost:3000/auth/callback?ticket=YOUR_TICKET" 2>&1 | grep -i location

# Step 2: Extract JWT from Location header
# Look for: access_token=eyJhbGciOiJIUzI1NiIs...

# Step 3: Use JWT
curl http://localhost:3000/api/inventory/items \
  -H "Authorization: Bearer YOUR_JWT_HERE" \
  -H "apikey: YOUR_ANON_KEY"
```

---

## 🌐 Browser Method

1. Visit: `http://localhost:3000/?ticket=YOUR_TICKET`
2. App auto-exchanges and stores JWT
3. Open DevTools Console:
   ```javascript
   localStorage.getItem('custom_access_token')
   ```
4. Copy JWT for use in scripts

---

## 🧪 Test Endpoints

### Health Check (No Auth)
```bash
curl http://localhost:3000/api/health
```

### Protected Route (Needs JWT)
```bash
curl http://localhost:3000/api/inventory/items \
  -H "Authorization: Bearer $JWT" \
  -H "apikey: $SUPABASE_ANON_KEY"
```

---

## 🔑 Environment Variables

```env
# Required for ticket exchange
CORE_EXCHANGE_URL=https://dev.summit-one.app/api/auth/exchange
CORE_SUPABASE_ANON_KEY=your-core-anon-key
SUPABASE_JWT_SECRET=your-jwt-secret

# Required for API requests
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-inventory-anon-key
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
```

---

## ⚡ One-Liners

### PowerShell
```powershell
# Get JWT and use immediately
$jwt = .\scripts\dev-auth.ps1 -Ticket "YOUR_TICKET"; Invoke-RestMethod -Uri "http://localhost:3000/api/inventory/items" -Headers @{Authorization="Bearer $jwt";apikey=$env:NEXT_PUBLIC_SUPABASE_ANON_KEY}
```

### Bash
```bash
# Get JWT and use immediately
JWT=$(./scripts/dev-auth.sh YOUR_TICKET) && curl http://localhost:3000/api/inventory/items -H "Authorization: Bearer $JWT" -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

### Node.js
```javascript
const {authenticate,makeAuthenticatedRequest}=require('./scripts/dev-auth.js');(async()=>{const j=await authenticate('TICKET');console.log(await makeAuthenticatedRequest(j,'/api/inventory/items','http://localhost:3000',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY))})();
```

---

## 🐛 Troubleshooting

| Error | Solution |
|-------|----------|
| "Invalid ticket" | Must be exactly 32 characters |
| "No redirect URL" | Check `.env.local` has `CORE_EXCHANGE_URL` and `CORE_SUPABASE_ANON_KEY` |
| "Failed to extract JWT" | Check server logs, ticket might be expired or already used |
| JWT doesn't work | Include both `Authorization: Bearer {JWT}` AND `apikey: {ANON_KEY}` |
| "Unauthorized" | JWT expires after 7 days - get new ticket |

---

## 📚 Full Documentation

- **[DEV_TOOLS_AUTH_GUIDE.md](DEV_TOOLS_AUTH_GUIDE.md)** - Complete guide with examples
- **[scripts/README.md](scripts/README.md)** - Script usage details
- **[src/app/auth/callback/route.ts](src/app/auth/callback/route.ts)** - Exchange implementation

---

## 💡 Tips

- Tickets are **single-use** - can't reuse same ticket
- JWTs **expire in 7 days** - get new ticket when expired
- Store JWT securely - it grants full access to your tenant
- Use scripts for automation - they handle redirect extraction
- Browser method is fastest for manual testing

---

**Need help?** Check logs: `tail -f .next/server.log` or browser console
