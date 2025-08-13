import { db } from '@/db'
import { account as accountSchema, user as userSchema } from '@/db/schema'
import { chatLimiter } from '@/lib/chat-limiter'
import { redis } from '@/lib/redis'
import { and, desc, eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { TwitterApi } from 'twitter-api-v2'
import { z } from 'zod'
import { j, privateProcedure } from '../jstack'

export type Account = {
  id: string
  name: string
  username: string
  profile_image_url: string
  verified: boolean
}

const client = new TwitterApi(process.env.TWITTER_BEARER_TOKEN!).readOnly

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

  delete_account: privateProcedure
    .input(
      z.object({
        accountId: z.string(),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { accountId } = input

      const activeAccount = await redis.json.get<Account>(`active-account:${user.email}`)

      if (activeAccount?.id === accountId) {
        await redis.del(`active-account:${user.email}`)
      }

      const [dbAccount] = await db
        .select()
        .from(accountSchema)
        .where(and(eq(accountSchema.userId, user.id), eq(accountSchema.id, accountId)))

      if (dbAccount) {
        await db.delete(accountSchema).where(eq(accountSchema.id, accountId))
      }

      await redis.json.del(`account:${user.email}:${accountId}`)
      // Also remove any style data cached for this account
      try {
        await redis.json.del(`style:${user.email}:${accountId}`)
      } catch (err) {
        console.log('[settings.delete_account] style json del failed (may be absent)', {
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
    const accountIds = await db
      .select({
        id: accountSchema.id,
      })
      .from(accountSchema)
      .where(
        and(eq(accountSchema.userId, user.id), eq(accountSchema.providerId, 'twitter')),
      )
      .orderBy(desc(accountSchema.createdAt))

    const activeAccount = await redis.json.get<Account>(`active-account:${user.email}`)

    const accounts = await Promise.all(
      accountIds.map(async (accountRecord) => {
        const accountData = await redis.json.get<Account>(
          `account:${user.email}:${accountRecord.id}`,
        )
        return {
          ...accountRecord,
          ...accountData,
          isActive: activeAccount?.id === accountRecord.id,
        }
      }),
    )

    return c.superjson({ accounts })
  }),

  connect: privateProcedure
    .input(
      z.object({
        accountId: z.string(),
      }),
    )
    .mutation(async ({ c, ctx, input }) => {
      const { user } = ctx
      const account = await redis.get<Account>(`account:${user.email}:${input.accountId}`)

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

    // Validate against the database to avoid stale pointers that make the UI inconsistent
    if (account?.id) {
      try {
        const [dbAccount] = await db
          .select()
          .from(accountSchema)
          .where(and(eq(accountSchema.userId, user.id), eq(accountSchema.id, account.id)))
          .limit(1)

        // If no DB record or missing tokens, clear the Redis pointer and return null
        if (!dbAccount || !dbAccount.accessToken || !dbAccount.accessSecret) {
          try {
            await redis.del(`active-account:${user.email}`)
            console.log('[settings.active_account] cleared stale active-account pointer', {
              email: user.email,
              accountId: account.id,
              reason: !dbAccount
                ? 'db-record-missing'
                : 'missing-access-tokens',
              at: new Date().toISOString(),
            })
          } catch (err) {
            console.log('[settings.active_account] failed clearing stale pointer', {
              email: user.email,
              accountId: account.id,
              err,
            })
          }
          account = null
        }
      } catch (err) {
        console.log('[settings.active_account] db validation failed; returning null', {
          email: user.email,
          accountId: account.id,
          err,
        })
        account = null
      }
    }

    return c.json({ account })
  }),

  switch_account: privateProcedure
    .input(z.object({ accountId: z.string() }))
    .mutation(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { accountId } = input

      const account = await redis.json.get<Account>(`account:${user.email}:${accountId}`)

      if (!account) {
        throw new HTTPException(404, { message: `Account "${accountId}" not found` })
      }

      await redis.json.set(`active-account:${user.email}`, '$', account)

      return c.json({ success: true, account })
    }),

  // Permanently delete the current user and all related data
  delete_user: privateProcedure.post(async ({ c, ctx }) => {
    const { user } = ctx

    const now = new Date().toISOString()
    console.log('[settings.delete_user] starting user deletion', { id: user.id, email: user.email, at: now })

    // Best-effort Redis cleanup
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

    } catch (err) {
      console.error('[settings.delete_user] redis cleanup error', err)
    }

    // Delete the user from the database (cascades to sessions, accounts, tweets, knowledge, media)
    try {
      await db.delete(userSchema).where(eq(userSchema.id, user.id))
    } catch (err) {
      console.error('[settings.delete_user] database deletion failed', err)
      throw new HTTPException(500, { message: 'Failed to delete user account' })
    }

    console.log('[settings.delete_user] user deleted successfully', { id: user.id, email: user.email, at: new Date().toISOString() })
    return c.json({ success: true })
  }),
})
