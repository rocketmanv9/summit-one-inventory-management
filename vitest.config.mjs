import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default {
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      'e2e/**',
      '__tests__/**',
      'tests/inline-creation-flows.test.ts',
      'tests/event-compliance.test.ts',
      'tests/idempotency.spec.ts',
      'node_modules/**',
    ],
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
};
