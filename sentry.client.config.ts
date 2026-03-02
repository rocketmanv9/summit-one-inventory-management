import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,

    // Environment (dev, stage, prod)
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || 'development',

    // Adjust this value in production, or use tracesSampler for greater control
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Setting this option to true will print useful information to the console while you're setting up Sentry.
    debug: false,

    replaysOnErrorSampleRate: 1.0,

    // This sets the sample rate to be 10%. You may want this to be 100% while
    // in development and sample at a lower rate in production
    replaysSessionSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0.0,

    // You can remove this option if you're not planning to use the Sentry Session Replay feature:
    integrations: [
      Sentry.replayIntegration({
        // Additional Replay configuration goes in here, for example:
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    // Add custom tags
    initialScope: (scope) => {
      scope.setTag('service', 'inventory');
      scope.setTag('service_slug', process.env.NEXT_PUBLIC_SERVICE_SLUG || 'inventory');
      return scope;
    },

    beforeSend(event, hint) {
      // Filter out localhost errors in development
      if (process.env.NODE_ENV === 'development') {
        return null;
      }

      // Add tenant context if available
      if (typeof window !== 'undefined') {
        const tenantId = window.localStorage.getItem('tenant_id');
        if (tenantId) {
          event.tags = event.tags || {};
          event.tags.tenant_id = tenantId;
        }
      }

      return event;
    },
  });
}
