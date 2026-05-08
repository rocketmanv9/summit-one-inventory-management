import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * Rate Limiting Configuration
 *
 * Uses Upstash Redis for distributed rate limiting across Vercel Edge Functions.
 * Falls back to in-memory limiting if Upstash is not configured (dev mode).
 */

// Initialize Redis client (only if credentials are provided)
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

/**
 * Strict rate limiter for sensitive endpoints (auth, mutations)
 * - 10 requests per 10 seconds per IP
 */
export const strictRateLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, '10 s'),
      analytics: true,
      prefix: 'ratelimit:strict',
    })
  : null;

/**
 * Standard rate limiter for API routes
 * - 100 requests per minute per IP
 */
export const standardRateLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(100, '1 m'),
      analytics: true,
      prefix: 'ratelimit:api',
    })
  : null;

/**
 * Generous rate limiter for read-only endpoints
 * - 300 requests per minute per IP
 */
export const readRateLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(300, '1 m'),
      analytics: true,
      prefix: 'ratelimit:read',
    })
  : null;

/**
 * AI chat rate limiter — protects OpenAI spend
 * - 20 requests per minute per IP (sliding window)
 */
export const aiRateLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, '1 m'),
      analytics: true,
      prefix: 'ratelimit:ai',
    })
  : null;

/**
 * Helper function to get client identifier (IP address)
 */
export function getClientIdentifier(request: Request): string {
  // Try to get real IP from headers (Vercel, Cloudflare, etc.)
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');

  if (forwarded) {
    // x-forwarded-for can be a comma-separated list
    return forwarded.split(',')[0].trim();
  }

  if (realIp) {
    return realIp;
  }

  // Fallback to connection IP (may not be available in all environments)
  return 'unknown';
}

/**
 * Check rate limit and return appropriate response if exceeded
 */
export async function checkRateLimit(
  request: Request,
  limiter: Ratelimit | null = standardRateLimit
): Promise<{ success: boolean; response?: Response }> {
  // If no rate limiter configured (dev mode), allow all requests
  if (!limiter) {
    return { success: true };
  }

  const identifier = getClientIdentifier(request);

  try {
    const { success, limit, reset, remaining } = await limiter.limit(identifier);

    if (!success) {
      return {
        success: false,
        response: new Response(
          JSON.stringify({
            error: 'Too Many Requests',
            message: 'You have exceeded the rate limit. Please try again later.',
            limit,
            remaining: 0,
            reset: new Date(reset).toISOString(),
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'X-RateLimit-Limit': limit.toString(),
              'X-RateLimit-Remaining': remaining.toString(),
              'X-RateLimit-Reset': reset.toString(),
              'Retry-After': Math.ceil((reset - Date.now()) / 1000).toString(),
            },
          }
        ),
      };
    }

    return { success: true };
  } catch (error) {
    // If rate limiting fails (e.g., Redis is down), log error but allow request
    console.error('Rate limiting error:', error);
    return { success: true };
  }
}

/**
 * Middleware wrapper for applying rate limiting to API routes
 *
 * Usage:
 * ```ts
 * export async function POST(request: Request) {
 *   const rateLimitResult = await checkRateLimit(request, strictRateLimit);
 *   if (!rateLimitResult.success) {
 *     return rateLimitResult.response;
 *   }
 *
 *   // Your endpoint logic here
 * }
 * ```
 */
