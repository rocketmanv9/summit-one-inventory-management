import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,

    // Environment
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',

    // Adjust this value in production, or use tracesSampler for greater control
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Setting this option to true will print useful information to the console
    debug: false,

    // Add custom tags
    initialScope: (scope) => {
      scope.setTag('service', 'inventory');
      scope.setTag('runtime', 'nodejs');
      return scope;
    },

    beforeSend(event, hint) {
      // Filter out development errors
      if (process.env.NODE_ENV === 'development') {
        return null;
      }

      // Add additional context
      event.tags = event.tags || {};
      event.tags.vercel_region = process.env.VERCEL_REGION;

      return event;
    },
  });
}
