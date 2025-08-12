import { dynamic, InferRouterInputs, InferRouterOutputs } from 'jstack'
import { j } from './jstack'
import { cors } from 'hono/cors'

/**
 * This is your base API.
 * Here you can handle errors, not-found responses, cors and more.
 *
 * @see https://jstack.app/docs/backend/app-router
 */
const api = j
  .router()
  .basePath('/api')
  .use(
    cors({
      origin: [
        process.env.NEXT_PUBLIC_SITE_URL,
        process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
        'https://trypostify.ai',
        'https://www.trypostify.ai',
        'https://trypostify.vercel.app',
        'https://www.trypostify.vercel.app',
        // Only add localhost in development
        process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : undefined,
      ].filter(Boolean) as string[],
      allowHeaders: ['x-is-superjson', 'Content-Type', 'content-type'],
      exposeHeaders: ['x-is-superjson', 'Content-Type', 'content-type'],
      credentials: true,
    }),
  )
  .onError(j.defaults.errorHandler)

/**
 * This is the main router for your server.
 * All routers in /server/routers should be added here manually.
 */
const appRouter = j.mergeRouters(api, {
  file: dynamic(() => import('./routers/file-router')),
  tweet: dynamic(() => import('./routers/tweet-router')),
  knowledge: dynamic(() => import('./routers/knowledge-router')),
  chat: dynamic(() => import('./routers/chat/chat-router')),
  style: dynamic(() => import('./routers/style-router')),
  settings: dynamic(() => import('./routers/settings-router')),
  auth_router: dynamic(() => import('./routers/auth-router')),
  stripe: dynamic(() => import('./routers/stripe-router')),
  media: dynamic(() => import('./routers/media-router')),
})

export type AppRouter = typeof appRouter
export type InferOutput = InferRouterOutputs<AppRouter>
export type InferInput = InferRouterInputs<AppRouter>

export default appRouter
