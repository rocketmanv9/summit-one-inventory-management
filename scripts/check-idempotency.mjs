#!/usr/bin/env node
/**
 * IDEMPOTENCY ENFORCEMENT CHECK
 * 
 * This script scans all API route files to ensure every mutating handler
 * (POST/PUT/PATCH/DELETE) enforces idempotency via requireIdempotencyKey.
 * 
 * Run this in CI to prevent regression.
 * 
 * USAGE:
 *   node scripts/check-idempotency.mjs
 * 
 * EXIT CODES:
 *   0 = All checks pass
 *   1 = Violations found
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROUTE_DIR = 'src/app/api';
const MUTATION_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

// Routes that are explicitly exempted (with justification)
const EXEMPTED_ROUTES = [
  // Auth routes - session management has different idempotency semantics
  'src/app/api/auth/logout/route.ts',
  'src/app/api/auth/session/route.ts',
  'src/app/api/auth/dev-login/route.ts',
  
  // Dev/debug endpoints - not production
  'src/app/api/dev-session/route.ts',
  
  // Webhook receiver - uses delivery_id from webhook provider
  'src/app/api/webhooks/core-events/route.ts',
];

function getAllRouteFiles(dir, fileList = []) {
  const files = readdirSync(dir);
  
  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    
    if (stat.isDirectory()) {
      getAllRouteFiles(filePath, fileList);
    } else if (file === 'route.ts' || file === 'route.tsx') {
      fileList.push(filePath);
    }
  }
  
  return fileList;
}

function checkFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const violations = [];
  
  // Check each mutation method
  for (const method of MUTATION_METHODS) {
    const handlerRegex = new RegExp(
      `export\\s+async\\s+function\\s+${method}\\s*\\(`,
      'g'
    );
    
    const matches = Array.from(content.matchAll(handlerRegex));
    
    for (const match of matches) {
      const handlerStart = match.index;
      // Find the end of this function (simplified - looks for next export or EOF)
      const nextExport = content.indexOf('export ', handlerStart + 1);
      const handlerEnd = nextExport === -1 ? content.length : nextExport;
      const handlerBody = content.slice(handlerStart, handlerEnd);
      
      // Check if requireIdempotencyKey is called within this handler
      const hasRequireIdempotency = /requireIdempotencyKey\s*\(/.test(handlerBody);
      
      // Also check for the forbidden pattern: getIdempotencyKey (weak enforcement)
      const hasGetIdempotency = /(?<!require)getIdempotencyKey\s*\(/.test(handlerBody);
      
      if (!hasRequireIdempotency) {
        violations.push({
          file: filePath,
          method,
          line: content.substring(0, handlerStart).split('\n').length,
          issue: 'Missing requireIdempotencyKey call'
        });
      }
      
      if (hasGetIdempotency) {
        violations.push({
          file: filePath,
          method,
          line: content.substring(0, handlerStart).split('\n').length,
          issue: 'Using weak getIdempotencyKey instead of requireIdempotencyKey'
        });
      }
    }
  }
  
  return violations;
}

function main() {
  console.log('🔍 Scanning API routes for idempotency enforcement...\n');
  
  const routeFiles = getAllRouteFiles(ROUTE_DIR);
  console.log(`Found ${routeFiles.length} route files\n`);
  
  let totalViolations = 0;
  const violationsByFile = {};
  
  for (const file of routeFiles) {
    const relativePath = relative(process.cwd(), file);
    
    // Skip exempted routes
    if (EXEMPTED_ROUTES.some(exemption => file.includes(exemption))) {
      console.log(`⚠️  EXEMPTED: ${relativePath}`);
      continue;
    }
    
    const violations = checkFile(file);
    
    if (violations.length > 0) {
      violationsByFile[relativePath] = violations;
      totalViolations += violations.length;
    }
  }
  
  if (totalViolations === 0) {
    console.log('\n✅ SUCCESS: All mutation routes enforce idempotency!\n');
    process.exit(0);
  } else {
    console.log('\n❌ IDEMPOTENCY VIOLATIONS FOUND:\n');
    
    for (const [file, violations] of Object.entries(violationsByFile)) {
      console.log(`📁 ${file}`);
      for (const v of violations) {
        console.log(`   ${v.method} (line ~${v.line}): ${v.issue}`);
      }
      console.log('');
    }
    
    console.log(`Total violations: ${totalViolations}\n`);
    console.log('💡 FIX: Add requireIdempotencyKey at the start of each handler:\n');
    console.log('   let idempotencyKey: string;');
    console.log('   try {');
    console.log('     const { requireIdempotencyKey } = await import(\'@/lib/db-middleware\');');
    console.log('     idempotencyKey = await requireIdempotencyKey(request);');
    console.log('   } catch (error: any) {');
    console.log('     return NextResponse.json({ error: error.message }, { status: 400 });');
    console.log('   }\n');
    
    process.exit(1);
  }
}

main();
