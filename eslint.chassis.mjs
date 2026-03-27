/**
 * Summit Chassis ESLint Governance Rules
 *
 * These rules enforce Summit One architecture standards at lint time:
 *   - No raw @supabase/supabase-js imports (use chassis client factories)
 *   - No deprecated chassis APIs (createServiceClient, publishEvent)
 *   - No generic Error throws (use AppError)
 *
 * Auto-imported by eslint.config.mjs — no manual wiring needed.
 */

// Chassis rules set to 'warn' for retrofit. Upgrade to 'error' after migration is complete.
export default [
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'app/**/*.ts', 'app/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['warn', {
        paths: [
          {
            name: '@supabase/supabase-js',
            importNames: ['createClient'],
            message: 'Use chassis client factories: createUserClient(), createTenantServiceClient(), or createServiceClientUnsafe(). Import from @rocketmanv9/chassis/supabase.',
          },
          {
            name: '@rocketmanv9/chassis',
            importNames: ['createServiceClient'],
            message: 'createServiceClient() is deprecated. Use createTenantServiceClient() for tenant-scoped work, or createServiceClientUnsafe({ dangerouslyBypassRLS: true }) for intentional admin access.',
          },
          {
            name: '@rocketmanv9/chassis/supabase',
            importNames: ['createServiceClient'],
            message: 'createServiceClient() is deprecated. Use createTenantServiceClient() for tenant-scoped work, or createServiceClientUnsafe({ dangerouslyBypassRLS: true }) for intentional admin access.',
          },
          {
            name: '@rocketmanv9/chassis',
            importNames: ['publishEvent'],
            message: 'publishEvent() is deprecated. Use emitOutboxEvent() from @rocketmanv9/chassis/events or emitOutboxEventFromContext() from @rocketmanv9/chassis/observability.',
          },
          {
            name: '@rocketmanv9/chassis/events',
            importNames: ['publishEvent'],
            message: 'publishEvent() is deprecated. Use emitOutboxEvent() or emitOutboxEventFromContext() from @rocketmanv9/chassis/observability.',
          },
          {
            name: '@rocketmanv9/chassis',
            importNames: ['withContext'],
            message: 'withContext() is deprecated. Use withOperationContext() from @rocketmanv9/chassis/observability for full distributed tracing.',
          },
          {
            name: '@rocketmanv9/chassis/context',
            importNames: ['withContext'],
            message: 'withContext() is deprecated. Use withOperationContext() from @rocketmanv9/chassis/observability for full distributed tracing.',
          },
        ],
        patterns: [
          {
            group: ['@supabase/supabase-js'],
            importNamePattern: '^createClient$',
            message: 'Use chassis client factories instead of raw createClient().',
          },
        ],
      }],
    },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'app/**/*.ts', 'app/**/*.tsx'],
    ignores: ['**/*.test.*', '**/*.spec.*', '**/tests/**'],
    rules: {
      'no-restricted-syntax': ['warn',
        {
          selector: 'ThrowStatement > NewExpression[callee.name="Error"]',
          message: 'Use AppError from @rocketmanv9/chassis/errors instead of generic Error for consistent error handling.',
        },
      ],
    },
  },
  // Route factory enforcement: warn when route handlers don't use chassis route factories
  {
    files: ['src/app/api/**/route.ts', 'app/api/**/route.ts'],
    ignores: ['**/system/**', '**/health/**', '**/debug/**'],
    rules: {
      'no-restricted-syntax': ['warn',
        {
          selector: 'ExportNamedDeclaration > FunctionDeclaration[id.name=/^(GET|POST|PUT|DELETE|PATCH)$/]',
          message: 'Use a chassis route factory (createReadRoute, createWriteRoute, createWebhookRoute, createInternalRoute) instead of bare function exports. Import from @rocketmanv9/chassis/nextjs.',
        },
      ],
    },
  },
];
