/**
 * Chat Action Executor
 * Bridges chat intents to real RPC operations
 */

import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { InventoryRPC } from '@/lib/rpc/inventory';
import type { IntentType } from './intents';

export interface ConversationStep {
  field: string;
  prompt: string;
  type: 'text' | 'select' | 'number' | 'confirm';
  required: boolean;
  options?: Array<{ label: string; value: string }>;
  validate?: (value: string) => string | null; // returns error message or null
}

export interface ActionDefinition {
  intent: IntentType;
  description: string;
  steps: ConversationStep[];
  execute: (params: Record<string, string>) => Promise<ActionResult>;
}

export interface ActionResult {
  success: boolean;
  message: string;
  data?: any;
  navigateTo?: string;
}

// ─── Helpers to load select options dynamically ───────────────────────

async function loadVendorOptions(): Promise<Array<{ label: string; value: string }>> {
  try {
    const vendors = await SupplyChainRPC.getVendors();
    return vendors.map((v) => ({
      label: v.code ? `${v.code} - ${v.name}` : v.name,
      value: v.id,
    }));
  } catch {
    return [];
  }
}

async function loadLocationOptions(): Promise<Array<{ label: string; value: string }>> {
  try {
    const locations = await InventoryRPC.getLocations({ active: true });
    return locations.map((l: any) => ({
      label: `${l.name}${l.location_type?.name ? ` (${l.location_type.name})` : ''}`,
      value: l.id,
    }));
  } catch {
    return [];
  }
}

async function loadItemOptions(): Promise<Array<{ label: string; value: string }>> {
  try {
    const items = await InventoryRPC.getCatalogItems({ active: true });
    return items.map((i) => ({
      label: `${i.sku} - ${i.name}`,
      value: i.id,
    }));
  } catch {
    return [];
  }
}

async function loadCategoryOptions(): Promise<Array<{ label: string; value: string }>> {
  try {
    const categories = await InventoryRPC.getItemCategories();
    return categories.map((c) => ({
      label: c.name,
      value: c.id,
    }));
  } catch {
    return [];
  }
}

async function loadLocationTypeOptions(): Promise<Array<{ label: string; value: string }>> {
  try {
    const types = await InventoryRPC.getLocationTypes();
    return types.map((t) => ({
      label: t.name,
      value: t.id,
    }));
  } catch {
    return [];
  }
}

// ─── Action Definitions ───────────────────────────────────────────────

export async function getActionDefinition(intent: IntentType): Promise<ActionDefinition | null> {
  switch (intent) {
    // ── Add Vendor ──────────────────────────────────────────────────
    case 'add_vendor':
      return {
        intent: 'add_vendor',
        description: 'Add a new vendor',
        steps: [
          {
            field: 'name',
            prompt: 'What is the vendor name?',
            type: 'text',
            required: true,
            validate: (v) => (v.trim().length < 2 ? 'Name must be at least 2 characters' : null),
          },
          {
            field: 'code',
            prompt: 'Vendor code? (optional, press Enter to skip)',
            type: 'text',
            required: false,
          },
          {
            field: 'contact_name',
            prompt: 'Contact person name? (optional, press Enter to skip)',
            type: 'text',
            required: false,
          },
          {
            field: 'contact_email',
            prompt: 'Contact email? (optional, press Enter to skip)',
            type: 'text',
            required: false,
          },
          {
            field: 'contact_phone',
            prompt: 'Contact phone? (optional, press Enter to skip)',
            type: 'text',
            required: false,
          },
          {
            field: 'confirm',
            prompt: '', // will be built dynamically
            type: 'confirm',
            required: true,
          },
        ],
        execute: async (params) => {
          const result = await SupplyChainRPC.createVendor({
            name: params.name,
            code: params.code || null,
            contact_name: params.contact_name || null,
            contact_email: params.contact_email || null,
            contact_phone: params.contact_phone || null,
          });
          return {
            success: true,
            message: `Vendor "${params.name}" created successfully!${params.code ? ` (Code: ${params.code})` : ''}`,
            data: result,
            navigateTo: '/inventory/vendors',
          };
        },
      };

    // ── Update Vendor ───────────────────────────────────────────────
    case 'update_vendor': {
      const vendorOptions = await loadVendorOptions();
      return {
        intent: 'update_vendor',
        description: 'Update an existing vendor',
        steps: [
          {
            field: 'vendor_id',
            prompt: 'Which vendor do you want to update?',
            type: 'select',
            required: true,
            options: vendorOptions,
          },
          {
            field: 'field_to_update',
            prompt: 'What do you want to update?',
            type: 'select',
            required: true,
            options: [
              { label: 'Name', value: 'name' },
              { label: 'Code', value: 'code' },
              { label: 'Contact Name', value: 'contact_name' },
              { label: 'Contact Email', value: 'contact_email' },
              { label: 'Contact Phone', value: 'contact_phone' },
              { label: 'Payment Terms', value: 'payment_terms' },
              { label: 'Notes', value: 'notes' },
            ],
          },
          {
            field: 'new_value',
            prompt: 'What should the new value be?',
            type: 'text',
            required: true,
          },
          {
            field: 'confirm',
            prompt: '',
            type: 'confirm',
            required: true,
          },
        ],
        execute: async (params) => {
          // First fetch current vendor to get last_event_id
          const vendor = await SupplyChainRPC.getVendorById(params.vendor_id);
          if (!vendor) throw new Error('Vendor not found');
          if (!vendor.last_event_id) throw new Error('Vendor is missing concurrency token. Please try from the vendors page.');

          const updates: Record<string, any> = {
            [params.field_to_update]: params.new_value,
          };

          await SupplyChainRPC.updateVendor(
            params.vendor_id,
            updates,
            vendor.last_event_id
          );

          return {
            success: true,
            message: `Vendor updated successfully! Set ${params.field_to_update} to "${params.new_value}".`,
          };
        },
      };
    }

    // ── List Vendors ────────────────────────────────────────────────
    case 'list_vendors':
      return {
        intent: 'list_vendors',
        description: 'List all vendors',
        steps: [],
        execute: async () => {
          const vendors = await SupplyChainRPC.getVendors();
          if (vendors.length === 0) {
            return {
              success: true,
              message: "You don't have any vendors yet. Say \"add a vendor\" to create one!",
            };
          }
          const list = vendors
            .map((v) => `  ${v.code ? `[${v.code}]` : '[-]'} ${v.name}${v.contact_email ? ` (${v.contact_email})` : ''}`)
            .join('\n');
          return {
            success: true,
            message: `Found ${vendors.length} vendor(s):\n\n${list}`,
            data: vendors,
          };
        },
      };

    // ── Add Item ────────────────────────────────────────────────────
    case 'add_item': {
      const categoryOptions = await loadCategoryOptions();
      return {
        intent: 'add_item',
        description: 'Add a new catalog item',
        steps: [
          {
            field: 'name',
            prompt: 'What is the item name?',
            type: 'text',
            required: true,
            validate: (v) => (v.trim().length < 2 ? 'Name must be at least 2 characters' : null),
          },
          {
            field: 'category_id',
            prompt: 'Which category? (optional, press Enter to skip)',
            type: 'select',
            required: false,
            options: categoryOptions,
          },
          {
            field: 'unit_of_measure',
            prompt: 'Unit of measure? (e.g. each, ton, gallon, bag — press Enter to skip)',
            type: 'text',
            required: false,
          },
          {
            field: 'tracking_mode',
            prompt: 'How should this item be tracked?',
            type: 'select',
            required: false,
            options: [
              { label: 'Fungible (bulk/quantity)', value: 'fungible' },
              { label: 'Serialized (unique assets)', value: 'serialized' },
            ],
          },
          {
            field: 'confirm',
            prompt: '',
            type: 'confirm',
            required: true,
          },
        ],
        execute: async (params) => {
          const result = await InventoryRPC.createCatalogItem({
            name: params.name,
            sku: '', // auto-generated by RPC if empty
            category_id: params.category_id || null,
            unit_of_measure: params.unit_of_measure || null,
            tracking_mode: params.tracking_mode || 'fungible',
          });
          return {
            success: true,
            message: `Item "${params.name}" created successfully!`,
            data: result,
            navigateTo: '/inventory/items',
          };
        },
      };
    }

    // ── Update Item ────────────────────────────────────────────────
    case 'update_item': {
      const updateItemOptions = await loadItemOptions();
      return {
        intent: 'update_item',
        description: 'Update an existing catalog item',
        steps: [
          {
            field: 'catalog_item_id',
            prompt: 'Which item do you want to update?',
            type: 'select',
            required: true,
            options: updateItemOptions,
          },
          {
            field: 'field_to_update',
            prompt: 'What do you want to update?',
            type: 'select',
            required: true,
            options: [
              { label: 'Name', value: 'name' },
              { label: 'Unit of Measure', value: 'unit_of_measure' },
              { label: 'Reorder Point', value: 'reorder_point' },
              { label: 'Description', value: 'description' },
            ],
          },
          {
            field: 'new_value',
            prompt: 'What should the new value be?',
            type: 'text',
            required: true,
          },
          {
            field: 'confirm',
            prompt: '',
            type: 'confirm',
            required: true,
          },
        ],
        execute: async (params) => {
          const items = await InventoryRPC.getCatalogItems({ active: true });
          const item = items.find((i) => i.id === params.catalog_item_id);
          if (!item) throw new Error('Item not found');
          if (!item.last_event_id) throw new Error('Item is missing concurrency token. Please try from the items page.');

          const updates: Record<string, any> = {
            [params.field_to_update]: params.new_value,
          };

          await InventoryRPC.updateCatalogItem(
            params.catalog_item_id,
            updates,
            item.last_event_id
          );

          return {
            success: true,
            message: `Item updated successfully! Set ${params.field_to_update} to "${params.new_value}".`,
            navigateTo: '/inventory/items',
          };
        },
      };
    }

    // ── List Items ──────────────────────────────────────────────────
    case 'list_items':
      return {
        intent: 'list_items',
        description: 'List catalog items',
        steps: [],
        execute: async () => {
          const items = await InventoryRPC.getCatalogItems({ active: true });
          if (items.length === 0) {
            return {
              success: true,
              message: "You don't have any catalog items yet. Say \"add an item\" to create one!",
            };
          }
          const list = items
            .slice(0, 20)
            .map((i) => `  [${i.sku}] ${i.name}${i.item_categories?.name ? ` (${i.item_categories.name})` : ''}`)
            .join('\n');
          const suffix = items.length > 20 ? `\n\n...and ${items.length - 20} more items.` : '';
          return {
            success: true,
            message: `Found ${items.length} item(s):\n\n${list}${suffix}`,
            data: items,
          };
        },
      };

    // ── Adjust Stock ────────────────────────────────────────────────
    case 'adjust_stock':
    case 'update_stock': {
      const itemOpts = await loadItemOptions();
      const locOpts = await loadLocationOptions();
      return {
        intent: 'adjust_stock',
        description: 'Adjust stock balance for an item',
        steps: [
          {
            field: 'catalog_item_id',
            prompt: 'Which item do you want to adjust?',
            type: 'select',
            required: true,
            options: itemOpts,
          },
          {
            field: 'location_id',
            prompt: 'At which location?',
            type: 'select',
            required: true,
            options: locOpts,
          },
          {
            field: 'new_qty',
            prompt: 'What is the new quantity (on-hand count)?',
            type: 'number',
            required: true,
            validate: (v) => {
              const n = Number(v);
              if (isNaN(n) || n < 0) return 'Please enter a valid non-negative number';
              return null;
            },
          },
          {
            field: 'reason',
            prompt: 'Reason for the adjustment?',
            type: 'select',
            required: true,
            options: [
              { label: 'Count Variance', value: 'count_variance' },
              { label: 'Damage', value: 'damage' },
              { label: 'Theft', value: 'theft' },
              { label: 'Expiration', value: 'expiration' },
              { label: 'Other', value: 'other' },
            ],
          },
          {
            field: 'notes',
            prompt: 'Any notes? (optional, press Enter to skip)',
            type: 'text',
            required: false,
          },
          {
            field: 'confirm',
            prompt: '',
            type: 'confirm',
            required: true,
          },
        ],
        execute: async (params) => {
          const result = await InventoryRPC.adjustInventory({
            location_id: params.location_id,
            catalog_item_id: params.catalog_item_id,
            new_qty: Number(params.new_qty),
            reason: params.reason as 'count_variance' | 'damage' | 'theft' | 'expiration' | 'other',
            notes: params.notes || `Adjusted via chat assistant`,
          });
          return {
            success: true,
            message: `Stock adjusted! Old: ${result.old_qty} -> New: ${result.new_qty} (delta: ${result.delta > 0 ? '+' : ''}${result.delta})`,
            data: result,
          };
        },
      };
    }

    // ── Check Stock ─────────────────────────────────────────────────
    case 'check_stock': {
      const checkItemOpts = await loadItemOptions();
      return {
        intent: 'check_stock',
        description: 'Check stock levels',
        steps: [
          {
            field: 'catalog_item_id',
            prompt: 'Which item do you want to check? (press Enter to see all)',
            type: 'select',
            required: false,
            options: checkItemOpts,
          },
        ],
        execute: async (params) => {
          const balances = await InventoryRPC.getStockBalances(
            params.catalog_item_id ? { catalog_item_id: params.catalog_item_id } : undefined
          );
          if (!balances || balances.length === 0) {
            return { success: true, message: 'No stock balances found.' };
          }
          const list = balances
            .slice(0, 20)
            .map((b: any) => {
              const itemName = b.catalog_items?.name || 'Unknown';
              const sku = b.catalog_items?.sku || '-';
              const loc = b.locations?.name || 'Unknown';
              return `  [${sku}] ${itemName} @ ${loc}: ${b.qty_on_hand ?? 0} on hand, ${b.qty_available ?? 0} available`;
            })
            .join('\n');
          const suffix = balances.length > 20 ? `\n\n...and ${balances.length - 20} more.` : '';
          return {
            success: true,
            message: `Stock balances:\n\n${list}${suffix}`,
            data: balances,
          };
        },
      };
    }

    // ── Low Stock ───────────────────────────────────────────────────
    case 'low_stock':
      return {
        intent: 'low_stock',
        description: 'Check low stock items',
        steps: [],
        execute: async () => {
          const items = await InventoryRPC.getLowStockItems();
          if (!items || items.length === 0) {
            return {
              success: true,
              message: 'All items are above their minimum stock levels!',
            };
          }
          const list = items
            .slice(0, 15)
            .map((i: any) => `  ${i.item_name} (${i.sku}) - Available: ${i.total_available}, Reorder Point: ${i.reorder_point ?? 'N/A'}`)
            .join('\n');
          return {
            success: true,
            message: `Found ${items.length} low stock item(s):\n\n${list}`,
            data: items,
            navigateTo: '/inventory/alerts',
          };
        },
      };

    // ── Create PO ───────────────────────────────────────────────────
    case 'create_po':
      return {
        intent: 'create_po',
        description: 'Create a purchase order',
        steps: [],
        execute: async () => {
          return {
            success: true,
            message: "I'll take you to the Purchase Order creation page where you can fill in all the details.",
            navigateTo: '/inventory/purchasing',
          };
        },
      };

    // ── List POs ────────────────────────────────────────────────────
    case 'list_pos':
      return {
        intent: 'list_pos',
        description: 'List purchase orders',
        steps: [],
        execute: async () => {
          const orders = await SupplyChainRPC.getPurchaseOrders();
          if (!orders || orders.length === 0) {
            return { success: true, message: 'No purchase orders found.' };
          }
          const list = orders
            .slice(0, 15)
            .map((po: any) => `  ${po.po_number} - ${po.vendor_name_snapshot || 'Unknown'} [${po.status}]`)
            .join('\n');
          const suffix = orders.length > 15 ? `\n\n...and ${orders.length - 15} more.` : '';
          return {
            success: true,
            message: `Found ${orders.length} purchase order(s):\n\n${list}${suffix}`,
            data: orders,
            navigateTo: '/inventory/purchasing',
          };
        },
      };

    // ── Late Orders ─────────────────────────────────────────────────
    case 'late_orders':
      return {
        intent: 'late_orders',
        description: 'Check for late purchase orders',
        steps: [],
        execute: async () => {
          const orders = await SupplyChainRPC.getPurchaseOrders();
          const today = new Date();
          const lateOrders = (orders || []).filter((po: any) => {
            if (!po.expected_delivery_date) return false;
            return (
              new Date(po.expected_delivery_date) < today &&
              !['received', 'closed', 'cancelled', 'fully_received'].includes(po.status)
            );
          });
          if (lateOrders.length === 0) {
            return { success: true, message: 'No late purchase orders!' };
          }
          const list = lateOrders
            .map((po: any) => {
              const daysLate = Math.floor(
                (today.getTime() - new Date(po.expected_delivery_date).getTime()) / 86400000
              );
              return `  ${po.po_number} - ${po.vendor_name_snapshot || 'Unknown'} - ${daysLate} day(s) late [${po.status}]`;
            })
            .join('\n');
          return {
            success: true,
            message: `Found ${lateOrders.length} late order(s):\n\n${list}`,
            data: lateOrders,
            navigateTo: '/inventory/purchasing',
          };
        },
      };

    // ── List Locations ──────────────────────────────────────────────
    case 'list_locations':
      return {
        intent: 'list_locations',
        description: 'List locations',
        steps: [],
        execute: async () => {
          const locations = await InventoryRPC.getLocations();
          if (locations.length === 0) {
            return { success: true, message: 'No locations found.' };
          }
          const list = locations
            .map((l: any) => `  ${l.name}${l.location_type?.name ? ` (${l.location_type.name})` : ''}${l.active === false ? ' [Inactive]' : ''}`)
            .join('\n');
          return {
            success: true,
            message: `Found ${locations.length} location(s):\n\n${list}`,
            data: locations,
          };
        },
      };

    // ── Add Location ────────────────────────────────────────────────
    case 'add_location': {
      const locTypeOpts = await loadLocationTypeOptions();
      return {
        intent: 'add_location',
        description: 'Add a new location',
        steps: [
          {
            field: 'name',
            prompt: 'What is the location name?',
            type: 'text',
            required: true,
            validate: (v) => (v.trim().length < 2 ? 'Name must be at least 2 characters' : null),
          },
          {
            field: 'location_type_id',
            prompt: 'What type of location?',
            type: 'select',
            required: true,
            options: locTypeOpts,
          },
          {
            field: 'confirm',
            prompt: '',
            type: 'confirm',
            required: true,
          },
        ],
        execute: async (params) => {
          // location_type (text label) is required alongside location_type_id
          const locTypes = await InventoryRPC.getLocationTypes();
          const locType = locTypes.find((t) => t.id === params.location_type_id);

          await InventoryRPC.createLocation({
            name: params.name,
            location_type_id: params.location_type_id,
            location_type: locType?.name || 'warehouse',
          });
          return {
            success: true,
            message: `Location "${params.name}" created successfully!`,
            navigateTo: '/inventory/locations',
          };
        },
      };
    }

    // ── Delete Vendor ─────────────────────────────────────────────
    case 'delete_vendor': {
      const deleteVendorOptions = await loadVendorOptions();
      return {
        intent: 'delete_vendor',
        description: 'Delete a vendor',
        steps: [
          {
            field: 'vendor_id',
            prompt: 'Which vendor do you want to delete?',
            type: 'select',
            required: true,
            options: deleteVendorOptions,
          },
          {
            field: 'confirm',
            prompt: '',
            type: 'confirm',
            required: true,
          },
        ],
        execute: async (params) => {
          const vendor = await SupplyChainRPC.getVendorById(params.vendor_id);
          if (!vendor) throw new Error('Vendor not found');
          if (!vendor.last_event_id) throw new Error('Vendor is missing concurrency token.');

          await SupplyChainRPC.deleteVendor(params.vendor_id, vendor.last_event_id);
          return {
            success: true,
            message: `Vendor "${vendor.name}" has been deactivated.`,
            navigateTo: '/inventory/vendors',
          };
        },
      };
    }

    // ── Delete Item ──────────────────────────────────────────────
    case 'delete_item': {
      const deleteItemOptions = await loadItemOptions();
      return {
        intent: 'delete_item',
        description: 'Delete a catalog item',
        steps: [
          {
            field: 'catalog_item_id',
            prompt: 'Which item do you want to delete?',
            type: 'select',
            required: true,
            options: deleteItemOptions,
          },
          {
            field: 'confirm',
            prompt: '',
            type: 'confirm',
            required: true,
          },
        ],
        execute: async (params) => {
          const items = await InventoryRPC.getCatalogItems({ active: true });
          const item = items.find((i) => i.id === params.catalog_item_id);
          if (!item) throw new Error('Item not found');
          if (!item.last_event_id) throw new Error('Item is missing concurrency token.');

          await InventoryRPC.deleteCatalogItem(params.catalog_item_id, item.last_event_id);
          return {
            success: true,
            message: `Item "${item.name}" (${item.sku}) has been deleted.`,
            navigateTo: '/inventory/items',
          };
        },
      };
    }

    // ── Issue Inventory ──────────────────────────────────────────
    case 'issue_inventory': {
      const issueLocOpts = await loadLocationOptions();
      const issueItemOpts = await loadItemOptions();
      return {
        intent: 'issue_inventory',
        description: 'Issue inventory from a location',
        steps: [
          {
            field: 'location_id',
            prompt: 'Which location are you issuing from?',
            type: 'select',
            required: true,
            options: issueLocOpts,
          },
          {
            field: 'catalog_item_id',
            prompt: 'Which item are you issuing?',
            type: 'select',
            required: true,
            options: issueItemOpts,
          },
          {
            field: 'quantity',
            prompt: 'How many units?',
            type: 'number',
            required: true,
            validate: (v) => {
              const n = Number(v);
              if (isNaN(n) || n <= 0) return 'Please enter a positive number';
              return null;
            },
          },
          {
            field: 'issued_to_type',
            prompt: 'Issuing to:',
            type: 'select',
            required: true,
            options: [
              { label: 'Job', value: 'job' },
              { label: 'Truck', value: 'truck' },
              { label: 'Person', value: 'person' },
              { label: 'Other', value: 'other' },
            ],
          },
          {
            field: 'issued_to_ref',
            prompt: 'Reference (job number, truck ID, person name, etc.)?',
            type: 'text',
            required: true,
          },
          {
            field: 'reason',
            prompt: 'Reason for issuing?',
            type: 'text',
            required: true,
          },
          {
            field: 'confirm',
            prompt: '',
            type: 'confirm',
            required: true,
          },
        ],
        execute: async (params) => {
          const result = await InventoryRPC.issueInventory({
            location_id: params.location_id,
            items: [{
              catalog_item_id: params.catalog_item_id,
              qty_issued: Number(params.quantity),
            }],
            issued_to_type: params.issued_to_type as 'job' | 'truck' | 'person' | 'other',
            issued_to_ref: params.issued_to_ref,
            reason: params.reason,
          });
          return {
            success: true,
            message: `Issued ${params.quantity} unit(s) to ${params.issued_to_type} "${params.issued_to_ref}".`,
            data: result,
          };
        },
      };
    }

    // ── Create Transfer ──────────────────────────────────────────
    case 'create_transfer': {
      const fromLocOpts = await loadLocationOptions();
      const toLocOpts = await loadLocationOptions();
      const transferItemOpts = await loadItemOptions();
      return {
        intent: 'create_transfer',
        description: 'Create a stock transfer',
        steps: [
          {
            field: 'from_location_id',
            prompt: 'Transfer FROM which location?',
            type: 'select',
            required: true,
            options: fromLocOpts,
          },
          {
            field: 'to_location_id',
            prompt: 'Transfer TO which location?',
            type: 'select',
            required: true,
            options: toLocOpts,
          },
          {
            field: 'catalog_item_id',
            prompt: 'Which item to transfer?',
            type: 'select',
            required: true,
            options: transferItemOpts,
          },
          {
            field: 'quantity',
            prompt: 'How many units?',
            type: 'number',
            required: true,
            validate: (v) => {
              const n = Number(v);
              if (isNaN(n) || n <= 0) return 'Please enter a positive number';
              return null;
            },
          },
          {
            field: 'notes',
            prompt: 'Any notes? (optional, press Enter to skip)',
            type: 'text',
            required: false,
          },
          {
            field: 'confirm',
            prompt: '',
            type: 'confirm',
            required: true,
          },
        ],
        execute: async (params) => {
          const transferId = await InventoryRPC.createTransfer({
            from_location_id: params.from_location_id,
            to_location_id: params.to_location_id,
            notes: params.notes || null,
            lines: [{
              catalog_item_id: params.catalog_item_id,
              qty: Number(params.quantity),
            }],
          });
          return {
            success: true,
            message: `Transfer created successfully! (ID: ${transferId?.slice(0, 8)}...)`,
            data: { transfer_id: transferId },
            navigateTo: '/inventory/transfers',
          };
        },
      };
    }

    // ── Create Asset ─────────────────────────────────────────────
    case 'create_asset': {
      const assetItemOpts = await loadItemOptions();
      const assetLocOpts = await loadLocationOptions();
      return {
        intent: 'create_asset',
        description: 'Register a new asset',
        steps: [
          {
            field: 'asset_tag',
            prompt: 'What is the asset tag / identifier?',
            type: 'text',
            required: true,
            validate: (v) => (v.trim().length < 1 ? 'Asset tag is required' : null),
          },
          {
            field: 'catalog_item_id',
            prompt: 'Which catalog item does this asset belong to?',
            type: 'select',
            required: true,
            options: assetItemOpts,
          },
          {
            field: 'location_id',
            prompt: 'Where is the asset located?',
            type: 'select',
            required: true,
            options: assetLocOpts,
          },
          {
            field: 'serial_number',
            prompt: 'Serial number? (optional, press Enter to skip)',
            type: 'text',
            required: false,
          },
          {
            field: 'confirm',
            prompt: '',
            type: 'confirm',
            required: true,
          },
        ],
        execute: async (params) => {
          const result = await InventoryRPC.createAsset({
            asset_tag: params.asset_tag,
            catalog_item_id: params.catalog_item_id,
            location_id: params.location_id,
            serial_number: params.serial_number || null,
            status: 'available',
          });
          return {
            success: true,
            message: `Asset "${params.asset_tag}" registered successfully!`,
            data: result,
            navigateTo: '/inventory/assets',
          };
        },
      };
    }

    // ── List Assets ──────────────────────────────────────────────
    case 'list_assets':
      return {
        intent: 'list_assets',
        description: 'List assets',
        steps: [],
        execute: async () => {
          const assets = await InventoryRPC.getAssets();
          if (!assets || assets.length === 0) {
            return { success: true, message: 'No assets found. Say "create an asset" to register one!' };
          }
          const list = assets
            .slice(0, 20)
            .map((a) => {
              const itemName = a.catalog_item?.name || 'Unknown';
              const loc = a.location?.name || 'Unknown';
              return `  [${a.asset_tag}] ${itemName} @ ${loc} (${a.status || 'unknown'})`;
            })
            .join('\n');
          const suffix = assets.length > 20 ? `\n\n...and ${assets.length - 20} more.` : '';
          return {
            success: true,
            message: `Found ${assets.length} asset(s):\n\n${list}${suffix}`,
            data: assets,
            navigateTo: '/inventory/assets',
          };
        },
      };

    // ── List Transfers ───────────────────────────────────────────
    case 'list_transfers':
      return {
        intent: 'list_transfers',
        description: 'List transfers',
        steps: [],
        execute: async () => {
          const transfers = await InventoryRPC.getTransfers();
          if (!transfers || transfers.length === 0) {
            return { success: true, message: 'No transfers found.' };
          }
          const list = transfers
            .slice(0, 15)
            .map((t) => {
              const from = t.from_location?.name || 'Unknown';
              const to = t.to_location?.name || 'Unknown';
              const lineCount = t.transfer_lines?.length || 0;
              return `  ${from} → ${to} [${t.status}] (${lineCount} line(s))`;
            })
            .join('\n');
          const suffix = transfers.length > 15 ? `\n\n...and ${transfers.length - 15} more.` : '';
          return {
            success: true,
            message: `Found ${transfers.length} transfer(s):\n\n${list}${suffix}`,
            data: transfers,
            navigateTo: '/inventory/transfers',
          };
        },
      };

    // ── List Receipts ────────────────────────────────────────────
    case 'list_receipts':
      return {
        intent: 'list_receipts',
        description: 'List recent receipts',
        steps: [],
        execute: async () => {
          const receipts = await SupplyChainRPC.getRecentReceipts(30);
          if (!receipts || receipts.length === 0) {
            return { success: true, message: 'No recent receipts found.' };
          }
          const list = (receipts as any[])
            .slice(0, 15)
            .map((r: any) => `  ${r.receipt_number || r.id?.slice(0, 8)} - ${r.location_name || 'Unknown'} [${r.status || 'confirmed'}]`)
            .join('\n');
          const suffix = receipts.length > 15 ? `\n\n...and ${receipts.length - 15} more.` : '';
          return {
            success: true,
            message: `Found ${receipts.length} recent receipt(s):\n\n${list}${suffix}`,
            data: receipts,
            navigateTo: '/inventory/receiving',
          };
        },
      };

    // ── Inventory Summary ───────────────────────────────────────────
    case 'inventory_summary':
      return {
        intent: 'inventory_summary',
        description: 'View inventory summary',
        steps: [],
        execute: async () => {
          const summary = await InventoryRPC.getInventorySummary();
          if (!summary) {
            return { success: true, message: 'No inventory data available yet.' };
          }
          const lines = [
            `Total SKUs: ${summary.total_skus ?? 0}`,
            `Active Items: ${summary.active_items ?? 0}`,
            `Total Locations: ${summary.total_locations ?? 0}`,
            `Items Below Reorder: ${summary.items_below_reorder ?? 0}`,
          ];
          return {
            success: true,
            message: `Inventory Summary:\n\n${lines.map(l => '  ' + l).join('\n')}`,
            data: summary,
          };
        },
      };

    // ── Navigate ────────────────────────────────────────────────────
    case 'navigate':
      return {
        intent: 'navigate',
        description: 'Navigate to a page',
        steps: [],
        execute: async () => {
          return { success: true, message: 'Navigation handled separately.' };
        },
      };

    // ── Help ────────────────────────────────────────────────────────
    case 'help':
      return {
        intent: 'help',
        description: 'Show help',
        steps: [],
        execute: async () => {
          return {
            success: true,
            message: [
              "Here's what I can help you with:\n",
              'Vendors:',
              '  "Add a vendor" - Create a new vendor',
              '  "Update a vendor" - Edit vendor details',
              '  "Delete a vendor" - Remove a vendor',
              '  "List vendors" - See all vendors',
              '',
              'Items:',
              '  "Add an item" - Create a catalog item',
              '  "Delete an item" - Remove a catalog item',
              '  "List items" - See all items',
              '',
              'Stock:',
              '  "Adjust stock" / "Update stock balance" - Correct stock levels',
              '  "Check stock" - View current stock',
              '  "Low stock" / "What\'s running low?" - See low items',
              '  "Issue inventory" - Release stock to a job/truck/person',
              '',
              'Purchase Orders:',
              '  "Create a PO" - Start a new purchase order',
              '  "List POs" - See purchase orders',
              '  "Late orders" - Check for overdue deliveries',
              '',
              'Locations:',
              '  "Add a location" - Create a new location',
              '  "List locations" - See all locations',
              '',
              'Transfers:',
              '  "Create a transfer" - Move stock between locations',
              '  "List transfers" - See recent transfers',
              '',
              'Assets:',
              '  "Create an asset" - Register new equipment/tool',
              '  "List assets" - See registered assets',
              '',
              'Other:',
              '  "List receipts" - See recent receipts',
              '  "Inventory summary" - Overview of your inventory',
            ].join('\n'),
          };
        },
      };

    default:
      return null;
  }
}

/**
 * Resolves navigation path from user message
 */
export function resolveNavigation(message: string): string | null {
  const lower = message.toLowerCase();
  const routes: Record<string, string[]> = {
    '/dashboard': ['dashboard', 'home'],
    '/inventory/stock': ['stock', 'stock levels', 'inventory levels'],
    '/inventory/items': ['items', 'catalog'],
    '/inventory/vendors': ['vendors', 'suppliers'],
    '/inventory/purchasing': ['purchasing', 'purchase orders', 'pos'],
    '/inventory/receiving': ['receiving', 'receipts'],
    '/inventory/locations': ['locations', 'warehouses', 'yards'],
    '/inventory/transfers': ['transfers'],
    '/inventory/reservations': ['reservations'],
    '/inventory/assets': ['assets', 'equipment'],
    '/inventory/categories': ['categories'],
    '/inventory/movements': ['movements', 'stock movements'],
    '/inventory/alerts': ['alerts', 'low stock'],
    '/inventory/reports': ['reports'],
    '/settings': ['settings', 'configuration'],
  };

  for (const [path, keywords] of Object.entries(routes)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return path;
      }
    }
  }

  return null;
}
