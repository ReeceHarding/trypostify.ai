import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdf-parse'],
  devIndicators: false,
  eslint: {
    // Prevent ESLint errors from failing the production build deployment
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Prevent TS type errors from failing the production build deployment
    ignoreBuildErrors: true,
  },
  
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'pbs.twimg.com',
        pathname: '/profile_images/**',
      },
    ],
  },

  async rewrites() {
    return [
      // Complete PostHog setup - proxy all ingest endpoints to prevent CORS and routing issues
      {
        source: '/ingest/batch',
        destination: 'https://us.i.posthog.com/batch',
      },
      {
        source: '/ingest/capture',
        destination: 'https://us.i.posthog.com/capture',
      },
      {
        source: '/ingest/e/:path*',
        destination: 'https://us.i.posthog.com/e/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ]
  },

  async headers() {
    return [
      {
        source: '/ingest/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ]
  },

  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
}

export default nextConfig
