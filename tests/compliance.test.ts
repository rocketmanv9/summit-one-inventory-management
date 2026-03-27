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
  });
});
