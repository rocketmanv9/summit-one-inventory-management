import { z } from 'zod';
import {
  stateZipProblem,
  normalizeStateCode,
  normalizeCountryCode,
} from '@/lib/integrations/amazon-cxml';

/**
 * Wrap a location request-body schema with US address enforcement:
 *   - rejects an inconsistent address (state/ZIP mismatch, unrecognized state,
 *     malformed ZIP) at parse time → 400 with an actionable message
 *   - normalizes `state` → 2-letter and `country` → ISO when present, so stored
 *     data is clean ("Washington" → "WA") and matches what we transmit to Amazon
 *
 * Validation only fires when BOTH `state` and `postal_code` are present, so
 * address-less locations (sheds, containers, equipment bays) still save freely.
 */
export function locationAddressSchema<T extends z.ZodTypeAny>(base: T) {
  return base
    .superRefine((val: any, ctx) => {
      const problem = stateZipProblem(val?.state, val?.postal_code, val?.country);
      if (problem) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Address ${problem}`,
          path: ['postal_code'],
        });
      }
    })
    .transform((val: any) => {
      if (!val || typeof val !== 'object') return val;
      return {
        ...val,
        ...(val.state ? { state: normalizeStateCode(val.state) } : {}),
        ...(val.country ? { country: normalizeCountryCode(val.country) } : {}),
      };
    });
}
