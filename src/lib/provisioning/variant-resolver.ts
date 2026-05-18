/**
 * Variant Resolver
 *
 * Resolves parent catalog items to specific variant children based on
 * employee attributes (e.g. shirt size). Uses the parent/child variant
 * system from the catalog_items table (parent_item_id, variant_attributes).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmployeeContext } from './policy-engine';
import type { SizeDimension } from './employee-sizing';
import { getSizingForVariantResolution } from './employee-sizing';

export interface ResolvedItem {
  catalogItemId: string;
  originalCatalogItemId: string;
  qty: number;
  resolvedVariantAttributes: Record<string, string> | null;
  isSubstitution: boolean;
  substitutionReason?: string;
}

export interface KitLineForResolution {
  catalog_item_id: string;
  qty: number;
  size_source?: 'employee_profile' | 'fixed' | 'ask_at_provision';
  size_dimension?: string;
  fixed_variant_attributes?: Record<string, string> | null;
  substitute_catalog_item_id?: string | null;
}

/**
 * Extract size-related attributes from employee context.
 *
 * When a Supabase client and tenantId are provided, tries the dedicated
 * employee_sizing table first (more granular per-dimension sizing).
 * Falls back to the legacy EmployeeContext-based attributes.
 */
async function getEmployeeSizeAttributes(
  employee: EmployeeContext,
  supabase?: SupabaseClient,
  tenantId?: string,
  sizeDimension?: SizeDimension,
): Promise<Record<string, string>> {
  // Try dedicated sizing table first
  if (supabase && tenantId) {
    const sizingAttrs = await getSizingForVariantResolution(
      supabase,
      tenantId,
      employee.employeeId,
      sizeDimension,
    );
    if (Object.keys(sizingAttrs).length > 0) return sizingAttrs;
  }

  // Fallback to EmployeeContext-based sizing
  const attrs: Record<string, string> = {};
  if (employee.shirtSize) {
    attrs['size'] = employee.shirtSize.toUpperCase();
    attrs['shirt_size'] = employee.shirtSize.toUpperCase();
  }
  // Extend with other size attributes from employee.attributes if present
  if (employee.attributes) {
    for (const [key, value] of Object.entries(employee.attributes)) {
      if (typeof value === 'string' && key.includes('size')) {
        attrs[key] = value;
      }
    }
  }
  return attrs;
}

/**
 * Find a variant child of a parent item that matches the given attributes.
 * Returns the child item ID, or null if no match found.
 */
async function findVariantMatch(
  inv: any,
  tenantId: string,
  parentItemId: string,
  targetAttributes: Record<string, string>,
): Promise<{ id: string; variant_attributes: Record<string, string> } | null> {
  const { data: variants } = await inv
    .from('catalog_items')
    .select('id, variant_attributes')
    .eq('tenant_id', tenantId)
    .eq('parent_item_id', parentItemId)
    .eq('active', true)
    .limit(200);

  if (!variants || variants.length === 0) return null;

  // Try to find an exact attribute match
  for (const variant of variants) {
    const va = variant.variant_attributes as Record<string, string> | null;
    if (!va) continue;

    // Check if all target attributes match (case-insensitive)
    const allMatch = Object.entries(targetAttributes).every(([key, value]) => {
      const variantValue = va[key];
      return variantValue && variantValue.toUpperCase() === value.toUpperCase();
    });

    if (allMatch) return variant;
  }

  return null;
}

/**
 * Check if a catalog item is a parent item (has variants).
 */
async function checkIsParent(
  inv: any,
  tenantId: string,
  catalogItemId: string,
): Promise<boolean> {
  const { data } = await inv
    .from('catalog_items')
    .select('is_parent')
    .eq('id', catalogItemId)
    .eq('tenant_id', tenantId)
    .limit(1)
    .single();

  return data?.is_parent === true;
}

/**
 * Resolve a single kit line to a specific catalog item.
 *
 * If the catalog_item_id is a parent, find the appropriate variant
 * based on size_source and employee attributes. If no variant is found,
 * attempt to use the substitute item.
 */
async function resolveKitLine(
  inv: any,
  tenantId: string,
  line: KitLineForResolution,
  employee: EmployeeContext,
  supabase?: SupabaseClient,
): Promise<ResolvedItem> {
  const isParent = await checkIsParent(inv, tenantId, line.catalog_item_id);

  // If not a parent item, return directly
  if (!isParent) {
    return {
      catalogItemId: line.catalog_item_id,
      originalCatalogItemId: line.catalog_item_id,
      qty: line.qty,
      resolvedVariantAttributes: null,
      isSubstitution: false,
    };
  }

  // Determine target attributes based on size_source
  let targetAttributes: Record<string, string> = {};
  const dimension = line.size_dimension as SizeDimension | undefined;

  switch (line.size_source) {
    case 'fixed':
      targetAttributes = line.fixed_variant_attributes ?? {};
      break;
    case 'employee_profile':
      targetAttributes = await getEmployeeSizeAttributes(employee, supabase, tenantId, dimension);
      break;
    case 'ask_at_provision':
      // Cannot auto-resolve; try employee profile as fallback
      targetAttributes = await getEmployeeSizeAttributes(employee, supabase, tenantId, dimension);
      break;
  }

  // Try to find a matching variant
  if (Object.keys(targetAttributes).length > 0) {
    const match = await findVariantMatch(inv, tenantId, line.catalog_item_id, targetAttributes);
    if (match) {
      return {
        catalogItemId: match.id,
        originalCatalogItemId: line.catalog_item_id,
        qty: line.qty,
        resolvedVariantAttributes: match.variant_attributes,
        isSubstitution: false,
      };
    }
  }

  // No variant found — try substitute
  if (line.substitute_catalog_item_id) {
    return {
      catalogItemId: line.substitute_catalog_item_id,
      originalCatalogItemId: line.catalog_item_id,
      qty: line.qty,
      resolvedVariantAttributes: null,
      isSubstitution: true,
      substitutionReason: `No variant found for attributes: ${JSON.stringify(targetAttributes)}`,
    };
  }

  // No substitute available — use parent item ID (will need manual resolution)
  return {
    catalogItemId: line.catalog_item_id,
    originalCatalogItemId: line.catalog_item_id,
    qty: line.qty,
    resolvedVariantAttributes: null,
    isSubstitution: false,
    substitutionReason: 'Variant resolution failed; manual selection required',
  };
}

/**
 * Resolve all items for a provisioning request.
 *
 * Handles both kit-based and inline-items-based provisioning.
 * For kit-based, loads kit lines from DB then resolves each.
 * For inline items, resolves each directly.
 */
export async function resolveItems(
  supabase: SupabaseClient,
  tenantId: string,
  employee: EmployeeContext,
  kitId: string | null,
  inlineItems: KitLineForResolution[] | null,
): Promise<ResolvedItem[]> {
  const inv = (supabase as any).schema('inventory');
  const prov = (supabase as any).schema('provisioning');

  let linesToResolve: KitLineForResolution[] = [];

  if (kitId) {
    // Load kit lines
    const { data: kitLines } = await prov
      .from('kit_lines')
      .select('*')
      .eq('kit_id', kitId)
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true })
      .limit(100);

    if (kitLines) {
      linesToResolve = kitLines.map((kl: any) => ({
        catalog_item_id: kl.catalog_item_id,
        qty: kl.qty,
        size_source: kl.size_source,
        size_dimension: kl.size_dimension,
        fixed_variant_attributes: kl.fixed_variant_attributes,
        substitute_catalog_item_id: kl.substitute_catalog_item_id,
      }));
    }
  } else if (inlineItems) {
    linesToResolve = inlineItems;
  }

  const resolved: ResolvedItem[] = [];
  for (const line of linesToResolve) {
    const result = await resolveKitLine(inv, tenantId, line, employee, supabase);
    resolved.push(result);
  }

  return resolved;
}
