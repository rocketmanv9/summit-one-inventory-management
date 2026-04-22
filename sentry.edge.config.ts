import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,

    // Environment
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',

    // Adjust this value in production
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    debug: false,

    // Add custom tags
    initialScope: (scope) => {
      scope.setTag('service', 'inventory');
      scope.setTag('runtime', 'edge');
      return scope;
    },
  });
}
