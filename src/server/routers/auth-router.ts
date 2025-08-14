import { DEFAULT_TWEETS } from '@/constants/default-tweet-preset'
import { db } from '@/db'
import { account, knowledgeDocument, user, user as userSchema } from '@/db/schema'
import { redis } from '@/lib/redis'
import { and, eq } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { customAlphabet } from 'nanoid'
import { TwitterApi } from 'twitter-api-v2'
import { j, privateProcedure, publicProcedure } from '../jstack'
import { z } from 'zod'
import { Account } from './settings-router'
import { getBaseUrl } from '@/constants/base-url'

import { PostHog } from 'posthog-node'

// Initialize PostHog client only if API key is available
const posthogApiKey = process.env.POSTHOG_API_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY
let posthog: PostHog | null = null

if (posthogApiKey && posthogApiKey.trim()) {
  console.log('[AUTH_ROUTER] Initializing PostHog client...', new Date().toISOString())
  posthog = new PostHog(posthogApiKey, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    flushAt: 1, // Reduce batching to prevent header buildup
    flushInterval: 10000, // Flush every 10 seconds
  })
  console.log('[AUTH_ROUTER] PostHog client initialized successfully')
} else {
  console.log('[AUTH_ROUTER] PostHog API key not found, skipping analytics initialization')
}

const nanoid = customAlphabet(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  32,
)

const consumerKey = process.env.TWITTER_CONSUMER_KEY as string
const consumerSecret = process.env.TWITTER_CONSUMER_SECRET as string

const client = new TwitterApi({ appKey: consumerKey, appSecret: consumerSecret })

type AuthAction = 'onboarding' | 'invite' | 'add-account'

const clientV2 = new TwitterApi(process.env.TWITTER_BEARER_TOKEN!).readOnly

export const authRouter = j.router({
  updateOnboardingMetaData: privateProcedure
    .input(z.object({ userGoals: z.array(z.string()), userFrequency: z.number(), hasXPremium: z.boolean() }))
    .post(async ({ c, input, ctx }) => {
      await db
        .update(user)
        .set({
          goals: input.userGoals,
          frequency: input.userFrequency,
          hasXPremium: input.hasXPremium,
        })
        .where(eq(user.id, ctx.user.id))
      return c.json({ success: true })
    }),

  createTwitterLink: privateProcedure
    .input(z.object({ action: z.enum(['onboarding', 'add-account']) }))
    .query(async ({ c, input, ctx }) => {
      const ts = new Date().toISOString()
      const callbackUrl = `${getBaseUrl()}/api/auth_router/callback`
      console.log('[AUTH_ROUTER:createTwitterLink]', JSON.stringify({
        timestamp: ts,
        message: 'Incoming createTwitterLink request',
        userId: ctx.user?.id,
        userPlan: ctx.user?.plan,
        input,
        baseUrl: getBaseUrl(),
        callbackUrl,
        env: {
          hasConsumerKey: Boolean(consumerKey),
          hasConsumerSecret: Boolean(consumerSecret),
          vercelUrl: process.env.VERCEL_URL || null,
          siteUrl: process.env.NEXT_PUBLIC_SITE_URL || null,
        },
      }))

      if (!consumerKey || !consumerSecret) {
        console.error('[AUTH_ROUTER:createTwitterLink]', JSON.stringify({
          timestamp: ts,
          message: 'Missing Twitter API credentials in environment',
          hasConsumerKey: Boolean(consumerKey),
          hasConsumerSecret: Boolean(consumerSecret),
        }))
        throw new HTTPException(400, { message: 'Failed to create Twitter link' })
      }

      // Gating rule: Free plan can connect exactly ONE account. Pro can add unlimited.
      if (input.action === 'add-account') {
        // Check whether the user already has at least one connected Twitter account in the DB
        const existing = await db
          .select({ id: account.id })
          .from(account)
          .where(and(eq(account.userId, ctx.user.id), eq(account.providerId, 'twitter')))
          .limit(1)

        const hasAtLeastOne = existing.length > 0

        if (ctx.user.plan !== 'pro' && hasAtLeastOne) {
          // Non-pro users attempting to add a second account must upgrade
          throw new HTTPException(402, {
            message: 'Upgrade to Pro to connect more accounts.',
          })
        }
      }

      try {
        const { url, oauth_token, oauth_token_secret } = await client.generateAuthLink(
          callbackUrl,
        )

        console.log('[AUTH_ROUTER:createTwitterLink]', JSON.stringify({
          timestamp: new Date().toISOString(),
          message: 'Successfully generated Twitter auth link',
          oauth_token_present: Boolean(oauth_token),
        }))

        await Promise.all([
          // Store the secret securely in Redis; do not log the value.
          redis.set(`twitter_oauth_secret:${oauth_token}`, oauth_token_secret),
          redis.set(`twitter_oauth_user_id:${oauth_token}`, ctx.user.id),
          redis.set(`auth_action:${oauth_token}`, input.action),
        ])

        console.log('[AUTH_ROUTER:createTwitterLink]', JSON.stringify({
          timestamp: new Date().toISOString(),
          message: 'Stored temporary OAuth metadata in Redis',
          keys: [
            `twitter_oauth_secret:${oauth_token}`,
            `twitter_oauth_user_id:${oauth_token}`,
            `auth_action:${oauth_token}`,
          ],
        }))

        return c.json({ url })
      } catch (err) {
        try {
          const anyErr: any = err
          console.error('[AUTH_ROUTER:createTwitterLink] ERROR', JSON.stringify({
            timestamp: new Date().toISOString(),
            name: anyErr?.name || null,
            message: anyErr?.message || String(anyErr),
            code: anyErr?.code || null,
            status: anyErr?.status || null,
            data: anyErr?.data || null,
            errors: anyErr?.errors || null,
            stack: anyErr?.stack || null,
          }))
        } catch (logErr) {
          console.error('[AUTH_ROUTER:createTwitterLink] Failed to serialize error', logErr)
        }
        throw new HTTPException(400, { message: 'Failed to create Twitter link' })
      }
    }),

  createInviteLink: privateProcedure.query(async ({ c, input, ctx }) => {
    if (ctx.user.plan !== 'pro') {
      throw new HTTPException(402, {
        message: 'Upgrade to Pro to connect more accounts.',
      })
    }

    const inviteId = nanoid()

    // invite valid for 24 hours
    await redis.set(`invite:${inviteId}`, ctx.user.id, { ex: 60 * 60 * 24 })
    await redis.set(`invite:name:${inviteId}`, ctx.user.name, { ex: 60 * 60 * 24 })

    const url = `${getBaseUrl()}/invite?id=${inviteId}`

    return c.json({ url })
  }),

  createTwitterInvite: publicProcedure
    .input(z.object({ inviteId: z.string() }))
    .query(async ({ c, input, ctx }) => {
      const invitedByUserId = await redis.get<string>(`invite:${input.inviteId}`)

      if (!invitedByUserId) {
        throw new HTTPException(400, { message: 'Invite has expired or is invalid' })
      }

      const { url, oauth_token, oauth_token_secret } = await client.generateAuthLink(
        `${getBaseUrl()}/api/auth_router/callback`,
      )

      await Promise.all([
        redis.set(`twitter_oauth_secret:${oauth_token}`, oauth_token_secret),
        redis.set(`twitter_oauth_user_id:${oauth_token}`, invitedByUserId),
        redis.set(`auth_action:${oauth_token}`, 'invite'),
        redis.set(`invite:id:${oauth_token}`, input.inviteId),
      ])

      return c.json({ url })
    }),

  callback: publicProcedure.get(async ({ c }) => {
    const oauth_token = c.req.query('oauth_token')
    const oauth_verifier = c.req.query('oauth_verifier')

    const [storedSecret, userId, authAction, inviteId] = await Promise.all([
      redis.get<string>(`twitter_oauth_secret:${oauth_token}`),
      redis.get<string>(`twitter_oauth_user_id:${oauth_token}`),
      redis.get<AuthAction>(`auth_action:${oauth_token}`),
      redis.get<string>(`invite:id:${oauth_token}`),
    ])

    if (!userId) {
      throw new HTTPException(400, { message: 'Missing user id' })
    }

    if (!storedSecret || !oauth_token || !oauth_verifier) {
      throw new HTTPException(400, { message: 'Missing or expired OAuth secret' })
    }

    const client = new TwitterApi({
      appKey: consumerKey as string,
      appSecret: consumerSecret as string,
      accessToken: oauth_token as string,
      accessSecret: storedSecret as string,
    })

    const credentials = await client.login(oauth_verifier)

    await Promise.all([
      redis.del(`twitter_oauth_secret:${oauth_token}`),
      redis.del(`twitter_oauth_user_id:${oauth_token}`),
      redis.del(`invite:id:${oauth_token}`),
      redis.del(`auth_action:${oauth_token}`),
    ])

    const {
      client: loggedInClient,
      accessToken,
      accessSecret,
      screenName,
      userId: accountId,
    } = credentials

    const { data } = await clientV2.v2.userByUsername(screenName, {
      'user.fields': ['verified', 'verified_type'],
    })

    const userProfile = await loggedInClient.currentUser()

    const [user] = await db.select().from(userSchema).where(eq(userSchema.id, userId))

    if (!user) {
      throw new HTTPException(404, { message: 'user not found' })
    }

    const accounts = await redis.scan(0, { match: `account:${user.email}:*` })

    console.log('accounts', accounts)

    const [, accountKeys] = accounts
    for (const accountKey of accountKeys) {
      const existingAccount = await redis.json.get<Account>(accountKey)
      if (existingAccount?.username === userProfile.screen_name) {
        console.log('[AUTH_ROUTER] Found existing account in Redis, updating database with fresh tokens', {
          accountId: existingAccount.id,
          username: existingAccount.username,
        })

        // CRITICAL: Update the database with fresh access tokens for existing accounts
        // This fixes the "access token missing" error when users reconnect
        await db
          .update(account)
          .set({
            accessToken,
            accessSecret,
            updatedAt: new Date(),
          })
          .where(eq(account.id, existingAccount.id))

        console.log('[AUTH_ROUTER] Successfully updated database tokens for existing account:', existingAccount.id)

        // Update Redis with fresh profile data in case it changed
        const updatedAccount = {
          ...existingAccount,
          username: userProfile.screen_name,
          name: userProfile.name,
          profile_image_url: userProfile.profile_image_url_https,
          verified: data.verified,
        }
        
        await redis.json.set(`account:${user.email}:${existingAccount.id}`, '$', updatedAccount)

        // Always set the active account when returning from OAuth for existing accounts
        try {
          await redis.json.set(`active-account:${user.email}`, '$', updatedAccount)
          console.log('[AUTH_ROUTER] Set active-account for existing account with updated profile', {
            email: user.email,
            id: updatedAccount.id,
            username: updatedAccount.username,
          })
        } catch (e) {
          console.error('[AUTH_ROUTER] Failed to set active-account for existing account', e)
        }

        if (authAction === 'invite') {
          return c.redirect(`${getBaseUrl()}/invite/success?id=${inviteId}`)
        }

        if (authAction === 'add-account') {
          return c.redirect(`${getBaseUrl()}/studio/accounts`)
        }

        return c.redirect(`${getBaseUrl()}/studio?account_connected=true`)
      }
    }

    const dbAccountId = nanoid()

    // Insert into database first
    const insertResult = await db
      .insert(account)
      .values({
        id: dbAccountId,
        accountId: accountId,
        createdAt: new Date(),
        updatedAt: new Date(),
        providerId: 'twitter',
        userId,
        accessToken,
        accessSecret,
      })
      .onConflictDoNothing()
      .returning({ id: account.id })

    // Verify the insert succeeded before proceeding
    if (!insertResult || insertResult.length === 0) {
      console.error('[AUTH_ROUTER] Failed to insert account into database', {
        dbAccountId,
        userId,
        accountId,
      })
      throw new HTTPException(500, { message: 'Failed to save account' })
    }

    const connectedAccount = {
      id: dbAccountId,
      username: userProfile.screen_name,
      name: userProfile.name,
      profile_image_url: userProfile.profile_image_url_https,
      verified: data.verified,
    }

    // Only set Redis data after confirming DB write succeeded
    await redis.json.set(`account:${user.email}:${dbAccountId}`, '$', connectedAccount)

    // For onboarding and invite flows, always set the connected account as active to avoid UI race conditions
    try {
      if (authAction !== 'add-account') {
        await redis.json.set(`active-account:${user.email}`, '$', connectedAccount)
        console.log('[AUTH_ROUTER] Set active-account for new connection', {
          email: user.email,
          id: connectedAccount.id,
          username: connectedAccount.username,
          authAction,
        })
      } else {
        // Preserve behavior for add-account flow
        const exists = await redis.exists(`active-account:${user.email}`)
        if (!exists) {
          await redis.json.set(`active-account:${user.email}`, '$', connectedAccount)
          console.log('[AUTH_ROUTER] Set active-account (was missing) during add-account', {
            email: user.email,
            id: connectedAccount.id,
            username: connectedAccount.username,
          })
        }
      }
    } catch (e) {
      console.error('[AUTH_ROUTER] Failed to set active-account for new connection', e)
    }

    const userTweets = await loggedInClient.v2.userTimeline(userProfile.id_str, {
      max_results: 30,
      'tweet.fields': [
        'public_metrics',
        'created_at',
        'text',
        'author_id',
        'note_tweet',
        'edit_history_tweet_ids',
        'in_reply_to_user_id',
        'referenced_tweets',
      ],
      'user.fields': ['username', 'profile_image_url', 'name'],
      exclude: ['retweets', 'replies'],
      expansions: ['author_id'],
    })

    // NEW
    const styleKey = `style:${user.email}:${dbAccountId}`

    if (!userTweets.data.data) {
      await redis.json.set(styleKey, '$', {
        tweets: DEFAULT_TWEETS,
        prompt: '',
      })
    } else {
      const filteredTweets = userTweets.data.data?.filter(
        (tweet) =>
          !tweet.in_reply_to_user_id &&
          !tweet.referenced_tweets?.some((ref) => ref.type === 'replied_to'),
      )
      const tweetsWithStats = filteredTweets.map((tweet) => ({
        id: tweet.id,
        text: tweet.text,
        likes: tweet.public_metrics?.like_count || 0,
        retweets: tweet.public_metrics?.retweet_count || 0,
        created_at: tweet.created_at || '',
      }))
      const sortedTweets = tweetsWithStats.sort((a, b) => b.likes - a.likes)
      const topTweets = sortedTweets.slice(0, 20)
      const author = userProfile
      const formattedTweets = topTweets.map((tweet) => {
        const cleanedText = tweet.text.replace(/https:\/\/t\.co\/\w+/g, '').trim()
        return {
          id: tweet.id,
          text: cleanedText,
          created_at: tweet.created_at,
          author_id: userProfile.id_str,
          edit_history_tweet_ids: [tweet.id],
          author: author
            ? {
                username: author.screen_name,
                profile_image_url: author.profile_image_url_https,
                name: author.name,
              }
            : null,
        }
      })
      if (formattedTweets.length < 20) {
        const existingIds = new Set(formattedTweets.map((t) => t.id))
        for (const defaultTweet of DEFAULT_TWEETS) {
          if (formattedTweets.length >= 20) break
          if (!existingIds.has(defaultTweet.id)) {
            formattedTweets.push(defaultTweet)
            existingIds.add(defaultTweet.id)
          }
        }
      }
      await redis.json.set(styleKey, '$', {
        tweets: formattedTweets.reverse(),
        prompt: '',
      })
    }

    const hasExistingExamples = await db.query.knowledgeDocument.findFirst({
      where: and(
        eq(knowledgeDocument.isExample, true),
        eq(knowledgeDocument.userId, user.id),
      ),
    })

    if (!Boolean(hasExistingExamples)) {
      await db.insert(knowledgeDocument).values([
        {
          userId: userId,
          fileName: '',
          type: 'url',
          s3Key: '',
          title: 'Introducing Zod 4',
          description:
            "An article about the Zod 4.0 release. After a year of active development: Zod 4 is now stable! It's faster, slimmer, more tsc-efficient, and implements some long-requested features.",
          isExample: true,
          sourceUrl: 'https://zod.dev/v4',
        },
        {
          userId: userId,
          fileName: 'data-fetching.png',
          type: 'image',
          s3Key: 'knowledge/4bBacfDWPhQzOzN479b605xuippnbKzF/Lsv-t_5_EMwNXW8jptBYG.png',
          title: 'React Hooks Cheatsheet - Visual Guide',
          isExample: true,
          sourceUrl: '',
        },
      ])
    }

    // Only send analytics if PostHog client is available
    if (posthog) {
      console.log('[AUTH_ROUTER] Capturing user account connected event for user:', user.id)
      posthog.capture({
        distinctId: user.id,
        event: 'user_account_connected',
        properties: {
          userId: user.id,
          accountId: dbAccountId,
          accountName: userProfile.name,
          reason: authAction,
        },
      })

      await posthog.shutdown()
    } else {
      console.log('[AUTH_ROUTER] PostHog client not available, skipping user account connected analytics')
    }

    if (authAction === 'invite') {
      return c.redirect(`${getBaseUrl()}/invite/success?id=${inviteId}`)
    }

    if (authAction === 'add-account') {
      return c.redirect(`${getBaseUrl()}/studio/accounts`)
    }

    return c.redirect(`${getBaseUrl()}/studio?account_connected=true`)
  }),
})
