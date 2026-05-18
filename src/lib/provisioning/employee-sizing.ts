/**
 * Employee Sizing
 *
 * Manages employee body-size profiles used by the variant resolver
 * to automatically select the correct product variant (e.g. shirt size)
 * during provisioning.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface EmployeeSizing {
  id: string;
  tenant_id: string;
  employee_id: string;
  shirt_size: string | null;
  hoodie_size: string | null;
  jacket_size: string | null;
  pants_size: string | null;
  boot_size: string | null;
  preferred_fit: 'slim' | 'regular' | 'relaxed' | null;
  created_at: string;
  updated_at: string;
}

export type SizeDimension = 'shirt_size' | 'hoodie_size' | 'jacket_size' | 'pants_size' | 'boot_size';

/**
 * Retrieve the sizing profile for a specific employee.
 */
export async function getEmployeeSizing(
  supabase: SupabaseClient,
  tenantId: string,
  employeeId: string,
): Promise<EmployeeSizing | null> {
  const prov = (supabase as any).schema('provisioning');

  const { data, error } = await prov
    .from('employee_sizing')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('employee_id', employeeId)
    .limit(1)
    .single();

  if (error || !data) return null;
  return data as EmployeeSizing;
}

/**
 * Create or update an employee sizing profile.
 * Uses upsert on (tenant_id, employee_id) for idempotent retry safety.
 */
export async function upsertEmployeeSizing(
  supabase: SupabaseClient,
  tenantId: string,
  employeeId: string,
  sizing: Partial<Pick<EmployeeSizing, 'shirt_size' | 'hoodie_size' | 'jacket_size' | 'pants_size' | 'boot_size' | 'preferred_fit'>>,
  lastEventId: string,
): Promise<EmployeeSizing> {
  const prov = (supabase as any).schema('provisioning');

  const { data, error } = await prov
    .from('employee_sizing')
    .upsert(
      {
        tenant_id: tenantId,
        employee_id: employeeId,
        ...sizing,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,employee_id' },
    )
    .select()
    .single();

  if (error) throw error;
  return data as EmployeeSizing;
}

/**
 * Get sizing attributes formatted for the variant resolver.
 *
 * Returns a `Record<string, string>` with a `size` key mapped to the
 * appropriate sizing dimension. If `sizeDimension` is provided, that
 * specific field is used; otherwise defaults to `shirt_size`.
 */
export async function getSizingForVariantResolution(
  supabase: SupabaseClient,
  tenantId: string,
  employeeId: string,
  sizeDimension?: SizeDimension,
): Promise<Record<string, string>> {
  const record = await getEmployeeSizing(supabase, tenantId, employeeId);
  if (!record) return {};

  const dimension = sizeDimension ?? 'shirt_size';
  const value = record[dimension];

  if (!value) return {};

  return {
    size: value.toUpperCase(),
    [dimension]: value.toUpperCase(),
  };
}
