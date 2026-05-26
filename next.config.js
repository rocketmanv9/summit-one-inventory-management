/** @type {import('next').NextConfig} */

const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Warning: This allows production builds to successfully complete even if
    // your project has type errors.
    ignoreBuildErrors: false,
  },
  // Performance optimizations
  poweredByHeader: false, // Remove X-Powered-By header
  compress: true, // Enable gzip compression
  // Image optimization
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60,
  },
};

// Compose all wrappers
let finalConfig = nextConfig;

// Bundle analyzer — only loaded when ANALYZE=true (devDependency, may not be installed in prod)
if (process.env.ANALYZE === 'true') {
  try {
    const withBundleAnalyzer = require('@next/bundle-analyzer')({ enabled: true });
    finalConfig = withBundleAnalyzer(finalConfig);
  } catch {
    console.warn('[@next/bundle-analyzer] not installed, skipping.');
  }
}

// Sentry — only loaded when SENTRY_DSN is set
if (process.env.SENTRY_DSN) {
  try {
    const { withSentryConfig } = require('@sentry/nextjs');
    finalConfig = withSentryConfig(finalConfig, {
      silent: true,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
    });
  } catch {
    console.warn('[@sentry/nextjs] not installed, skipping.');
  }
}

module.exports = finalConfig;
