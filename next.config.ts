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
      // Minimal PostHog setup - only essential endpoints to prevent 431 errors
      {
        source: '/ingest/batch',
        destination: 'https://us.i.posthog.com/batch',
      },
      {
        source: '/ingest/capture',
        destination: 'https://us.i.posthog.com/capture',
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
