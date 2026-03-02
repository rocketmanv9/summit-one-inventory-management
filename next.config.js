/** @type {import('next').NextConfig} */
const { withSentryConfig } = require('@sentry/nextjs');

// Bundle analyzer (enable with ANALYZE=true npm run build)
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig = {
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: false,
  },
  typescript: {
    // Warning: This allows production builds to successfully complete even if
    // your project has type errors.
    ignoreBuildErrors: false,
  },
  // Enable experimental features if needed
  experimental: {
    // serverActions: true,
  },
  // Performance optimizations
  poweredByHeader: false, // Remove X-Powered-By header
  compress: true, // Enable gzip compression
  // Image optimization
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60,
  },
  // Sentry will be enabled if SENTRY_DSN is set
  sentry: {
    hideSourceMaps: true,
    disableServerWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
    disableClientWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
  },
};

// Compose all wrappers
let finalConfig = nextConfig;

// Add bundle analyzer
finalConfig = withBundleAnalyzer(finalConfig);

// Add Sentry (only if configured)
if (process.env.SENTRY_DSN) {
  finalConfig = withSentryConfig(finalConfig, {
    // Sentry webpack plugin options
    silent: true,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
  });
}

module.exports = finalConfig;
