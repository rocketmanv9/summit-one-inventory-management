import { AppError } from '@rocketmanv9/chassis/errors';

// supply_chain.vendors enforces UNIQUE (tenant_id, code) via
// vendors_tenant_code_unique — and inactive (soft-deleted) vendors still hold
// their codes. These helpers surface that as a 409 naming the holder instead of
// letting the insert/update die as a raw 500.

/** Trim a user-supplied code; empty strings become null so they don't collide. */
export function normalizeVendorCode(code: unknown): string | null | undefined {
  if (code === undefined) return undefined;
  if (code === null) return null;
  const trimmed = String(code).trim();
  return trimmed || null;
}

/**
 * Throw a 409 if another vendor (active or inactive) already holds this code.
 * `excludeVendorId` skips the vendor being updated/reactivated itself.
 */
export async function assertVendorCodeAvailable(
  sc: any,
  log: { error: (msg: string, meta?: Record<string, unknown>) => void },
  code: string,
  excludeVendorId?: string,
): Promise<void> {
  let q = sc.from('vendors').select('id, name, active').eq('code', code).limit(1);
  if (excludeVendorId) q = q.neq('id', excludeVendorId);
  const { data: holder, error } = await q.maybeSingle();
  if (error) {
    log.error('vendor.code_check_failed', { error: error.message });
    throw AppError.internal(error.message);
  }
  if (holder) {
    throw AppError.conflict(
      holder.active
        ? `Vendor code "${code}" is already used by "${holder.name}". Choose a different code.`
        : `Vendor code "${code}" is held by the inactive vendor "${holder.name}". Reactivate that vendor, clear its code, or choose a different code.`,
    );
  }
}

/** True when a Postgres error is the (tenant_id, code) unique violation. */
export function isVendorCodeConflict(error: { code?: string; message?: string } | null): boolean {
  return error?.code === '23505' && String(error?.message || '').includes('vendors_tenant_code_unique');
}

/** Map a code-unique violation (lost race with the pre-check) to a clean 409. */
export function vendorCodeConflictError(code: string): AppError {
  return AppError.conflict(`Vendor code "${code}" is already in use by another vendor. Choose a different code.`);
}
