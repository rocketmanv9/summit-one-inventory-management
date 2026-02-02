#!/usr/bin/env node

/**
 * Security Guardrail Scan: Debug & Service Role Endpoints
 * 
 * Detects:
 * 1. Debug endpoints missing authentication checks
 * 2. Service role usage without JWT verification
 * 3. Session-cookie-only authentication patterns
 */

import fs from 'fs';
import path from 'path';

const issues = [];
let fileCount = 0;

function scanDirectory(dir) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      if (!filePath.includes('node_modules') && !filePath.includes('.next') && !filePath.includes('.git')) {
        scanDirectory(filePath);
      }
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      fileCount++;
      scanFile(filePath);
    }
  }
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  // VIOLATION PATTERN #1: Debug endpoints without auth
  if (filePath.includes('/api/debug/')) {
    lines.forEach((line, idx) => {
      if (line.includes('export async function GET') || line.includes('export async function POST')) {
        // Check if the function body validates JWT
        let foundAuth = false;
        for (let i = idx; i < Math.min(idx + 30, lines.length); i++) {
          if (
            lines[i].includes('createUserClient(') ||
            lines[i].includes('createAuthenticatedClient') ||
            lines[i].includes('validateJWT(')
          ) {
            foundAuth = true;
            break;
          }
        }
        if (!foundAuth) {
          issues.push({
            type: 'CRITICAL',
            file: filePath,
            line: idx + 1,
            pattern: 'Debug endpoint without JWT authentication',
            message: `Debug route handler starting at line ${idx + 1} must call createUserClient() or validateJWT()`
          });
        }
      }
    });
  }
  
  // VIOLATION PATTERN #2: Service role without JWT in user-facing routes
  if (filePath.includes('/api/') && !filePath.includes('/api/webhooks') && !filePath.includes('/api/inventory/rfid')) {
    lines.forEach((line, idx) => {
      if (line.includes('createUnscopedClient()')) {
        // Check if there's JWT validation BEFORE this line
        let foundJWTValidation = false;
        for (let i = Math.max(0, idx - 30); i < idx; i++) {
          if (
            lines[i].includes('createUserClient(') ||
            lines[i].includes('createAuthenticatedClient') ||
            lines[i].includes('validateJWT(') ||
            lines[i].includes('createAuthenticatedClientOrThrow(')
          ) {
            foundJWTValidation = true;
            break;
          }
        }
        if (!foundJWTValidation) {
          issues.push({
            type: 'CRITICAL',
            file: filePath,
            line: idx + 1,
            pattern: 'Service role without JWT verification',
            message: `Service role client created at line ${idx + 1} requires JWT validation before use. Use createAuthenticatedClientOrThrow() instead.`
          });
        }
      }
    });
  }
  
  // VIOLATION PATTERN #3: Session cookie only (no JWT) in user-facing endpoints
  if (filePath.includes('/api/') && !filePath.includes('/api/auth') && !filePath.includes('/api/webhooks')) {
    lines.forEach((line, idx) => {
      if (line.includes('cookies().get') && line.includes('inventory_session')) {
        // Check if JWT validation happens AFTER
        let foundJWTValidation = false;
        for (let i = idx; i < Math.min(idx + 20, lines.length); i++) {
          if (
            lines[i].includes('validateJWT(') ||
            lines[i].includes('createUserClient(') ||
            lines[i].includes('auth.getUser(')
          ) {
            foundJWTValidation = true;
            break;
          }
        }
        // Session cookie check alone is not sufficient for routes that use service role
        if (!foundJWTValidation && lines.slice(idx, Math.min(idx + 50, lines.length)).some(l => l.includes('createUnscopedClient'))) {
          issues.push({
            type: 'CRITICAL',
            file: filePath,
            line: idx + 1,
            pattern: 'Session cookie auth + service role without JWT verification',
            message: `Route uses session cookie only (line ${idx + 1}) and service role. Must add JWT validation via createAuthenticatedClientOrThrow().`
          });
        }
      }
    });
  }
}

console.log('🔍 Security Guardrail Scan: Debug & Service Role Endpoints\n');
console.log('Scanning for violations...\n');

scanDirectory(path.join(process.cwd(), 'src'));

console.log(`Scanned: ${fileCount} TypeScript files\n`);

if (issues.length === 0) {
  console.log('✅ PASS: No security violations found\n');
  process.exit(0);
} else {
  console.log(`❌ FAIL: Found ${issues.length} violation(s)\n`);
  issues.forEach((issue) => {
    console.log(`${issue.type}: ${issue.file}#L${issue.line}`);
    console.log(`  Pattern: ${issue.pattern}`);
    console.log(`  ${issue.message}\n`);
  });
  process.exit(1);
}
