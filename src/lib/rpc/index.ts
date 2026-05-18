/**
 * RPC Service Layer Index
 * Central export for all RPC services
 */

export { SupplyChainRPC } from './supply-chain';
export { InventoryRPC } from './inventory';

export type {
  // Supply Chain Types
  CreatePurchaseOrderParams,
  CreatePurchaseOrderResult,
  CreateReceiptParams,
  CreateReceiptResult,
  PostReceiptToInventoryParams,
  PostReceiptToInventoryResult,
} from './supply-chain';

export type {
  // Inventory Types
  IssueInventoryParams,
  IssueInventoryResult,
  AdjustInventoryParams,
  AdjustInventoryResult,
} from './inventory';
