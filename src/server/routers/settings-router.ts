import { db } from '@/db'
import { account as accountSchema, user as userSchema, tweets, knowledgeDocument, mediaLibrary } from '@/db/schema'
import { chatLimiter } from '@/lib/chat-limiter'
import { redis } from '@/lib/redis'
import { qstash } from '@/lib/qstash'
import { s3Client, BUCKET_NAME } from '@/lib/s3'
import { stripe } from '@/lib/stripe/client'
import { DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { TwitterApi } from 'twitter-api-v2'
import { z } from 'zod'
import { j, privateProcedure } from '../jstack'
import { PostHog } from 'posthog-node'

export type Account = {
  id: string
  name: string
  username: string
  profile_image_url: string
  verified: boolean
}

const client = new TwitterApi(process.env.TWITTER_BEARER_TOKEN!).readOnly

// Initialize PostHog client only if API key is available
const posthogApiKey = process.env.POSTHOG_API_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY
let posthog: PostHog | null = null

if (posthogApiKey && posthogApiKey.trim()) {
  posthog = new PostHog(posthogApiKey, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    flushAt: 1, // Reduce batching to prevent header buildup
    flushInterval: 10000, // Flush every 10 seconds
  })
}

interface Settings {
  user: {
    profile_image_url: string
    name: string
    username: string
    id: string
    verified: boolean
    verified_type: 'string'
  }
}

interface TweetWithStats {
  id: string
  text: string
  likes: number
  retweets: number
  created_at: string
}

interface StyleAnalysis {
  overall: string
  first_third: string
  second_third: string
  third_third: string
  [key: string]: string
}

export const settingsRouter = j.router({
  limit: privateProcedure.get(async ({ c, ctx }) => {
    const { user } = ctx
    const { remaining, reset } = await chatLimiter.getRemaining(user.email)

    return c.json({ remaining, reset })
  }),

  getPostingWindow: privateProcedure.get(async ({ c, ctx }) => {
    const { user } = ctx
    
    console.log('[SETTINGS] Fetching posting window for user:', user.email, 'at', new Date().toISOString())
    
    const userRecord = await db
      .select({
        postingWindowStart: userSchema.postingWindowStart,
        postingWindowEnd: userSchema.postingWindowEnd,
      })
      .from(userSchema)
      .where(eq(userSchema.id, user.id))
      .limit(1)
      .then(rows => rows[0])

    const postingWindow = {
      start: userRecord?.postingWindowStart ?? 8, // Default 8am
      end: userRecord?.postingWindowEnd ?? 18, // Default 6pm
    }

    console.log('[SETTINGS] Retrieved posting window:', postingWindow)
    
    return c.json(postingWindow)
  }),

  updatePostingWindow: privateProcedure
    .input(
      z.object({
        start: z.number().min(0).max(23), // Hour 0-23
        end: z.number().min(0).max(23), // Hour 0-23
      })
    )
    .mutation(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { start, end } = input

      console.log('[SETTINGS] Updating posting window for user:', user.email, 'start:', start, 'end:', end, 'at', new Date().toISOString())

      // Validate that start is before end
      if (start >= end) {
        console.log('[SETTINGS] Invalid posting window: start >= end')
        throw new HTTPException(400, {
          message: 'Posting window start time must be before end time',
        })
      }

      await db
        .update(userSchema)
        .set({
          postingWindowStart: start,
          postingWindowEnd: end,
          updatedAt: new Date(),
        })
        .where(eq(userSchema.id, user.id))

      console.log('[SETTINGS] Posting window updated successfully')

      return c.json({ 
        success: true, 
        postingWindow: { start, end } 
      })
    }),

  delete_account: privateProcedure
    .input(
      z.object({
        accountId: z.string(),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { accountId } = input

      // First verify the account exists in DB and belongs to this user
      const [dbAccount] = await db
        .select()
        .from(accountSchema)
        .where(and(eq(accountSchema.userId, user.id), eq(accountSchema.id, accountId)))

      if (!dbAccount) {
        throw new HTTPException(404, { message: 'Account not found' })
      }

      // Delete from database first (source of truth)
      await db.delete(accountSchema).where(eq(accountSchema.id, accountId))

      // Then clean up Redis caches (best effort)
      try {
        const activeAccount = await redis.json.get<Account>(`active-account:${user.email}`)
        if (activeAccount?.id === accountId) {
          await redis.del(`active-account:${user.email}`)
        }

        await redis.json.del(`account:${user.email}:${accountId}`)
        
        // Also remove any style data cached for this account
        await redis.json.del(`style:${user.email}:${accountId}`)
      } catch (err) {
        // Log but don't fail - Redis is just cache
        console.log('[settings.delete_account] redis cleanup error (non-critical)', {
          email: user.email,
          accountId,
          err,
          at: new Date().toISOString(),
        })
      }

      return c.json({ success: true })
    }),

  list_accounts: privateProcedure.get(async ({ c, ctx }) => {
    const { user } = ctx
    
    // Get all accounts from DB (source of truth)
    const dbAccounts = await db
      .select({
        id: accountSchema.id,
        accessToken: accountSchema.accessToken,
        accessSecret: accountSchema.accessSecret,
      })
      .from(accountSchema)
      .where(
        and(eq(accountSchema.userId, user.id), eq(accountSchema.providerId, 'twitter')),
      )
      .orderBy(desc(accountSchema.createdAt))

    const activeAccount = await redis.json.get<Account>(`active-account:${user.email}`)

    const accounts = await Promise.all(
      dbAccounts.map(async (dbAccount) => {
        const redisData = await redis.json.get<Account>(
          `account:${user.email}:${dbAccount.id}`,
        )
        
        if (!redisData) {
          // Account exists in DB but not Redis - shouldn't happen
          console.log(`[list_accounts] Missing Redis data for account ${dbAccount.id}`)
          return null
        }
        
        return {
          ...redisData,
          isActive: activeAccount?.id === dbAccount.id,
          hasValidTokens: Boolean(dbAccount.accessToken && dbAccount.accessSecret),
          needsReconnection: !dbAccount.accessToken || !dbAccount.accessSecret,
        }
      }),
    )

    // Filter out any null accounts (missing Redis data)
    const validAccounts = accounts.filter(Boolean)

    return c.superjson({ accounts: validAccounts })
  }),

  connect: privateProcedure
    .input(
      z.object({
        accountId: z.string(),
      }),
    )
    .mutation(async ({ c, ctx, input }) => {
      const { user } = ctx
      const account = await redis.json.get<Account>(`account:${user.email}:${input.accountId}`)

      if (!account) {
        throw new HTTPException(404, {
          message: `Account "${input.accountId}" not found`,
        })
      }

      await redis.json.set(`active-account:${user.email}`, '$', account)

      return c.json({ success: true })
    }),

  active_account: privateProcedure.get(async ({ c, input, ctx }) => {
    const { user } = ctx

    let account: Account | null = null

    // Read the active account pointer from Redis
    account = await redis.json.get<Account>(`active-account:${user.email}`)

    // Validate against the database to ensure tokens exist
    if (account?.id) {
      try {
        const [dbAccount] = await db
          .select()
          .from(accountSchema)
          .where(and(eq(accountSchema.userId, user.id), eq(accountSchema.id, account.id)))
          .limit(1)

        // If no DB record or missing tokens, return null but DON'T delete the pointer
        // This allows the UI to show the account exists but needs reconnection
        if (!dbAccount || !dbAccount.accessToken || !dbAccount.accessSecret) {
          console.log('[settings.active_account] active account needs reconnection', {
            email: user.email,
            accountId: account.id,
            reason: !dbAccount
              ? 'db-record-missing'
              : 'missing-access-tokens',
            at: new Date().toISOString(),
          })
          // Return account info with a flag indicating it needs reconnection
          return c.json({ 
            account: {
              ...account,
              needsReconnection: true
            }
          })
        }
      } catch (err) {
        console.log('[settings.active_account] db validation failed; returning account anyway', {
          email: user.email,
          accountId: account.id,
          err,
        })
        // Return the account even if DB validation fails - let UI handle it
        return c.json({ account })
      }
    }

    return c.json({ account })
  }),

  switch_account: privateProcedure
    .input(z.object({ accountId: z.string() }))
    .mutation(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { accountId } = input

      // First verify the account exists in DB with valid tokens
      const [dbAccount] = await db
        .select()
        .from(accountSchema)
        .where(and(eq(accountSchema.userId, user.id), eq(accountSchema.id, accountId)))
        .limit(1)

      if (!dbAccount) {
        throw new HTTPException(404, { message: `Account not found` })
      }

      if (!dbAccount.accessToken || !dbAccount.accessSecret) {
        throw new HTTPException(400, { message: `Account needs to be reconnected` })
      }

      // Get the Redis profile data
      const account = await redis.json.get<Account>(`account:${user.email}:${accountId}`)

      if (!account) {
        // Redis data missing - this shouldn't happen but handle gracefully
        throw new HTTPException(500, { message: `Account profile data missing` })
      }

      await redis.json.set(`active-account:${user.email}`, '$', account)

      return c.json({ success: true, account })
    }),

  // Permanently delete the current user and all related data
  delete_user: privateProcedure.post(async ({ c, ctx }) => {
    const { user } = ctx

    const now = new Date().toISOString()
    console.log('[settings.delete_user] starting user deletion', { id: user.id, email: user.email, at: now })

    // Phase 1: Collect all data that needs cleanup before deletion
    console.log('[settings.delete_user] collecting user data for cleanup', { id: user.id, at: new Date().toISOString() })
    
    // Collect QStash message IDs from scheduled tweets
    const scheduledTweets = await db
      .select({ qstashId: tweets.qstashId })
      .from(tweets)
      .where(and(
        eq(tweets.userId, user.id),
        isNotNull(tweets.qstashId)
      ))
    console.log('[settings.delete_user] found scheduled tweets', { count: scheduledTweets.length, at: new Date().toISOString() })

    // Collect S3 keys from all sources
    const tweetsWithMedia = await db
      .select({ media: tweets.media })
      .from(tweets)
      .where(eq(tweets.userId, user.id))
    
    const knowledgeDocs = await db
      .select({ s3Key: knowledgeDocument.s3Key })
      .from(knowledgeDocument)
      .where(eq(knowledgeDocument.userId, user.id))
    
    const mediaItems = await db
      .select({ s3Key: mediaLibrary.s3Key })
      .from(mediaLibrary)
      .where(eq(mediaLibrary.userId, user.id))

    // Extract all S3 keys with proper typing
    interface MediaItem {
      s3Key: string
      media_id: string
    }
    
    const s3Keys: string[] = [
      ...tweetsWithMedia.flatMap(t => {
        const media = t.media as MediaItem[] | null
        return media?.map(m => m.s3Key) || []
      }),
      ...knowledgeDocs.map(k => k.s3Key),
      ...mediaItems.map(m => m.s3Key)
    ].filter(Boolean)
    console.log('[settings.delete_user] collected S3 keys', { count: s3Keys.length, at: new Date().toISOString() })

    // Phase 2: Clean up external resources (best effort, non-blocking)
    const cleanupPromises = []

    // QStash cleanup
    if (scheduledTweets.length > 0) {
      cleanupPromises.push(
        (async () => {
          console.log('[settings.delete_user] cancelling QStash messages', { count: scheduledTweets.length, at: new Date().toISOString() })
          const messages = qstash.messages
          let cancelledCount = 0
          
          for (const tweet of scheduledTweets) {
            if (tweet.qstashId) {
              try {
                await messages.delete(tweet.qstashId)
                cancelledCount++
              } catch (err) {
                console.error('[settings.delete_user] failed to cancel QStash message', { qstashId: tweet.qstashId, err })
              }
            }
          }
          
          console.log('[settings.delete_user] QStash cleanup complete', { 
            attempted: scheduledTweets.length, 
            cancelled: cancelledCount,
            at: new Date().toISOString()
          })
        })()
      )
    }

    // S3 cleanup
    if (s3Keys.length > 0) {
      cleanupPromises.push(
        (async () => {
          console.log('[settings.delete_user] deleting S3 objects', { count: s3Keys.length, at: new Date().toISOString() })
          try {
            // Batch delete S3 objects (max 1000 per request)
            const batches = []
            for (let i = 0; i < s3Keys.length; i += 1000) {
              batches.push(s3Keys.slice(i, i + 1000))
            }

            let deletedCount = 0
            for (const batch of batches) {
              const deleteResult = await s3Client.send(new DeleteObjectsCommand({
                Bucket: BUCKET_NAME,
                Delete: {
                  Objects: batch.map(Key => ({ Key })),
                  Quiet: true
                }
              }))
              deletedCount += deleteResult.Deleted?.length || 0
            }

            console.log('[settings.delete_user] S3 cleanup complete', { 
              attempted: s3Keys.length,
              deleted: deletedCount,
              at: new Date().toISOString()
            })
          } catch (err) {
            console.error('[settings.delete_user] S3 cleanup error', err)
          }
        })()
      )
    }

    // Stripe cleanup
    if (user.stripeId && stripe) {
      cleanupPromises.push(
        (async () => {
          console.log('[settings.delete_user] deleting Stripe customer', { stripeId: user.stripeId, at: new Date().toISOString() })
          try {
            await stripe.customers.del(user.stripeId)
            console.log('[settings.delete_user] Stripe customer deleted', { stripeId: user.stripeId, at: new Date().toISOString() })
          } catch (err) {
            console.error('[settings.delete_user] Stripe cleanup error', { stripeId: user.stripeId, err })
          }
        })()
      )
    }

    // PostHog cleanup
    if (posthog) {
      cleanupPromises.push(
        (async () => {
          console.log('[settings.delete_user] deleting PostHog user', { email: user.email, at: new Date().toISOString() })
          try {
            // Delete the person from PostHog
            posthog.capture({
              distinctId: user.email,
              event: '$delete_person',
              properties: {
                $delete_distinct_id: user.email
              }
            })
            await posthog.flush() // Ensure the event is sent
            console.log('[settings.delete_user] PostHog user deleted', { email: user.email, at: new Date().toISOString() })
          } catch (err) {
            console.error('[settings.delete_user] PostHog cleanup error', { email: user.email, err })
          }
        })()
      )
    }

    // Redis cleanup
    cleanupPromises.push(
      (async () => {
        try {
          // Delete active account pointer
          await redis.del(`active-account:${user.email}`)

          // Delete all per-account caches for this user
          const accountsScan = await redis.scan(0, { match: `account:${user.email}:*` })
          const [, accountKeys] = accountsScan
          for (const key of accountKeys) {
            try {
              await redis.json.del(key)
            } catch {
              await redis.del(key)
            }
          }

          // Delete all style caches for this user
          const stylesScan = await redis.scan(0, { match: `style:${user.email}:*` })
          const [, styleKeys] = stylesScan
          for (const key of styleKeys) {
            try {
              await redis.json.del(key)
            } catch {
              await redis.del(key)
            }
          }
          
          console.log('[settings.delete_user] Redis cleanup complete', { 
            accountKeys: accountKeys.length,
            styleKeys: styleKeys.length,
            at: new Date().toISOString()
          })
        } catch (err) {
          console.error('[settings.delete_user] Redis cleanup error', err)
        }
      })()
    )

    // Execute all cleanup operations in parallel
    console.log('[settings.delete_user] executing cleanup operations', { operations: cleanupPromises.length, at: new Date().toISOString() })
    const cleanupResults = await Promise.allSettled(cleanupPromises)
    const failedCleanups = cleanupResults.filter(r => r.status === 'rejected').length
    if (failedCleanups > 0) {
      console.warn('[settings.delete_user] some cleanup operations failed', { failed: failedCleanups, total: cleanupPromises.length })
    }

    // Phase 3: Delete the user from the database (cascades to sessions, accounts, tweets, knowledge, media)
    console.log('[settings.delete_user] deleting user from database', { id: user.id, at: new Date().toISOString() })
    try {
      await db.delete(userSchema).where(eq(userSchema.id, user.id))
    } catch (err) {
      console.error('[settings.delete_user] database deletion failed', err)
      throw new HTTPException(500, { message: 'Failed to delete user account' })
    }

    console.log('[settings.delete_user] user deleted successfully', { 
      id: user.id, 
      email: user.email, 
      qstashCleaned: scheduledTweets.length,
      s3Cleaned: s3Keys.length,
      stripeCleaned: !!user.stripeId,
      posthogCleaned: !!posthog,
      at: new Date().toISOString() 
    })
    
    return c.json({ success: true })
  }),
})
