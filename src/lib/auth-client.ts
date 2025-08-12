import { createAuthClient } from 'better-auth/react'
import { inferAdditionalFields } from 'better-auth/client/plugins'

// Resolve the correct base URL across local, preview and production deployments.
// Prefer the runtime origin in the browser to avoid hardcoding domains that may lack DNS.
function resolveBaseUrl(): string {
  if (typeof window !== 'undefined') return window.location.origin
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL
  return 'http://localhost:3000'
}

export const authClient = createAuthClient({
  baseURL: resolveBaseUrl(),
  plugins: [
    inferAdditionalFields({
      user: {
        plan: { type: 'string', defaultValue: 'free' },
        hasXPremium: { type: 'boolean', defaultValue: false },
      },
    }),
  ],
})
