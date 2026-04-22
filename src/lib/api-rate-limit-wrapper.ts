import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, strictRateLimit, standardRateLimit } from './rate-limit';

/**
 * Higher-order function to wrap API route handlers with rate limiting
 *
 * Usage:
 * ```ts
 * import { withRateLimit } from '@/lib/api-rate-limit-wrapper';
 *
 * export const POST = withRateLimit(
 *   async (request: Request) => {
 *     // Your handler logic
 *     return Response.json({ success: true });
 *   },
 *   { type: 'strict' }
 * );
 * ```
 */

type RateLimitType = 'strict' | 'standard' | 'read';

interface RateLimitOptions {
  type?: RateLimitType;
  onRateLimited?: (request: Request) => void;
}

export function withRateLimit(
  handler: (request: Request, context?: any) => Promise<Response>,
  options: RateLimitOptions = {}
) {
  const { type = 'standard', onRateLimited } = options;

  return async function rateLimitedHandler(
    request: Request,
    context?: any
  ): Promise<Response> {
    // Select rate limiter based on type
    const limiter =
      type === 'strict'
        ? strictRateLimit
        : type === 'read'
        ? null // No rate limit for read endpoints (or use readRateLimit if you want to limit)
        : standardRateLimit;

    // Check rate limit
    const rateLimitResult = await checkRateLimit(request, limiter);

    if (!rateLimitResult.success) {
      // Call optional callback when rate limited
      onRateLimited?.(request);

      return rateLimitResult.response!;
    }

    // Execute the actual handler
    return handler(request, context);
  };
}

/**
 * Pre-configured rate limit decorators for common use cases
 */

/**
 * Apply strict rate limiting (10 req/10s)
 * Use for: Authentication, password reset, sensitive mutations
 */
export function withStrictRateLimit(
  handler: (request: Request, context?: any) => Promise<Response>
) {
  return withRateLimit(handler, { type: 'strict' });
}

/**
 * Apply standard rate limiting (100 req/min)
 * Use for: Most API endpoints, RPC calls, mutations
 */
export function withStandardRateLimit(
  handler: (request: Request, context?: any) => Promise<Response>
) {
  return withRateLimit(handler, { type: 'standard' });
}

/**
 * No rate limiting
 * Use for: Public read endpoints, health checks
 */
export function withoutRateLimit(
  handler: (request: Request, context?: any) => Promise<Response>
) {
  return handler;
}
