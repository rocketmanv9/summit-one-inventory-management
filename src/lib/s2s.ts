import { mintInternalJwt } from '@rocketmanv9/chassis/auth';
import { createTracedFetch } from '@rocketmanv9/chassis/observability';
import { AppError } from '@rocketmanv9/chassis/errors';
import type { OperationContext } from '@rocketmanv9/chassis/observability';

/**
 * Service-to-service call example.
 *
 * 1. Mint a short-lived internal JWT (shared HMAC secret).
 * 2. Create a fetch wrapper that propagates full trace context (trace ID,
 *    span ID, correlation ID) to downstream services.
 * 3. Call the downstream service with both the JWT and trace headers.
 *
 * The receiving service verifies the JWT with requireInternalServiceJwt().
 */
export async function callDownstreamService(
  ctx: OperationContext,
  tenantId: string,
) {
  // Mint a 5-minute internal JWT for this service
  const token = await mintInternalJwt({
    sub: process.env.INTERNAL_JWT_ISSUER || 'my-service',
    tenantId,
  });

  // Fetch wrapper that propagates full trace context (trace ID, span ID, correlation ID)
  const tracedFetch = createTracedFetch(ctx);

  const response = await tracedFetch('https://other-service.example.com/api/internal/action', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ tenantId, action: 'example' }),
  });

  if (!response.ok) {
    throw AppError.internal(`Downstream call failed: ${response.status}`);
  }

  return response.json();
}
