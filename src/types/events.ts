/**
 * Event Type Definitions
 * 
 * TypeScript types for Supply Chain and Inventory events
 * Based on the event catalog after bounded context separation
 * 
 * @see EVENT_CATALOG.md for complete event documentation
 * @see FRONTEND_EVENT_MIGRATION_GUIDE.md for migration guide
 */

// ============================================================================
// Base Event Structure
// ============================================================================

export interface BaseEvent<TPayload = any> {
  id: string;
  tenant_id: string;
  event_name: string;
  event_version: number;
  payload: TPayload;
  correlation_id?: string;
  causation_id?: string;
  actor_user_id?: string;
  created_at: string;
}

// ============================================================================
// Supply Chain Event Names (16 total)
// ============================================================================

export type SupplyChainEventName =
  // Vendor Events (2)
  | 'supply_chain.vendor.created'
  | 'supply_chain.vendor.updated'
  // Vendor Item Events (3)
  | 'supply_chain.vendor_item.created'
  | 'supply_chain.vendor_item.updated'
  | 'supply_chain.vendor_item.deleted'
  // Purchase Order Events (8)
  | 'supply_chain.purchase_order.created'
  | 'supply_chain.purchase_order.submitted'
  | 'supply_chain.purchase_order.approved'
  | 'supply_chain.purchase_order.in_transit'
  | 'supply_chain.purchase_order.received'
  | 'supply_chain.purchase_order.cancelled'
  | 'supply_chain.purchase_order.closed'
  | 'supply_chain.purchase_order.voided'
  // Receipt Events (3)
  | 'supply_chain.receipt.created'
  | 'supply_chain.receipt.line_added'
  | 'supply_chain.receipt.posted';

// ============================================================================
// Inventory Event Names (42 total)
// ============================================================================

export type InventoryEventName =
  // Catalog Item Events
  | 'inventory.item.created'
  | 'catalog_item.updated'
  | 'catalog_item.deactivated'
  | 'inventory.catalog_item.deleted'
  // Location Events
  | 'location.created'
  | 'location.updated'
  | 'location.deactivated'
  | 'inventory.location.deleted'
  // Location Type Events
  | 'inventory.location_type.created'
  | 'inventory.location_type.updated'
  | 'inventory.location_type.deleted'
  // Category Events
  | 'category.created'
  | 'category.updated'
  | 'inventory.item_category.deleted'
  // Assignment Type Events
  | 'inventory.assignment_type.created'
  | 'inventory.assignment_type.updated'
  | 'inventory.assignment_type.deleted'
  // Reservation Type Events
  | 'inventory.reservation_type.created'
  | 'inventory.reservation_type.updated'
  | 'inventory.reservation_type.deleted'
  // Stock Events
  | 'stock.replenished'
  | 'stock.issued'
  | 'stock.returned'
  | 'stock.adjusted'
  | 'stock.low_threshold_reached'
  | 'stock.out_of_stock'
  // Transfer Events
  | 'transfer.created'
  | 'transfer.completed'
  | 'transfer.updated'
  | 'inventory.transfer.shipped'
  | 'inventory.transfer.cancelled'
  // Transfer Line Events
  | 'inventory.transfer_line.created'
  | 'inventory.transfer_line.updated'
  | 'inventory.transfer_line.deleted'
  // Asset Events
  | 'asset.created'
  | 'asset.updated'
  | 'asset.assigned'
  | 'asset.returned'
  | 'asset.retired'
  // Reservation Events
  | 'reservation.created'
  | 'reservation.fulfilled'
  | 'reservation.cancelled'
  | 'reservation.expired'
  // Cycle Count Events
  | 'cycle_count.started'
  | 'cycle_count.line_counted'
  | 'cycle_count.approved'
  | 'cycle_count.posted'
  // Adjustment Events
  | 'adjustment.created'
  | 'adjustment.approved'
  | 'adjustment.rejected'
  // Wizard Events
  | 'inventory.item.wizard_created';

// Combined event name type
export type AllEventNames = SupplyChainEventName | InventoryEventName;

// ============================================================================
// Deprecated Event Names (DO NOT USE - Will be removed April 21, 2026)
// ============================================================================

/**
 * @deprecated Use supply_chain.vendor.created instead
 */
export type DeprecatedVendorCreated = 'vendor.created';

/**
 * @deprecated Use supply_chain.vendor.updated instead
 */
export type DeprecatedVendorUpdated = 'vendor.updated';

/**
 * @deprecated Use supply_chain.purchase_order.created instead
 */
export type DeprecatedPOCreated = 'purchase_order.created';

/**
 * @deprecated Use supply_chain.purchase_order.submitted instead
 */
export type DeprecatedPOSubmitted = 'purchase_order.submitted';

/**
 * @deprecated Use supply_chain.purchase_order.approved instead
 */
export type DeprecatedPOApproved = 'purchase_order.approved';

/**
 * @deprecated Use supply_chain.purchase_order.in_transit instead
 */
export type DeprecatedPOPlaced = 'inventory.po.placed';

/**
 * @deprecated Use supply_chain.purchase_order.received instead
 */
export type DeprecatedPOReceived = 'inventory.po.received';

/**
 * @deprecated Use supply_chain.purchase_order.cancelled instead
 */
export type DeprecatedPOCancelled = 'purchase_order.cancelled';

/**
 * @deprecated Use supply_chain.receipt.created instead
 */
export type DeprecatedReceiptCreated = 'receipt.created';

/**
 * @deprecated Use supply_chain.receipt.line_added instead
 */
export type DeprecatedReceiptLineAdded = 'receipt.line_added';

// ============================================================================
// Supply Chain Event Payloads
// ============================================================================

export interface VendorCreatedPayload {
  vendor_id: string;
  vendor_code: string;
  vendor_name: string;
  contact_email?: string;
  contact_phone?: string;
}

export interface VendorUpdatedPayload extends VendorCreatedPayload {
  changes: Record<string, { old: any; new: any }>;
}

export interface PurchaseOrderCreatedPayload {
  po_id: string;
  po_number: string;
  vendor_id: string;
  vendor_name: string;
  vendor_code?: string;
  delivery_location_id: string;
  expected_delivery_date?: string;
  line_count: number;
  total_amount?: number;
}

export interface PurchaseOrderStatusPayload {
  po_id: string;
  po_number: string;
  old_status: string;
  new_status: string;
  vendor_name: string;
  vendor_code?: string;
  vendor_id?: string;
}

export interface ReceiptCreatedPayload {
  receipt_id: string;
  receipt_number: string;
  location_id: string;
  location_name: string;
  po_id?: string;
  po_number?: string;
  vendor_id?: string;
  vendor_name?: string;
  vendor_code?: string;
  received_at: string;
}

export interface ReceiptLineAddedPayload {
  receipt_id: string;
  receipt_number: string;
  catalog_item_id: string;
  item_sku: string;
  item_name: string;
  qty_received: number;
  po_line_id?: string;
}

export interface ReceiptPostedPayload {
  receipt_id: string;
  receipt_number: string;
  location_id: string;
  items_count: number;
  total_qty: number;
  posted_at: string;
}

// ============================================================================
// Inventory Event Payloads
// ============================================================================

export interface ItemCreatedPayload {
  catalog_item_id: string;
  sku: string;
  name: string;
  category_id?: string;
  tracking_mode: 'stock' | 'serialized' | 'both';
}

export interface StockReplenishedPayload {
  catalog_item_id: string;
  item_sku: string;
  item_name: string;
  location_id: string;
  location_name: string;
  qty_change: number;
  new_qty: number;
  receipt_id?: string;
}

export interface StockIssuedPayload {
  catalog_item_id: string;
  item_sku: string;
  item_name: string;
  location_id: string;
  location_name: string;
  qty_issued: number;
  new_qty: number;
  issued_to?: string;
  job_ref?: string;
}

export interface StockAdjustedPayload {
  catalog_item_id: string;
  item_sku: string;
  location_id: string;
  old_qty: number;
  new_qty: number;
  delta: number;
  reason: 'count_variance' | 'damage' | 'theft' | 'expiration' | 'other';
  notes?: string;
}

export interface StockLowThresholdPayload {
  catalog_item_id: string;
  item_sku: string;
  item_name: string;
  location_id: string;
  current_qty: number;
  reorder_point: number;
  vendor_id?: string;
}

export interface TransferCreatedPayload {
  transfer_id: string;
  transfer_number: string;
  from_location_id: string;
  from_location_name: string;
  to_location_id: string;
  to_location_name: string;
  item_count: number;
}

export interface AssetAssignedPayload {
  asset_id: string;
  asset_tag: string;
  serial_number?: string;
  assigned_to_type: 'employee' | 'vehicle' | 'job' | 'location';
  assigned_to_id: string;
  assigned_to_name: string;
}

export interface ReservationCreatedPayload {
  reservation_id: string;
  catalog_item_id: string;
  item_sku: string;
  location_id: string;
  qty: number;
  allocation_type: 'job' | 'project' | 'customer_order' | 'internal_order';
  reference_id: string;
  needed_by?: string;
}

export interface CycleCountStartedPayload {
  cycle_count_id: string;
  count_number: string;
  location_id?: string;
  scheduled_for: string;
  item_count: number;
}

export interface AdjustmentCreatedPayload {
  adjustment_id: string;
  catalog_item_id: string;
  location_id: string;
  qty_change: number;
  reason: string;
  requires_approval: boolean;
}

export interface ItemWizardCreatedPayload {
  item_id: string;
  item_sku: string;
  category_id?: string;
  vendor_id?: string;
  location_id?: string;
  initial_qty?: number;
  created_entities: Array<{ type: string; id?: string; name?: string }>;
}

// ============================================================================
// Typed Event Interfaces
// ============================================================================

// Supply Chain Events
export type VendorCreatedEvent = BaseEvent<VendorCreatedPayload>;
export type VendorUpdatedEvent = BaseEvent<VendorUpdatedPayload>;
export type PurchaseOrderCreatedEvent = BaseEvent<PurchaseOrderCreatedPayload>;
export type PurchaseOrderStatusEvent = BaseEvent<PurchaseOrderStatusPayload>;
export type ReceiptCreatedEvent = BaseEvent<ReceiptCreatedPayload>;
export type ReceiptLineAddedEvent = BaseEvent<ReceiptLineAddedPayload>;
export type ReceiptPostedEvent = BaseEvent<ReceiptPostedPayload>;

// Inventory Events
export type ItemCreatedEvent = BaseEvent<ItemCreatedPayload>;
export type StockReplenishedEvent = BaseEvent<StockReplenishedPayload>;
export type StockIssuedEvent = BaseEvent<StockIssuedPayload>;
export type StockAdjustedEvent = BaseEvent<StockAdjustedPayload>;
export type StockLowThresholdEvent = BaseEvent<StockLowThresholdPayload>;
export type TransferCreatedEvent = BaseEvent<TransferCreatedPayload>;
export type AssetAssignedEvent = BaseEvent<AssetAssignedPayload>;
export type ReservationCreatedEvent = BaseEvent<ReservationCreatedPayload>;
export type CycleCountStartedEvent = BaseEvent<CycleCountStartedPayload>;
export type AdjustmentCreatedEvent = BaseEvent<AdjustmentCreatedPayload>;

// ============================================================================
// Event Type Guards
// ============================================================================

export function isSupplyChainEvent(eventName: string): eventName is SupplyChainEventName {
  return eventName.startsWith('supply_chain.');
}

export function isInventoryEvent(eventName: string): eventName is InventoryEventName {
  return !eventName.startsWith('supply_chain.');
}

export function isVendorEvent(eventName: string): boolean {
  return eventName.startsWith('supply_chain.vendor.') || eventName.startsWith('supply_chain.vendor_item.');
}

export function isPurchaseOrderEvent(eventName: string): boolean {
  return eventName.startsWith('supply_chain.purchase_order.');
}

export function isReceiptEvent(eventName: string): boolean {
  return eventName.startsWith('supply_chain.receipt.');
}

export function isStockEvent(eventName: string): boolean {
  return eventName.startsWith('stock.');
}

export function isAssetEvent(eventName: string): boolean {
  return eventName.startsWith('asset.');
}

export function isReservationEvent(eventName: string): boolean {
  return eventName.startsWith('reservation.');
}

// ============================================================================
// Event Filter Helpers
// ============================================================================

export const SUPPLY_CHAIN_PATTERNS = {
  ALL: 'supply_chain.%',
  VENDOR: 'supply_chain.vendor.%',
  VENDOR_ITEM: 'supply_chain.vendor_item.%',
  PURCHASE_ORDER: 'supply_chain.purchase_order.%',
  RECEIPT: 'supply_chain.receipt.%',
} as const;

export const INVENTORY_PATTERNS = {
  STOCK: 'stock.%',
  ASSET: 'asset.%',
  TRANSFER: 'transfer.%',
  TRANSFER_PREFIXED: 'inventory.transfer.%',
  TRANSFER_LINE: 'inventory.transfer_line.%',
  CATALOG_ITEM: 'catalog_item.%',
  CATALOG_ITEM_PREFIXED: 'inventory.catalog_item.%',
  LOCATION: 'location.%',
  LOCATION_PREFIXED: 'inventory.location.%',
  CATEGORY: 'category.%',
  CATEGORY_PREFIXED: 'inventory.item_category.%',
  RESERVATION: 'reservation.%',
  CYCLE_COUNT: 'cycle_count.%',
  ADJUSTMENT: 'adjustment.%',
  LOCATION_TYPE: 'inventory.location_type.%',
  ASSIGNMENT_TYPE: 'inventory.assignment_type.%',
  RESERVATION_TYPE: 'inventory.reservation_type.%',
} as const;
