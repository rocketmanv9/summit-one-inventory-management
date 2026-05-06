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
          unit_of_measure: { type: 'string', description: 'Unit of measure (e.g. each, ton, gallon, bag). Default: "each"' },
          tracking_mode: {
            type: 'string',
            description: 'Tracking mode (default: "fungible")',
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

  // ── Reservation operations ───────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_reservation',
      description: 'Reserve stock at a location for a job, truck, or other purpose',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Item name or SKU to reserve' },
          location: { type: 'string', description: 'Location to reserve stock at' },
          quantity: { type: 'number', description: 'Quantity to reserve' },
          job_ref: { type: 'string', description: 'Job reference or purpose for the reservation' },
          allocation_type: { type: 'string', description: 'Type of allocation', enum: ['job', 'truck', 'person', 'transfer', 'other'] },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'release_reservation',
      description: 'Release/cancel an active reservation',
      parameters: {
        type: 'object',
        properties: {
          reservation_id: { type: 'string', description: 'ID of the reservation to release' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_reservations',
      description: 'List active stock reservations',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ── Receive PO ────────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'receive_po',
      description: 'Record receipt of materials against a purchase order. This navigates to the receiving page for the complex receiving workflow.',
      parameters: {
        type: 'object',
        properties: {
          po_number: { type: 'string', description: 'PO number to receive against' },
        },
        required: [],
      },
    },
  },

  // ── Category operations ──────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'list_categories',
      description: 'List item categories',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_category',
      description: 'Create a new item category',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Category name' },
        },
        required: [],
      },
    },
  },

  // ── Global Search ────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'global_search',
      description: 'Search across all entities (items, assets, locations, vendors, POs, reservations). Use for broad searches like "find cement" or "search for truck 5".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
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

  // ── Analytics / KPI queries (server-side) ────────────────────────────
  {
    type: 'function',
    function: {
      name: 'query_inventory_summary',
      description: 'Get high-level inventory KPIs: total items, total quantity on hand, reserved, available, and alert counts. Use for questions like "how much inventory do we have?" or "give me an overview".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_stock_valuation',
      description: 'Get inventory value broken down by location and category. Shows item count, total quantity, average unit cost, and total value. Use for questions about inventory value or worth.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_low_stock_report',
      description: 'Get items below minimum stock levels with shortage amounts. Use for "what needs reordering?" or "what is running low?".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_dead_stock',
      description: 'Get items with no recent movement, showing days idle and capital locked up. Use for "what is not selling?" or "dead stock" or "idle inventory".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_velocity_analysis',
      description: 'Get item usage velocity over 30/60/90 day periods with daily rate and days-of-stock remaining. Use for "which items move fastest?" or "velocity analysis".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_movement_summary',
      description: 'Get stock movement totals by type (received, issued, adjusted, transferred) over a date range. Use for "movement summary" or "what happened this month?".',
      parameters: {
        type: 'object',
        properties: {
          start_date: { type: 'string', description: 'Start date (ISO 8601). Defaults to 30 days ago.' },
          end_date: { type: 'string', description: 'End date (ISO 8601). Defaults to now.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_reorder_suggestions',
      description: 'Get recommended reorder quantities based on current stock vs reorder points. Shows shortage, suggested order qty, and preferred vendor. Use for "what should I reorder?" or "reorder suggestions".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_forecast',
      description: 'Get inventory forecast showing on-hand, reserved, incoming PO quantities, projected demand, and net position. Use for "forecast" or "will I run out?".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_inventory_turnover',
      description: 'Get inventory turnover ratio and velocity metrics. Use for "inventory turnover" or "how fast does stock move?".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_po_status',
      description: 'Get purchase order status summary showing open, late, and recently completed POs with amounts. Use for "PO status" or "purchase order summary".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },

  // ── Dashboard generation (server-side) ───────────────────────────────
  {
    type: 'function',
    function: {
      name: 'create_dashboard',
      description: 'Create a pre-configured dashboard from a template. Available templates: executive (high-level KPIs), operations (daily ops), procurement (PO tracking), inventory_health (stock health), alerts (warnings & risks), asset_tracking (equipment & assets).',
      parameters: {
        type: 'object',
        properties: {
          template: {
            type: 'string',
            description: 'Dashboard template to use',
            enum: ['executive', 'operations', 'procurement', 'inventory_health', 'alerts', 'asset_tracking'],
          },
          name: { type: 'string', description: 'Custom dashboard name (optional, template name used if omitted)' },
        },
        required: ['template'],
      },
    },
  },

  // ── Dashboard management (server-side) ──────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'list_dashboards',
      description: 'List all dashboards for the current tenant, showing name, widget count, and whether each is the default. Also shows which widgets are on each dashboard.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_available_widgets',
      description: 'List all available widgets from the widget registry that can be added to dashboards. Shows widget name, key, domain, and default size. Use this to see what widgets exist before suggesting them to the user.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_dashboard_widget',
      description: 'Add a widget to an existing dashboard. Matches the dashboard by name and the widget from the widget registry.',
      parameters: {
        type: 'object',
        properties: {
          dashboard: { type: 'string', description: 'Name (or partial name) of the dashboard to add the widget to' },
          widget: { type: 'string', description: 'Widget name or key to add (e.g. "low stock alerts", "dead stock", "inventory health score")' },
        },
        required: ['dashboard', 'widget'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_dashboard_widget',
      description: 'Remove a widget from a dashboard by matching the widget title or key.',
      parameters: {
        type: 'object',
        properties: {
          dashboard: { type: 'string', description: 'Name (or partial name) of the dashboard' },
          widget: { type: 'string', description: 'Widget title or key to remove' },
        },
        required: ['dashboard', 'widget'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_dashboard',
      description: 'Update a dashboard — rename it, change its description, or set/unset it as the default dashboard.',
      parameters: {
        type: 'object',
        properties: {
          dashboard: { type: 'string', description: 'Name (or partial name) of the dashboard to update' },
          name: { type: 'string', description: 'New name for the dashboard' },
          description: { type: 'string', description: 'New description for the dashboard' },
          is_default: { type: 'boolean', description: 'Set to true to make this the default dashboard, false to unset' },
        },
        required: ['dashboard'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_dashboard',
      description: 'Delete a dashboard (soft-delete). This removes it from view but does not permanently destroy it.',
      parameters: {
        type: 'object',
        properties: {
          dashboard: { type: 'string', description: 'Name (or partial name) of the dashboard to delete' },
        },
        required: ['dashboard'],
      },
    },
  },

  // ── Workflow automation (server-side) ─────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'workflow_auto_reorder',
      description: 'Create draft purchase orders for all items below their reorder point, grouped by preferred vendor. Defaults to dry run (preview only). Say "confirm" or set dry_run=false to actually create the POs.',
      parameters: {
        type: 'object',
        properties: {
          dry_run: {
            type: 'boolean',
            description: 'If true (default), show what would be created without creating anything. Set to false to actually create draft POs.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workflow_stock_rebalance',
      description: 'Suggest stock transfers to balance inventory across locations based on demand patterns. Defaults to dry run (preview only). Say "confirm" or set dry_run=false to actually create the transfers.',
      parameters: {
        type: 'object',
        properties: {
          dry_run: {
            type: 'boolean',
            description: 'If true (default), show suggested transfers without creating them. Set to false to create the transfers.',
          },
        },
        required: [],
      },
    },
  },

  // ── Smart Stock Receive (vision + inventory) ───────────────────────────
  {
    type: 'function',
    function: {
      name: 'smart_stock_receive',
      description: 'Add stock of an item at a location. Finds or creates the catalog item, finds the location, and adds quantity to current stock. Use when a user sends a photo of a material and says "add N of these to [location]", or when they describe an item to receive into inventory.',
      parameters: {
        type: 'object',
        properties: {
          item_name: { type: 'string', description: 'Identified item name (e.g. "Portland Cement Type I/II 94lb")' },
          item_description: { type: 'string', description: 'Additional specs, brand, size, or material details' },
          location_name: { type: 'string', description: 'Destination location name (warehouse, yard, job site)' },
          quantity: { type: 'number', description: 'Number of units to add' },
          unit_of_measure: { type: 'string', description: 'Unit of measure (default: "each")' },
        },
        required: ['item_name', 'location_name', 'quantity'],
      },
    },
  },

  // ── Smart Location Creation ────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'smart_add_location',
      description: 'Create a new location with address validation and automatic location type matching. Just provide a name and optional address — the system will validate the address via web search and match the location type automatically. Use for "Add our Portland yard at 1234 NE Industrial Way" or "Create a job site called Riverside Project".',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Location name (e.g. "Portland Yard", "Main Warehouse")' },
          address: { type: 'string', description: 'Street address to validate and standardize (e.g. "1234 NE Industrial Way, Portland, OR")' },
          location_type: { type: 'string', description: 'Type of location in plain English (e.g. "warehouse", "yard", "job site", "office")' },
        },
        required: ['name'],
      },
    },
  },

  // ── Smart Asset Registration ───────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'smart_register_asset',
      description: 'Register a new asset using natural language. Just describe what it is — the system will find or create the catalog item, match the location, and generate an asset tag. Use for "we got a new CAT 320 excavator" or "register this paver at the Portland yard".',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'What the asset is (e.g. "CAT 320 excavator", "Bomag BW 120 paver")' },
          description: { type: 'string', description: 'Additional details about the asset' },
          location: { type: 'string', description: 'Where the asset is located (e.g. "Portland yard", "main warehouse")' },
          serial_number: { type: 'string', description: 'Manufacturer serial number' },
          asset_tag: { type: 'string', description: 'Custom asset tag (auto-generated if not provided)' },
        },
        required: ['name'],
      },
    },
  },

  // ── Vendor Search Online ───────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'search_vendors_online',
      description: 'Search the web for vendors/suppliers of a specific product or service in a given area. Returns 3-5 vendor suggestions with contact details. Use when users need to find new suppliers — "I need a vendor for wheel stops near Portland" or "find me a rebar supplier in Oregon".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Product, service, or material to search for (e.g. "wheel stops", "ready-mix concrete", "rebar supplier")' },
          location: { type: 'string', description: 'Geographic area to search in (e.g. "Portland, OR", "Pacific Northwest")' },
        },
        required: ['query'],
      },
    },
  },

  // ── Preferred Vendor Management ────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'set_preferred_vendor',
      description: 'Set a vendor as the preferred supplier for a catalog item. Links the vendor to the item with optional pricing and lead time. Use for "make ACME our preferred vendor for rebar" or "set up pricing for cement from Riverside".',
      parameters: {
        type: 'object',
        properties: {
          vendor: { type: 'string', description: 'Vendor name (fuzzy-matched)' },
          item: { type: 'string', description: 'Catalog item name (fuzzy-matched)' },
          unit_cost: { type: 'number', description: 'Cost per unit from this vendor' },
          lead_time_days: { type: 'number', description: 'Typical lead time in days' },
        },
        required: ['vendor', 'item'],
      },
    },
  },
];
