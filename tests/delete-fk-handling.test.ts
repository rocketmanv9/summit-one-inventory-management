import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Delete-route FK-violation guard.
 *
 * A delete blocked by an ON DELETE RESTRICT/NO ACTION child throws Postgres
 * `23503`. If a route surfaces that as `AppError.internal(error.message)`, the
 * user sees raw text like:
 *   update or delete on table "catalog_items" violates foreign key constraint
 *   "cycle_count_lines_catalog_item_id_fkey"
 * as a 500 instead of an actionable 409.
 *
 * This has regressed repeatedly because the fix lives per-route and new
 * hand-written delete routes silently omit it. This test makes the omission a
 * build failure: every route that exports DELETE and performs a hard `.delete()`
 * must route the error through `rethrowDeleteError` (src/lib/api/typed-crud.ts)
 * — either directly, or by using the shared `deleteRoute`/`deleteRouteOCC`
 * helpers (which call it internally).
 *
 * Soft-deletes (DELETE handler that `.update()`s a status/active flag) and
 * RPC-backed deletes carry no FK-on-delete risk and are exempt.
 */
describe('delete routes handle FK violations (23503)', () => {
  const API_ROOT = path.resolve(__dirname, '..', 'src', 'app', 'api');

  function routeFiles(dir: string): string[] {
    let out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) out = out.concat(routeFiles(p));
      else if (entry.name === 'route.ts') out.push(p);
    }
    return out;
  }

  it('every hard-delete DELETE route routes errors through rethrowDeleteError', () => {
    const offenders: string[] = [];

    for (const file of routeFiles(API_ROOT)) {
      const src = fs.readFileSync(file, 'utf8');
      if (!/export const DELETE/.test(src)) continue;

      // Uses the shared helper → handled internally.
      if (/\bdeleteRoute(OCC)?\s*\(/.test(src)) continue;
      // No hard delete (soft-delete via .update(), or RPC) → no FK-on-delete risk.
      if (!/\.delete\s*\(/.test(src)) continue;
      // Hand-written hard delete → must reference the shared mapper (or 23503).
      if (/rethrowDeleteError/.test(src) || /['"]23503['"]/.test(src)) continue;

      offenders.push(path.relative(API_ROOT, file).replace(/\\/g, '/'));
    }

    expect(
      offenders,
      `These delete routes perform a hard .delete() but don't map Postgres 23503 ` +
        `(foreign_key_violation) to a friendly 409. Import { rethrowDeleteError } from ` +
        `'@/lib/api/typed-crud' and call it in the delete error branch ` +
        `(or use the shared deleteRoute/deleteRouteOCC helpers):\n  - ` +
        offenders.join('\n  - '),
    ).toEqual([]);
  });
});
