import { describe, it, expect } from 'vitest';
import { generateComplianceReport } from '@rocketmanv9/chassis/compliance';
import * as path from 'node:path';

/**
 * Chassis Compliance Gate
 *
 * This test runs the Summit Chassis compliance scanner against your service
 * source code. It enforces governance rules including:
 *   - No raw service_role usage in routes
 *   - Idempotency on write operations
 *   - Authentication on write routes
 *   - AppError instead of generic Error
 *   - Tenant context on DB queries
 *   - Outbox event emission on writes
 *   - Operation context for observability
 *   - Traced fetch for outgoing calls
 *   - Event context on consumers
 *
 * Set strict: true (default) to treat all warnings as errors.
 * To ignore specific paths, add them to the ignorePaths array.
 */
describe('chassis compliance', () => {
  it('passes all governance rules', async () => {
    const rootPath = path.resolve(__dirname, '..');
    const report = await generateComplianceReport(rootPath, {
      strict: true,
      ignorePaths: [
        'supabase/functions',           // Deno edge functions — different module system
        'supabase\\functions',          // Windows path variant
        'e2e/',                         // Playwright e2e tests — need raw Supabase for test setup
        'e2e\\',                        // Windows path variant
        'src/lib/chassis.ts',           // Infrastructure re-export hub
        'src\\lib\\chassis.ts',         // Windows path variant
        'src/supabase/client.ts',       // Client-side browser code needs raw Supabase
        'src\\supabase\\client.ts',     // Windows path variant
        'src/lib/api-client.ts',        // Client-side API shim needs raw Supabase
        'src\\lib\\api-client.ts',      // Windows path variant
        'src/app/dev-login/page.tsx',   // Dev-only page needs raw Supabase auth
        'src\\app\\dev-login\\page.tsx', // Windows path variant
        'src/app/api/webhooks/core-events/route.ts', // Type-only import for handler signatures
        'src\\app\\api\\webhooks\\core-events\\route.ts', // Windows path variant
        'supabase/migrations/20260325000001', // Consolidation migration — no new tables, only ALTER/INSERT
        'supabase\\migrations\\20260325000001', // Windows path variant
        'src/hooks/',                         // Client-side React hooks — AppError is server-only
        'src\\hooks\\',                       // Windows path variant
        'src/components/',                    // Client-side React components — AppError is server-only
        'src\\components\\',                  // Windows path variant
        'src/app/(dashboard)/settings/branding/page.tsx', // 'use client' page
        'src\\app\\(dashboard)\\settings\\branding\\page.tsx',
        'src/app/(dashboard)/settings/integrations/page.tsx', // 'use client' page
        'src\\app\\(dashboard)\\settings\\integrations\\page.tsx',
        'src/app/m/',                         // Mobile client-side pages — AppError is server-only
        'src\\app\\m\\',                      // Windows path variant
        'src/lib/vendors.ts',                 // Needs raw createClient for GV anon-key client
        'src\\lib\\vendors.ts',               // Windows path variant
        'scripts/',                           // Standalone scripts — allowed per CLAUDE.md
        'scripts\\',                          // Windows path variant
      ],
    });

    if (!report.passed) {
      const summary = report.violations
        .map((v) => `[${v.severity.toUpperCase()}] ${v.rule}: ${v.file}${v.line ? ':' + v.line : ''} — ${v.message}`)
        .join('\n  ');
      throw new Error(
        `Chassis compliance failed:\n  ${summary}\n\nRun "npx chassis audit --strict" for details.`,
      );
    }

    expect(report.passed).toBe(true);
    // Full-repo scan: comfortably under a second alone, but can exceed the 5s
    // default when vitest runs every suite in parallel — give it headroom.
  }, 30_000);
});
