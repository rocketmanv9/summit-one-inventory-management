#!/usr/bin/env node

/**
 * Frontend Idempotency Compliance Check
 * Ensures:
 * 1. No raw fetch() for POST/PUT/PATCH/DELETE outside apiWrite implementation
 * 2. No inline crypto.randomUUID() in dashboard components
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const violations = [];

// Files to scan for violations
const dashboardGlob = path.join(projectRoot, 'src', 'app', '(dashboard)');
const componentsGlob = path.join(projectRoot, 'src', 'components', 'dashboards');
const hooksGlob = path.join(projectRoot, 'src', 'hooks');

// Files exempt from checks
const exemptFiles = [
  'api-client.ts',        // apiWrite implementation
  'db-middleware.ts',     // middleware implementation
];

function isExempt(filePath) {
  return exemptFiles.some(exempt => filePath.endsWith(exempt));
}

function scanDirectory(dir, extensions = ['.tsx', '.ts']) {
  let files = [];
  
  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      files = files.concat(scanDirectory(fullPath, extensions));
    } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }

  return files;
}

function checkFile(filePath) {
  if (isExempt(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Check for inline crypto.randomUUID() in dashboard files
  if (filePath.includes('(dashboard)') || filePath.includes('components/dashboards') || filePath.includes('hooks')) {
    lines.forEach((line, idx) => {
      if (line.includes('crypto.randomUUID()') && !line.trim().startsWith('//')) {
        violations.push({
          file: path.relative(projectRoot, filePath),
          line: idx + 1,
          issue: 'INLINE_CRYPTO_UUID',
          code: line.trim(),
        });
      }
    });
  }

  // Check for raw fetch() with mutation methods
  const methodPattern = /(POST|PUT|PATCH|DELETE)/;
  lines.forEach((line, idx) => {
    // Skip comments
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
      return;
    }

    // Check for fetch with mutation method
    if (line.includes('fetch(') && methodPattern.test(line)) {
      violations.push({
        file: path.relative(projectRoot, filePath),
        line: idx + 1,
        issue: 'RAW_FETCH_MUTATION',
        code: line.trim(),
      });
    }

    // Check for fetch followed by method: in next few lines
    if (line.includes('fetch(')) {
      const nextLines = lines.slice(idx, Math.min(idx + 5, lines.length)).join('\n');
      if (methodPattern.test(nextLines) && nextLines.includes("method:")) {
        violations.push({
          file: path.relative(projectRoot, filePath),
          line: idx + 1,
          issue: 'RAW_FETCH_MUTATION',
          code: line.trim(),
        });
      }
    }
  });
}

console.log('Frontend Idempotency Compliance Check');
console.log('====================================\n');

// Scan all relevant directories
const allFiles = [
  ...scanDirectory(dashboardGlob),
  ...scanDirectory(componentsGlob),
  ...scanDirectory(hooksGlob),
];

console.log(`Scanning ${allFiles.length} files...\n`);

allFiles.forEach(checkFile);

if (violations.length === 0) {
  console.log('✅ PASS - No idempotency violations found');
  process.exit(0);
} else {
  console.log(`❌ FAIL - Found ${violations.length} violations:\n`);
  
  violations.forEach(v => {
    console.log(`${v.file}:${v.line}`);
    console.log(`  Issue: ${v.issue}`);
    console.log(`  Code:  ${v.code}`);
    console.log('');
  });

  console.log('\nRULES:');
  console.log('1. All POST/PUT/PATCH/DELETE must use apiWrite() from @/lib/api-client');
  console.log('2. No inline crypto.randomUUID() in dashboard components/hooks');
  console.log('3. Idempotency keys must be stable per operation attempt\n');

  process.exit(1);
}
