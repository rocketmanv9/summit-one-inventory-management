#!/usr/bin/env node

/**
 * Event-Driven Compliance Audit Script
 *
 * Scans source files and reports violations:
 * 1. Mutations in src/lib/rpc/*.ts or src/lib/api/*.ts without last_event_id usage
 * 2. Event names defined in src/types/events.ts not registered in migration SQL
 * 3. Hard-coded last_event_id values (should be generated or passed)
 *
 * Exit code 0 = all pass, 1 = violations detected.
 *
 * Usage: node scripts/audit-event-compliance.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Check 1: Mutations without last_event_id
// ---------------------------------------------------------------------------

const MUTATION_DIRS = [
  'src/lib/rpc',
  'src/lib/api',
];

// Patterns that indicate a mutation
const MUTATION_PATTERNS = [
  /\.insert\s*\(/,
  /\.update\s*\(/,
  /\.delete\s*\(\s*\)/,
  /\.upsert\s*\(/,
];

// Patterns that indicate last_event_id is being used
const IDEMPOTENCY_PATTERNS = [
  /last_event_id/,
  /lastEventId/,
  /p_last_event_id/,
];

// Read-only functions to exclude (match function names)
const EXEMPT_FUNCTIONS = [
  'get', 'fetch', 'find', 'list', 'count', 'search', 'load',
  'getTenantSettings', 'getSkuSettings', 'getVendorItemsWithCatalog',
  'getItemsAtLocation', 'getAssetsForTransfer',
];

// Known P2 deferred items — reported as WARN, not FAIL
const DEFERRED_FUNCTIONS = [
  'upsertSkuSettings',
  'upsertInventoryLevels',
  'deleteReservationType',
];

function isExemptFunction(funcName) {
  const lower = funcName.toLowerCase();
  return EXEMPT_FUNCTIONS.some(ex => lower.startsWith(ex.toLowerCase()));
}

function scanMutationFiles() {
  const violations = [];

  for (const dir of MUTATION_DIRS) {
    const fullDir = path.join(rootDir, dir);
    if (!fs.existsSync(fullDir)) continue;

    const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.ts'));

    for (const file of files) {
      const filePath = path.join(fullDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const relPath = path.relative(rootDir, filePath);

      // Extract async function blocks
      const funcRegex = /(?:async\s+)?(\w+)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^{]*)?\s*\{/g;
      let funcMatch;

      while ((funcMatch = funcRegex.exec(content)) !== null) {
        const funcName = funcMatch[1];
        if (isExemptFunction(funcName)) continue;

        const startPos = funcMatch.index;

        // Rough body extraction: find matching closing brace
        let braceDepth = 0;
        let endPos = startPos;
        let foundOpen = false;
        for (let i = startPos; i < content.length; i++) {
          if (content[i] === '{') {
            braceDepth++;
            foundOpen = true;
          }
          if (content[i] === '}') {
            braceDepth--;
          }
          if (foundOpen && braceDepth === 0) {
            endPos = i;
            break;
          }
        }

        const funcBody = content.substring(startPos, endPos + 1);

        // Does this function body contain a mutation?
        const hasMutation = MUTATION_PATTERNS.some(p => p.test(funcBody));
        if (!hasMutation) continue;

        // Does it reference last_event_id?
        const hasIdempotency = IDEMPOTENCY_PATTERNS.some(p => p.test(funcBody));

        // Does it call an RPC (which handles idempotency internally)?
        const callsRpc = /\.rpc\s*\(/.test(funcBody);

        if (!hasIdempotency && !callsRpc) {
          const lineNumber = content.substring(0, startPos).split('\n').length;
          const severity = DEFERRED_FUNCTIONS.includes(funcName) ? 'WARN' : 'FAIL';
          violations.push({
            file: relPath,
            line: lineNumber,
            func: funcName,
            issue: 'Mutation without last_event_id or RPC call',
            severity,
          });
        }
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Check 2: Event names in types but not in migration SQL
// ---------------------------------------------------------------------------

function extractEventNamesFromTypes() {
  const eventsFile = path.join(rootDir, 'src/types/events.ts');
  if (!fs.existsSync(eventsFile)) return [];

  const content = fs.readFileSync(eventsFile, 'utf-8');
  const eventNames = [];

  // Only extract from the SupplyChainEventName and InventoryEventName type unions.
  // Match lines that look like: | 'some.event.name'
  const unionMemberRegex = /^\s*\|\s*'([\w]+(?:\.[\w]+)+)'/gm;
  let match;
  while ((match = unionMemberRegex.exec(content)) !== null) {
    const name = match[1];
    // Must contain at least one dot (to be an event name, not an enum value)
    // Skip deprecated aliases (inventory.po.*)
    if (name && name.includes('.') && !name.startsWith('inventory.po.')) {
      eventNames.push(name);
    }
  }

  return [...new Set(eventNames)];
}

function extractRegisteredEventsFromSQL() {
  const migrationsDir = path.join(rootDir, 'supabase/migrations');
  if (!fs.existsSync(migrationsDir)) return new Set();

  const registered = new Set();

  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
  for (const file of files) {
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    // Match register_event('event.name', ...)
    const registerRegex = /register_event\s*\(\s*'([^']+)'/g;
    let m;
    while ((m = registerRegex.exec(content)) !== null) {
      registered.add(m[1]);
    }

    // Event names in trigger functions (v_event_name := '...')
    const triggerRegex = /v_event_name\s*:=\s*'([^']+)'/g;
    while ((m = triggerRegex.exec(content)) !== null) {
      registered.add(m[1]);
    }

    // Event names in emit_event calls (p_type := '...' or first positional arg)
    const emitRegex = /emit_event\s*\(\s*(?:p_type\s*:=\s*)?'([^']+)'/g;
    while ((m = emitRegex.exec(content)) !== null) {
      registered.add(m[1]);
    }

    // Event names in INSERT INTO events_outbox with literal event_type
    const insertRegex = /event_type\s*,.*?VALUES\s*\(\s*'([^']+)'/g;
    while ((m = insertRegex.exec(content)) !== null) {
      registered.add(m[1]);
    }
  }

  return registered;
}

function checkEventCatalogCoverage() {
  const typeEvents = extractEventNamesFromTypes();
  const registered = extractRegisteredEventsFromSQL();
  const missing = [];

  for (const eventName of typeEvents) {
    if (!registered.has(eventName)) {
      missing.push(eventName);
    }
  }

  return missing;
}

// ---------------------------------------------------------------------------
// Check 3: Hard-coded last_event_id values
// ---------------------------------------------------------------------------

function checkHardCodedEventIds() {
  const violations = [];
  const dirs = ['src/lib/rpc', 'src/lib/api'];

  for (const dir of dirs) {
    const fullDir = path.join(rootDir, dir);
    if (!fs.existsSync(fullDir)) continue;

    const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.ts'));
    for (const file of files) {
      const filePath = path.join(fullDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const relPath = path.relative(rootDir, filePath);

      // Look for last_event_id set to a string literal (not crypto.randomUUID() or a variable)
      const hardCodedRegex = /last_event_id\s*[:=]\s*['"]([a-f0-9-]{36})['"]/gi;
      let m;
      while ((m = hardCodedRegex.exec(content)) !== null) {
        const lineNumber = content.substring(0, m.index).split('\n').length;
        violations.push({
          file: relPath,
          line: lineNumber,
          value: m[1],
          issue: 'Hard-coded last_event_id value',
        });
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('Scanning for event-driven compliance violations...\n');

const mutationViolations = scanMutationFiles();
const missingCatalog = checkEventCatalogCoverage();
const hardCodedIds = checkHardCodedEventIds();

let hasViolations = false;

// Report: mutations without last_event_id
const failMutations = mutationViolations.filter(v => v.severity === 'FAIL');
const warnMutations = mutationViolations.filter(v => v.severity === 'WARN');

if (failMutations.length > 0) {
  hasViolations = true;
  console.log(`FAIL: ${failMutations.length} mutation(s) without last_event_id\n`);
  for (const v of failMutations) {
    console.log(`  ${v.file}:${v.line} - ${v.func}: ${v.issue}`);
  }
  console.log();
}

if (warnMutations.length > 0) {
  console.log(`WARN: ${warnMutations.length} deferred P2 mutation(s) without last_event_id\n`);
  for (const v of warnMutations) {
    console.log(`  ${v.file}:${v.line} - ${v.func}: ${v.issue} (deferred)`);
  }
  console.log();
}

// Report: unregistered events (informational — many are emitted by SQL RPCs internally)
if (missingCatalog.length > 0) {
  console.log(`WARN: ${missingCatalog.length} event(s) in types but not found in SQL register_event/trigger patterns\n`);
  console.log('  (These may be emitted by SQL RPCs via intermediate event tables)\n');
  for (const name of missingCatalog) {
    console.log(`  ${name}`);
  }
  console.log();
}

// Report: hard-coded IDs
if (hardCodedIds.length > 0) {
  hasViolations = true;
  console.log(`FAIL: ${hardCodedIds.length} hard-coded last_event_id value(s)\n`);
  for (const v of hardCodedIds) {
    console.log(`  ${v.file}:${v.line} - ${v.value}`);
  }
  console.log();
}

if (!hasViolations) {
  console.log('All checks passed.\n');
  process.exit(0);
} else {
  console.log('Violations detected. See above for details.\n');
  process.exit(1);
}
