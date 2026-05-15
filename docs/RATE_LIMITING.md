# Rate Limiting

This project implements distributed rate limiting using [Upstash Redis](https://upstash.com) to prevent API abuse and ensure fair usage.

## Configuration

Rate limiting is **optional** but **recommended for production**. It requires Upstash Redis credentials:

```env
# .env.local or Vercel environment variables
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token-here
```

If these variables are not set, rate limiting is **disabled** (useful for local development).

## Rate Limit Tiers

| Tier | Limit | Use Case | Example Endpoints |
|------|-------|----------|-------------------|
| **Strict** | 10 req / 10s | Auth, sensitive mutations | `/api/auth/*`, password reset |
| **Standard** | 100 req / min | Most API endpoints, RPC | `/api/inventory/*`, `/api/search` |
| **Read** | 300 req / min | Public read endpoints | `/api/health`, public data |

## Usage in API Routes

### Method 1: Wrapper Function (Recommended)

```typescript
import { withStrictRateLimit, withStandardRateLimit } from '@/lib/api-rate-limit-wrapper';

// Strict rate limiting for auth
export const POST = withStrictRateLimit(async (request: Request) => {
  // Your handler logic
  return Response.json({ success: true });
});

// Standard rate limiting for API endpoints
export const GET = withStandardRateLimit(async (request: Request) => {
  // Your handler logic
  return Response.json({ data: [] });
});
```

### Method 2: Manual Check (inside a route factory)

```typescript
import { checkRateLimit, strictRateLimit } from '@/lib/rate-limit';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';

export const POST = createSessionWriteRoute(async ({ req }) => {
  const rateLimitResult = await checkRateLimit(req, strictRateLimit);
  if (!rateLimitResult.success) {
    return rateLimitResult.response;
  }
  // Your handler logic
  return { data: { success: true }, status: 200, events: [] };
}, { serviceName: process.env.INTERNAL_JWT_ISSUER || 'inventory' });
```

**Note:** Always use chassis route factories (`createSessionWriteRoute`, etc.) - never bare `export async function`. See [CLAUDE.md](../CLAUDE.md) for enforcement rules.

## Response Headers

When rate limited, the API returns:

```
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1709876543000
Retry-After: 8
```

```json
{
  "error": "Too Many Requests",
  "message": "You have exceeded the rate limit. Please try again later.",
  "limit": 10,
  "remaining": 0,
  "reset": "2024-03-08T12:34:56.789Z"
}
```

## Client Identification

Rate limits are applied **per IP address**. The system checks (in order):

1. `x-forwarded-for` header (Vercel, Cloudflare)
2. `x-real-ip` header
3. Fallback to `'unknown'` (treated as single client)

## Local Development

Rate limiting is **disabled by default** in local development (when Upstash credentials are not set).

To test rate limiting locally:

1. Create a free Upstash account: https://upstash.com
2. Create a Redis database
3. Copy credentials to `.env.local`
4. Restart dev server

## Production Setup

1. **Create Upstash Redis**:
   - Go to https://upstash.com
   - Create a new Redis database (free tier is sufficient for most apps)
   - Copy REST URL and Token

2. **Set Vercel Environment Variables**:
   ```bash
   vercel env add UPSTASH_REDIS_REST_URL
   vercel env add UPSTASH_REDIS_REST_TOKEN
   ```

3. **Deploy**:
   - Rate limiting activates automatically when credentials are present

## Monitoring

Upstash provides analytics for rate limiting:

- Go to Upstash Dashboard > Your Database > Metrics
- View request counts, rate limit hits, etc.

## Customization

To create custom rate limiters, edit `src/lib/rate-limit.ts`:

```typescript
export const customRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(50, '5 m'), // 50 req per 5 min
  analytics: true,
  prefix: 'ratelimit:custom',
});
```

## Graceful Degradation

If Upstash Redis is unavailable (network issues, credentials expired):

- Requests are **allowed** (fail-open approach)
- Errors are logged to console/Sentry
- No impact on user experience

This prevents rate limiting infrastructure from becoming a single point of failure.

## Best Practices

1. **Apply strictest limits to auth endpoints** - prevents brute force attacks
2. **Use standard limits for mutations** - prevents abuse while allowing normal usage
3. **Use generous limits (or none) for reads** - maximize performance for GET requests
4. **Monitor rate limit hits** - adjust limits based on actual usage patterns
5. **Document limits in API docs** - helps API consumers design their clients

## Cost

Upstash pricing (as of 2024):

- **Free tier**: 10,000 commands/day (sufficient for small apps)
- **Pay-as-you-go**: $0.20 per 100,000 commands
- **Pro**: $120/month for 10M commands

For most apps, the free tier is enough for rate limiting.
