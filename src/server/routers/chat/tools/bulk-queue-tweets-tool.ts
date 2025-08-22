import { tool, UIMessageStreamWriter } from 'ai'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { redis } from '../../../../lib/redis'
import { format, addDays, startOfDay, startOfHour, setHours, isAfter, addMinutes } from 'date-fns'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import { db } from '../../../../db'
import { tweets, account as accountSchema, user as userSchema } from '../../../../db/schema'
import { and, eq, asc } from 'drizzle-orm'
import { qstash } from '../../../../lib/qstash'
import { getAccount } from '../../utils/get-account'

export const createBulkQueueTweetsTool = (
  writer: UIMessageStreamWriter,
  userId: string,
  accountId: string,
  conversationContext?: string,
  chatId?: string
) => {
  return tool({
    description: 'Queue multiple tweets at once with automatic scheduling and conflict resolution. Use this when user wants to queue all generated tweets.',
    inputSchema: z.object({
      tweetIds: z.array(z.string()).optional().describe('Specific tweet IDs to queue. If not provided, queues all cached tweets'),
      spacing: z.enum(['hourly', 'daily', 'optimal']).default('optimal')
        .describe('How to space tweets: hourly (1 per hour), daily (spread across days), optimal (based on user settings)'),
    }),
    execute: async ({ tweetIds, spacing = 'optimal' }) => {
      const toolId = nanoid()
      
      try {
        console.log('[BULK_QUEUE_TWEETS_TOOL] ===== TOOL CALLED =====')
        console.log('[BULK_QUEUE_TWEETS_TOOL] Tweet IDs:', tweetIds)
        console.log('[BULK_QUEUE_TWEETS_TOOL] Spacing:', spacing)
        console.log('[BULK_QUEUE_TWEETS_TOOL] Timestamp:', new Date().toISOString())
        
        // Get cached tweets
        let tweetsToQueue = []
        if (chatId) {
          try {
            // First try bulk tweets cache
            const cached = await redis.get(`chat:bulk-tweets:${chatId}`)
            if (cached) {
              // Handle both string and object returns from Redis
              tweetsToQueue = typeof cached === 'string' ? JSON.parse(cached) : cached
              console.log('[BULK_QUEUE_TWEETS_TOOL] Loaded', tweetsToQueue.length, 'cached bulk tweets')
            }
          } catch (err) {
            console.error('[BULK_QUEUE_TWEETS_TOOL] Failed to load cached tweets:', err)
          }
        }

        // If no bulk tweets, extract from conversation
        if (!tweetsToQueue.length && conversationContext) {
          console.log('[BULK_QUEUE_TWEETS_TOOL] No cached bulk tweets, extracting from conversation')
          // Look for tweet content in conversation data-tool-output
          const tweetMatches = conversationContext.match(/"text"\s*:\s*"([^"]+)"/g) || []
          tweetsToQueue = tweetMatches.map((match, index) => ({
            id: nanoid(),
            text: match.replace(/"text"\s*:\s*"/, '').replace(/"$/, ''),
            index,
          }))
          console.log('[BULK_QUEUE_TWEETS_TOOL] Extracted', tweetsToQueue.length, 'tweets from conversation')
        }

        if (!tweetsToQueue.length) {
          throw new Error('No tweets found to queue. Please generate tweets first.')
        }

        // Filter tweets if specific IDs provided
        if (tweetIds && tweetIds.length > 0) {
          tweetsToQueue = tweetsToQueue.filter(tweet => tweetIds.includes(tweet.id))
        }

        // Remove any tweets marked as original in variations
        tweetsToQueue = tweetsToQueue.filter(tweet => !tweet.isOriginal)

        if (!tweetsToQueue.length) {
          throw new Error('No tweets to queue after filtering.')
        }

        // Send initial status
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: `Queueing ${tweetsToQueue.length} tweets...`,
            status: 'processing',
            queuedCount: 0,
            totalCount: tweetsToQueue.length,
          },
        })

        // Get user settings
        const userRecord = await db
          .select({
            postingWindowStart: userSchema.postingWindowStart,
            postingWindowEnd: userSchema.postingWindowEnd,
            frequency: userSchema.frequency,
          })
          .from(userSchema)
          .where(eq(userSchema.id, userId))
          .limit(1)
          .then(rows => rows[0])

        const postingWindowStart = userRecord?.postingWindowStart ?? 8
        const postingWindowEnd = userRecord?.postingWindowEnd ?? 18
        const userFrequency = userRecord?.frequency ?? 3

        console.log('[BULK_QUEUE_TWEETS_TOOL] User settings:', {
          postingWindowStart,
          postingWindowEnd,
          userFrequency,
        })

        // Get account info
        const account = await getAccount({ email: (await db.query.user.findFirst({ where: eq(userSchema.id, userId) }))?.email || '' })
        if (!account?.id) {
          throw new Error('No active X account found')
        }

        const dbAccount = await db.query.account.findFirst({
          where: and(eq(accountSchema.userId, userId), eq(accountSchema.id, account.id)),
        })

        if (!dbAccount || !dbAccount.accessToken || !dbAccount.accessSecret) {
          throw new Error('X account not properly connected')
        }

        // Get all scheduled tweets to check for conflicts
        const scheduledTweets = await db.query.tweets.findMany({
          where: and(eq(tweets.accountId, account.id), eq(tweets.isScheduled, true)),
          columns: { scheduledUnix: true },
        })

        const occupiedSlots = new Set(scheduledTweets.map(t => t.scheduledUnix))
        
        // Get user timezone
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
        const userNow = new Date()

        // Calculate slots based on spacing strategy
        const slots: Date[] = []
        let currentTime = new Date(userNow)
        
        if (spacing === 'hourly') {
          // Schedule one per hour starting from next hour
          currentTime = startOfHour(addMinutes(currentTime, 60))
          for (let i = 0; i < tweetsToQueue.length; i++) {
            while (occupiedSlots.has(currentTime.getTime())) {
              currentTime = addMinutes(currentTime, 60)
            }
            slots.push(new Date(currentTime))
            currentTime = addMinutes(currentTime, 60)
          }
        } else if (spacing === 'daily') {
          // Schedule tweets spread across days at optimal times
          const optimalHours = userFrequency === 1 ? [12] : userFrequency === 2 ? [10, 14] : [10, 12, 14]
          let dayOffset = 0
          let hourIndex = 0
          
          for (let i = 0; i < tweetsToQueue.length; i++) {
            let found = false
            while (!found) {
              const checkDay = startOfDay(addDays(userNow, dayOffset))
              const hour = optimalHours[hourIndex % optimalHours.length]
              const localSlotTime = startOfHour(setHours(checkDay, hour))
              const slotTime = fromZonedTime(localSlotTime, timezone)
              
              if (isAfter(slotTime, userNow) && !occupiedSlots.has(slotTime.getTime())) {
                slots.push(slotTime)
                found = true
              }
              
              hourIndex++
              if (hourIndex >= optimalHours.length) {
                hourIndex = 0
                dayOffset++
              }
            }
          }
        } else {
          // Optimal spacing based on user frequency
          const minutesBetweenPosts = Math.max(60, Math.floor((24 * 60) / userFrequency / 2))
          currentTime = startOfHour(addMinutes(currentTime, 60))
          
          for (let i = 0; i < tweetsToQueue.length; i++) {
            // Find next available slot
            while (true) {
              const hour = currentTime.getHours()
              const withinWindow = hour >= postingWindowStart && hour < postingWindowEnd
              const notOccupied = !occupiedSlots.has(currentTime.getTime())
              
              if (withinWindow && notOccupied && isAfter(currentTime, userNow)) {
                slots.push(new Date(currentTime))
                currentTime = addMinutes(currentTime, minutesBetweenPosts)
                break
              } else {
                currentTime = addMinutes(currentTime, 30)
                // Skip to next day's posting window if we're past today's window
                if (hour >= postingWindowEnd) {
                  currentTime = startOfHour(setHours(addDays(startOfDay(currentTime), 1), postingWindowStart))
                }
              }
            }
          }
        }

        console.log('[BULK_QUEUE_TWEETS_TOOL] Generated', slots.length, 'time slots')

        // Create individual threads for each tweet and queue them
        const queuedTweets = []
        let successCount = 0
        
        for (let i = 0; i < tweetsToQueue.length; i++) {
          const tweet = tweetsToQueue[i]
          const slot = slots[i]
          
          if (!slot) {
            console.warn('[BULK_QUEUE_TWEETS_TOOL] No slot available for tweet:', i)
            continue
          }

          try {
            const threadId = crypto.randomUUID()
            const scheduledUnix = slot.getTime()
            
            // Create QStash message
            let messageId = null
            if (process.env.NODE_ENV === 'development' || !process.env.WEBHOOK_URL) {
              messageId = `local-${Date.now()}-${Math.random().toString(36).substring(7)}`
            } else {
              const baseUrl = process.env.WEBHOOK_URL
              const qstashResponse = await qstash.publishJSON({
                url: baseUrl + '/api/tweet/postThread',
                body: { threadId, userId, accountId: dbAccount.id },
                notBefore: scheduledUnix / 1000, // needs to be in seconds
              })
              messageId = qstashResponse.messageId
            }
            
            // Insert tweet into database
            const [created] = await db
              .insert(tweets)
              .values({
                id: crypto.randomUUID(),
                accountId: account.id,
                userId: userId,
                content: tweet.text,
                media: [],
                threadId,
                position: 0,
                isThreadStart: true,
                delayMs: 0,
                isScheduled: true,
                isQueued: true,
                scheduledFor: new Date(scheduledUnix),
                scheduledUnix: scheduledUnix,
                qstashId: messageId,
                isPublished: false,
              })
              .returning()
            
            queuedTweets.push({
              ...tweet,
              scheduledFor: slot,
              threadId,
            })
            
            successCount++
            
            // Update progress
            writer.write({
              type: 'data-tool-output',
              id: toolId,
              data: {
                text: `Queued ${successCount} of ${tweetsToQueue.length} tweets...`,
                status: 'processing',
                queuedCount: successCount,
                totalCount: tweetsToQueue.length,
              },
            })
            
          } catch (err) {
            console.error('[BULK_QUEUE_TWEETS_TOOL] Failed to queue tweet:', i, err)
          }
        }

        // Send final result
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: `Successfully queued ${successCount} tweets`,
            status: 'complete',
            queuedCount: successCount,
            totalCount: tweetsToQueue.length,
            queuedTweets: queuedTweets,
            nextSlot: slots[0] ? format(slots[0], 'PPp') : 'N/A',
          },
        })

        console.log('[BULK_QUEUE_TWEETS_TOOL] Tool execution complete, queued:', successCount)
        return { success: true, queuedCount: successCount, queuedTweets }
        
      } catch (error) {
        console.error('[BULK_QUEUE_TWEETS_TOOL] Error:', error)
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: `Error queueing tweets: ${(error as Error).message}`,
            status: 'error',
            queuedCount: 0,
          },
        })
        throw error
      }
    },
  })
}
