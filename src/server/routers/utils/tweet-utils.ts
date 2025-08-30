import { getBaseUrl } from '@/constants/base-url'
import { db } from '@/db'
import { tweets, user as userSchema, account as accountSchema } from '@/db/schema'
import { qstash } from '@/lib/qstash'
import { eq, and, asc } from 'drizzle-orm'
import crypto from 'crypto'
import { getAccount } from './get-account'
import {
  addDays,
  isAfter,
  startOfDay,
  startOfHour,
  setHours,
} from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'

/**
 * Internal function to create a thread directly (bypasses HTTP layer)
 * Used by schedule-tool.ts to avoid server-to-server fetch calls
 */
export async function createThreadInternal(input: {
  tweets: Array<{
    content: string
    media: Array<{
      s3Key: string
      media_id?: string
      url?: string
      type?: 'image' | 'gif' | 'video'
    }>
    delayMs?: number
  }>
}, userId: string): Promise<{ threadId: string }> {
  console.log('[createThreadInternal] invoked', {
    at: new Date().toISOString(),
    userId: userId,
    tweetsCount: input.tweets.length,
  })

  // Validate input
  if (!input.tweets || input.tweets.length === 0) {
    throw new Error('At least one tweet is required to create a thread')
  }

  if (!userId || typeof userId !== 'string') {
    throw new Error('Valid userId is required')
  }

  // Validate tweet content
  for (let i = 0; i < input.tweets.length; i++) {
    const tweet = input.tweets[i]
    if (!tweet) {
      throw new Error(`Tweet at position ${i} is null or undefined`)
    }
    if (!tweet.content || typeof tweet.content !== 'string') {
      throw new Error(`Tweet at position ${i} must have valid content`)
    }
    if (tweet.content.length > 280) {
      throw new Error(`Tweet at position ${i} exceeds 280 character limit`)
    }
    // Validate that tweet has either content or media
    if (tweet.content.trim().length === 0 && (!tweet.media || tweet.media.length === 0)) {
      throw new Error(`Tweet at position ${i} must have either content or media`)
    }
  }

  // Get user and account info
  const userRecord = await db.query.user.findFirst({
    where: eq(userSchema.id, userId),
    columns: { email: true }
  })

  if (!userRecord?.email) {
    throw new Error('User not found')
  }

  const account = await getAccount({
    email: userRecord.email,
  })

  if (!account?.id) {
    throw new Error('Please connect your X account')
  }

  const threadId = crypto.randomUUID()
  console.log('[createThreadInternal] generated threadId', threadId)

  // Create all thread tweets in the database with transaction-like behavior
  const createdTweets = []
  try {
    for (let i = 0; i < input.tweets.length; i++) {
      const tweetData = input.tweets[i]!
      const tweetId = crypto.randomUUID()

      // Transform media to match database schema
      const mediaForDb = (tweetData.media || []).map(m => ({
        s3Key: m.s3Key,
        media_id: m.media_id || '', // Will be filled when uploaded to Twitter
        url: m.url,
        type: m.type,
      }))

      const newTweet = {
        id: tweetId,
        threadId,
        content: tweetData.content,
        position: i,
        isThreadStart: i === 0,
        media: mediaForDb,
        delayMs: tweetData.delayMs || 0,
        userId: userId,
        accountId: account.id,
        createdAt: new Date(),
        updatedAt: new Date(),
        isScheduled: false,
        isPublished: false,
      }

      const [insertedTweet] = await db.insert(tweets).values(newTweet).returning()
      createdTweets.push(insertedTweet)
      
      console.log('[createThreadInternal] Created tweet:', {
        tweetId,
        position: i,
        contentLength: tweetData.content.length,
        mediaCount: mediaForDb.length
      })
    }

    console.log('[createThreadInternal] success', {
      threadId,
      createdCount: createdTweets.length,
    })

    return { threadId }
    
  } catch (error) {
    console.error('[createThreadInternal] Error creating tweets:', error)
    
    // Cleanup: try to delete any tweets that were created before the error
    if (createdTweets.length > 0) {
      try {
        await db.delete(tweets).where(eq(tweets.threadId, threadId))
        console.log('[createThreadInternal] Cleaned up partial thread after error')
      } catch (cleanupError) {
        console.error('[createThreadInternal] Failed to cleanup partial thread:', cleanupError)
      }
    }
    
    throw error
  }
}

/**
 * Internal function to schedule a thread directly (bypasses HTTP layer)  
 * Used by schedule-tool.ts to avoid server-to-server fetch calls
 */
export async function scheduleThreadInternal(input: {
  threadId: string
  scheduledUnix: number
}, userId: string): Promise<{ success: boolean; threadId: string; messageId?: string }> {
  const { threadId, scheduledUnix } = input
  
  console.log('[scheduleThreadInternal] Starting thread scheduling:', {
    threadId,
    scheduledUnix,
    scheduledDate: new Date(scheduledUnix * 1000).toISOString(),
  })

  // Get thread tweets
  const threadTweets = await db.query.tweets.findMany({
    where: eq(tweets.threadId, threadId),
    orderBy: [asc(tweets.position)],
  })

  if (!threadTweets.length) {
    throw new Error('Thread not found')
  }

  // For local development, skip QStash and just update the database
  let messageId = null
  if (process.env.NODE_ENV === 'development') {
    messageId = `dev-${Date.now()}-${Math.random().toString(36).substring(7)}`
    console.log('[scheduleThreadInternal] Local development - skipping QStash, using fake messageId:', messageId)
  } else {
    // In production, use QStash
    const baseUrl = process.env.WEBHOOK_URL || getBaseUrl()
    const qstashResponse = await qstash.publishJSON({
      url: `${baseUrl}/api/tweet/publishThread`,
      body: { threadId },
      notBefore: scheduledUnix,
    })
    messageId = qstashResponse.messageId
  }

  console.log('[scheduleThreadInternal] Updating tweets with scheduled time')

  // Update all tweets in the thread
  await db
    .update(tweets)
    .set({
      isScheduled: true,
      scheduledFor: new Date(scheduledUnix * 1000),
      scheduledUnix: scheduledUnix * 1000,
      qstashId: messageId,
      updatedAt: new Date(),
    })
    .where(eq(tweets.threadId, threadId))

  console.log('[scheduleThreadInternal] Thread scheduled successfully:', {
    threadId,
    tweetCount: threadTweets.length,
    scheduledFor: new Date(scheduledUnix * 1000).toISOString(),
  })

  return {
    success: true,
    threadId,
    messageId,
  }
}

/**
 * Internal function to enqueue a thread directly (bypasses HTTP layer)
 * Finds the next available slot and schedules the thread for posting.
 */
export async function enqueueThreadInternal(input: {
  threadId: string
  userId: string
  userNow: Date
  timezone: string
}): Promise<{ tweetCount: number; scheduledUnix: number; accountId: string; accountName: string; messageId: string | null }> {
  const { threadId, userId, userNow, timezone } = input

  console.log('[enqueueThreadInternal] Starting internal thread queue for threadId:', threadId)
  console.log('[enqueueThreadInternal] User timezone:', timezone)

  const userRecord = await db.query.user.findFirst({ where: eq(userSchema.id, userId) })
  if (!userRecord) throw new Error('User not found')

  const account = await getAccount({ email: userRecord.email })
  if (!account?.id) {
    throw new Error('Please connect your X account.')
  }

  const dbAccount = await db.query.account.findFirst({
    where: and(eq(accountSchema.userId, userId), eq(accountSchema.id, account.id)),
  })
  if (!dbAccount?.accessToken || !dbAccount?.accessSecret) {
    throw new Error('X account authentication incomplete.')
  }

  console.log('[enqueueThreadInternal] Authentication successful for account:', account.id)

  const threadTweets = await db.query.tweets.findMany({
    where: and(eq(tweets.threadId, threadId), eq(tweets.userId, userId)),
  })
  if (threadTweets.length === 0) {
    throw new Error('Thread not found or has no tweets')
  }

  console.log('[enqueueThreadInternal] Found tweets in thread:', threadTweets.length)

  const userSettings = await db.query.user.findFirst({
    where: eq(userSchema.id, userId),
    columns: {
      postingWindowStart: true,
      postingWindowEnd: true,
      frequency: true,
    },
  })

  const postingWindowStart = userSettings?.postingWindowStart ?? 8
  const postingWindowEnd = userSettings?.postingWindowEnd ?? 18
  const userFrequency = userSettings?.frequency ?? 3

  console.log('[enqueueThreadInternal] User posting window:', postingWindowStart, '-', postingWindowEnd)
  console.log('[enqueueThreadInternal] User frequency:', userFrequency, 'posts per day')

  const scheduledTweets = await db.query.tweets.findMany({
    where: and(eq(tweets.accountId, account.id), eq(tweets.isScheduled, true)),
    columns: { scheduledUnix: true },
  })

  function isSpotEmpty(time: Date) {
    const unix = time.getTime()
    return !scheduledTweets.some((t) => t.scheduledUnix === unix)
  }

  function getNextAvailableSlot() {
    // Get preset slots based on user frequency
    // 1 post per day: 10am
    // 2 posts per day: 10am, 12pm  
    // 3 posts per day: 10am, 12pm, 2pm
    let presetSlots: number[]
    if (userFrequency === 1) {
      presetSlots = [10] // Just 10am
    } else if (userFrequency === 2) {
      presetSlots = [10, 12] // 10am and noon
    } else {
      presetSlots = [10, 12, 14] // 10am, noon, 2pm (default for 3+ posts)
    }

    console.log('[enqueueThreadInternal] Using preset slots for', userFrequency, 'posts per day:', presetSlots)

    for (let dayOffset = 0; dayOffset <= 90; dayOffset++) {
      const checkDay = dayOffset === 0 ? startOfDay(userNow) : startOfDay(addDays(userNow, dayOffset))
      
      for (const hour of presetSlots) {
        const localSlotTime = startOfHour(setHours(checkDay, hour))
        const slotTime = fromZonedTime(localSlotTime, timezone)
        if (isAfter(slotTime, userNow) && isSpotEmpty(slotTime)) {
          console.log('[enqueueThreadInternal] Found available preset slot:', slotTime, 'hour:', hour)
          return slotTime
        }
      }
    }
    return null
  }

  const nextSlot = getNextAvailableSlot()
  if (!nextSlot) {
    throw new Error('Queue for the next 3 months is already full!')
  }

  const scheduledUnix = nextSlot.getTime()
  let messageId = null

  if (process.env.NODE_ENV === 'development' || !process.env.WEBHOOK_URL) {
    messageId = `local-${Date.now()}-${Math.random().toString(36).substring(7)}`
    console.log('[enqueueThreadInternal] Local development - skipping QStash, using fake messageId:', messageId)
  } else {
    const baseUrl = process.env.WEBHOOK_URL
    const qstashResponse = await qstash.publishJSON({
      url: baseUrl + '/api/tweet/postThread',
      body: { threadId, userId, accountId: dbAccount.id },
      notBefore: scheduledUnix / 1000,
    })
    messageId = qstashResponse.messageId
  }

  console.log('[enqueueThreadInternal] QStash message created:', messageId)

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
    .where(and(eq(tweets.threadId, threadId), eq(tweets.userId, userId)))

  console.log('[enqueueThreadInternal] Thread queued successfully')

  return {
    tweetCount: threadTweets.length,
    scheduledUnix,
    accountId: account.id,
    accountName: account.name,
    messageId,
  }
}
