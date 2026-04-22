/**
 * requireIdempotencyKey — extracts Idempotency-Key from request headers.
 *
 * For Next.js API routes that perform state-changing mutations.
 * Returns the key or throws a 400-style error if missing.
 *
 * Note: Most mutations today go through PostgREST (not Next.js API routes),
 * so this is scaffolding for future compliance. Auth and webhook handshake
 * endpoints are exempt.
 */

const HEADER_NAMES = ['idempotency-key', 'x-idempotency-key'] as const;

/**
 * Extract the idempotency key from a Headers object.
 * Throws if no key is present (caller should catch and return 400).
 */
export function requireIdempotencyKey(headers: Headers): string {
  for (const name of HEADER_NAMES) {
    const value = headers.get(name);
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }

  throw new IdempotencyKeyMissingError();
}

/**
 * Try to extract the idempotency key; returns null if absent.
 */
export function getIdempotencyKey(headers: Headers): string | null {
  for (const name of HEADER_NAMES) {
    const value = headers.get(name);
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

export class IdempotencyKeyMissingError extends Error {
  public readonly status = 400;

  constructor() {
    super('Missing required Idempotency-Key header for this mutation.');
    this.name = 'IdempotencyKeyMissingError';
  }
}
