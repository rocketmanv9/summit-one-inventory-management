/**
 * Procurement Integration Framework — Public API
 *
 * Re-exports the core abstractions for use by API routes and UI.
 */

// Ensure all adapters are registered
import './adapters';

export type {
  ProcurementProviderConfig,
  ProcurementProviderAdapter,
  ProcurementAdapterMeta,
  ExternalProduct,
  ExternalProductVariant,
  SubmitOrderInput,
  SubmitOrderResult,
  ExternalOrderStatus,
  ConnectionValidation,
  OAuthUrlResult,
  OAuthTokenResult,
  OrderAddress,
  AdapterConfigField,
  ReorderRule,
} from './types';

export { registerAdapter, getAdapter, listAdapters, hasAdapter } from './registry';
export { resolveProcurementConfig, resolveProcurementConfigByKey } from './config-resolver';
