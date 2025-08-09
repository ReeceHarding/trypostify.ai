import { getBaseUrl } from '@/constants/base-url'
import { db } from '@/db'
import { tweets, account as accountSchema } from '@/db/schema'
import { qstash } from '@/lib/qstash'
import { and, eq, asc, desc, isNotNull, notInArray } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { SendTweetV2Params, TwitterApi } from 'twitter-api-v2'
import { z } from 'zod'
import { j, privateProcedure } from '../jstack'
import { getAccount } from './utils/get-account'

const consumerKey = process.env.TWITTER_CONSUMER_KEY as string
const consumerSecret = process.env.TWITTER_CONSUMER_SECRET as string

// Helper to get full account data from database
async function getFullAccount(userId: string, email: string) {
  // First try to get the active account from Redis
  const activeAccount = await getAccount({ email })
  if (!activeAccount) {
    return null
  }

  // Then fetch the full account data from the database
  const dbAccount = await db.query.account.findFirst({
    where: and(
      eq(accountSchema.userId, userId),
      eq(accountSchema.id, activeAccount.id)
    ),
  })

  if (!dbAccount) {
    return null
  }

  // Combine Redis and database data
  return {
    ...dbAccount,
    name: activeAccount.name,
    username: activeAccount.username,
  }
}

export const threadRouter = j.router({
  createThread: privateProcedure
    .input(
      z.object({
        tweets: z.array(
          z.object({
            content: z.string().min(1).max(280),
            media: z
              .array(
                z.object({
                  s3Key: z.string(),
                  media_id: z.string(),
                }),
              )
              .default([]),
            delayMs: z.number().min(0).default(0),
          }),
        ).min(2), // At least 2 tweets for a thread
      }),
    )
    .post(async ({ c, ctx, input }) => {
      console.log('🧵 [createThread] Starting thread creation')
      const { user } = ctx
      const { tweets: threadTweets } = input

      const account = await getFullAccount(user.id, user.email)
      if (!account || !account.accessToken) {
        console.error('🔴 [createThread] No connected Twitter account found')
        throw new HTTPException(401, { message: 'No connected Twitter account' })
      }

      // Generate thread ID
      const threadId = crypto.randomUUID()
      console.log(`🧵 [createThread] Generated thread ID: ${threadId}`)

      // Create tweets in database
      const createdTweets = []
      for (let i = 0; i < threadTweets.length; i++) {
        const tweet = threadTweets[i]
        if (!tweet) continue // TypeScript safety check
        
        const tweetId = crypto.randomUUID()
        
        console.log(`📝 [createThread] Creating tweet ${i + 1}/${threadTweets.length} with ID: ${tweetId}`)
        
        const [createdTweet] = await db
          .insert(tweets)
          .values({
            id: tweetId,
            accountId: account.id,
            userId: user.id,
            content: tweet.content,
            media: tweet.media,
            threadId,
            position: i,
            isThreadStart: i === 0,
            delayMs: tweet.delayMs,
            isQueued: false,
            isScheduled: false,
            isPublished: false,
          })
          .returning()

        createdTweets.push(createdTweet)
      }

      console.log(`✅ [createThread] Successfully created ${createdTweets.length} tweets in thread`)

      return c.json({
        success: true,
        threadId,
        tweets: createdTweets,
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
      console.log('📅 [scheduleThread] Starting thread scheduling')
      const { user } = ctx
      const { threadId, scheduledUnix } = input

      const account = await getFullAccount(user.id, user.email)
      if (!account || !account.accessToken) {
        console.error('🔴 [scheduleThread] No connected Twitter account found')
        throw new HTTPException(401, { message: 'No connected Twitter account' })
      }

      // Fetch all tweets in the thread
      const threadTweets = await db.query.tweets.findMany({
        where: and(
          eq(tweets.threadId, threadId),
          eq(tweets.userId, user.id),
        ),
        orderBy: [asc(tweets.position)],
      })

      if (!threadTweets.length) {
        console.error(`🔴 [scheduleThread] No tweets found for thread ${threadId}`)
        throw new HTTPException(404, { message: 'Thread not found' })
      }

      console.log(`📊 [scheduleThread] Found ${threadTweets.length} tweets in thread`)

      // Schedule each tweet
      let currentScheduleTime = scheduledUnix
      const scheduledTweets = []

      for (const tweet of threadTweets) {
        console.log(`⏰ [scheduleThread] Scheduling tweet at position ${tweet.position}`)
        
        // Create QStash message for each tweet
        const { messageId } = await qstash.publishJSON({
          url: `${getBaseUrl()}/api/tweet/post`,
          body: JSON.stringify({
            tweetId: tweet.id,
            isThread: true,
            threadId: tweet.threadId,
            position: tweet.position,
          }),
          notBefore: currentScheduleTime / 1000, // QStash needs seconds
        })

        // Update tweet with schedule info
        await db
          .update(tweets)
          .set({
            isScheduled: true,
            scheduledFor: new Date(currentScheduleTime),
            scheduledUnix: currentScheduleTime,
            isQueued: true,
            qstashId: messageId,
          })
          .where(eq(tweets.id, tweet.id))

        scheduledTweets.push({
          id: tweet.id,
          position: tweet.position,
          scheduledFor: new Date(currentScheduleTime),
        })

        // Add delay for next tweet
        currentScheduleTime += tweet.delayMs || 0
      }

      console.log(`✅ [scheduleThread] Successfully scheduled ${scheduledTweets.length} tweets`)

      return c.json({
        success: true,
        threadId,
        scheduledTweets,
      })
    }),

  postThreadNow: privateProcedure
    .input(
      z.object({
        threadId: z.string(),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      console.log('🚀 [postThreadNow] Starting immediate thread posting')
      const { user } = ctx
      const { threadId } = input

      const account = await getFullAccount(user.id, user.email)
      if (!account || !account.accessToken) {
        console.error('🔴 [postThreadNow] No connected Twitter account found')
        throw new HTTPException(401, { message: 'No connected Twitter account' })
      }

      // Fetch all tweets in the thread
      const threadTweets = await db.query.tweets.findMany({
        where: and(
          eq(tweets.threadId, threadId),
          eq(tweets.userId, user.id),
        ),
        orderBy: [asc(tweets.position)],
      })

      if (!threadTweets.length) {
        console.error(`🔴 [postThreadNow] No tweets found for thread ${threadId}`)
        throw new HTTPException(404, { message: 'Thread not found' })
      }

      console.log(`📊 [postThreadNow] Found ${threadTweets.length} tweets to post`)

      // Initialize Twitter client
      const client = new TwitterApi({
        appKey: consumerKey,
        appSecret: consumerSecret,
        accessToken: account.accessToken as string,
        accessSecret: account.accessSecret as string,
      })

      const postedTweets = []
      let previousTweetId: string | null = null

      // Post each tweet in order
      for (let i = 0; i < threadTweets.length; i++) {
        const tweet = threadTweets[i]
        if (!tweet) continue // TypeScript safety check
        
        console.log(`📤 [postThreadNow] Posting tweet ${i + 1}/${threadTweets.length}`)

        // Wait for delay if not the first tweet
        if (i > 0 && tweet.delayMs && tweet.delayMs > 0) {
          console.log(`⏳ [postThreadNow] Waiting ${tweet.delayMs}ms before next tweet`)
          await new Promise((resolve) => setTimeout(resolve, tweet.delayMs!))
        }

        try {
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

          // Add reply reference if not the first tweet
          if (previousTweetId) {
            tweetPayload.reply = {
              in_reply_to_tweet_id: previousTweetId,
            }
          }

          console.log('📝 [postThreadNow] Tweet payload:', JSON.stringify(tweetPayload, null, 2))

          // Post to Twitter
          const res = await client.v2.tweet(tweetPayload)
          
          if (res.errors?.length) {
            console.error('⚠️ [postThreadNow] Twitter errors:', res.errors)
          }

          // Update tweet in database
          await db
            .update(tweets)
            .set({
              twitterId: res.data.id,
              replyToTweetId: previousTweetId,
              isPublished: true,
              isScheduled: false,
              isQueued: false,
              updatedAt: new Date(),
            })
            .where(eq(tweets.id, tweet.id))

          postedTweets.push({
            id: tweet.id,
            twitterId: res.data.id,
            position: tweet.position,
            url: `https://x.com/${account.name}/status/${res.data.id}`,
          })

          previousTweetId = res.data.id
          console.log(`✅ [postThreadNow] Successfully posted tweet ${i + 1}`)

        } catch (error) {
          console.error(`🔴 [postThreadNow] Failed to post tweet at position ${tweet.position}:`, error)
          
          // Return partial success if some tweets were posted
          if (postedTweets.length > 0) {
            return c.json({
              success: false,
              partial: true,
              threadId,
              postedTweets,
              error: `Failed at tweet ${i + 1}`,
              threadUrl: postedTweets[0]?.url,
            })
          }
          
          throw new HTTPException(500, { 
            message: `Failed to post thread: ${error instanceof Error ? error.message : 'Unknown error'}` 
          })
        }
      }

      console.log(`🎉 [postThreadNow] Successfully posted entire thread (${postedTweets.length} tweets)`)

      return c.json({
        success: true,
        threadId,
        postedTweets,
        threadUrl: postedTweets[0]?.url || '',
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

      console.log(`🔍 [getThread] Fetching thread ${threadId}`)

      const threadTweets = await db.query.tweets.findMany({
        where: and(
          eq(tweets.threadId, threadId),
          eq(tweets.userId, user.id),
        ),
        orderBy: [asc(tweets.position)],
      })

      if (!threadTweets.length) {
        console.error(`🔴 [getThread] Thread ${threadId} not found`)
        throw new HTTPException(404, { message: 'Thread not found' })
      }

      console.log(`✅ [getThread] Found ${threadTweets.length} tweets in thread`)

      return c.json({
        threadId,
        tweets: threadTweets,
      })
    }),

  updateThread: privateProcedure
    .input(
      z.object({
        threadId: z.string(),
        tweets: z.array(
          z.object({
            id: z.string().optional(), // For existing tweets
            content: z.string().min(1).max(280),
            media: z
              .array(
                z.object({
                  s3Key: z.string(),
                  media_id: z.string(),
                }),
              )
              .default([]),
            delayMs: z.number().min(0).default(0),
            position: z.number(),
          }),
        ),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      console.log('✏️ [updateThread] Starting thread update')
      const { user } = ctx
      const { threadId, tweets: updatedTweets } = input

      const account = await getFullAccount(user.id, user.email)
      if (!account || !account.accessToken) {
        console.error('🔴 [updateThread] No connected Twitter account found')
        throw new HTTPException(401, { message: 'No connected Twitter account' })
      }

      // Verify thread exists and belongs to user
      const existingThread = await db.query.tweets.findFirst({
        where: and(
          eq(tweets.threadId, threadId),
          eq(tweets.userId, user.id),
        ),
      })

      if (!existingThread) {
        console.error(`🔴 [updateThread] Thread ${threadId} not found`)
        throw new HTTPException(404, { message: 'Thread not found' })
      }

      // Check if thread is already published
      const publishedTweet = await db.query.tweets.findFirst({
        where: and(
          eq(tweets.threadId, threadId),
          eq(tweets.isPublished, true),
        ),
      })

      if (publishedTweet) {
        console.error('🔴 [updateThread] Cannot update published thread')
        throw new HTTPException(400, { message: 'Cannot update a published thread' })
      }

      // Delete existing tweets that are not in the update
      const existingTweetIds = updatedTweets
        .filter((t) => t.id)
        .map((t) => t.id!)

      if (existingTweetIds.length > 0) {
        await db
          .delete(tweets)
          .where(
            and(
              eq(tweets.threadId, threadId),
              notInArray(tweets.id, existingTweetIds)
            ),
          )
      } else {
        // Delete all tweets if no existing IDs provided
        await db.delete(tweets).where(eq(tweets.threadId, threadId))
      }

      // Update or create tweets
      const finalTweets = []
      for (const tweet of updatedTweets) {
        if (tweet.id) {
          // Update existing tweet
          console.log(`📝 [updateThread] Updating tweet ${tweet.id}`)
          await db
            .update(tweets)
            .set({
              content: tweet.content,
              media: tweet.media,
              delayMs: tweet.delayMs,
              position: tweet.position,
              updatedAt: new Date(),
            })
            .where(eq(tweets.id, tweet.id))
          
          finalTweets.push({ ...tweet, id: tweet.id })
        } else {
          // Create new tweet
          const newTweetId = crypto.randomUUID()
          console.log(`➕ [updateThread] Creating new tweet ${newTweetId}`)
          
          const [createdTweet] = await db
            .insert(tweets)
            .values({
              id: newTweetId,
              accountId: account.id,
              userId: user.id,
              content: tweet.content,
              media: tweet.media,
              threadId,
              position: tweet.position,
              isThreadStart: tweet.position === 0,
              delayMs: tweet.delayMs,
              isQueued: false,
              isScheduled: false,
              isPublished: false,
            })
            .returning()
          
          finalTweets.push(createdTweet)
        }
      }

      console.log(`✅ [updateThread] Successfully updated thread with ${finalTweets.length} tweets`)

      return c.json({
        success: true,
        threadId,
        tweets: finalTweets,
      })
    }),

  deleteThread: privateProcedure
    .input(
      z.object({
        threadId: z.string(),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      console.log('🗑️ [deleteThread] Starting thread deletion')
      const { user } = ctx
      const { threadId } = input

      // Check if thread exists and belongs to user
      const threadTweets = await db.query.tweets.findMany({
        where: and(
          eq(tweets.threadId, threadId),
          eq(tweets.userId, user.id),
        ),
      })

      if (!threadTweets.length) {
        console.error(`🔴 [deleteThread] Thread ${threadId} not found`)
        throw new HTTPException(404, { message: 'Thread not found' })
      }

      // Check if any tweet is published
      const publishedTweet = threadTweets.find((t) => t.isPublished)
      if (publishedTweet) {
        console.error('🔴 [deleteThread] Cannot delete published thread')
        throw new HTTPException(400, { message: 'Cannot delete a published thread' })
      }

      // Cancel any scheduled messages
      for (const tweet of threadTweets) {
        if (tweet.qstashId) {
          console.log(`🚫 [deleteThread] Canceling QStash message ${tweet.qstashId}`)
          try {
            await qstash.messages.delete(tweet.qstashId)
          } catch (err) {
            console.error(`⚠️ [deleteThread] Failed to delete QStash message:`, err)
            // Continue with deletion even if QStash deletion fails
          }
        }
      }

      // Delete all tweets in the thread
      await db.delete(tweets).where(eq(tweets.threadId, threadId))

      console.log(`✅ [deleteThread] Successfully deleted thread ${threadId} with ${threadTweets.length} tweets`)

      return c.json({
        success: true,
        deletedCount: threadTweets.length,
      })
    }),

  getThreads: privateProcedure
    .get(async ({ c, ctx }) => {
      const { user } = ctx

      console.log('📋 [getThreads] Fetching all threads for user')

      // Get unique thread IDs for the user
      const userTweets = await db.query.tweets.findMany({
        where: and(
          eq(tweets.userId, user.id),
          isNotNull(tweets.threadId),
          eq(tweets.isThreadStart, true)
        ),
        orderBy: [desc(tweets.createdAt)],
      })

      const threads = []
      for (const firstTweet of userTweets) {
        if (!firstTweet.threadId) continue

        // Get all tweets in this thread
        const threadTweets = await db.query.tweets.findMany({
          where: eq(tweets.threadId, firstTweet.threadId),
          orderBy: [asc(tweets.position)],
        })

        threads.push({
          threadId: firstTweet.threadId,
          tweetCount: threadTweets.length,
          firstTweet: threadTweets[0],
          isScheduled: threadTweets.some(t => t.isScheduled),
          isPublished: threadTweets.some(t => t.isPublished),
          scheduledFor: threadTweets[0]?.scheduledFor,
          createdAt: threadTweets[0]?.createdAt,
        })
      }

      console.log(`✅ [getThreads] Found ${threads.length} threads`)

      return c.json({
        threads,
      })
    }),
})
