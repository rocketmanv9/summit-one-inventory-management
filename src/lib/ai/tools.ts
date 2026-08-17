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
      description: 'List all active vendors in your account (tenant vendors)',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_catalog_vendors',
      description: 'List vendors from the global/shared catalog that you can adopt into your account. Use when user asks to browse available vendors, see the catalog, or find vendors to add. NOT for listing their own vendors — use list_vendors for that.',
      parameters: {
        type: 'object',
        properties: {
          industry: { type: 'string', description: 'Filter by industry tag (e.g. "asphalt", "concrete", "equipment")' },
          search: { type: 'string', description: 'Search text to filter vendors by name' },
        },
        required: [],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'recommend_vendor_for_item',
      description:
        'Recommend who to buy an item from. Use when the user says "I need X", "who sells X", "where do I buy X", or asks for the best/cheapest/fastest vendor for an item. Returns a ranked, honest list: your own vendors first (preferred, then cheapest, with a fastest marker and last-paid price), a shared-catalog candidate when you have none on file, or a note that a web search is available. Advisory only — it does not create a PO or add a vendor.',
      parameters: {
        type: 'object',
        properties: {
          item_ref: {
            type: 'string',
            description: 'The item to source, as free text (e.g. "wheelstops", "crack sealant") or a catalog_item_id UUID.',
          },
          qty: { type: 'number', description: 'Quantity needed (optional; used for context).' },
          location_id: { type: 'string', description: 'Location UUID to anchor a web-search suggestion (optional).' },
        },
        required: ['item_ref'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'draft_po_preview',
      description:
        'Assemble a complete, reviewable Draft-PO card BEFORE creating anything. Use right after choosing a vendor, when the user says "order N of X from <vendor>" or "put together a PO for …". Returns the vendor, priced lines (with a price_basis of fixed/estimated/market/unknown), a delivery location, an estimated total, and smart buyer advisories per line (how much is already on hand here or at other yards, whether an open PO already covers the item, and a minimum-order nudge). Advisory only — it CREATES NOTHING and never places an order; the confirmation card owns the actual Create step.',
      parameters: {
        type: 'object',
        properties: {
          vendor_id: { type: 'string', description: 'Chosen tenant vendor UUID.' },
          catalog_vendor_id: {
            type: 'string',
            description: 'GV shared-catalog vendor UUID when the tenant has not adopted it yet. The card marks the vendor pending_adopt so it can be added on confirm.',
          },
          delivery_location_id: { type: 'string', description: 'Deliver-to location UUID (optional; defaults to the tenant ship-to).' },
          needed_by_date: { type: 'string', description: 'Needed-by date (ISO, optional).' },
          cost_context: { type: 'string', description: 'Cost context for the PO (e.g. "overhead", "job"; optional).' },
          lines: {
            type: 'array',
            description: 'Lines to preview.',
            items: {
              type: 'object',
              properties: {
                item_ref: { type: 'string', description: 'Item as free text ("Fuel Can") or a catalog_item_id UUID.' },
                qty: { type: 'number', description: 'Quantity to order.' },
              },
              required: ['item_ref', 'qty'],
            },
          },
        },
        required: ['lines'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'adopt_catalog_vendor',
      description:
        'Adopt a shared-catalog vendor into the tenant\'s own vendor list so it can be used on a PO. Use after recommend_vendor_for_item returns a catalog candidate and the user says "add the first one" / "add <name> from the catalog". Copies the catalog vendor\'s contacts and addresses into the tenant vendor store and returns the new tenant vendor id. This is an explicit add — only call it when the user confirms.',
      parameters: {
        type: 'object',
        properties: {
          catalog_vendor_id: { type: 'string', description: 'The GV vendor_catalog UUID to adopt (from recommend_vendor_for_item\'s catalog options).' },
          name: { type: 'string', description: 'Optional catalog vendor name to resolve the id from, when the id is not known.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_vendors_online',
      description:
        'Search the web for real supplier candidates for an item when there is nothing on file and nothing in the shared catalog. Returns a LIST of candidates (name, category, address, phone, email, website) for the user to review — it CREATES NOTHING. To actually add one, adopt_catalog_vendor (catalog) or the vendor create flow (web) runs only on an explicit confirm. Use for "find me a supplier for X online".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for, ideally with a place (e.g. "wheel stop supplier near Portland OR").' },
        },
        required: ['query'],
      },
    },
  },

  // ── Item operations ────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'add_item',
      description: 'Create a new catalog item (material, product, supply). Category is auto-matched or created — just pass a name like "Fasteners" or "Concrete".',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Item name' },
          category: { type: 'string', description: 'Category name in plain text (e.g. "Fasteners", "Concrete", "Safety Equipment"). Auto-matched to existing categories or created if new.' },
          description: { type: 'string', description: 'Item description' },
          uom_term_id: { type: 'string', description: 'UOM term ID from Global Values (resolved via GV). If unknown, omit and it defaults to "each".' },
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
            enum: ['name', 'uom_term_id', 'reorder_point', 'description', 'category'],
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

  {
    type: 'function',
    function: {
      name: 'create_item_with_variants',
      description: 'Create a parent item with variant children. Use when the user mentions sizes, colors, styles, grades, or other product variations. E.g., "add t-shirts in S/M/L/XL and red/blue" or "add gloves in sizes small, medium, large".',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Parent item name (e.g. "Company T-Shirt", "Work Gloves")' },
          description: { type: 'string', description: 'Item description' },
          category: { type: 'string', description: 'Category name in plain text (auto-matched or created)' },
          uom_term_id: { type: 'string', description: 'UOM term ID from Global Values (default: EA term)' },
          variant_dimensions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Dimension names (e.g. ["size", "color"])',
          },
          variant_options: {
            type: 'object',
            additionalProperties: {
              type: 'array',
              items: { type: 'string' },
            },
            description: 'Options per dimension (e.g. {"size": ["S","M","L","XL"], "color": ["Red","Blue"]})',
          },
          location_id: { type: 'string', description: 'Location ID for initial stock (optional)' },
          initial_qty_per_variant: { type: 'number', description: 'Initial stock quantity per variant (optional)' },
        },
        required: ['name', 'variant_dimensions', 'variant_options'],
      },
    },
  },

  // ── Stock operations ───────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'adjust_stock',
      description: 'Set stock to an exact quantity (physical count). Use when user says "count shows 90", "should be 200", "set to 100".',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Item name or SKU' },
          location: { type: 'string', description: 'Location name' },
          quantity: { type: 'number', description: 'New on-hand quantity' },
          confirm: { type: 'boolean', description: 'Defaults to false, which returns a preview for the user to approve. Set true only after the user confirms, to actually perform the action.' },
          reason: {
            type: 'string',
            description: 'Reason for adjustment. INFER from language: "lost/missing" → theft, "damaged/broke" → damage, "expired" → expiration, "count shows" → count_variance. Default: other.',
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
      name: 'adjust_stock_delta',
      description: 'Add or subtract a quantity from current stock balance. Use when user says "add 50 more", "remove 10", "subtract 40", "lost 5". Positive = add, negative = subtract.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Item name or SKU' },
          location: { type: 'string', description: 'Location name' },
          delta: { type: 'number', description: 'Quantity to add (positive) or subtract (negative)' },
          confirm: { type: 'boolean', description: 'Defaults to false, which returns a preview for the user to approve. Set true only after the user confirms, to actually perform the action.' },
          reason: {
            type: 'string',
            description: 'Reason for adjustment. INFER from language: "lost/missing" → theft, "damaged/broke" → damage, "expired" → expiration, "count shows" → count_variance. Default: other.',
            enum: ['count_variance', 'damage', 'theft', 'expiration', 'other'],
          },
          notes: { type: 'string', description: 'Additional notes' },
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
          confirm: { type: 'boolean', description: 'Defaults to false, which returns a preview for the user to approve. Set true only after the user confirms, to actually perform the action.' },
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
      description: 'Create a draft purchase order for a vendor, optionally with line items to order. Returns a preview to confirm before creating unless confirm=true.',
      parameters: {
        type: 'object',
        properties: {
          vendor: { type: 'string', description: 'Vendor name to order from (fuzzy-matched)' },
          items: {
            type: 'array',
            description: 'Line items to order. Omit to create an empty draft.',
            items: {
              type: 'object',
              properties: {
                item: { type: 'string', description: 'Item name or SKU (fuzzy-matched)' },
                quantity: { type: 'number', description: 'Quantity to order' },
                unit_cost: { type: 'number', description: 'Unit cost if known (optional)' },
              },
              required: ['item', 'quantity'],
            },
          },
          notes: { type: 'string', description: 'Notes for the PO' },
          confirm: { type: 'boolean', description: 'Defaults to false, which returns a preview for the user to approve. Set true only after the user confirms, to actually create the PO.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'draft_restock_order',
      description:
        'Build a restock order DRAFT for the user to review — this never orders anything. scope="low_stock" sweeps every item below its reorder point (optionally one yard); scope="items" takes an explicit item+quantity list. Lines are grouped into one PO per vendor (item\'s preferred vendor → best vendor price list → the yard\'s preferred vendor). Present the draft (vendors, items, quantities, totals) and only call confirm_restock_order after the user explicitly confirms. Calling this again replaces the previous draft.',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['low_stock', 'items'],
            description: 'low_stock = sweep everything below reorder point; items = order the explicit list',
          },
          items: {
            type: 'array',
            description: 'Required when scope=items: the items and quantities to order.',
            items: {
              type: 'object',
              properties: {
                item: { type: 'string', description: 'Item name or SKU (fuzzy-matched)' },
                quantity: { type: 'number', description: 'Quantity to order' },
              },
              required: ['item', 'quantity'],
            },
          },
          location: {
            type: 'string',
            description: 'Yard/location name — the delivery destination, and for low_stock also the yard whose stock is swept. Omit to use the default ship-to yard and company-wide stock.',
          },
          vendor: {
            type: 'string',
            description: 'Force ALL lines onto this vendor (fuzzy-matched) instead of per-item vendor resolution.',
          },
          note: { type: 'string', description: 'Note to include on the purchase orders' },
        },
        required: ['scope'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'confirm_restock_order',
      description:
        'Execute a reviewed restock draft — ONLY after the user explicitly confirmed it in this conversation. Creates one purchase order per vendor (spend limits and manager approval still apply; over-limit POs land in the approval inbox and are NOT emailed) and emails each vendor as the user. Never call this without an explicit user confirmation.',
      parameters: {
        type: 'object',
        properties: {
          draft_id: { type: 'string', description: 'The draft id returned by draft_restock_order' },
          send_emails: { type: 'boolean', description: 'Email the vendors after creating POs. Defaults to true.' },
          message: { type: 'string', description: 'Personal note included in the vendor emails' },
        },
        required: ['draft_id'],
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
          confirm: { type: 'boolean', description: 'Defaults to false, which returns a preview for the user to approve. Set true only after the user confirms, to actually perform the action.' },
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
      description: 'List registered assets, optionally filtered by location or status. For printing labels/tags/barcodes use print_labels instead.',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: "Location name or type to filter by (e.g. 'yard', 'Main Warehouse'). Matches location names and location types. 'Assets assigned to the Portland yard' means location: 'Portland yard' — NOT a status filter." },
          status: { type: 'string', description: "Asset status filter (e.g. 'available', 'assigned', 'maintenance'). Only set this when the user explicitly refers to asset status; 'assigned to <place>' is a location, not a status." },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'print_labels',
      description: "ALWAYS use this (never list_assets) when the user wants labels, tags, or barcodes printed. Prepares printable barcode/QR labels for registered assets and opens the print dialog preloaded with one label per asset. Optionally filter by location (e.g. 'the yard', 'Main Warehouse') or status. Use for requests like 'I need labels for all the assets in my yard', 'print asset tags', or 'make barcode labels for the shop'.",
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: "Location name or type to filter by (e.g. 'yard', 'shop', 'Main Warehouse'). Matches location names and location types. 'Assets assigned to the Portland yard' means location: 'Portland yard' — NOT a status filter. Omit for all assets." },
          status: { type: 'string', description: "Asset status filter (e.g. 'available', 'in_maintenance'). Only set this when the user explicitly refers to asset status; 'assigned to <place>' is a location, not a status. Omit for all statuses." },
        },
        required: [],
      },
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
          confirm: { type: 'boolean', description: 'Defaults to false, which returns a preview for the user to approve. Set true only after the user confirms, to actually perform the action.' },
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
      name: 'query_usage_trends',
      description: 'Get month-by-month material usage (consumption) and on-hand history for consumable items, to spot seasonal patterns. Use for "what do we use most in spring?", "when do we burn through crackfill?", "usage trends", "seasonal demand", or "what should I stock up on before summer?".',
      parameters: {
        type: 'object',
        properties: {
          months: { type: 'number', description: 'How many months of history to analyze (default 13, max 36).' },
          item: { type: 'string', description: 'Optional item name to focus on (fuzzy-matched). Omit for the whole catalog.' },
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
          uom_term_id: { type: 'string', description: 'UOM term ID from Global Values (optional, defaults to "each")' },
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
          quantity: { type: 'number', description: 'Number of assets to register (default: 1, max: 20)' },
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
      description: 'Search the web for vendors/suppliers of a specific product or service in a given area. Returns 3-5 vendor suggestions with contact details. Use when users need to find new suppliers — "I need a vendor for wheel stops near Portland", "find me a rebar supplier in Oregon", or "I need a vendor for crack sealant for my Portland yard".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Product, service, or material to search for (e.g. "wheel stops", "ready-mix concrete", "rebar supplier")' },
          location: { type: 'string', description: 'Geographic area OR one of the company\'s own location names (e.g. "Portland, OR", "Pacific Northwest", "Portland yard"). Company location names are automatically resolved to their city/state — pass them through as the user said them.' },
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

  // ── Enrichment tools ──────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'enrich_vendor',
      description: 'Enrich an existing vendor with web-sourced data. Searches online for the vendor and shows a diff of current vs suggested fields (phone, email, address, website, etc.) with confidence scores. Does NOT apply changes — shows suggestions for user approval. Use for "enrich vendor ACME" or "update vendor info for Riverside".',
      parameters: {
        type: 'object',
        properties: {
          vendor_name: { type: 'string', description: 'Name of the existing vendor to enrich (fuzzy-matched)' },
        },
        required: ['vendor_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enrich_item',
      description: 'Suggest normalized fields for an existing catalog item using AI reasoning. Suggests category, unit of measure, description, and reorder point based on the item name and industry standards. Does NOT apply changes — shows suggestions for user approval. Use for "enrich our rebar item" or "suggest fields for cement".',
      parameters: {
        type: 'object',
        properties: {
          item_name: { type: 'string', description: 'Name of the existing item to enrich (fuzzy-matched)' },
          barcode: { type: 'string', description: 'Optional barcode/UPC to help identify the item' },
        },
        required: ['item_name'],
      },
    },
  },

  // ── Smart reservation queries ─────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'query_reservations',
      description: 'Query reservations with smart filtering by date, item, person, asset, or status. Supports natural language dates like "tomorrow", "next week", "June 15-20". Use for "what\'s reserved tomorrow?", "who has the melter?", "when is the excavator available?", or "show reservations for Job 123".',
      parameters: {
        type: 'object',
        properties: {
          item_name: { type: 'string', description: 'Filter by item name (fuzzy-matched)' },
          date_range: { type: 'string', description: 'Date filter — supports "today", "tomorrow", "this week", "next week", "June 15", "2026-06-15 to 2026-06-20", ISO dates' },
          person: { type: 'string', description: 'Filter by person/job reference name' },
          asset_tag: { type: 'string', description: 'Filter by asset tag' },
          status: { type: 'string', description: 'Filter by status (active, released, expired)', enum: ['active', 'released', 'expired'] },
        },
        required: [],
      },
    },
  },

  // ── Asset value query ─────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'query_asset_value',
      description: 'Calculate total asset value and breakdown by category, location, or status. Shows total fleet value, count of assets with and without purchase cost recorded. Use for "what are my assets worth?", "fleet value", or "equipment value by location".',
      parameters: {
        type: 'object',
        properties: {
          group_by: {
            type: 'string',
            description: 'How to group the breakdown',
            enum: ['category', 'location', 'status'],
          },
        },
        required: [],
      },
    },
  },

  // ── Draft purchase request ────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'draft_purchase_request',
      description: 'Generate a draft RFQ/purchase request email for a vendor. Looks up vendor contact info, items to order (from params or reorder suggestions), and generates a professional email body. Does NOT send — returns the draft for review. Use for "draft a purchase request for ACME" or "write an email to order from Riverside".',
      parameters: {
        type: 'object',
        properties: {
          vendor_name: { type: 'string', description: 'Vendor name to address the request to (fuzzy-matched)' },
          items: { type: 'string', description: 'Comma-separated list of items to include (optional — pulls from reorder suggestions if omitted)' },
          notes: { type: 'string', description: 'Additional notes or special instructions for the email' },
        },
        required: ['vendor_name'],
      },
    },
  },

  // ── Apparel / uniform management ──────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'list_pending_apparel_orders',
      description: 'List pending apparel/uniform orders awaiting approval. Shows sizes, quantities, estimated cost, and trigger event. Use when managers ask about shirt orders, uniform orders, or pending approvals.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            description: 'Filter by status (default: pending_approval)',
            enum: ['pending_approval', 'approved', 'rejected', 'ordered', 'in_production', 'shipped', 'fulfilled', 'failed', 'canceled'],
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'approve_apparel_order',
      description: 'Approve a pending apparel/uniform order and place it with Printful. This creates and confirms the print order. Use when a manager says "approve" for a pending shirt order.',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'ID of the apparel order to approve' },
        },
        required: ['order_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reject_apparel_order',
      description: 'Reject a pending apparel/uniform order with an optional reason. Use when a manager declines a shirt order.',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'ID of the apparel order to reject' },
          reason: { type: 'string', description: 'Reason for rejection' },
        },
        required: ['order_id'],
      },
    },
  },

  // ── Semantic search ──────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'semantic_search',
      description: 'Search items using natural language. Finds items by meaning, not just exact keyword match. Use this when the user describes an item by its properties, use case, or appearance rather than its exact name.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language description of what to search for' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    },
  },

  // ── Document extraction ───────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'extract_document',
      description: 'Extract structured data from a document image (invoice, receipt, packing slip, quote, SDS). Uses the image already in the conversation to extract vendor, line items, quantities, prices, and totals. Fuzzy-matches vendor and items to existing records. Does NOT write to the database — returns extracted data for review. Use when the user sends a photo of an invoice, receipt, or packing slip (NOT a product photo — use smart_stock_receive for those).',
      parameters: {
        type: 'object',
        properties: {
          document_type: {
            type: 'string',
            description: 'Type of document (auto-detected if omitted)',
            enum: ['invoice', 'receipt', 'packing_slip', 'quote', 'sds'],
          },
        },
        required: [],
      },
    },
  },
  // ── Purchasing assistant (composite workflow) ───────────────────────
  {
    type: 'function',
    function: {
      name: 'purchasing_assistant',
      description: 'Full purchasing workflow: detect items below reorder point, find preferred vendors, and group into draft purchase orders. Use when user asks about reordering, shortages, or wants to create POs for low stock.',
      parameters: {
        type: 'object',
        properties: {
          include_unassigned: {
            type: 'boolean',
            description: 'Include items without a preferred vendor (default true)',
          },
        },
        required: [],
      },
    },
  },

  // ── Ontology Tools ──────────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'resolve_entity',
      description: 'Resolve free-text to a canonical entity in the system. Tries exact match, alias match, then vector similarity. Use this when the user mentions an entity by name, abbreviation, or description and you need to find the exact entity.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to resolve (item name, vendor name, location name, etc.)' },
          entity_type: {
            type: 'string',
            description: 'Optional: narrow resolution to a specific entity type',
            enum: ['item', 'vendor', 'location', 'asset'],
          },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_relationships',
      description: 'Find all ontology relationships for an entity. Shows what an entity is related to — substitutes, suppliers, components, storage locations, etc.',
      parameters: {
        type: 'object',
        properties: {
          entity_type: { type: 'string', description: 'The entity type (item, vendor, location, asset)' },
          entity_id: { type: 'string', description: 'The entity UUID' },
        },
        required: ['entity_type', 'entity_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_substitutes',
      description: 'Find substitute items or alternatives for an entity. Answers questions like "what can replace X?" or "alternatives to Y".',
      parameters: {
        type: 'object',
        properties: {
          entity_type: { type: 'string', description: 'The entity type (usually "item")', enum: ['item', 'vendor', 'location', 'asset'] },
          entity_id: { type: 'string', description: 'The entity UUID to find substitutes for' },
        },
        required: ['entity_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_cycle_counts',
      description: 'Query cycle counts — physical inventory audits. Answers: "any cycle counts going on?", "show me scheduled counts".',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status', enum: ['scheduled', 'in_progress', 'completed', 'cancelled'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_cancelled_transfers',
      description: 'Query recently cancelled inventory transfers. Answers: "any cancelled transfers?", "transfers cancelled this week".',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Look back this many days (default 7)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_stock_movements',
      description: 'Query the stock movement ledger — all inventory ins and outs. Answers: "audit my ledger", "show recent movements", "what happened to my stock".',
      parameters: {
        type: 'object',
        properties: {
          movement_type: { type: 'string', description: 'Filter by movement type (e.g. receipt, adjustment, transfer, issue)' },
          start_date: { type: 'string', description: 'Start date ISO (YYYY-MM-DD)' },
          end_date: { type: 'string', description: 'End date ISO (YYYY-MM-DD)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_stock_by_location',
      description: 'Show all stock balances at a specific location. Answers: "what do I have in Portland?", "stock at Auburn Yard", "items in warehouse".',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'Location name or partial match (e.g. "Portland", "Auburn")' },
        },
        required: ['location'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_integrations',
      description: 'Show configured integrations and tool settings. Answers: "do I have any integrations?", "what integrations are set up?".',
      parameters: { type: 'object', properties: {} },
    },
  },
];
