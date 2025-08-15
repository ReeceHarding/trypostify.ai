import { getBaseUrl } from '@/constants/base-url'
import { db } from '@/db'
import { account as accountSchema, tweets, mediaLibrary, user as userSchema } from '@/db/schema'
import { qstash } from '@/lib/qstash'
import { redis } from '@/lib/redis'
import { BUCKET_NAME, s3Client } from '@/lib/s3'
import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { Receiver } from '@upstash/qstash'
import { Ratelimit } from '@upstash/ratelimit'
import { and, desc, eq, asc, inArray, lte } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { SendTweetV2Params, TwitterApi, UserV2 } from 'twitter-api-v2'
import { z } from 'zod'
import { j, privateProcedure, publicProcedure } from '../jstack'
import { getAccount } from './utils/get-account'
import { waitUntil } from '@vercel/functions'
import {
  addDays,
  addHours,
  isAfter,
  isBefore,
  isFuture,
  isSameDay,
  setDay,
  setHours,
  startOfDay,
  startOfHour,
} from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'

const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY as string,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY as string,
})

const consumerKey = process.env.TWITTER_CONSUMER_KEY as string
const consumerSecret = process.env.TWITTER_CONSUMER_SECRET as string

const SLOTS = [10, 12, 14]

// Function to enrich media without S3 HEAD calls.
// Derive URL from s3Key and infer type from extension. This removes 1 network call per item.
async function fetchMediaFromS3(media: { s3Key: string; media_id: string }[]) {
  return media.map((m) => {
    const lower = m.s3Key.toLowerCase()
    const url = `https://${process.env.NEXT_PUBLIC_S3_BUCKET_NAME}.s3.amazonaws.com/${m.s3Key}`
    let type: 'image' | 'gif' | 'video' = 'image'
    if (lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.m4v') || lower.endsWith('.webm')) {
      type = 'video'
    } else if (lower.endsWith('.gif')) {
      type = 'gif'
    } else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.endsWith('.webp') || lower.endsWith('.svg')) {
      type = 'image'
    }
    return {
      url,
      type,
      media_id: m.media_id,
      s3Key: m.s3Key,
      uploaded: true,
      uploading: false,
      file: null,
    }
  })
}

// Simple in-memory scheduler for local development
if (process.env.NODE_ENV === 'development') {
  // Check for scheduled tweets every minute in development
  setInterval(async () => {
    try {
      const now = Date.now()
      const scheduledTweets = await db.query.tweets.findMany({
        where: and(
          eq(tweets.isScheduled, true),
          eq(tweets.isPublished, false),
          lte(tweets.scheduledUnix, now),
        ),
      })
      
      // Group by threadId
      const threads = scheduledTweets.reduce((acc, tweet) => {
        if (tweet.threadId && tweet.scheduledUnix && tweet.scheduledUnix <= now) {
          if (!acc[tweet.threadId]) {
            acc[tweet.threadId] = []
          }
          acc[tweet.threadId]!.push(tweet)
        }
        return acc
      }, {} as Record<string, typeof scheduledTweets>)
      
      // Process each thread that's due
      for (const [threadId, threadTweets] of Object.entries(threads)) {
        if (threadTweets.length > 0) {
          console.log(`[LocalScheduler] Processing scheduled thread ${threadId}`)
          // In a real implementation, you'd call the postThread logic here
          // For now, just log it
        }
      }
    } catch (error) {
      console.error('[LocalScheduler] Error checking scheduled tweets:', error)
    }
  }, 60000) // Check every minute
}

export const tweetRouter = j.router({
  getConnectedAccount: privateProcedure.get(async ({ c, ctx }) => {
    const { user } = ctx

    const connectedAccount = await db.query.account.findFirst({
      where: and(eq(accountSchema.userId, user.id), eq(accountSchema.id, 'twitter')),
    })

    return c.json({ isConnected: Boolean(connectedAccount) })
  }),

  getTweet: privateProcedure
    .input(z.object({ tweetId: z.string() }))
    .get(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { tweetId } = input

      console.log('[getTweet] Fetching tweet with thread context:', { tweetId })

      const tweet = await db.query.tweets.findFirst({
        where: and(eq(tweets.id, tweetId), eq(tweets.userId, user.id)),
      })

      if (!tweet) {
        return c.superjson({ tweet: null })
      }

      // If tweet has a threadId, fetch all tweets in the thread
      if (tweet.threadId) {
        const threadTweets = await db.query.tweets.findMany({
          where: and(
            eq(tweets.threadId, tweet.threadId),
            eq(tweets.userId, user.id)
          ),
          orderBy: asc(tweets.position),
        })

        console.log('[getTweet] Fetched thread context:', {
          tweetId,
          threadId: tweet.threadId,
          threadLength: threadTweets.length,
        })

        return c.superjson({ 
          tweet,
          thread: threadTweets 
        })
      }

      // Single tweet without thread
      return c.superjson({ 
        tweet,
        thread: [tweet]
      })
    }),

  // save: privateProcedure
  //   .input(
  //     z.object({
  //       tweetId: z.string(),
  //       content: z.string(),
  //       mediaData: z
  //         .array(
  //           z.object({
  //             media_id: z.string(),
  //             media_key: z.string().optional(),
  //             type: z.enum(['image', 'video', 'gif']),
  //             url: z.string(),
  //             width: z.number().optional(),
  //             height: z.number().optional(),
  //             size: z.number().optional(),
  //           }),
  //         )
  uploadMediaToTwitter: privateProcedure
    .input(
      z.object({
        s3Key: z.string(),
        mediaType: z.enum(['image', 'gif', 'video']),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { s3Key, mediaType } = input

      const activeAccount = await getAccount({ email: user.email })

      if (!activeAccount) {
        throw new HTTPException(400, {
          message: 'No active account found',
        })
      }

      const account = await db.query.account.findFirst({
        where: and(
          eq(accountSchema.userId, user.id),
          eq(accountSchema.id, activeAccount.id),
        ),
      })

      if (!account) {
        throw new HTTPException(400, {
          message: 'X account not connected or access token missing',
        })
      }

      const client = new TwitterApi({
        appKey: consumerKey as string,
        appSecret: consumerSecret as string,
        accessToken: account.accessToken as string,
        accessSecret: account.accessSecret as string,
      })

      const mediaUrl = `https://${process.env.NEXT_PUBLIC_S3_BUCKET_NAME}.s3.amazonaws.com/${s3Key}`
      const response = await fetch(mediaUrl)

      if (!response.ok) {
        throw new HTTPException(400, { message: 'Failed to fetch media from S3' })
      }

      const buffer = await response.arrayBuffer()

      // Determine media category and type for Twitter
      let mediaCategory: string
      let mimeType: string

      switch (mediaType) {
        case 'image':
          mediaCategory = 'tweet_image'
          mimeType = response.headers.get('content-type') || 'image/png'
          break
        case 'gif':
          mediaCategory = 'tweet_gif'
          mimeType = 'image/gif'
          break
        case 'video':
          mediaCategory = 'tweet_video'
          mimeType = response.headers.get('content-type') || 'video/mp4'
          break
      }

      const mediaBuffer = Buffer.from(buffer)
      const mediaId = await client.v1.uploadMedia(mediaBuffer, { mimeType })

      const mediaUpload = mediaId

      // Extract filename from s3Key
      const filename = s3Key.split('/').pop() || 'unknown'

      // Save to media library
      try {
        await db.insert(mediaLibrary).values({
          userId: user.id,
          s3Key,
          media_id: mediaUpload,
          filename,
          fileType: mimeType,
          mediaType,
          sizeBytes: mediaBuffer.length,
          tags: [],
          isStarred: false,
          isDeleted: false,
        })
      } catch (error) {
        console.error('Failed to save media to library:', error)
        // Don't fail the upload if library save fails
      }

      return c.json({
        media_id: mediaUpload,
        media_key: `3_${mediaUpload}`,
      })
    }),






  post: publicProcedure.post(async ({ c }) => {
    const body = await c.req.text()

    const signature =
      c.req.header('Upstash-Signature') ?? c.req.header('upstash-signature') ?? ''

    try {
      await receiver.verify({
        body,
        signature,
      })
    } catch (err) {
      throw new HTTPException(403, { message: 'Invalid credentials' })
    }

    const { tweetId, userId, accountId } = JSON.parse(body) as {
      tweetId: string
      userId: string
      accountId: string
    }

    const tweet = await db.query.tweets.findFirst({
      where: eq(tweets.id, tweetId),
    })

    if (tweet?.isPublished) {
      return c.json({ success: true })
    }

    const account = await db.query.account.findFirst({
      where: and(
        eq(accountSchema.userId, userId),
        // use account that this was scheduled with
        eq(accountSchema.id, accountId),
      ),
    })

    if (!account || !account.accessToken) {

      throw new HTTPException(400, {
        message: 'X account not connected or access token missing',
      })
    }

    if (!tweet) {
      throw new HTTPException(404, { message: 'Tweet not found' })
    }

    try {
      const client = new TwitterApi({
        appKey: consumerKey as string,
        appSecret: consumerSecret as string,
        accessToken: account.accessToken as string,
        accessSecret: account.accessSecret as string,
      })

      // Create tweet payload
      const tweetPayload: Partial<SendTweetV2Params> = {
        text: tweet.content,
      }

      // Add media if present
      if (tweet.media && tweet.media.length > 0) {
        tweetPayload.media = {
          // @ts-expect-error tuple type vs. string[]
          media_ids: tweet.media.map((media) => media.media_id),
        }
      }

      try {

        const res = await client.v2.tweet(tweetPayload)
        // res.errors?.map((error) =>
        //   console.error('⚠️ Twitter error:', JSON.stringify(error, null, 2)),
        // )

        await db
          .update(tweets)
          .set({
            isScheduled: false,
            isPublished: true,
            updatedAt: new Date(),
            twitterId: res.data.id,
          })
          .where(eq(tweets.id, tweetId))
      } catch (err) {
        // console.error('🔴 Twitter error:', JSON.stringify(err, null, 2))

        throw new HTTPException(500, {
          message: 'Failed to post tweet to Twitter',
        })
      }
    } catch (error) {
      // console.error('Failed to post tweet:', error)
      throw new HTTPException(500, {
        message: 'Failed to post tweet to Twitter',
      })
    }

    return c.json({ success: true })
  }),

  postImmediateFromQueue: privateProcedure
    .input(
      z.object({
        tweetId: z.string(),
      }),
    )
    .mutation(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { tweetId } = input

      const account = await getAccount({
        email: user.email,
      })

      if (!account?.id) {
        throw new HTTPException(400, {
          message: 'Please connect your X account',
        })
      }

      const dbAccount = await db.query.account.findFirst({
        where: and(eq(accountSchema.userId, user.id), eq(accountSchema.id, account.id)),
      })

      if (!dbAccount || !dbAccount.accessToken) {
        throw new HTTPException(400, {
          message: 'Account not found',
        })
      }

      const [tweet] = await db
        .select()
        .from(tweets)
        .where(
          and(
            eq(tweets.id, tweetId),
            eq(tweets.userId, user.id),
            eq(tweets.accountId, account.id),
            eq(tweets.isScheduled, true),
            eq(tweets.isPublished, false),
          ),
        )

      if (!tweet) {
        throw new HTTPException(404, { message: 'Tweet not found' })
      }

      if (tweet.qstashId) {
        const messages = qstash.messages
        try {
          await messages.delete(tweet.qstashId)
        } catch (err) {
          throw new HTTPException(500, {
            message: 'Failed to cancel existing scheduled tweet',
          })
        }
      } else {
        throw new HTTPException(400, { message: 'Tweet is not scheduled' })
      }

      const client = new TwitterApi({
        appKey: consumerKey as string,
        appSecret: consumerSecret as string,
        accessToken: dbAccount.accessToken as string,
        accessSecret: dbAccount.accessSecret as string,
      })

      try {
        const tweetPayload: SendTweetV2Params = {
          text: tweet.content,
        }

        if (tweet.media && tweet.media.length > 0) {
          tweetPayload.media = {
            // @ts-expect-error tuple
            media_ids: tweet.media.map((m) => m.media_id),
          }
        }

        const res = await client.v2.tweet(tweetPayload)

        // update the tweet in the database
        await db
          .update(tweets)
          .set({
            isScheduled: false,
            isPublished: true,
            updatedAt: new Date(),
            twitterId: res.data.id,
          })
          .where(
            and(
              eq(tweets.id, tweetId),
              eq(tweets.userId, user.id),
              eq(tweets.accountId, account.id),
            ),
          )

        return c.json({
          success: true,
          tweetId: res.data.id,
          accountId: account.id,
          accountName: account.name, // Display name of the twitter (x) user, do not use for tweet urls
          accountUsername: account.username, // Username of the twitter (x) user, use for correct tweet urls
        })
      } catch (error) {
        // console.error('Failed to post tweet:', error)
        throw new HTTPException(500, {
          message: 'Failed to post tweet to Twitter',
        })
      }
    }),

  postImmediate: privateProcedure
    .input(
      z.object({
        content: z.string().min(1).max(4000),
        media: z.array(
          z.object({
            media_id: z.string(),
            s3Key: z.string(),
          }),
        ),
        // mediaIds: z.array(z.string()).default([]),
        // s3Keys: z.array(z.string()).default([]),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { content, media } = input

      const account = await getAccount({
        email: user.email,
      })

      if (!account?.id) {
        throw new HTTPException(400, {
          message: 'Please connect your X account',
        })
      }

      const dbAccount = await db.query.account.findFirst({
        where: and(eq(accountSchema.userId, user.id), eq(accountSchema.id, account.id)),
      })

      if (!dbAccount) {
        throw new HTTPException(400, {
          message: 'Account not found',
        })
      }

      const client = new TwitterApi({
        appKey: consumerKey as string,
        appSecret: consumerSecret as string,
        accessToken: dbAccount.accessToken as string,
        accessSecret: dbAccount.accessSecret as string,
      })

      try {
        // Create tweet payload
        const tweetPayload: SendTweetV2Params = {
          text: content,
        }

        // Add media if present
        if (media && media.length > 0) {
          tweetPayload.media = {
            // @ts-expect-error tuple
            media_ids: media.map((m) => m.media_id),
          }
        }

        const res = await client.v2.tweet(tweetPayload)

        // Save to database
        await db.insert(tweets).values({
          accountId: account.id,
          userId: user.id,
          content,
          media,
          isScheduled: false,
          isPublished: true,
          twitterId: res.data.id,
        })

        return c.json({
          success: true,
          tweetId: res.data.id,
          accountId: account.id,
          accountName: account.name, // Display name of the twitter (x) user, do not use for tweet urls
          accountUsername: account.username, // Username of the twitter (x) user, use for correct tweet urls
        })
      } catch (error) {
        // console.error('Failed to post tweet:', error)
        throw new HTTPException(500, {
          message: 'Failed to post tweet to Twitter',
        })
      }
    }),

  getScheduledAndPublished: privateProcedure.get(async ({ c, ctx }) => {
    const { user } = ctx

    console.log('[getScheduledAndPublished] Starting to fetch scheduled tweets')

    const account = await getAccount({
      email: user.email,
    })

    if (!account?.id) {
      throw new HTTPException(400, {
        message: 'Please connect your X account',
      })
    }

    const allTweets = await db.query.tweets.findMany({
      where: and(eq(tweets.accountId, account.id), eq(tweets.isScheduled, true)),
      orderBy: [desc(tweets.scheduledFor)],
    })
    
    console.log('[getScheduledAndPublished] Found tweets:', {
      totalCount: allTweets.length,
      tweetsWithThreadId: allTweets.filter(t => t.threadId).length,
      uniqueThreadIds: [...new Set(allTweets.filter(t => t.threadId).map(t => t.threadId))],
    })

    // Fetch media URLs for each tweet
    const tweetsWithMedia = await Promise.all(
      allTweets.map(async (tweet) => {
        const enrichedMedia = await fetchMediaFromS3(tweet.media || [])
        return {
          ...tweet,
          media: enrichedMedia,
        }
      }),
    )

    // Group all tweets by threadId (or treat as single-item threads)
    const threadGroups: Record<string, typeof tweetsWithMedia> = {}
    
    for (const tweet of tweetsWithMedia) {
      const groupKey = tweet.threadId || tweet.id
      if (!threadGroups[groupKey]) {
        threadGroups[groupKey] = []
      }
      threadGroups[groupKey].push(tweet)
    }

    // Convert to unified thread structure
    const allItems = Object.entries(threadGroups)
      .map(([key, tweets]) => {
        const sortedTweets = tweets.sort((a, b) => (a.position || 0) - (b.position || 0))
        const firstTweet = sortedTweets[0]!
        
        return {
          threadId: firstTweet.threadId,
          tweets: sortedTweets,
          scheduledFor: firstTweet.scheduledFor,
          scheduledUnix: firstTweet.scheduledUnix,
        }
      })
      .sort((a, b) => {
        // Sort by scheduled time, newest first
        const timeA = a.scheduledUnix || 0
        const timeB = b.scheduledUnix || 0
        return timeB - timeA
      })

    console.log('[getScheduledAndPublished] Returning items:', {
      totalItems: allItems.length,
      threads: allItems.filter(item => item.tweets.length > 1).length,
      singlePosts: allItems.filter(item => item.tweets.length === 1).length,
    })

    return c.superjson({ items: allItems, tweets: tweetsWithMedia })
  }),

  getPosted: privateProcedure.get(async ({ c, ctx }) => {
    const { user } = ctx

    const account = await getAccount({
      email: user.email,
    })

    if (!account?.id) {
      throw new HTTPException(400, {
        message: 'Please connect your X account',
      })
    }

    const postedTweets = await db.query.tweets.findMany({
      where: and(eq(tweets.accountId, account.id), eq(tweets.isPublished, true)),
      orderBy: [desc(tweets.updatedAt)],
    })

    // Fetch media URLs for each tweet
    const tweetsWithMedia = await Promise.all(
      postedTweets.map(async (tweet) => {
        const enrichedMedia = await fetchMediaFromS3(tweet.media || [])
        return {
          ...tweet,
          media: enrichedMedia,
        }
      }),
    )

    // Group all tweets by threadId (or treat as single-item threads)
    const threadGroups: Record<string, typeof tweetsWithMedia> = {}
    
    for (const tweet of tweetsWithMedia) {
      const groupKey = tweet.threadId || tweet.id
      if (!threadGroups[groupKey]) {
        threadGroups[groupKey] = []
      }
      threadGroups[groupKey].push(tweet)
    }

    // Convert to unified thread structure
    const allItems = Object.entries(threadGroups)
      .map(([key, tweets]) => {
        const sortedTweets = tweets.sort((a, b) => (a.position || 0) - (b.position || 0))
        const firstTweet = sortedTweets[0]!
        
        return {
          threadId: firstTweet.threadId,
          tweets: sortedTweets,
          updatedAt: firstTweet.updatedAt,
        }
      })
      .sort((a, b) => {
        // Sort by updated time, newest first
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
        return timeB - timeA
      })

    return c.superjson({ items: allItems, tweets: tweetsWithMedia, accountId: account.id })
  }),

  getNextQueueSlot: privateProcedure
    .input(
      z.object({
        currentTimeUnix: z.number(), // User's current time as Unix timestamp
      }),
    )
    .get(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { currentTimeUnix } = input

      const account = await getAccount({
        email: user.email,
      })

      if (!account?.id) {
        throw new HTTPException(400, {
          message: 'Please connect your X account',
        })
      }

      // Get all scheduled tweets for this account
      const scheduledTweets = await db.query.tweets.findMany({
        where: and(eq(tweets.accountId, account.id), eq(tweets.isScheduled, true)),
        columns: { scheduledFor: true },
      })

      // Get user's posting window settings
      const userRecord = await db
        .select({
          postingWindowStart: userSchema.postingWindowStart,
          postingWindowEnd: userSchema.postingWindowEnd,
        })
        .from(userSchema)
        .where(eq(userSchema.id, user.id))
        .limit(1)
        .then(rows => rows[0])

      const postingWindowStart = userRecord?.postingWindowStart ?? 8 // Default 8am
      const postingWindowEnd = userRecord?.postingWindowEnd ?? 18 // Default 6pm

      console.log('[getNextQueueSlot] User posting window:', postingWindowStart, '-', postingWindowEnd)

      const userNow = new Date(currentTimeUnix * 1000)

      // Find next available slot within the user's posting window
      for (let daysAhead = 0; daysAhead < 365; daysAhead++) {
        const checkDate = new Date(userNow)
        checkDate.setDate(userNow.getDate() + daysAhead)

        // Check every hour within the posting window
        for (let hour = postingWindowStart; hour < postingWindowEnd; hour++) {
          // Create slot time in user's timezone
          const slotTime = new Date(checkDate)
          slotTime.setHours(hour, 0, 0, 0)

          // Skip if this slot is in the past
          if (slotTime <= userNow) continue

          // Check if this slot is already taken
          const isSlotTaken = scheduledTweets.some((tweet) => {
            if (!tweet.scheduledFor) return false
            const tweetTime = new Date(tweet.scheduledFor)
            const timeDiff = Math.abs(tweetTime.getTime() - slotTime.getTime())
            return timeDiff < 60000 // Within 1 minute = same slot
          })

          if (!isSlotTaken) {
            console.log('[getNextQueueSlot] Found available slot:', slotTime, 'hour:', hour)
            return c.json({
              scheduledUnix: Math.floor(slotTime.getTime() / 1000),
            })
          }
        }
      }

      throw new HTTPException(400, {
        message: 'No available queue slots found in the next year',
      })
    }),




  get_queue: privateProcedure
    .input(
      z.object({
        userNow: z.date(),
        timezone: z.string(),
        daysToLoad: z.number().default(7), // Add pagination support
      }),
    )
    .query(async ({ c, input, ctx }) => {
      const { user } = ctx
      const { timezone, userNow, daysToLoad } = input

      console.log('[get_queue] Starting queue fetch:', {
        timezone,
        userNow: userNow.toISOString(),
      })

      const today = startOfDay(userNow)

      const account = await getAccount({
        email: user.email,
      })

      if (!account?.id) {
        throw new HTTPException(400, {
          message: 'Please connect your X account',
        })
      }

      const _scheduledTweets = await db.query.tweets.findMany({
        where: and(eq(tweets.accountId, account.id), eq(tweets.isScheduled, true)),
        columns: {
          content: true,
          media: true,
          id: true,
          scheduledUnix: true,
          isPublished: true,
          isQueued: true,
          threadId: true,
          position: true,
        },
      })

      // Optimize media fetching by batching and lazy loading
      console.log('[get_queue] Optimizing media fetch for', _scheduledTweets.length, 'tweets')
      const startMediaFetch = Date.now()
      
      // Only fetch media for tweets that have media
      const tweetsWithMedia = _scheduledTweets.filter(t => t.media && t.media.length > 0)
      const tweetsWithoutMedia = _scheduledTweets.filter(t => !t.media || t.media.length === 0)
      
      console.log('[get_queue] Media fetch split:', {
        withMedia: tweetsWithMedia.length,
        withoutMedia: tweetsWithoutMedia.length
      })
      
      // Batch process media-rich tweets
      const enrichedTweetsWithMedia = await Promise.all(
        tweetsWithMedia.map(async (tweet) => {
          const enrichedMedia = await fetchMediaFromS3(tweet.media || [])
          return {
            ...tweet,
            media: enrichedMedia,
          }
        }),
      )
      
      // Combine results
      const scheduledTweetsWithMedia = [
        ...enrichedTweetsWithMedia,
        ...tweetsWithoutMedia.map(tweet => ({ ...tweet, media: [] }))
      ]
      
      console.log('[get_queue] Media fetch completed in', Date.now() - startMediaFetch, 'ms')
      
      console.log('[get_queue] Scheduled tweets before filtering:', {
        total: scheduledTweetsWithMedia.length,
        withThreadId: scheduledTweetsWithMedia.filter(t => t.threadId).length,
        withoutThreadId: scheduledTweetsWithMedia.filter(t => !t.threadId).length,
      })
      
      // Group all tweets by threadId (or treat as single-item threads)
      const threadGroups: Record<string, typeof scheduledTweetsWithMedia> = {}
      
      for (const tweet of scheduledTweetsWithMedia) {
        const groupKey = tweet.threadId || tweet.id
        if (!threadGroups[groupKey]) {
          threadGroups[groupKey] = []
        }
        threadGroups[groupKey].push(tweet)
      }
      
      // Convert to unified thread structure
      const scheduledTweets = Object.entries(threadGroups).map(([key, tweets]) => {
        const sortedTweets = tweets.sort((a, b) => (a.position || 0) - (b.position || 0))
        const firstTweet = sortedTweets[0]!
        
        return {
          id: key,
          threadId: firstTweet.threadId,
          content: sortedTweets.length > 1 
            ? `Thread (${sortedTweets.length} posts)` 
            : firstTweet.content,
          scheduledUnix: firstTweet.scheduledUnix,
          isQueued: firstTweet.isQueued,
          isScheduled: true,
          tweets: sortedTweets,
          media: sortedTweets.length === 1 ? firstTweet.media : [],
        }
      })
      
      console.log('[get_queue] Combined scheduled items:', {
        total: scheduledTweets.length,
        singlePosts: scheduledTweets.filter(t => t.tweets.length === 1).length,
        threads: scheduledTweets.filter(t => t.tweets.length > 1).length,
      })

      // Only allow items that were actually queued to occupy preset slots.
      // Threads and manually scheduled items should not fill queue slots to avoid duplication.
      const getSlotTweet = (unix: number) => {
        const slotTweet = scheduledTweets.find(
          (t) => t.scheduledUnix === unix && Boolean(t.isQueued),
        )

        if (slotTweet) {
          try {
            console.log('[get_queue] slot filled', {
              unixIso: new Date(unix).toISOString(),
              tweetId: (slotTweet as any).id,
              tweetCount: (slotTweet as any).tweets?.length || 1,
              isQueued: Boolean((slotTweet as any).isQueued),
            })
          } catch {}
          return slotTweet
        }

        return null
      }

      const all: Array<Record<number, Array<number>>> = []

      for (let i = 0; i < daysToLoad; i++) {
        const currentDay = addDays(today, i)

        const unixTimestamps = SLOTS.map((hour) => {
          const localDate = startOfHour(setHours(currentDay, hour))
          const utcDate = fromZonedTime(localDate, timezone)
          return utcDate.getTime()
        })

        all.push({ [currentDay.getTime()]: unixTimestamps })
      }

      const results: Array<
        Record<
          number,
          Array<{
            unix: number
            tweet: ReturnType<typeof getSlotTweet>
            isQueued: boolean
          }>
        >
      > = []

      all.forEach((day) => {
        const [dayUnix, timestamps] = Object.entries(day)[0]!

        // Timezone-aware day grouping to ensure tweets scheduled at arbitrary times (e.g., 12:30) appear on the correct day for the user
        const tweetsForThisDay = scheduledTweets.filter((t) =>
          isSameDay(
            toZonedTime(new Date(t.scheduledUnix!), timezone),
            toZonedTime(new Date(Number(dayUnix)), timezone),
          ),
        )

        const manualForThisDay = tweetsForThisDay.filter((t) => !Boolean(t.isQueued))

        const timezoneChanged = tweetsForThisDay.filter((t) => {
          return (
            !Boolean(timestamps.includes(t.scheduledUnix!)) &&
            !manualForThisDay.some((m) => m.id === t.id)
          )
        })

        results.push({
          [dayUnix]: [
            // Preset queue slots
            ...timestamps.map((timestamp) => ({
              unix: timestamp,
              tweet: getSlotTweet(timestamp),
              isQueued: true,
            })),
            // Manually scheduled items (not part of the queue)
            ...manualForThisDay.map((tweet) => ({
              unix: tweet.scheduledUnix!,
              tweet,
              isQueued: false,
            })),
            // Queued items that do not align with preset slots should still appear at their exact scheduled time
            ...timezoneChanged.map((tweet) => ({
              unix: tweet.scheduledUnix!,
              tweet,
              isQueued: Boolean(tweet.isQueued),
            })),
          ]
            .sort((a, b) => a.unix - b.unix)
            .filter((entry) => isFuture(entry.unix)),
        })
      })

      return c.superjson({ results })
    }),

  getHandles: privateProcedure
    .input(
      z.object({
        query: z.string().min(1).max(15),
      }),
    )
    .get(async ({ c, ctx, input }) => {
      const { query } = input
      const { user } = ctx

      const cached = await redis.get<UserV2>(`cache:mention:${query}`)

      if (cached) {
        return c.json({ data: cached })
      }

      const account = await getAccount({
        email: user.email,
      })

      if (!account?.id) {
        throw new HTTPException(400, {
          message: 'Please connect your X account',
        })
      }

      const dbAccount = await db.query.account.findFirst({
        where: and(eq(accountSchema.userId, user.id), eq(accountSchema.id, account.id)),
      })

      if (!dbAccount || !dbAccount.accessToken) {
        throw new HTTPException(400, {
          message: 'X account not connected or access token missing',
        })
      }

      const client = new TwitterApi({
        appKey: consumerKey as string,
        appSecret: consumerSecret as string,
        accessToken: dbAccount.accessToken as string,
        accessSecret: dbAccount.accessSecret as string,
      })

      const { data } = await client.v2.userByUsername(query.replaceAll('@', ''), {
        'user.fields': ['profile_image_url'],
      })

      if (data) {
        waitUntil(redis.set(`cache:mention:${query}`, data))
      }

      return c.json({ data })
    }),

  // Thread-related endpoints
  createThread: privateProcedure
    .input(
      z.object({
        tweets: z.array(
          z.object({
            content: z.string().min(1).max(280),
            media: z.array(
              z.object({
                media_id: z.string(),
                s3Key: z.string(),
              }),
            ).optional(),
            delayMs: z.number().default(0),
          }),
        ),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { tweets: threadTweets } = input



      const account = await getAccount({
        email: user.email,
      })

      if (!account?.id) {

        throw new HTTPException(400, {
          message: 'Please connect your X account',
        })
      }

      const threadId = crypto.randomUUID()


      // Create all thread tweets in the database
      const createdTweets = await Promise.all(
        threadTweets.map(async (tweet, index) => {
          const tweetId = crypto.randomUUID()


          const [created] = await db
            .insert(tweets)
            .values({
              id: tweetId,
              accountId: account.id,
              userId: user.id,
              content: tweet.content,
              media: tweet.media || [],
              threadId,
              position: index,
              isThreadStart: index === 0,
              delayMs: tweet.delayMs || 0,
              isScheduled: false,
              isPublished: false,
            })
            .returning()


          return created
        }),
      )


      return c.json({ 
        success: true, 
        threadId, 
        tweets: createdTweets,
        message: `Thread created with ${createdTweets.length} tweets`
      })
    }),

  updateThread: privateProcedure
    .input(
      z.object({
        threadId: z.string(),
        tweets: z.array(
          z.object({
            id: z.string().optional(),
            content: z.string().min(1).max(280),
            media: z.array(
              z.object({
                media_id: z.string(),
                s3Key: z.string(),
              }),
            ).optional(),
            delayMs: z.number().default(0),
          }),
        ),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { threadId, tweets: updatedTweets } = input



      // Get existing thread tweets
      const existingTweets = await db.query.tweets.findMany({
        where: and(
          eq(tweets.threadId, threadId),
          eq(tweets.userId, user.id),
        ),
        orderBy: asc(tweets.position),
      })



      // Delete tweets that are no longer in the updated list
      const updatedIds = updatedTweets.filter(t => t.id).map(t => t.id)
      const toDelete = existingTweets.filter(t => !updatedIds.includes(t.id))
      
      for (const tweet of toDelete) {

        await db.delete(tweets).where(eq(tweets.id, tweet.id))
      }

      // Update or create tweets
      const results = await Promise.all(
        updatedTweets.map(async (tweet, index) => {
          if (tweet.id) {
            // Update existing tweet

            const [updated] = await db
              .update(tweets)
              .set({
                content: tweet.content,
                media: tweet.media || [],
                position: index,
                delayMs: tweet.delayMs || 0,
                updatedAt: new Date(),
              })
              .where(eq(tweets.id, tweet.id))
              .returning()
            return updated
          } else {
            // Create new tweet
            const tweetId = crypto.randomUUID()

            // Get account ID from existing tweets
            if (!existingTweets[0]) {
              throw new HTTPException(400, { message: 'Cannot add tweets to empty thread' })
            }
            const accountId = existingTweets[0].accountId
            
            const [created] = await db
              .insert(tweets)
              .values({
                id: tweetId,
                accountId,
                userId: user.id,
                content: tweet.content,
                media: tweet.media || [],
                threadId,
                position: index,
                isThreadStart: index === 0,
                delayMs: tweet.delayMs || 0,
                isScheduled: false,
                isPublished: false,
              })
              .returning()
            return created
          }
        }),
      )


      return c.json({ 
        success: true, 
        tweets: results,
        message: `Thread updated with ${results.length} tweets`
      })
    }),

  postThreadNow: privateProcedure
    .input(
      z.object({
        tweets: z.array(
          z.object({
            content: z.string().min(1).max(280),
            media: z.array(
              z.object({
                media_id: z.string(),
                s3Key: z.string(),
              }),
            ).optional(),
            delayMs: z.number().default(0),
          }),
        ),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { tweets: threadTweets } = input
      
      console.log('[postThreadNow] Starting thread post:', {
        userId: user.id,
        tweetCount: threadTweets.length,
        tweets: threadTweets.map((t, i) => ({
          index: i,
          contentLength: t.content.length,
          hasMedia: !!t.media && t.media.length > 0,
          mediaCount: t.media?.length || 0,
          delayMs: t.delayMs,
        })),
        timestamp: new Date().toISOString(),
      })

      const account = await getAccount({
        email: user.email,
      })

      if (!account?.id) {
        throw new HTTPException(400, {
          message: 'Please connect your X account',
        })
      }

      const threadId = crypto.randomUUID()

      // Create all thread tweets in the database
      const createdTweets = await Promise.all(
        threadTweets.map(async (tweet, index) => {
          const tweetId = crypto.randomUUID()

          const [created] = await db
            .insert(tweets)
            .values({
              id: tweetId,
              accountId: account.id,
              userId: user.id,
              content: tweet.content,
              media: tweet.media || [],
              threadId,
              position: index,
              isThreadStart: index === 0,
              delayMs: tweet.delayMs || 0,
              isScheduled: false,
              isPublished: false,
            })
            .returning()

          return created
        }),
      )

      // Get account with tokens
      const dbAccount = await db.query.account.findFirst({
        where: eq(accountSchema.id, account.id),
      })

      if (!dbAccount?.accessToken || !dbAccount?.accessSecret) {
        throw new HTTPException(400, {
          message: 'Please reconnect your Twitter account',
        })
      }

      // Check for Twitter API credentials
      if (!consumerKey || !consumerSecret) {
        console.error('[postThreadNow] Missing Twitter API credentials')
        throw new HTTPException(500, {
          message: 'Twitter API credentials not configured. Please check TWITTER_CONSUMER_KEY and TWITTER_CONSUMER_SECRET environment variables.',
        })
      }

      const client = new TwitterApi({
        appKey: consumerKey,
        appSecret: consumerSecret,
        accessToken: dbAccount.accessToken,
        accessSecret: dbAccount.accessSecret,
      })

      let previousTweetId: string | null = null
      const postedTweets = []

      for (const [index, tweet] of createdTweets.entries()) {
        if (!tweet) continue
        
        try {
          // Add delay between tweets
          if (index > 0 && tweet.delayMs && tweet.delayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, tweet.delayMs || 0))
          }

          const tweetPayload: SendTweetV2Params = {
            text: tweet.content,
          }

          // Add reply reference for thread continuation
          if (previousTweetId && index > 0) {
            tweetPayload.reply = {
              in_reply_to_tweet_id: previousTweetId,
            }
          }

          // Add media if present
          if (tweet.media && tweet.media.length > 0) {
            const mediaIds = tweet.media.map((media) => media.media_id)
            tweetPayload.media = {
              media_ids: mediaIds as any,
            }
          }

          console.log(`[postThreadNow] Posting tweet ${index + 1}:`, {
            content: tweet.content.substring(0, 50) + '...',
            hasReply: !!tweetPayload.reply,
            replyTo: previousTweetId,
            mediaIds: tweetPayload.media?.media_ids,
          })

          const res = await client.v2.tweet(tweetPayload)

          // Update database with Twitter ID
          await db
            .update(tweets)
            .set({
              isPublished: true,
              twitterId: res.data.id,
              replyToTweetId: previousTweetId,
              updatedAt: new Date(),
            })
            .where(eq(tweets.id, tweet.id))

          previousTweetId = res.data.id
          postedTweets.push(res.data)
        } catch (error) {
          console.error(`[postThreadNow] Error posting tweet ${index + 1}:`, error)
          
          // Extract error details for better debugging
          let errorMessage = `Failed to post tweet ${index + 1} in thread`
          
          if (error instanceof Error) {
            errorMessage += `: ${error.message}`
          }
          
          // Twitter API errors typically have more detailed information
          if (error && typeof error === 'object' && 'data' in error) {
            const apiError = error as any
            
            // Log rate limit details if available
            if (apiError.rateLimit) {
              console.log('[postThreadNow] Rate limit details:', {
                limit: apiError.rateLimit.limit,
                remaining: apiError.rateLimit.remaining,
                reset: new Date(apiError.rateLimit.reset * 1000).toISOString(),
                window: apiError.rateLimit.window,
              })
            }
            
            if (apiError.data?.detail) {
              errorMessage = `Twitter API error: ${apiError.data.detail}`
            }
            if (apiError.code === 429) {
              const resetTime = apiError.rateLimit?.reset 
                ? new Date(apiError.rateLimit.reset * 1000).toLocaleTimeString('en-US')
                : 'soon'
              throw new HTTPException(429, {
                message: `X rate limit exceeded. Try again after ${resetTime}.`,
              })
            }
          }
          
          throw new HTTPException(500, {
            message: errorMessage,
          })
        }
      }

      const threadUrl = postedTweets[0]
        ? `https://twitter.com/${account.username}/status/${postedTweets[0].id}`
        : undefined

      return c.json({ 
        success: true, 
        threadId,
        threadUrl,
        message: `Thread posted successfully with ${threadTweets.length} tweets`,
      })
    }),



  scheduleThread: privateProcedure
    .input(
      z.object({
        threadId: z.string(),
        scheduledUnix: z.number(),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { threadId, scheduledUnix } = input

      console.log('[scheduleThread] Starting thread scheduling:', {
        threadId,
        scheduledUnix,
        scheduledDate: new Date(scheduledUnix * 1000).toISOString(),
        userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })

      const account = await getAccount({
        email: user.email,
      })

      if (!account?.id) {
        throw new HTTPException(400, {
          message: 'Please connect your X account',
        })
      }

      const dbAccount = await db.query.account.findFirst({
        where: and(eq(accountSchema.userId, user.id), eq(accountSchema.id, account.id)),
      })

      if (!dbAccount || !dbAccount.accessToken) {
        throw new HTTPException(400, {
          message: 'X account not connected or access token missing',
        })
      }

      // Get all tweets in the thread
      const threadTweets = await db.query.tweets.findMany({
        where: and(
          eq(tweets.threadId, threadId),
          eq(tweets.userId, user.id),
        ),
        orderBy: asc(tweets.position),
      })

      if (threadTweets.length === 0) {
        throw new HTTPException(404, { message: 'Thread not found' })
      }

      // console.log('[scheduleThread] Scheduling', threadTweets.length, 'tweets')

      // For local development, skip QStash and just update the database
      let messageId = null
      
      if (process.env.NODE_ENV === 'development' || !process.env.WEBHOOK_URL) {
        // In development, generate a fake message ID
        messageId = `local-${Date.now()}-${Math.random().toString(36).substring(7)}`
        console.log('[scheduleThread] Local development - skipping QStash, using fake messageId:', messageId)
      } else {
        // In production, use QStash
        const baseUrl = process.env.WEBHOOK_URL
        const qstashResponse = await qstash.publishJSON({
          url: baseUrl + '/api/tweet/postThread',
          body: { threadId, userId: user.id, accountId: dbAccount.id },
          notBefore: scheduledUnix,
        })
        messageId = qstashResponse.messageId
      }

      // Update all tweets in the thread to scheduled
      console.log('[scheduleThread] Updating tweets with scheduled time:', {
        scheduledFor: new Date(scheduledUnix * 1000).toISOString(),
        scheduledUnixMillis: scheduledUnix * 1000,
      })
      
      await db
        .update(tweets)
        .set({
          isScheduled: true,
          scheduledFor: new Date(scheduledUnix * 1000),
          scheduledUnix: scheduledUnix * 1000,
          qstashId: messageId,
          updatedAt: new Date(),
        })
        .where(and(
          eq(tweets.threadId, threadId),
          eq(tweets.userId, user.id),
        ))

      console.log('[scheduleThread] Thread scheduled successfully:', {
        threadId,
        tweetCount: threadTweets.length,
        scheduledFor: new Date(scheduledUnix * 1000).toISOString(),
      })

      return c.json({
        success: true,
        threadId,
        scheduledFor: new Date(scheduledUnix * 1000),
        messageId,
        message: `Thread scheduled with ${threadTweets.length} tweets`,
      })
    }),

  enqueueThread: privateProcedure
    .input(
      z.object({
        threadId: z.string(),
        userNow: z.date(),
        timezone: z.string(),
      }),
    )
    .mutation(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { threadId, userNow, timezone } = input

      // console.log('[enqueueThread] Starting thread queue for threadId:', threadId)
      // console.log('[enqueueThread] User timezone:', timezone)

      console.log('[enqueueThread] Starting authentication checks for user:', user.email, 'at', new Date().toISOString())
      
      const account = await getAccount({
        email: user.email,
      })

      if (!account?.id) {
        console.log('[enqueueThread] No active account found for user:', user.email)
        throw new HTTPException(400, {
          message: 'Please connect your X account. Go to Settings to link your Twitter account.',
        })
      }

      console.log('[enqueueThread] Found active account:', account.id, 'username:', account.username)

      const dbAccount = await db.query.account.findFirst({
        where: and(eq(accountSchema.userId, user.id), eq(accountSchema.id, account.id)),
      })

      if (!dbAccount) {
        console.log('[enqueueThread] Database account not found for account ID:', account.id)
        throw new HTTPException(400, {
          message: 'X account database entry missing. Please reconnect your Twitter account in Settings.',
        })
      }

      if (!dbAccount.accessToken || !dbAccount.accessSecret) {
        console.log('[enqueueThread] Access tokens missing for account:', account.id, 'accessToken present:', Boolean(dbAccount.accessToken), 'accessSecret present:', Boolean(dbAccount.accessSecret))
        throw new HTTPException(400, {
          message: 'X account authentication incomplete. Please reconnect your Twitter account in Settings to complete the OAuth flow.',
        })
      }

      console.log('[enqueueThread] Authentication successful for account:', account.id)

      // Get user's posting window settings
      const userRecord = await db
        .select({
          postingWindowStart: userSchema.postingWindowStart,
          postingWindowEnd: userSchema.postingWindowEnd,
        })
        .from(userSchema)
        .where(eq(userSchema.id, user.id))
        .limit(1)
        .then(rows => rows[0])

      const postingWindowStart = userRecord?.postingWindowStart ?? 8 // Default 8am
      const postingWindowEnd = userRecord?.postingWindowEnd ?? 18 // Default 6pm

      console.log('[enqueueThread] User posting window:', postingWindowStart, '-', postingWindowEnd)

      // Get all tweets in the thread
      const threadTweets = await db.query.tweets.findMany({
        where: and(
          eq(tweets.threadId, threadId),
          eq(tweets.userId, user.id),
        ),
        orderBy: asc(tweets.position),
      })

      if (threadTweets.length === 0) {
        // console.log('[enqueueThread] No tweets found in thread')
        throw new HTTPException(404, { message: 'Thread not found' })
      }

      // console.log('[enqueueThread] Found tweets in thread:', threadTweets.length)

      // Get all scheduled tweets to check for conflicts
      const scheduledTweets = await db.query.tweets.findMany({
        where: and(eq(tweets.accountId, account.id), eq(tweets.isScheduled, true)),
        columns: { scheduledUnix: true },
      })

      function isSpotEmpty(time: Date) {
        const unix = time.getTime()
        return !Boolean(scheduledTweets.some((t) => t.scheduledUnix === unix))
      }

      function getNextAvailableSlot({
        userNow,
        timezone,
        maxDaysAhead,
        postingWindowStart,
        postingWindowEnd,
      }: {
        userNow: Date
        timezone: string
        maxDaysAhead: number
        postingWindowStart: number
        postingWindowEnd: number
      }) {
        for (let dayOffset = 0; dayOffset <= maxDaysAhead; dayOffset++) {
          let checkDay: Date | undefined = undefined

          if (dayOffset === 0) checkDay = startOfDay(userNow)
          else checkDay = startOfDay(addDays(userNow, dayOffset))

          // Generate hourly slots within the user's posting window
          for (let hour = postingWindowStart; hour < postingWindowEnd; hour++) {
            const localSlotTime = startOfHour(setHours(checkDay, hour))
            const slotTime = fromZonedTime(localSlotTime, timezone)

            if (isAfter(slotTime, userNow) && isSpotEmpty(slotTime)) {
              console.log('[enqueueThread] Found available slot:', slotTime, 'hour:', hour)
              return slotTime
            }
          }
        }

        return null // no slot found in next N days
      }

      const nextSlot = getNextAvailableSlot({ 
        userNow, 
        timezone, 
        maxDaysAhead: 90,
        postingWindowStart,
        postingWindowEnd 
      })

      // console.log('[enqueueThread] Next available slot:', nextSlot)

      if (!nextSlot) {
        throw new HTTPException(409, {
          message: 'Queue for the next 3 months is already full!',
        })
      }

      const scheduledUnix = nextSlot.getTime()

      // For local development, skip QStash and just update the database
      let messageId = null
      
      if (process.env.NODE_ENV === 'development' || !process.env.WEBHOOK_URL) {
        // In development, generate a fake message ID
        messageId = `local-${Date.now()}-${Math.random().toString(36).substring(7)}`
        console.log('[enqueueThread] Local development - skipping QStash, using fake messageId:', messageId)
      } else {
        // In production, use QStash
        const baseUrl = process.env.WEBHOOK_URL
        const qstashResponse = await qstash.publishJSON({
          url: baseUrl + '/api/tweet/postThread',
          body: { threadId, userId: user.id, accountId: dbAccount.id },
          notBefore: scheduledUnix / 1000, // needs to be in seconds
        })
        messageId = qstashResponse.messageId
      }

      // console.log('[enqueueThread] QStash message created:', messageId)

      try {
        // Update all tweets in the thread to queued
        await db
          .update(tweets)
          .set({
            isScheduled: true,
            isQueued: true,
            scheduledFor: new Date(scheduledUnix),
            scheduledUnix: scheduledUnix,
            qstashId: messageId,
            updatedAt: new Date(),
          })
          .where(and(
            eq(tweets.threadId, threadId),
            eq(tweets.userId, user.id),
          ))

        // console.log('[enqueueThread] Thread queued successfully')
      } catch (err) {
        // console.error('[enqueueThread] Database error:', err)
        const messages = qstash.messages

        try {
          await messages.delete(messageId)
        } catch (err) {
          // fail silently
          // console.error('[enqueueThread] Failed to delete QStash message:', err)
        }

        throw new HTTPException(500, { message: 'Problem with database' })
      }

      return c.json({
        success: true,
        threadId,
        scheduledUnix: scheduledUnix,
        accountId: account.id,
        accountName: account.name,
        message: `Thread queued with ${threadTweets.length} tweets`,
      })
    }),

  getThread: privateProcedure
    .input(
      z.object({
        threadId: z.string(),
      }),
    )
    .get(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { threadId } = input

      // console.log('[getThread] Fetching thread:', threadId)

      const threadTweets = await db.query.tweets.findMany({
        where: and(
          eq(tweets.threadId, threadId),
          eq(tweets.userId, user.id),
        ),
        orderBy: asc(tweets.position),
      })

      // console.log('[getThread] Found tweets:', threadTweets.length)

      // Fetch media URLs for each tweet
      const tweetsWithMedia = await Promise.all(
        threadTweets.map(async (tweet) => {
          const enrichedMedia = await fetchMediaFromS3(tweet.media || [])
          return {
            ...tweet,
            media: enrichedMedia,
          }
        }),
      )

      return c.json({
        threadId,
        tweets: tweetsWithMedia,
      })
    }),

  getThreads: privateProcedure.get(async ({ c, ctx }) => {
    const { user } = ctx

    // console.log('[getThreads] Fetching all threads for user:', user.id)

    // Get all tweets that are thread starts
    const threadStarts = await db.query.tweets.findMany({
      where: and(
        eq(tweets.userId, user.id),
        eq(tweets.isThreadStart, true),
      ),
      orderBy: desc(tweets.createdAt),
    })

    // console.log('[getThreads] Found thread starts:', threadStarts.length)

    // Get full thread data for each thread
    const threads = await Promise.all(
      threadStarts.map(async (start) => {
        const threadTweets = await db.query.tweets.findMany({
          where: and(
            eq(tweets.threadId, start.threadId!),
            eq(tweets.userId, user.id),
          ),
          orderBy: asc(tweets.position),
        })

        return {
          threadId: start.threadId,
          tweetCount: threadTweets.length,
          firstTweet: start,
          isScheduled: start.isScheduled,
          isPublished: start.isPublished,
          scheduledFor: start.scheduledFor,
          createdAt: start.createdAt,
        }
      }),
    )

    // console.log('[getThreads] Returning threads:', threads.length)
    return c.json({ threads })
  }),

  deleteThread: privateProcedure
    .input(
      z.object({
        threadId: z.string(),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { threadId } = input

      // console.log('[deleteThread] Deleting thread:', threadId)

      // Get all tweets in the thread
      const threadTweets = await db.query.tweets.findMany({
        where: and(
          eq(tweets.threadId, threadId),
          eq(tweets.userId, user.id),
        ),
      })

      if (threadTweets.length === 0) {
        throw new HTTPException(404, { message: 'Thread not found' })
      }

      // console.log('[deleteThread] Found tweets to delete:', threadTweets.length)

      // Cancel any scheduled QStash jobs
      const messages = qstash.messages
      for (const tweet of threadTweets) {
        if (tweet.qstashId) {
          // console.log('[deleteThread] Cancelling QStash job:', tweet.qstashId)
          try {
            await messages.delete(tweet.qstashId)
          } catch (err) {
            // console.error('[deleteThread] Failed to cancel QStash job:', err)
          }
        }
      }

      // Delete all tweets in the thread
      await db
        .delete(tweets)
        .where(and(
          eq(tweets.threadId, threadId),
          eq(tweets.userId, user.id),
        ))

      // console.log('[deleteThread] Thread deleted successfully')
      return c.json({ 
        success: true,
        message: `Thread deleted with ${threadTweets.length} tweets`,
      })
    }),

  // New endpoint for posting scheduled threads via QStash
  postThread: publicProcedure.post(async ({ c }) => {
    const body = await c.req.text()

    const signature =
      c.req.header('Upstash-Signature') ?? c.req.header('upstash-signature') ?? ''

    try {
      await receiver.verify({
        body,
        signature,
      })
    } catch (err) {
      throw new HTTPException(403, { message: 'Invalid credentials' })
    }

    const { threadId, userId, accountId } = JSON.parse(body) as {
      threadId: string
      userId: string
      accountId: string
    }

    // console.log('[postThread] Processing scheduled thread:', threadId)

    // Get all tweets in the thread
    const threadTweets = await db.query.tweets.findMany({
      where: and(
        eq(tweets.threadId, threadId),
        eq(tweets.isPublished, false),
      ),
      orderBy: asc(tweets.position),
    })

    if (threadTweets.length === 0) {
      // console.log('[postThread] No unpublished tweets found')
      return c.json({ success: true })
    }

    const account = await db.query.account.findFirst({
      where: and(
        eq(accountSchema.userId, userId),
        eq(accountSchema.id, accountId),
      ),
    })

    if (!account || !account.accessToken) {
      // console.log('[postThread] No account or access token')
      throw new HTTPException(400, {
        message: 'X account not connected or access token missing',
      })
    }

    const client = new TwitterApi({
      appKey: consumerKey as string,
      appSecret: consumerSecret as string,
      accessToken: account.accessToken as string,
      accessSecret: account.accessSecret as string,
    })

    let previousTweetId: string | null = null

    // Post each tweet in sequence
    for (const [index, tweet] of threadTweets.entries()) {
      // console.log(`[postThread] Posting tweet ${index + 1}/${threadTweets.length}`)

      try {
        // Wait for delay if specified (except for first tweet)
        if (index > 0 && tweet.delayMs && tweet.delayMs > 0) {
          // console.log(`[postThread] Waiting ${tweet.delayMs}ms`)
          await new Promise(resolve => setTimeout(resolve, tweet.delayMs!))
        }

        const tweetPayload: SendTweetV2Params = {
          text: tweet.content,
        }

        // Add reply_to for subsequent tweets
        if (previousTweetId && index > 0) {
          // console.log('[postThread] Adding reply_to:', previousTweetId)
          tweetPayload.reply = {
            in_reply_to_tweet_id: previousTweetId,
          }
        }

        // Add media if present
        if (tweet.media && tweet.media.length > 0) {
          tweetPayload.media = {
            // @ts-expect-error tuple type vs. string[]
            media_ids: tweet.media.map((media) => media.media_id),
          }
        }

        const res = await client.v2.tweet(tweetPayload)
        // console.log('[postThread] Tweet posted, ID:', res.data.id)

        // Update the tweet in the database
        await db
          .update(tweets)
          .set({
            isScheduled: false,
            isPublished: true,
            twitterId: res.data.id,
            replyToTweetId: previousTweetId,
            updatedAt: new Date(),
          })
          .where(eq(tweets.id, tweet.id))

        previousTweetId = res.data.id
      } catch (error) {
        // console.error(`[postThread] Failed to post tweet ${index + 1}:`, error)
        throw new HTTPException(500, {
          message: `Failed to post tweet ${index + 1} in thread`,
        })
      }
    }

    // console.log('[postThread] Thread posted successfully')
    return c.json({ success: true })
  }),

  // Fetch tweet metrics from Twitter API
  fetchTweetMetrics: privateProcedure
    .input(
      z.object({
        tweetIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { tweetIds } = input

      // console.log('[fetchTweetMetrics] Fetching metrics for tweets:', tweetIds)

      const account = await getAccount({
        email: user.email,
      })

      if (!account?.id) {
        throw new HTTPException(400, {
          message: 'Please connect your X account',
        })
      }

      const dbAccount = await db.query.account.findFirst({
        where: and(eq(accountSchema.userId, user.id), eq(accountSchema.id, account.id)),
      })

      if (!dbAccount || !dbAccount.accessToken) {
        throw new HTTPException(400, {
          message: 'X account not connected or access token missing',
        })
      }

      const client = new TwitterApi({
        appKey: consumerKey as string,
        appSecret: consumerSecret as string,
        accessToken: dbAccount.accessToken as string,
        accessSecret: dbAccount.accessSecret as string,
      })

      try {
        // Get tweets from our database first
        const dbTweets = await db.query.tweets.findMany({
          where: and(
            eq(tweets.userId, user.id),
            inArray(tweets.id, tweetIds),
          ),
        })

        // console.log('[fetchTweetMetrics] Found tweets in DB:', dbTweets.length)

        // Filter to only tweets that have Twitter IDs
        const tweetsWithTwitterIds = dbTweets.filter(t => t.twitterId)
        
        if (tweetsWithTwitterIds.length === 0) {
          // console.log('[fetchTweetMetrics] No tweets with Twitter IDs found')
          return c.json({ success: true, updatedCount: 0 })
        }

        // Fetch metrics from Twitter API (batch up to 100 tweets at a time)
        const batchSize = 100
        const updatePromises = []

        for (let i = 0; i < tweetsWithTwitterIds.length; i += batchSize) {
          const batch = tweetsWithTwitterIds.slice(i, i + batchSize)
          const twitterIds = batch.map(t => t.twitterId!).filter(Boolean)

          // console.log(`[fetchTweetMetrics] Fetching batch ${i / batchSize + 1}, tweets:`, twitterIds.length)

          try {
            // Fetch tweet metrics from Twitter API v2
            const twitterResponse = await client.v2.tweets(twitterIds, {
              'tweet.fields': ['public_metrics'],
            })

            // console.log(`[fetchTweetMetrics] Received metrics for ${twitterResponse.data?.length || 0} tweets`)

            // Update each tweet with its metrics
            if (twitterResponse.data) {
              for (const tweetData of twitterResponse.data) {
                const dbTweet = batch.find(t => t.twitterId === tweetData.id)
                if (dbTweet && tweetData.public_metrics) {
                  const updatePromise = db
                    .update(tweets)
                    .set({
                      likes: tweetData.public_metrics.like_count || 0,
                      retweets: tweetData.public_metrics.retweet_count || 0,
                      replies: tweetData.public_metrics.reply_count || 0,
                      impressions: tweetData.public_metrics.impression_count || 0,
                      metricsUpdatedAt: new Date(),
                      updatedAt: new Date(),
                    })
                    .where(eq(tweets.id, dbTweet.id))

                  updatePromises.push(updatePromise)
                }
              }
            }
          } catch (error) {
            // console.error(`[fetchTweetMetrics] Error fetching batch ${i / batchSize + 1}:`, error)
            // Continue with next batch even if one fails
          }
        }

        // Execute all updates
        await Promise.all(updatePromises)

        // console.log('[fetchTweetMetrics] Successfully updated metrics for', updatePromises.length, 'tweets')

        return c.json({ 
          success: true, 
          updatedCount: updatePromises.length,
          message: `Updated metrics for ${updatePromises.length} tweets`,
        })
      } catch (error) {
        // console.error('[fetchTweetMetrics] Failed to fetch metrics:', error)
        throw new HTTPException(500, {
          message: 'Failed to fetch tweet metrics from Twitter',
        })
      }
    }),


})
