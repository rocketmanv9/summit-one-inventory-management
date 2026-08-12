/**
 * Extract a human-readable message from a chassis API error response.
 *
 * The chassis route factories serialize errors as `{ error: { code, message,
 * details, requestId }, timestamp }` — so `data.error` is an OBJECT, not a
 * string. Doing `new Error(data.error)` yields the message "[object Object]".
 * Use this to pull out the real message (with a string fallback for older
 * shapes), so users see what actually went wrong.
 */
export function apiErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object') {
    const err = (data as { error?: unknown }).error;
    if (typeof err === 'string' && err.trim()) return err;
    if (err && typeof err === 'object') {
      const msg = (err as { message?: unknown }).message;
      if (typeof msg === 'string' && msg.trim()) return msg;
    }
    const topMsg = (data as { message?: unknown }).message;
    if (typeof topMsg === 'string' && topMsg.trim()) return topMsg;
  }
  return fallback;
}
