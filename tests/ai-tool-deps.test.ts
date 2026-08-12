/**
 * AI Tool Dependency Guard
 *
 * Statically scans the AI data layer (server tools, reindex, ontology, and the
 * shared RPC layer the client tools route through) for every Supabase
 * `.rpc('name')` and `.from('table')` reference and asserts each one exists in
 * the DB schema snapshot (tests/fixtures/ai-db-schema-snapshot.json).
 *
 * This catches the class of bug where a tool calls a function or table that
 * doesn't exist — e.g. rpc_reorder_suggestions (vs rpc_report_reorder_suggestions)
 * or .from('categories') (vs item_categories) — which otherwise fail silently
 * at runtime and make the assistant report empty data as a confident answer.
 *
 * Regenerate the snapshot after schema changes — see the _comment in the JSON.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import snapshot from './fixtures/ai-db-schema-snapshot.json';

const ROOT = join(__dirname, '..');

// Directories whose Supabase calls we want to guard.
const SCAN_DIRS = [
  join(ROOT, 'src', 'lib', 'ai'),
  join(ROOT, 'src', 'lib', 'rpc'),
];

// `.from('x')` literals that are NOT table names (Buffer.from / Array.from encodings, etc.)
const NON_TABLE_FROM = new Set([
  'base64', 'base64url', 'utf8', 'utf-8', 'hex', 'ascii', 'binary', 'latin1', 'ucs2', 'utf16le',
]);

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out = out.concat(walk(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface Ref {
  name: string;
  file: string;
}

function collectRefs(): { rpcs: Ref[]; tables: Ref[] } {
  const rpcRe = /\.rpc\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g;
  const fromRe = /\.from\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g;
  const rpcs: Ref[] = [];
  const tables: Ref[] = [];

  for (const dir of SCAN_DIRS) {
    for (const file of walk(dir)) {
      const src = readFileSync(file, 'utf8');
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
      let m: RegExpExecArray | null;
      while ((m = rpcRe.exec(src))) rpcs.push({ name: m[1], file: rel });
      while ((m = fromRe.exec(src))) {
        if (!NON_TABLE_FROM.has(m[1])) tables.push({ name: m[1], file: rel });
      }
    }
  }
  return { rpcs, tables };
}

const functions = new Set<string>(snapshot.functions);
const relations = new Set<string>(snapshot.relations);
const { rpcs, tables } = collectRefs();

describe('AI tool DB dependencies', () => {
  it('finds RPC and table references to validate', () => {
    // Sanity: the scan should pick up a meaningful number of references.
    expect(rpcs.length).toBeGreaterThan(10);
    expect(tables.length).toBeGreaterThan(10);
  });

  it('every .rpc() name exists in the DB schema', () => {
    const missing = rpcs.filter((r) => !functions.has(r.name));
    const detail = missing.map((r) => `${r.name}  (${r.file})`).join('\n');
    expect(missing, `Unknown RPC(s):\n${detail}`).toEqual([]);
  });

  it('every .from() table name exists in the DB schema', () => {
    const missing = tables.filter((t) => !relations.has(t.name));
    const detail = missing.map((t) => `${t.name}  (${t.file})`).join('\n');
    expect(missing, `Unknown table(s):\n${detail}`).toEqual([]);
  });
});
