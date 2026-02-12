# Dev Authentication Scripts

Quick helper scripts to exchange Core SSO tickets for inventory service JWTs.

## Available Scripts

### PowerShell (`dev-auth.ps1`)
```powershell
# Get JWT
.\scripts\dev-auth.ps1 -Ticket "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

# Capture JWT in variable
$jwt = .\scripts\dev-auth.ps1 -Ticket "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"

# Use JWT
$headers = @{
    Authorization = "Bearer $jwt"
    apikey = $env:NEXT_PUBLIC_SUPABASE_ANON_KEY
}
Invoke-RestMethod -Uri "http://localhost:3000/api/inventory/items" -Headers $headers
```

### Bash (`dev-auth.sh`)
```bash
# Make executable first
chmod +x scripts/dev-auth.sh

# Get JWT
./scripts/dev-auth.sh a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6

# Capture JWT in variable
JWT=$(./scripts/dev-auth.sh a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6)

# Use JWT
curl http://localhost:3000/api/inventory/items \
  -H "Authorization: Bearer $JWT" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

### Node.js (`dev-auth.js`)
```bash
# Get JWT (CLI mode)
node scripts/dev-auth.js a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6

# Use as module
node -e "
const { authenticate } = require('./scripts/dev-auth.js');
(async () => {
  const jwt = await authenticate('a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6');
  console.log('JWT:', jwt);
})();
"
```

Or in your code:
```javascript
const { authenticate, makeAuthenticatedRequest } = require('./scripts/dev-auth.js');

(async () => {
  // Get JWT
  const jwt = await authenticate('a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6');
  
  // Make request
  const data = await makeAuthenticatedRequest(
    jwt,
    '/api/inventory/items',
    'http://localhost:3000',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  
  console.log(data);
})();
```

### Python (`dev-auth.py`)
```bash
# Get JWT (CLI mode)
python scripts/dev-auth.py a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6

# Or import as module
python -c "
from scripts.dev_auth import authenticate
jwt = authenticate('a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6')
print('JWT:', jwt)
"
```

Or in your code:
```python
from scripts.dev_auth import authenticate, make_authenticated_request
import os

# Get JWT
jwt = authenticate('a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6')

# Make request
data = make_authenticated_request(
    jwt,
    '/api/inventory/items',
    'http://localhost:3000',
    os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
)

print(data)
```

## How It Works

1. Script calls `/auth/callback?ticket={ticket}`
2. Server validates ticket with Core
3. Server mints JWT with tenant_id
4. Server redirects to `/dashboard?access_token={jwt}`
5. Script extracts JWT from redirect URL
6. You use JWT in Authorization header

## Environment Variables

Set in `.env.local`:
```env
CORE_EXCHANGE_URL=https://dev.summit-one.app/api/auth/exchange
CORE_SUPABASE_ANON_KEY=your-core-anon-key
SUPABASE_JWT_SECRET=your-jwt-secret
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-inventory-anon-key
```

## Getting a Ticket

Tickets come from Core SSO. You can:
1. Get from browser URL after Core login: `?ticket=...`
2. Extract from Core's redirect
3. Use Core's API to generate test tickets (if available)

## Troubleshooting

### "Invalid ticket: must be exactly 32 characters"
Ticket must be 32-char hex string. Check you copied it correctly.

### "No redirect URL received"
Server didn't respond with redirect. Check:
- Server is running (`npm run dev`)
- `.env.local` has `CORE_EXCHANGE_URL` and `CORE_SUPABASE_ANON_KEY`

### "Failed to extract JWT"
Server redirected but JWT wasn't in URL. Check server logs for errors.

## See Also

- [DEV_TOOLS_AUTH_GUIDE.md](../DEV_TOOLS_AUTH_GUIDE.md) - Full authentication guide with examples
- [src/app/auth/callback/route.ts](../src/app/auth/callback/route.ts) - Server-side exchange logic
