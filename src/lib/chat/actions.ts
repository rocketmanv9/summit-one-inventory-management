/**
 * Chat Action Executor
 * Bridges chat intents to real RPC operations
 */

import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { AppError } from '@rocketmanv9/chassis/errors';
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

// ─── Fuzzy-resolve helpers ────────────────────────────────────────────
// Accept either a UUID (pass through) or a human name (fuzzy-match).
// This bridges the gap between what OpenAI tools send (names) and what
// the RPC layer expects (UUIDs).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(v: string): boolean {
  return UUID_RE.test(v);
}

function fuzzyFind<T extends { id: string }>(
  items: T[],
  query: string,
  nameGetter: (item: T) => string
): T | null {
  if (!query) return null;
  // If it's a UUID, match by id directly
  if (isUUID(query)) return items.find((i) => i.id === query) || null;
  const q = query.toLowerCase();
  return (
    items.find((i) => nameGetter(i).toLowerCase() === q) ||
    items.find((i) => nameGetter(i).toLowerCase().includes(q)) ||
    items.find((i) => q.includes(nameGetter(i).toLowerCase())) ||
    null
  );
}

async function resolveItemId(hint: string): Promise<{ id: string; name: string; sku: string; last_event_id?: string }> {
  const items = await InventoryRPC.getCatalogItems({ active: true });
  const match = fuzzyFind(items, hint, (i) => `${i.name} ${i.sku}`);
  if (!match) throw AppError.notFound(`Item "${hint}" not found`);
  return { id: match.id, name: match.name, sku: match.sku, last_event_id: match.last_event_id ?? undefined };
}

async function resolveLocationId(hint: string): Promise<{ id: string; name: string }> {
  const locations = await InventoryRPC.getLocations({ active: true });
  const match = fuzzyFind(locations, hint, (l: any) => l.name);
  if (!match) throw AppError.notFound(`Location "${hint}" not found`);
  return match as any;
}

async function resolveVendorId(hint: string): Promise<{ id: string; name: string; last_event_id?: string }> {
  const vendors = await SupplyChainRPC.getVendors();
  const match = fuzzyFind(vendors, hint, (v) => `${v.name} ${v.code || ''}`);
  if (!match) throw AppError.notFound(`Vendor "${hint}" not found`);
  return match as any;
}

function resolveEnum(hint: string, validValues: string[], fallback: string): string {
  if (!hint) return fallback;
  const q = hint.toLowerCase().replace(/[_\s-]+/g, '');
  // Exact match
  const exact = validValues.find((v) => v === hint);
  if (exact) return exact;
  // Fuzzy match
  const fuzzy = validValues.find((v) => v.replace(/[_\s-]+/g, '').includes(q) || q.includes(v.replace(/[_\s-]+/g, '')));
  return fuzzy || fallback;
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
            field: 'name',
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
          const vendor = await resolveVendorId(params.name);
          if (!vendor.last_event_id) throw AppError.badRequest('Vendor is missing concurrency token. Please try from the vendors page.');

          const field = resolveEnum(params.field_to_update, ['name', 'code', 'contact_name', 'contact_email', 'contact_phone', 'payment_terms', 'notes'], params.field_to_update);
          const updates: Record<string, any> = { [field]: params.new_value };

          await SupplyChainRPC.updateVendor(vendor.id, updates, vendor.last_event_id);

          return {
            success: true,
            message: `Vendor "${vendor.name}" updated! Set ${field} to "${params.new_value}".`,
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
          // Resolve category text → category_id (fuzzy-match or auto-create)
          let categoryId: string | null = params.category_id || null;
          if (!categoryId && params.category) {
            const categories = await InventoryRPC.getItemCategories();
            const match = fuzzyFind(categories, params.category, (c) => c.name);
            if (match) {
              categoryId = match.id;
            } else {
              try {
                const created = await InventoryRPC.createItemCategory({ name: params.category });
                categoryId = created.id;
              } catch {
                // Non-fatal — create item without category
              }
            }
          }

          const result = await InventoryRPC.createCatalogItem({
            name: params.name,
            sku: '',
            description: params.description || null,
            category_id: categoryId,
            unit_of_measure: params.unit_of_measure || null,
            tracking_mode: params.tracking_mode || 'fungible',
          });
          const categoryNote = categoryId && params.category ? ` in category "${params.category}"` : '';
          return {
            success: true,
            message: `Item "${params.name}" created successfully${categoryNote}!`,
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
            field: 'name',
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
              { label: 'Category', value: 'category' },
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
          const item = await resolveItemId(params.name);
          if (!item.last_event_id) throw AppError.badRequest('Item is missing concurrency token. Please try from the items page.');

          const updates: Record<string, any> = {};

          if (params.field_to_update === 'category') {
            const categories = await InventoryRPC.getItemCategories();
            const match = fuzzyFind(categories, params.new_value, (c) => c.name);
            if (match) {
              updates.category_id = match.id;
            } else {
              const created = await InventoryRPC.createItemCategory({ name: params.new_value });
              updates.category_id = created.id;
            }
          } else {
            updates[params.field_to_update] = params.new_value;
          }

          await InventoryRPC.updateCatalogItem(item.id, updates, item.last_event_id);

          return {
            success: true,
            message: `Item "${item.name}" updated! Set ${params.field_to_update} to "${params.new_value}".`,
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
            field: 'item',
            prompt: 'Which item do you want to adjust?',
            type: 'select',
            required: true,
            options: itemOpts,
          },
          {
            field: 'location',
            prompt: 'At which location?',
            type: 'select',
            required: true,
            options: locOpts,
          },
          {
            field: 'quantity',
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
          const item = await resolveItemId(params.item);
          const loc = await resolveLocationId(params.location);
          const reason = resolveEnum(params.reason, ['count_variance', 'damage', 'theft', 'expiration', 'other'], 'other') as 'count_variance' | 'damage' | 'theft' | 'expiration' | 'other';

          const result = await InventoryRPC.adjustInventory({
            location_id: loc.id,
            catalog_item_id: item.id,
            new_qty: Number(params.quantity),
            reason,
            notes: params.notes || `Adjusted via chat assistant`,
          });
          if (!result.success && result.error) {
            return { success: false, message: result.error.message, data: result.error };
          }
          const delta = result.delta ?? 0;
          return {
            success: true,
            message: `Stock adjusted for "${item.name}" at ${loc.name}! Old: ${result.current_qty} → New: ${result.new_qty} (delta: ${delta > 0 ? '+' : ''}${delta})`,
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
            field: 'item',
            prompt: 'Which item do you want to check? (press Enter to see all)',
            type: 'select',
            required: false,
            options: checkItemOpts,
          },
        ],
        execute: async (params) => {
          let catalogItemId: string | undefined;
          if (params.item) {
            try {
              const item = await resolveItemId(params.item);
              catalogItemId = item.id;
            } catch {
              // Not found — show all
            }
          }
          const balances = await InventoryRPC.getStockBalances(
            catalogItemId ? { catalog_item_id: catalogItemId } : undefined
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
            field: 'confirm',
            prompt: '',
            type: 'confirm',
            required: true,
          },
        ],
        execute: async (params) => {
          // Auto-detect location type from name or explicit param
          let typeId: string | null = null;
          let typeName = '';

          if (locTypeOpts.length > 0) {
            // Check if user explicitly passed a type
            const typeHint = params.location_type || '';
            if (typeHint) {
              const match = fuzzyFind(
                locTypeOpts.map((o) => ({ id: o.value, name: o.label })),
                typeHint,
                (t) => t.name
              );
              if (match) { typeId = match.id; typeName = match.name; }
            }

            // Infer from name if no explicit type
            if (!typeId) {
              const nameLower = params.name.toLowerCase();
              const typeKeywords: Record<string, string[]> = {
                warehouse: ['warehouse', 'wh'],
                yard: ['yard'],
                'job site': ['job site', 'jobsite', 'job'],
                office: ['office', 'hq'],
                shop: ['shop'],
                truck: ['truck'],
              };
              for (const [typeLabel, keywords] of Object.entries(typeKeywords)) {
                if (keywords.some((kw) => nameLower.includes(kw))) {
                  const match = locTypeOpts.find((o) => o.label.toLowerCase().includes(typeLabel));
                  if (match) { typeId = match.value; typeName = match.label; break; }
                }
              }
            }
          }

          await InventoryRPC.createLocation({
            name: params.name,
            location_type_id: typeId || locTypeOpts[0]?.value || '',
            location_type: typeName || locTypeOpts[0]?.label || 'warehouse',
          });
          return {
            success: true,
            message: `Location "${params.name}" created${typeName ? ` as ${typeName}` : ''}!`,
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
            field: 'name',
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
          const vendor = await resolveVendorId(params.name);
          if (!vendor.last_event_id) throw AppError.badRequest('Vendor is missing concurrency token.');

          await SupplyChainRPC.deleteVendor(vendor.id, vendor.last_event_id);
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
            field: 'name',
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
          const item = await resolveItemId(params.name);
          if (!item.last_event_id) throw AppError.badRequest('Item is missing concurrency token.');

          await InventoryRPC.deleteCatalogItem(item.id, item.last_event_id);
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
            field: 'location',
            prompt: 'Which location are you issuing from?',
            type: 'select',
            required: true,
            options: issueLocOpts,
          },
          {
            field: 'item',
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
          const loc = await resolveLocationId(params.location);
          const item = await resolveItemId(params.item);
          const issuedToType = resolveEnum(params.issued_to_type, ['job', 'truck', 'person', 'other'], 'other') as 'job' | 'truck' | 'person' | 'other';

          const result = await InventoryRPC.issueInventory({
            location_id: loc.id,
            items: [{
              catalog_item_id: item.id,
              qty_issued: Number(params.quantity),
            }],
            issued_to_type: issuedToType,
            issued_to_ref: params.issued_to_ref,
            reason: params.reason,
          });
          return {
            success: true,
            message: `Issued ${params.quantity} "${item.name}" from ${loc.name} to ${issuedToType} "${params.issued_to_ref}".`,
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
            field: 'from_location',
            prompt: 'Transfer FROM which location?',
            type: 'select',
            required: true,
            options: fromLocOpts,
          },
          {
            field: 'to_location',
            prompt: 'Transfer TO which location?',
            type: 'select',
            required: true,
            options: toLocOpts,
          },
          {
            field: 'item',
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
          const fromLoc = await resolveLocationId(params.from_location);
          const toLoc = await resolveLocationId(params.to_location);
          const item = await resolveItemId(params.item);

          const transferId = await InventoryRPC.createTransfer({
            from_location_id: fromLoc.id,
            to_location_id: toLoc.id,
            notes: params.notes || null,
            lines: [{
              catalog_item_id: item.id,
              qty: Number(params.quantity),
            }],
          });
          return {
            success: true,
            message: `Transfer created! ${params.quantity} "${item.name}" from ${fromLoc.name} → ${toLoc.name}.`,
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
            field: 'item',
            prompt: 'Which catalog item does this asset belong to?',
            type: 'select',
            required: true,
            options: assetItemOpts,
          },
          {
            field: 'location',
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
          const item = await resolveItemId(params.item);
          const loc = await resolveLocationId(params.location);

          const result = await InventoryRPC.createAsset({
            asset_tag: params.asset_tag,
            catalog_item_id: item.id,
            location_id: loc.id,
            serial_number: params.serial_number || null,
            status: 'available',
          });
          return {
            success: true,
            message: `Asset "${params.asset_tag}" (${item.name}) registered at ${loc.name}!`,
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
            navigateTo: '/inventory/purchasing',
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

    // ── Create Reservation ──────────────────────────────────────
    case 'create_reservation': {
      const resItemOpts = await loadItemOptions();
      const resLocOpts = await loadLocationOptions();
      return {
        intent: 'create_reservation' as IntentType,
        description: 'Create a stock reservation',
        steps: [
          {
            field: 'item',
            prompt: 'Which item do you want to reserve?',
            type: 'select',
            required: true,
            options: resItemOpts,
          },
          {
            field: 'location',
            prompt: 'At which location?',
            type: 'select',
            required: true,
            options: resLocOpts,
          },
          {
            field: 'quantity',
            prompt: 'How many units to reserve?',
            type: 'number',
            required: true,
            validate: (v) => {
              const n = Number(v);
              if (isNaN(n) || n <= 0) return 'Please enter a positive number';
              return null;
            },
          },
          {
            field: 'allocation_type',
            prompt: 'What is this reservation for?',
            type: 'select',
            required: true,
            options: [
              { label: 'Job', value: 'job' },
              { label: 'Truck', value: 'truck' },
              { label: 'Person', value: 'person' },
              { label: 'Transfer', value: 'transfer' },
              { label: 'Other', value: 'other' },
            ],
          },
          {
            field: 'job_ref',
            prompt: 'Reference (job number, truck ID, etc.)? (optional, press Enter to skip)',
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
          const item = await resolveItemId(params.item);
          const loc = await resolveLocationId(params.location);
          const allocationType = resolveEnum(params.allocation_type, ['job', 'truck', 'person', 'transfer', 'other'], 'other');

          const result = await InventoryRPC.reserveFungible({
            catalog_item_id: item.id,
            location_id: loc.id,
            qty: Number(params.quantity),
            allocation_type: allocationType || null,
            job_ref: params.job_ref || null,
            last_event_id: crypto.randomUUID(),
          });
          return {
            success: true,
            message: `Reserved ${params.quantity} "${item.name}" at ${loc.name} for ${allocationType}${params.job_ref ? ` "${params.job_ref}"` : ''}!`,
            data: { reservation_id: result },
            navigateTo: '/inventory/reservations',
          };
        },
      };
    }

    // ── Release Reservation ──────────────────────────────────────
    case 'release_reservation': {
      let reservationOptions: Array<{ label: string; value: string }> = [];
      try {
        const reservations = await InventoryRPC.getReservations({ status: 'active' });
        reservationOptions = reservations.map((r: any) => ({
          label: `${r.catalog_items?.name || 'Unknown'} - ${r.qty} @ ${r.locations?.name || 'Unknown'}${r.job_ref ? ` (${typeof r.job_ref === 'string' ? r.job_ref : JSON.stringify(r.job_ref)})` : ''}`,
          value: r.id,
        }));
      } catch {
        // ignore
      }
      return {
        intent: 'release_reservation' as IntentType,
        description: 'Release a reservation',
        steps: [
          {
            field: 'reservation_id',
            prompt: reservationOptions.length > 0 ? 'Which reservation do you want to release?' : 'No active reservations found.',
            type: 'select',
            required: true,
            options: reservationOptions,
          },
          {
            field: 'confirm',
            prompt: '',
            type: 'confirm',
            required: true,
          },
        ],
        execute: async (params) => {
          const reservations = await InventoryRPC.getReservations({ status: 'active' });
          const reservation = reservations.find((r: any) => r.id === params.reservation_id);
          if (!reservation) throw AppError.notFound('Reservation not found');

          await InventoryRPC.releaseReservation(
            params.reservation_id,
            reservation.last_event_id || crypto.randomUUID()
          );
          return {
            success: true,
            message: 'Reservation released successfully!',
            navigateTo: '/inventory/reservations',
          };
        },
      };
    }

    // ── List Reservations ──────────────────────────────────────────
    case 'list_reservations':
      return {
        intent: 'list_reservations' as IntentType,
        description: 'List reservations',
        steps: [],
        execute: async () => {
          const reservations = await InventoryRPC.getReservations();
          if (!reservations || reservations.length === 0) {
            return { success: true, message: 'No reservations found. Say "reserve stock" to create one!' };
          }
          const list = reservations
            .slice(0, 15)
            .map((r: any) => {
              const itemName = r.catalog_items?.name || 'Unknown';
              const loc = r.locations?.name || 'Unknown';
              return `  ${itemName} - ${r.qty} @ ${loc} [${r.status}]${r.job_ref ? ` (${typeof r.job_ref === 'string' ? r.job_ref : ''})` : ''}`;
            })
            .join('\n');
          const suffix = reservations.length > 15 ? `\n\n...and ${reservations.length - 15} more.` : '';
          return {
            success: true,
            message: `Found ${reservations.length} reservation(s):\n\n${list}${suffix}`,
            data: reservations,
            navigateTo: '/inventory/reservations',
          };
        },
      };

    // ── Receive PO ────────────────────────────────────────────────
    case 'receive_po':
      return {
        intent: 'receive_po' as IntentType,
        description: 'Receive a purchase order',
        steps: [],
        execute: async () => {
          return {
            success: true,
            message: "I'll take you to the Purchasing page where you can record receipts against your POs.",
            navigateTo: '/inventory/purchasing',
          };
        },
      };

    // ── List Categories ──────────────────────────────────────────
    case 'list_categories':
      return {
        intent: 'list_categories' as IntentType,
        description: 'List item categories',
        steps: [],
        execute: async () => {
          const categories = await InventoryRPC.getItemCategories();
          if (!categories || categories.length === 0) {
            return { success: true, message: 'No categories found. Say "add a category" to create one!' };
          }
          const list = categories
            .map((c) => `  ${c.name}`)
            .join('\n');
          return {
            success: true,
            message: `Found ${categories.length} category(ies):\n\n${list}`,
            data: categories,
            navigateTo: '/inventory/categories',
          };
        },
      };

    // ── Add Category ─────────────────────────────────────────────
    case 'add_category':
      return {
        intent: 'add_category' as IntentType,
        description: 'Add an item category',
        steps: [
          {
            field: 'name',
            prompt: 'What should the category be called?',
            type: 'text',
            required: true,
            validate: (v) => (v.trim().length < 2 ? 'Name must be at least 2 characters' : null),
          },
          {
            field: 'confirm',
            prompt: '',
            type: 'confirm',
            required: true,
          },
        ],
        execute: async (params) => {
          const result = await InventoryRPC.createItemCategory({
            name: params.name,
          });
          return {
            success: true,
            message: `Category "${params.name}" created successfully!`,
            data: result,
            navigateTo: '/inventory/categories',
          };
        },
      };

    // ── Global Search ────────────────────────────────────────────
    case 'global_search':
      return {
        intent: 'global_search' as IntentType,
        description: 'Search across all entities',
        steps: [
          {
            field: 'query',
            prompt: 'What do you want to search for?',
            type: 'text',
            required: true,
          },
        ],
        execute: async (params) => {
          const results = await InventoryRPC.globalSearch(params.query);
          const sections: string[] = [];

          if (results.items.length > 0) {
            sections.push('Items:\n' + results.items.map((i) => `  [${i.sku}] ${i.name}`).join('\n'));
          }
          if (results.assets.length > 0) {
            sections.push('Assets:\n' + results.assets.map((a) => `  [${a.tag}] ${a.serial_number || '-'} (${a.status})`).join('\n'));
          }
          if (results.locations.length > 0) {
            sections.push('Locations:\n' + results.locations.map((l) => `  ${l.name}`).join('\n'));
          }
          if (results.vendors.length > 0) {
            sections.push('Vendors:\n' + results.vendors.map((v) => `  ${v.code ? `[${v.code}] ` : ''}${v.name}`).join('\n'));
          }
          if (results.purchase_orders.length > 0) {
            sections.push('Purchase Orders:\n' + results.purchase_orders.map((po) => `  ${po.po_number} - ${po.vendor_name || 'Unknown'} [${po.status}]`).join('\n'));
          }
          if (results.reservations.length > 0) {
            sections.push('Reservations:\n' + results.reservations.map((r) => `  ${r.ref || r.id.slice(0, 8)} - ${r.qty} [${r.status}]`).join('\n'));
          }

          if (sections.length === 0) {
            return {
              success: true,
              message: `No results found for "${params.query}".`,
            };
          }

          return {
            success: true,
            message: `Search results for "${params.query}":\n\n${sections.join('\n\n')}`,
            data: results,
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
              'Reservations:',
              '  "Reserve stock" - Create a stock reservation',
              '  "List reservations" - See active reservations',
              '  "Release reservation" - Cancel a reservation',
              '',
              'Categories:',
              '  "List categories" - See item categories',
              '  "Add a category" - Create a new category',
              '',
              'Search:',
              '  "Search for [term]" - Search across all entities',
              '',
              'Other:',
              '  "List receipts" - See recent receipts',
              '  "Receive a PO" - Record receipt against a purchase order',
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
    '/inventory/locations': ['locations', 'warehouses', 'yards'],
    '/inventory/transfers': ['transfers'],
    '/inventory/reservations': ['reservations'],
    '/inventory/assets': ['assets', 'equipment'],
    '/inventory/categories': ['categories'],
    '/inventory/movements': ['movements', 'stock movements'],
    '/inventory/alerts': ['alerts', 'low stock'],
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
