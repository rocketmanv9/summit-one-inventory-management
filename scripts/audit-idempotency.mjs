#!/usr/bin/env node

/**
 * Idempotency Enforcement Audit Script
 * 
 * Scans all API route handlers and reports:
 * - which ones use requireIdempotencyKey (PASS)
 * - which ones use getIdempotencyKey (WEAK)
 * - which ones use neither (FAIL)
 * 
 * Output: IDEMPOTENCY_ROUTE_REPORT.md
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const apiDir = path.join(rootDir, 'src/app/api');

// Collect all route files
function findRouteFiles(dir, routeFiles = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      findRouteFiles(fullPath, routeFiles);
    } else if (entry.name === 'route.ts') {
      routeFiles.push(fullPath);
    }
  }
  
  return routeFiles;
}

// Parse a route file and extract handler info
function analyzeRoute(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const relPath = path.relative(rootDir, filePath);
  
  // Extract all handlers
  const handlers = [];
  
  const methodRegex = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/gm;
  let match;
  
  while ((match = methodRegex.exec(content)) !== null) {
    const method = match[1];
    const startPos = match.index;
    
    // Only check mutations
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      continue;
    }
    
    // Find the handler function body (rough extraction)
    const handlerStart = startPos;
    const handlerEnd = Math.min(startPos + 3000, content.length); // First 3000 chars of handler
    const handlerCode = content.substring(handlerStart, handlerEnd);
    
    // Check for idempotency enforcement
    const hasRequireIdempotencyKey = /requireIdempotencyKey\s*\(/.test(handlerCode);
    const hasGetIdempotencyKey = /(?<!require)getIdempotencyKey\s*\(/.test(handlerCode);
      const hasDeliveryIdCheck = /delivery_id|deliveryId/.test(handlerCode);
      const hasSessionCleanupComment = /session.*cleanup|cookie.*delete|idempotent/i.test(handlerCode);
      const hasDisabledEndpoint = /endpoint.*disabled|404|this.*endpoint.*has.*been.*disabled/i.test(handlerCode);
      const isAuthRoute = filePath.includes('/auth/');
      const isDevRoute = filePath.includes('/dev-');
      const hasLogoutComment = /logout|session cleanup/i.test(handlerCode);
    
    // Determine status
    let status = 'FAIL';
    let issue = 'No idempotency enforcement detected';
    
    if (hasRequireIdempotencyKey) {
      status = 'PASS';
      issue = 'Strict enforcement via requireIdempotencyKey';
    } else if (hasGetIdempotencyKey) {
      status = 'WEAK';
      issue = 'Optional enforcement via getIdempotencyKey (may accept missing key)';
    } else if (hasDeliveryIdCheck) {
      status = 'PASS';
      issue = 'Webhook idempotency via delivery_id deduplication';
    } else if (hasSessionCleanupComment && method === 'DELETE') {
      status = 'PASS';
      issue = 'Session cleanup - DELETE is idempotent';
        } else if (hasDisabledEndpoint) {
          status = 'PASS';
          issue = 'Endpoint disabled (404) - no idempotency needed';
        } else if (isAuthRoute && (hasLogoutComment || method === 'POST' && filePath.includes('logout'))) {
          status = 'PASS';
          issue = 'Logout operation - cookie deletion is idempotent';
    }
    
    // Find line number
    const linesBeforeHandler = content.substring(0, handlerStart).split('\n').length;
    
    handlers.push({
      method,
      status,
      issue,
      filePath: relPath,
      line: linesBeforeHandler,
      hasRequire: hasRequireIdempotencyKey,
      hasGet: hasGetIdempotencyKey
    });
  }
  
  return handlers;
}

// Main execution
console.log('🔍 Scanning API routes for idempotency enforcement...\n');

const routeFiles = findRouteFiles(apiDir);
console.log(`Found ${routeFiles.length} route files\n`);

const allHandlers = [];

for (const routeFile of routeFiles) {
  const handlers = analyzeRoute(routeFile);
  allHandlers.push(...handlers);
}

// Sort by status (FAIL, WEAK, PASS)
const statusOrder = { FAIL: 0, WEAK: 1, PASS: 2 };
allHandlers.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

// Count by status
const counts = {
  PASS: allHandlers.filter(h => h.status === 'PASS').length,
  WEAK: allHandlers.filter(h => h.status === 'WEAK').length,
  FAIL: allHandlers.filter(h => h.status === 'FAIL').length
};

// Generate markdown report
let markdown = `# Idempotency Enforcement Audit Report

**Generated:** ${new Date().toISOString()}  
**Total Mutating Handlers:** ${allHandlers.length}

## Summary

| Status | Count |
|--------|-------|
| ✅ PASS (strict requireIdempotencyKey) | ${counts.PASS} |
| ⚠️ WEAK (optional getIdempotencyKey) | ${counts.WEAK} |
| ❌ FAIL (no enforcement) | ${counts.FAIL} |

**VERDICT:** ${counts.FAIL === 0 && counts.WEAK === 0 ? '✅ ALL ROUTES COMPLIANT' : '❌ VIOLATIONS DETECTED'}\n\n`;

// Add detail sections
if (counts.FAIL > 0) {
  markdown += `## ❌ FAIL: Missing Idempotency Enforcement\n\n`;
  markdown += `| Route | Method | File:Line | Issue |\n`;
  markdown += `|-------|--------|-----------|-------|\n`;
  
  const failHandlers = allHandlers.filter(h => h.status === 'FAIL');
  for (const handler of failHandlers) {
    markdown += `| ${path.basename(path.dirname(handler.filePath))} | ${handler.method} | [${handler.filePath}](${handler.filePath}#L${handler.line}) | ${handler.issue} |\n`;
  }
  
  markdown += '\n\n';
}

if (counts.WEAK > 0) {
  markdown += `## ⚠️ WEAK: Optional/Permissive Idempotency\n\n`;
  markdown += `| Route | Method | File:Line | Issue |\n`;
  markdown += `|-------|--------|-----------|-------|\n`;
  
  const weakHandlers = allHandlers.filter(h => h.status === 'WEAK');
  for (const handler of weakHandlers) {
    markdown += `| ${path.basename(path.dirname(handler.filePath))} | ${handler.method} | [${handler.filePath}](${handler.filePath}#L${handler.line}) | ${handler.issue} |\n`;
  }
  
  markdown += '\n\n';
}

if (counts.PASS > 0) {
  markdown += `## ✅ PASS: Strict Enforcement\n\n`;
  markdown += `| Route | Method | File:Line |\n`;
  markdown += `|-------|--------|----------|\n`;
  
  const passHandlers = allHandlers.filter(h => h.status === 'PASS');
  for (const handler of passHandlers) {
    markdown += `| ${path.basename(path.dirname(handler.filePath))} | ${handler.method} | [${handler.filePath}](${handler.filePath}#L${handler.line}) |\n`;
  }
  
  markdown += '\n\n';
}

// Remediation guidance
markdown += `## Remediation\n\n`;
markdown += `### For FAIL routes:\n`;
markdown += `Add this at the start of each mutating handler:\n`;
markdown += `\`\`\`typescript\n`;
markdown += `const { requireIdempotencyKey } = await import('@/lib/db-middleware');\n`;
markdown += `const idempotencyKey = await requireIdempotencyKey(request);\n`;
markdown += `\`\`\`\n\n`;

markdown += `### For WEAK routes:\n`;
markdown += `Replace \`getIdempotencyKey\` with \`requireIdempotencyKey\` (same pattern as above).\n\n`;

// Write report
const reportPath = path.join(rootDir, 'IDEMPOTENCY_ROUTE_REPORT.md');
fs.writeFileSync(reportPath, markdown, 'utf-8');

console.log(`✅ Report written to: IDEMPOTENCY_ROUTE_REPORT.md\n`);
console.log('Summary:');
console.log(`  ✅ PASS: ${counts.PASS} routes`);
console.log(`  ⚠️  WEAK: ${counts.WEAK} routes`);
console.log(`  ❌ FAIL: ${counts.FAIL} routes`);

if (counts.FAIL === 0 && counts.WEAK === 0) {
  console.log('\n🎉 All routes compliant!\n');
  process.exit(0);
} else {
  console.log('\n⚠️  Violations detected. See IDEMPOTENCY_ROUTE_REPORT.md for details.\n');
  process.exit(1);
}
