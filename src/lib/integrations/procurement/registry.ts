/**
 * Procurement Provider Adapter Registry
 *
 * Central registry for procurement provider adapters.
 * Adapters self-register on import; consumers look them up by provider_key prefix.
 */

import type { ProcurementProviderAdapter, ProcurementAdapterMeta } from './types';

const adapters = new Map<string, ProcurementProviderAdapter>();

/** Register an adapter under its key prefix (e.g., 'amazon-business') */
export function registerAdapter(adapter: ProcurementProviderAdapter): void {
  adapters.set(adapter.meta.key, adapter);
}

/**
 * Get an adapter by exact key or provider_key prefix match.
 * E.g., provider_key 'amazon-business-main' matches adapter key 'amazon-business'.
 */
export function getAdapter(providerKey: string): ProcurementProviderAdapter | undefined {
  // Exact match first
  if (adapters.has(providerKey)) return adapters.get(providerKey);

  // Prefix match: 'amazon-business-main' -> 'amazon-business'
  for (const [key, adapter] of adapters) {
    if (providerKey.startsWith(key)) return adapter;
  }

  return undefined;
}

/** List all registered adapter metadata */
export function listAdapters(): ProcurementAdapterMeta[] {
  return Array.from(adapters.values()).map((a) => a.meta);
}

/** Check if an adapter is registered for a given key */
export function hasAdapter(providerKey: string): boolean {
  return getAdapter(providerKey) !== undefined;
}
