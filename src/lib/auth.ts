import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAuthMiddleware } from 'better-auth/api'
import { PostHog } from 'posthog-node'

// Initialize PostHog client only if API key is available
const posthogApiKey = process.env.POSTHOG_API_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY
let client: PostHog | null = null

if (posthogApiKey && posthogApiKey.trim()) {
  console.log('[AUTH] Initializing PostHog client...', new Date().toISOString())
  client = new PostHog(posthogApiKey, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com',
  })
  console.log('[AUTH] PostHog client initialized successfully')
} else {
  console.log('[AUTH] PostHog API key not found, skipping analytics initialization')
}

// Lazy database initialization for auth
let database: any = null

function getDatabase() {
  if (!database) {
    console.log('[AUTH] Initializing database adapter...', new Date().toISOString())
    const { db } = require('@/db')
    database = drizzleAdapter(db, { provider: 'pg' })
    console.log('[AUTH] Database adapter initialized successfully')
  }
  return database
}

// Lazy auth initialization
let _auth: any = null

function initializeAuth() {
  if (_auth) return _auth

  console.log('[AUTH] Initializing Better Auth...', new Date().toISOString())

  // Build trusted origins dynamically
  const trustedOrigins = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
    'https://trypostify.ai',
    'https://www.trypostify.ai',
    // Only add localhost in development
    process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : undefined,
  ].filter(Boolean) as string[]

  const database = getDatabase()

  _auth = betterAuth({
    trustedOrigins,
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // Only send analytics if PostHog client is available
            if (client) {
              console.log('[AUTH] Capturing user signup event for user:', user.id)
              client.capture({
                distinctId: user.id,
                event: 'user_signed_up',
                properties: {
                  email: user.email,
                },
              })

              await client.shutdown()
            } else {
              console.log('[AUTH] PostHog client not available, skipping user signup analytics')
            }
          },
        },
      },
    },
    account: {
      accountLinking: {
        enabled: true,
      },
    },
    user: {
      additionalFields: {
        plan: { type: 'string', defaultValue: 'free' },
        stripeId: { type: 'string', defaultValue: null, required: false },
        hadTrial: { type: 'boolean', defaultValue: false, required: true },
        hasXPremium: { type: 'boolean', defaultValue: false, required: true },
      },
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    database,
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID as string,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
        // Force account chooser to avoid silently reusing last Google account
        authorization: {
          params: {
            prompt: 'select_account',
          },
        },
      },
      twitter: {
        clientId: process.env.TWITTER_CLIENT_ID as string,
        clientSecret: process.env.TWITTER_CLIENT_SECRET as string,
        scope: [
          'tweet.read',
          'tweet.write',
          'users.read',
          'offline.access',
          'block.read',
          'follows.read',
          'media.write',
        ],
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        const session = ctx.context.newSession

        if (session) {
          ctx.redirect('/studio')
        } else {
          ctx.redirect('/')
        }
      }),
    },
  })

  console.log('[AUTH] Better Auth initialized successfully')
  return _auth
}

// Export auth with full compatibility through Proxy
export const auth = new Proxy({}, {
  get(target, prop) {
    const authInstance = initializeAuth()
    const value = authInstance[prop]
    // Ensure functions are bound to the correct context
    if (typeof value === 'function') {
      return value.bind(authInstance)
    }
    return value
  },
  has(target, prop) {
    const authInstance = initializeAuth()
    return prop in authInstance
  },
  ownKeys(target) {
    const authInstance = initializeAuth()
    return Reflect.ownKeys(authInstance)
  },
  getOwnPropertyDescriptor(target, prop) {
    const authInstance = initializeAuth()
    return Reflect.getOwnPropertyDescriptor(authInstance, prop)
  }
}) as any
