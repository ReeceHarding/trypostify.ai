import { getBaseUrl } from '@/constants/base-url'
import { db } from '@/db'
import { tweets, user as userSchema, account as accountSchema } from '@/db/schema'
import { qstash } from '@/lib/qstash'
import { eq, and, asc } from 'drizzle-orm'
import crypto from 'crypto'
import { getAccount } from './get-account'

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

  const account = await getAccount({
    email: (await db.query.user.findFirst({
      where: eq(userSchema.id, userId),
      columns: { email: true }
    }))?.email!,
  })

  if (!account?.id) {
    throw new Error('Please connect your X account')
  }

  const threadId = crypto.randomUUID()
  console.log('[createThreadInternal] generated threadId', threadId)

  // Create all thread tweets in the database
  const createdTweets = []
  for (let i = 0; i < input.tweets.length; i++) {
    const tweetData = input.tweets[i]!
    const tweetId = crypto.randomUUID()

    const newTweet = {
      id: tweetId,
      threadId,
      content: tweetData.content,
      position: i,
      isThreadStart: i === 0,
      media: tweetData.media || [],
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
  }

  console.log('[createThreadInternal] success', {
    threadId,
    createdCount: createdTweets.length,
  })

  return { threadId }
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
