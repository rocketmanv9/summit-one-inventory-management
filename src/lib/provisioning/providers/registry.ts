/**
 * Provider Registry
 *
 * Singleton registry that maps provider type keys to their FulfillmentProvider
 * implementations. Providers register themselves at module load time.
 */

import type { FulfillmentProvider, ProviderType } from './types';

const providers = new Map<ProviderType, FulfillmentProvider>();

/**
 * Register a fulfillment provider implementation.
 * Called once per provider type at module initialization.
 */
export function registerProvider(type: ProviderType, provider: FulfillmentProvider): void {
  providers.set(type, provider);
}

/**
 * Get a registered fulfillment provider by type.
 * Returns undefined if no provider is registered for that type.
 */
export function getProvider(type: ProviderType): FulfillmentProvider | undefined {
  return providers.get(type);
}

/**
 * List all registered provider types.
 */
export function listRegisteredProviderTypes(): ProviderType[] {
  return Array.from(providers.keys());
}

/**
 * Check if a provider type is registered.
 */
export function isProviderRegistered(type: ProviderType): boolean {
  return providers.has(type);
}
