# Dev Tools Authentication Guide

## 🎯 Quick Reference

**You have a ticket. You need a JWT. Here's how.**

---

## The Flow

```
1. Get ticket from Core (32-char hex string)
2. Exchange ticket with inventory service → JWT
3. Use JWT in Authorization header for all requests
```

---

## Method 1: Browser/Manual Flow

### Step 1: Get the Ticket
Core redirects users to:
```
http://localhost:3000/?ticket=a1b2c3d4e5f6...32chars...
```

### Step 2: Automatic Exchange
The inventory app automatically:
- Detects ticket in URL
- Exchanges it with Core
- Mints JWT
- Stores in `localStorage` as `custom_access_token`

### Step 3: Extract JWT from Browser
Open DevTools Console:
```javascript
localStorage.getItem('custom_access_token')
```

Copy the JWT for use in scripts/tools.

---

## Method 2: Script/CLI/Dev Tool Flow

### PowerShell Example

```powershell
# 1. Set your ticket (get this from Core)
$ticket = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

# 2. Exchange ticket with inventory service
$response = Invoke-WebRequest `
  -Uri "http://localhost:3000/auth/callback?ticket=$ticket" `
  -Method GET `
  -MaximumRedirection 0 `
  -ErrorAction SilentlyContinue

# 3. Extract access_token from redirect URL
$redirectUrl = $response.Headers.Location
if ($redirectUrl -match 'access_token=([^&]+)') {
    $jwt = $matches[1]
    Write-Host "JWT: $jwt"
}

# 4. Use JWT for authenticated requests
$headers = @{
    'Authorization' = "Bearer $jwt"
    'Content-Type' = 'application/json'
    'apikey' = $env:NEXT_PUBLIC_SUPABASE_ANON_KEY
}

Invoke-RestMethod `
  -Uri "http://localhost:3000/api/inventory/items" `
  -Method GET `
  -Headers $headers
```

---

### Bash/cURL Example

```bash
# 1. Set your ticket
TICKET="a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

# 2. Exchange ticket (follow redirects manually)
REDIRECT_URL=$(curl -s -I "http://localhost:3000/auth/callback?ticket=$TICKET" | grep -i location | awk '{print $2}' | tr -d '\r')

# 3. Extract JWT from redirect URL
JWT=$(echo "$REDIRECT_URL" | grep -oP 'access_token=\K[^&]+')

echo "JWT: $JWT"

# 4. Use JWT for authenticated requests
curl http://localhost:3000/api/inventory/items \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

---

### Node.js Example

```javascript
const fetch = require('node-fetch');

async function authenticate(ticket) {
  // Exchange ticket for JWT
  const response = await fetch(
    `http://localhost:3000/auth/callback?ticket=${ticket}`,
    { redirect: 'manual' }
  );

  // Extract JWT from redirect URL
  const redirectUrl = response.headers.get('location');
  const match = redirectUrl.match(/access_token=([^&]+)/);
  
  if (!match) {
    throw new Error('Failed to extract JWT');
  }

  return match[1]; // JWT
}

async function makeAuthenticatedRequest(jwt) {
  const response = await fetch('http://localhost:3000/api/inventory/items', {
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    }
  });

  return response.json();
}

// Usage
(async () => {
  const ticket = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6';
  const jwt = await authenticate(ticket);
  console.log('JWT:', jwt);

  const data = await makeAuthenticatedRequest(jwt);
  console.log('Data:', data);
})();
```

---

### Python Example

```python
import requests
import re
import os

def authenticate(ticket):
    """Exchange ticket for JWT"""
    url = f"http://localhost:3000/auth/callback?ticket={ticket}"
    
    # Don't follow redirects automatically
    response = requests.get(url, allow_redirects=False)
    
    # Extract JWT from redirect URL
    redirect_url = response.headers.get('Location', '')
    match = re.search(r'access_token=([^&]+)', redirect_url)
    
    if not match:
        raise ValueError('Failed to extract JWT from redirect')
    
    return match.group(1)

def make_authenticated_request(jwt):
    """Make an authenticated API request"""
    headers = {
        'Authorization': f'Bearer {jwt}',
        'Content-Type': 'application/json',
        'apikey': os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    }
    
    response = requests.get(
        'http://localhost:3000/api/inventory/items',
        headers=headers
    )
    
    return response.json()

# Usage
if __name__ == '__main__':
    ticket = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'
    
    # Get JWT
    jwt = authenticate(ticket)
    print(f'JWT: {jwt}')
    
    # Make authenticated request
    data = make_authenticated_request(jwt)
    print(f'Data: {data}')
```

---

## Method 3: Direct Core Exchange (Bypass Inventory)

If you have access to Core's exchange endpoint directly:

```bash
# Exchange ticket directly with Core
curl -X POST https://dev.summit-one.app/api/auth/exchange \
  -H "Content-Type: application/json" \
  -H "apikey: YOUR_CORE_ANON_KEY" \
  -H "Authorization: Bearer YOUR_CORE_ANON_KEY" \
  -d '{"ticket": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"}'
```

This returns user data, but you still need to call the inventory `/auth/callback` to get the inventory-specific JWT.

---

## JWT Details

### What's in the JWT?

```json
{
  "sub": "user-uuid-here",
  "email": "user@example.com",
  "role": "authenticated",
  "app_metadata": {
    "tenant_id": "tenant-uuid-here",
    "role": "authenticated"
  },
  "user_metadata": {
    "full_name": "User Name",
    "email": "user@example.com",
    "role": "authenticated"
  },
  "iat": 1707692400,
  "exp": 1708297200
}
```

### JWT Lifespan
- **Expires**: 7 days from issuance
- **Storage**: `localStorage.custom_access_token` (browser)
- **Use**: Include in `Authorization: Bearer {JWT}` header

---

## Environment Variables Needed

For dev tools to work, you need:

```env
# From inventory .env.local
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-inventory-supabase-anon-key

# Optional: If calling Core directly
CORE_SUPABASE_ANON_KEY=your-core-supabase-anon-key
CORE_EXCHANGE_URL=https://dev.summit-one.app/api/auth/exchange
```

---

## Troubleshooting

### "Invalid ticket" Error
- Ticket must be exactly 32 characters
- Ticket is single-use only (can't reuse)
- Get a fresh ticket from Core

### "Missing Core configuration" Error
- Check `CORE_EXCHANGE_URL` is set in `.env.local`
- Check `CORE_SUPABASE_ANON_KEY` is set in `.env.local`

### "Exchange failed" Error
- Core API might be down
- Ticket might be expired
- Check Core logs for details

### JWT Not Working
- Ensure `Authorization: Bearer {JWT}` header is set
- Ensure `apikey` header includes Supabase anon key
- JWT expires after 7 days - get a new ticket

---

## Quick Test Commands

### Test 1: Health Check (No Auth)
```bash
curl http://localhost:3000/api/health
```

### Test 2: Get JWT from Ticket
```bash
curl -I "http://localhost:3000/auth/callback?ticket=YOUR_TICKET_HERE" 2>&1 | grep -i location
```

### Test 3: Use JWT
```bash
JWT="your-jwt-here"
ANON_KEY="your-anon-key-here"

curl http://localhost:3000/api/inventory/items \
  -H "Authorization: Bearer $JWT" \
  -H "apikey: $ANON_KEY"
```

---

## Integration Checklist

- [ ] Get ticket from Core SSO
- [ ] Exchange ticket with `/auth/callback?ticket=...`
- [ ] Extract JWT from redirect URL (`access_token` param)
- [ ] Store JWT securely in your tool
- [ ] Include JWT in all API requests: `Authorization: Bearer {JWT}`
- [ ] Include Supabase anon key: `apikey: {ANON_KEY}`
- [ ] Handle JWT expiration (7 days) - re-authenticate when expired

---

## Example: Complete Dev Tool Script

```bash
#!/bin/bash
# dev-auth.sh - Complete authentication helper

set -e

# Configuration
INVENTORY_URL="${INVENTORY_URL:-http://localhost:3000}"
SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY}"

# Check for ticket
if [ -z "$1" ]; then
    echo "Usage: ./dev-auth.sh <ticket>"
    echo "Example: ./dev-auth.sh a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
    exit 1
fi

TICKET="$1"

echo "🔐 Authenticating with ticket..."

# Exchange ticket
REDIRECT=$(curl -s -I "$INVENTORY_URL/auth/callback?ticket=$TICKET" | grep -i location | awk '{print $2}' | tr -d '\r')

# Extract JWT
JWT=$(echo "$REDIRECT" | grep -oP 'access_token=\K[^&]+')

if [ -z "$JWT" ]; then
    echo "❌ Failed to get JWT"
    exit 1
fi

echo "✅ Got JWT!"
echo ""
echo "Export this to use in other commands:"
echo "export AUTH_TOKEN=\"$JWT\""
echo ""
echo "Or use directly:"
echo "curl $INVENTORY_URL/api/inventory/items \\"
echo "  -H 'Authorization: Bearer $JWT' \\"
echo "  -H 'apikey: $SUPABASE_ANON_KEY'"
```

---

## Summary

1. **Get ticket** from Core (32-char hex)
2. **Exchange**: `GET /auth/callback?ticket={ticket}`
3. **Extract JWT** from redirect URL parameter `access_token`
4. **Use JWT** in `Authorization: Bearer {JWT}` header
5. **Remember** to include Supabase `apikey` header

Done. Your dev tools are now authenticated. 🎉
