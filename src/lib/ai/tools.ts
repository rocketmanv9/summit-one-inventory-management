/**
 * OpenAI Function Definitions for Inventory Assistant
 * Maps each IntentType to an OpenAI function-calling tool definition.
 */

import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export const INVENTORY_TOOLS: ChatCompletionTool[] = [
  // ── Vendor operations ──────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'add_vendor',
      description: 'Create a new vendor/supplier. Provide the company name and the system will search for their contact details online.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Vendor company name' },
          code: { type: 'string', description: 'Short vendor code (e.g. ACME)' },
          contact_name: { type: 'string', description: 'Contact person name' },
          contact_email: { type: 'string', description: 'Contact email address' },
          contact_phone: { type: 'string', description: 'Contact phone number' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_vendor',
      description: 'Update an existing vendor\'s details',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the vendor to update (for lookup)' },
          field_to_update: {
            type: 'string',
            description: 'Which field to change',
            enum: ['name', 'code', 'contact_name', 'contact_email', 'contact_phone', 'payment_terms', 'notes'],
          },
          new_value: { type: 'string', description: 'The new value for the field' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_vendor',
      description: 'Delete/deactivate a vendor',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the vendor to delete' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_vendors',
      description: 'List all active vendors',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ── Item operations ────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'add_item',
      description: 'Create a new catalog item (material, product, supply)',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Item name' },
          unit_of_measure: { type: 'string', description: 'Unit of measure (e.g. each, ton, gallon, bag)' },
          tracking_mode: {
            type: 'string',
            description: 'Tracking mode',
            enum: ['fungible', 'serialized'],
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_item',
      description: 'Delete a catalog item',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name or SKU of the item to delete' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_item',
      description: 'Update an existing catalog item\'s details',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name or SKU of the item to update (for lookup)' },
          field_to_update: {
            type: 'string',
            description: 'Which field to change',
            enum: ['name', 'unit_of_measure', 'reorder_point', 'description'],
          },
          new_value: { type: 'string', description: 'The new value for the field' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_items',
      description: 'List all catalog items',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ── Stock operations ───────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'adjust_stock',
      description: 'Adjust/correct stock balance for an item at a location',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Item name or SKU' },
          location: { type: 'string', description: 'Location name' },
          quantity: { type: 'number', description: 'New on-hand quantity' },
          reason: {
            type: 'string',
            description: 'Reason for adjustment',
            enum: ['count_variance', 'damage', 'theft', 'expiration', 'other'],
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_stock',
      description: 'Check current stock levels for an item or all items',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Item name or SKU to check (omit for all)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'low_stock',
      description: 'Check items that are below their minimum stock levels',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'issue_inventory',
      description: 'Issue/release inventory from a location to a job, truck, person, or other recipient',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Item name or SKU' },
          location: { type: 'string', description: 'Location to issue from' },
          quantity: { type: 'number', description: 'Quantity to issue' },
          issued_to_type: {
            type: 'string',
            description: 'Who is receiving the material',
            enum: ['job', 'truck', 'person', 'other'],
          },
          issued_to_ref: { type: 'string', description: 'Reference for the recipient (job number, truck ID, person name, etc.)' },
          reason: { type: 'string', description: 'Reason for issuing' },
        },
        required: [],
      },
    },
  },

  // ── Purchase order operations ──────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_po',
      description: 'Create a new purchase order',
      parameters: {
        type: 'object',
        properties: {
          vendor: { type: 'string', description: 'Vendor name to order from' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_pos',
      description: 'List purchase orders',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'late_orders',
      description: 'Check for late/overdue purchase orders',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ── Location operations ────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'list_locations',
      description: 'List all locations (warehouses, yards, job sites)',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_location',
      description: 'Create a new location',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Location name' },
        },
        required: [],
      },
    },
  },

  // ── Transfer operations ────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_transfer',
      description: 'Create a stock transfer between two locations',
      parameters: {
        type: 'object',
        properties: {
          from_location: { type: 'string', description: 'Source location name' },
          to_location: { type: 'string', description: 'Destination location name' },
          item: { type: 'string', description: 'Item name or SKU to transfer' },
          quantity: { type: 'number', description: 'Quantity to transfer' },
          notes: { type: 'string', description: 'Transfer notes' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_transfers',
      description: 'List recent stock transfers',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ── Asset operations ───────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_asset',
      description: 'Create/register a new serialized asset (equipment, vehicle, tool)',
      parameters: {
        type: 'object',
        properties: {
          asset_tag: { type: 'string', description: 'Asset tag / identifier' },
          item: { type: 'string', description: 'Catalog item name or SKU this asset belongs to' },
          location: { type: 'string', description: 'Location where the asset is stored' },
          serial_number: { type: 'string', description: 'Manufacturer serial number' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_assets',
      description: 'List registered assets',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ── Receipts ───────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'list_receipts',
      description: 'List recent receiving receipts',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ── Summary / help / navigation ────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'inventory_summary',
      description: 'Get an overview of inventory status (total SKUs, items, locations, alerts)',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Navigate to a specific page in the application',
      parameters: {
        type: 'object',
        properties: {
          destination: { type: 'string', description: 'Page or section to navigate to (e.g. dashboard, vendors, stock, purchasing)' },
        },
        required: ['destination'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'help',
      description: 'Show available commands and capabilities',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];
