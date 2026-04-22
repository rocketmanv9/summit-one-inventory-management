import { loadConfig, detectEnvironment, assertChassisSchemaVersion } from '@rocketmanv9/chassis/config';
import { createLogger } from '@rocketmanv9/chassis/logging';
import type { ServiceConfig } from '@rocketmanv9/chassis/config';

// Load and validate config at startup
let _config: ServiceConfig | null = null;

export function getConfig(): ServiceConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

export function getEnv() {
  return detectEnvironment();
}

export function getLogger(ctx?: { correlationId?: string; requestId?: string; tenantId?: string }) {
  return createLogger({ ...ctx, serviceName: getConfig().INTERNAL_JWT_ISSUER });
}

/**
 * Call once at startup (e.g., in a health endpoint or initialization hook)
 * to verify the DB has the required chassis schema version.
 */
export { assertChassisSchemaVersion };

// Re-export commonly used chassis utilities
export { AppError } from '@rocketmanv9/chassis/errors';
export { assertTenantContext } from '@rocketmanv9/chassis/context';
export { createUserClient, createServiceClientUnsafe, createTenantServiceClient, setRLSContext } from '@rocketmanv9/chassis/supabase';
export { withIdempotency, withIdempotentReplay, replayResponse, requireIdempotencyKey } from '@rocketmanv9/chassis/idempotency';
export { emitOutboxEvent, createEventEnvelope, pollOutbox } from '@rocketmanv9/chassis/events';
export { withOperationContext, emitOutboxEventFromContext, createTracedFetch } from '@rocketmanv9/chassis/observability';
export { mintInternalJwt } from '@rocketmanv9/chassis/auth';
export { exchangeTicketWithCore, mintSessionTokens, verifySessionToken, verifyRefreshToken } from '@rocketmanv9/chassis/auth';
export { accessTokenCookieConfig, refreshTokenCookieConfig } from '@rocketmanv9/chassis/auth';
export { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from '@rocketmanv9/chassis/auth';

// Global Values
export { createGVClient, createTenantGVClient } from '@rocketmanv9/chassis/global-values';
export type { GlobalValuesClient, TermId } from '@rocketmanv9/chassis/global-values';
export { toTermId, isTermId, GV_EVENT_TYPES, isGVEvent } from '@rocketmanv9/chassis/global-values';

// Vendors
export { createVendorCatalogClient, createTenantVendorClient } from '@rocketmanv9/chassis/vendors';
export type { VendorCatalogClient, TenantVendorClient } from '@rocketmanv9/chassis/vendors';
export { VENDOR_EVENT_TYPES, isVendorEvent } from '@rocketmanv9/chassis/vendors';
