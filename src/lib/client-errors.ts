/**
 * Shared client-side helpers for extracting human-readable error messages.
 *
 * The chassis error envelope is `{ error: { message: string, code?: string } }`
 * — note `error` may be an OBJECT, not a string. These helpers normalize both
 * shapes (and plain `{ message }` bodies) so we never render '[object Object]'.
 */

/** Coerce an unknown envelope value to a non-empty string, or null. */
function asMessage(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object') {
    const msg = (value as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  return null;
}

/**
 * Extract a friendly message from a failed fetch Response.
 * Tries `error.message`, then `error` (string), then top-level `message`,
 * falling back to the supplied default. Never throws.
 */
export async function apiErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object') {
      const envelope = body as { error?: unknown; message?: unknown };
      return asMessage(envelope.error) ?? asMessage(envelope.message) ?? fallback;
    }
  } catch {
    // Non-JSON body — fall through to the fallback.
  }
  return fallback;
}

/** Safe message extraction from a caught exception. */
export function errMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message.trim()) return e.message;
  if (typeof e === 'string' && e.trim()) return e;
  return asMessage(e) ?? fallback;
}
