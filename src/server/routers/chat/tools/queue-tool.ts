import { tool, UIMessageStreamWriter } from 'ai'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { redis } from '../../../../lib/redis'
import { format, addDays, startOfDay, startOfHour, setHours, isAfter } from 'date-fns'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import { db } from '../../../../db'
import { tweets, account as accountSchema, user as userSchema } from '../../../../db/schema'
import { and, eq, asc } from 'drizzle-orm'
import { qstash } from '../../../../lib/qstash'
import { getAccount } from '../../utils/get-account'
import { HTTPException } from 'hono/http-exception'

export const createQueueTool = (
  writer: UIMessageStreamWriter,
  userId: string,
  accountId: string,
  conversationContext?: string,
  chatId?: string
) => {
  return tool({
    description: 'Add tweet(s) to the queue for automatic scheduling at the next available slot. Can handle single tweets or bulk operations. If content is not provided, uses tweet(s) from the conversation.',
    inputSchema: z.object({
      content: z.string().optional().describe('The tweet content to queue. If not provided, uses the most recent tweet from conversation'),
      bulkMode: z.boolean().optional().describe('If true, queues ALL recent tweets from conversation instead of just the last one'),
      media: z.array(z.object({
        s3Key: z.string(),
        url: z.string().optional(),
        type: z.enum(['image', 'gif', 'video']).optional()
      })).optional().describe('Optional media attachments'),
      isThread: z.boolean().optional().describe('Whether this is part of a thread'),
      additionalTweets: z.array(z.object({
        content: z.string(),
        media: z.array(z.object({
          s3Key: z.string(),
          url: z.string().optional(),
          type: z.enum(['image', 'gif', 'video']).optional()
        })).optional(),
        delayMs: z.number().optional()
      })).optional().describe('Additional tweets for thread')
    }),
    execute: async ({ content, bulkMode = false, media = [], isThread = false, additionalTweets = [] }) => {
      const toolId = nanoid()
      
      try {
        console.log('[QUEUE_TOOL] ===== TOOL CALLED =====')
        console.log('[QUEUE_TOOL] Content provided:', content)
        console.log('[QUEUE_TOOL] Bulk mode:', bulkMode)
        console.log('[QUEUE_TOOL] Has conversation context:', !!conversationContext)
        console.log('[QUEUE_TOOL] Has media:', !!media?.length)
        console.log('[QUEUE_TOOL] Is thread:', isThread)
        console.log('[QUEUE_TOOL] Additional tweets:', additionalTweets?.length || 0)
        console.log('[QUEUE_TOOL] Timestamp:', new Date().toISOString())
        
        // Array to hold all tweets to queue
        let tweetsToQueue: Array<{ content: string, media: any[], delayMs?: number }> = []
        
        if (bulkMode && conversationContext) {
          // Extract ALL recent tweets from conversation
          console.log('[QUEUE_TOOL] Bulk mode - extracting all recent tweets from conversation')
          
          // Find all data-tool-output entries with tweet text
          const tweetMatches = conversationContext.matchAll(/"type"\s*:\s*"data-tool-output"[^}]*?"data"\s*:\s*\{[^}]*?"text"\s*:\s*"([^"]+)"/g)
          
          for (const match of tweetMatches) {
            if (match[1] && match[1].length > 10) { // Skip very short texts
              tweetsToQueue.push({ content: match[1], media: [] })
              console.log('[QUEUE_TOOL] Found tweet in conversation:', match[1].substring(0, 50) + '...')
            }
          }
          
          // Also try to find tweets in a more structured way
          if (tweetsToQueue.length === 0) {
            // Look for tweet-like content in the conversation
            const lines = conversationContext.split('\n')
            for (const line of lines) {
              const trimmedLine = line.trim()
              // Skip metadata, tool outputs, and very short lines
              if (trimmedLine.length > 20 && 
                  !trimmedLine.includes('Tool called:') && 
                  !trimmedLine.includes('Assistant:') &&
                  !trimmedLine.includes('User:') &&
                  !trimmedLine.includes('{') &&
                  !trimmedLine.includes('}') &&
                  !trimmedLine.includes('**') &&
                  !trimmedLine.includes('![') &&
                  !trimmedLine.includes('](')) {
                // This looks like tweet content
                tweetsToQueue.push({ content: trimmedLine, media: [] })
                console.log('[QUEUE_TOOL] Found potential tweet:', trimmedLine.substring(0, 50) + '...')
              }
            }
          }
          
          console.log('[QUEUE_TOOL] Total tweets found for bulk queueing:', tweetsToQueue.length)
          
          if (tweetsToQueue.length === 0) {
            throw new Error('No tweets found in the conversation to queue. Please generate some tweets first.')
          }
        } else {
          // Single tweet mode - existing logic
          let finalContent = content
          if (!finalContent && chatId) {
            try {
              const cached = await redis.get<string>(`chat:last-tweet:${chatId}`)
              if (cached && cached.trim().length > 0) {
                finalContent = cached
                console.log('[QUEUE_TOOL] Loaded tweet from cache for chat:', chatId, 'Content length:', cached.length, 'Content preview:', cached.substring(0, 100) + '...')
              }
            } catch (cacheErr) {
              console.warn('[QUEUE_TOOL] Failed to read cached tweet:', (cacheErr as Error)?.message)
            }
          }
        
          // Fallback to conversation context extraction if cache is empty
          if (!finalContent && conversationContext) {
            console.log('[QUEUE_TOOL] No cached content, extracting from conversation context')
            
            // Look for the most recent tweet in the conversation
            // Try multiple patterns to find tweet content
            
            // Pattern 1: Look for tool output with text field (improved regex)
            let tweetMatch = conversationContext.match(/"text"\s*:\s*"([^"]{20,}?)"/i)
            
            // Pattern 2: If not found, look for text in conversation that looks like a tweet
            if (!tweetMatch || !tweetMatch[1]) {
              // Find the last assistant message with tweet-like content
              const lines = conversationContext.split('\n')
              for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i]?.trim() || ''
                // Skip short lines, tool outputs, system messages, and markdown content
                if (line.length > 20 && 
                    !line.includes('Tool called:') && 
                    !line.includes('Assistant:') &&
                    !line.includes('User:') &&
                    !line.includes('{') &&
                    !line.includes('}') &&
                    !line.includes('![') && // Skip markdown images
                    !line.includes('](') && // Skip markdown links
                    !line.includes('**') && // Skip markdown bold
                    !line.includes('*') && // Skip markdown italic
                    !line.includes('https://') && // Skip all URLs
                    !line.includes('<') && // Skip HTML tags
                    !line.includes('>')) { // Skip HTML tags
                  finalContent = line
                  console.log('[QUEUE_TOOL] Extracted tweet from conversation line:', finalContent)
                  break
                }
              }
            } else if (tweetMatch && tweetMatch[1]) {
              finalContent = tweetMatch[1]
              console.log('[QUEUE_TOOL] Extracted tweet from tool output:', finalContent)
            }
          }
          
          if (!finalContent) {
            throw new Error('No tweet content provided and could not find a recent tweet in the conversation')
          }
          
          // In single mode, we have just one tweet
          tweetsToQueue = [{ content: finalContent, media: media || [] }]
        }
        
        // Send initial status
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: bulkMode ? `Finding slots for ${tweetsToQueue.length} tweets...` : 'Finding next available slot...',
            status: 'processing',
          },
        })

        console.log('[QUEUE_TOOL] Queueing', tweetsToQueue.length, 'tweet(s)')

        // Get user's timezone
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
        const userNow = new Date()

        // Store created tweet info for later use
        const queuedTweets: Array<{ threadId: string, content: string }> = []

        // In bulk mode, create separate threads for each tweet
        // In single mode or thread mode, create one thread with all tweets
        if (bulkMode) {
          // Create separate single-tweet threads for each tweet
          for (const tweet of tweetsToQueue) {
            const threadId = crypto.randomUUID()
            const tweetId = crypto.randomUUID()
            console.log('[QUEUE_TOOL] Creating single-tweet thread', { threadId, tweetId, contentLength: tweet.content.length })

            // Transform media to match database schema
            const mediaForDb = (tweet.media || []).map(m => ({
              s3Key: m.s3Key,
              media_id: '', // Will be filled when uploaded to Twitter
            }))

            await db
              .insert(tweets)
              .values({
                id: tweetId,
                threadId: threadId,
                content: tweet.content,
                media: mediaForDb,
                userId: userId,
                accountId: accountId,
                position: 0,
                isThreadStart: true,
                delayMs: 0,
                isScheduled: false,
                isPublished: false,
                createdAt: new Date(),
                updatedAt: new Date(),
              })

            queuedTweets.push({ threadId, content: tweet.content })
            console.log('[QUEUE_TOOL] Single-tweet thread created:', { threadId })
          }
        } else {
          // Single mode or thread mode - create one thread with all tweets
          const threadId = crypto.randomUUID()
          console.log('[QUEUE_TOOL] Generated threadId:', threadId)
          
          // Insert tweets into database
          const createdTweets = await Promise.all(
            tweetsToQueue.map(async (tweet, index) => {
              const tweetId = crypto.randomUUID()
              console.log('[QUEUE_TOOL] Creating tweet', { tweetId, position: index, contentLength: tweet.content.length })

              // Transform media to match database schema
              const mediaForDb = (tweet.media || []).map(m => ({
                s3Key: m.s3Key,
                media_id: '', // Will be filled when uploaded to Twitter
              }))

              const [created] = await db
                .insert(tweets)
                .values({
                  id: tweetId,
                  threadId: threadId,
                  content: tweet.content,
                  media: mediaForDb,
                  userId: userId,
                  accountId: accountId,
                  position: index,
                  isThreadStart: index === 0,
                  delayMs: tweet.delayMs || 0,
                  isScheduled: false,
                  isPublished: false,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                })
                .returning()

              console.log('[QUEUE_TOOL] Tweet created in database:', { tweetId, threadId, position: index })
              return created
            }),
          )

          console.log('[QUEUE_TOOL] Thread created with ID:', threadId, 'with', createdTweets.length, 'tweets')
          queuedTweets.push({ threadId, content: tweetsToQueue[0]?.content || '' })
        }

        // Update status
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: 'Adding to queue...',
            status: 'processing',
          },
        })

        // Now enqueue the thread directly using database operations
        console.log('[QUEUE_TOOL] Starting authentication checks for user:', userId, 'at', new Date().toISOString())
        
        // Get the account information (same pattern as enqueueThread)
        const userRecord = await db
          .select()
          .from(userSchema)
          .where(eq(userSchema.id, userId))
          .limit(1)
          .then(rows => rows[0])
        
        if (!userRecord) {
          throw new Error('User not found')
        }
        
        const account = await getAccount({
          email: userRecord.email,
        })

        if (!account?.id) {
          console.log('[QUEUE_TOOL] No active account found for user:', userRecord.email)
          throw new Error('Please connect your X account. Go to Settings to link your Twitter account.')
        }

        console.log('[QUEUE_TOOL] Found active account:', account.id, 'username:', account.username)

        const dbAccount = await db
          .select()
          .from(accountSchema)
          .where(and(eq(accountSchema.userId, userId), eq(accountSchema.id, account.id)))
          .limit(1)
          .then(rows => rows[0])

        if (!dbAccount) {
          console.log('[QUEUE_TOOL] Database account not found for account ID:', account.id)
          throw new Error('X account database entry missing. Please reconnect your Twitter account in Settings.')
        }

        if (!dbAccount.accessToken || !dbAccount.accessSecret) {
          console.log('[QUEUE_TOOL] Access tokens missing for account:', account.id, 'accessToken present:', Boolean(dbAccount.accessToken), 'accessSecret present:', Boolean(dbAccount.accessSecret))
          throw new Error('X account authentication incomplete. Please reconnect your Twitter account in Settings to complete the OAuth flow.')
        }

        console.log('[QUEUE_TOOL] Authentication successful for account:', account.id)

        // Get user's frequency and posting window settings
        const userSettings = await db
          .select({
            postingWindowStart: userSchema.postingWindowStart,
            postingWindowEnd: userSchema.postingWindowEnd,
            frequency: userSchema.frequency,
          })
          .from(userSchema)
          .where(eq(userSchema.id, userId))
          .limit(1)
          .then(rows => rows[0])

        const postingWindowStart = userSettings?.postingWindowStart ?? 8 // Default 8am
        const postingWindowEnd = userSettings?.postingWindowEnd ?? 18 // Default 6pm
        const userFrequency = userSettings?.frequency ?? 3 // Default 3 posts per day

        console.log('[QUEUE_TOOL] User posting window:', postingWindowStart, '-', postingWindowEnd)
        console.log('[QUEUE_TOOL] User frequency:', userFrequency, 'posts per day')

        // Get all scheduled tweets to check for conflicts
        const scheduledTweets = await db
          .select({ scheduledUnix: tweets.scheduledUnix })
          .from(tweets)
          .where(and(eq(tweets.accountId, account.id), eq(tweets.isScheduled, true)))

        function isSpotEmpty(time: Date) {
          const unix = time.getTime()
          return !Boolean(scheduledTweets.some((t: { scheduledUnix: number | null }) => t.scheduledUnix === unix))
        }

        function getNextAvailableSlot({
          userNow,
          timezone,
          maxDaysAhead,
          userFrequency,
        }: {
          userNow: Date
          timezone: string
          maxDaysAhead: number
          userFrequency: number
        }) {
          // Get preset slots based on user frequency
          // 1 post per day: noon (12pm)
          // 2 posts per day: 10am, 12pm  
          // 3 posts per day: 10am, 12pm, 2pm
          let presetSlots: number[]
          if (userFrequency === 1) {
            presetSlots = [12] // Just noon
          } else if (userFrequency === 2) {
            presetSlots = [10, 12] // 10am and noon
          } else {
            presetSlots = [10, 12, 14] // 10am, noon, 2pm (default for 3+ posts)
          }

          console.log('[QUEUE_TOOL] Using preset slots for', userFrequency, 'posts per day:', presetSlots)

          for (let dayOffset = 0; dayOffset <= maxDaysAhead; dayOffset++) {
            let checkDay: Date | undefined = undefined

            if (dayOffset === 0) checkDay = startOfDay(userNow)
            else checkDay = startOfDay(addDays(userNow, dayOffset))

            // Check preset slots for this day
            for (const hour of presetSlots) {
              const localSlotTime = startOfHour(setHours(checkDay, hour))
              const slotTime = fromZonedTime(localSlotTime, timezone)

              if (isAfter(slotTime, userNow) && isSpotEmpty(slotTime)) {
                console.log('[QUEUE_TOOL] Found available preset slot:', slotTime, 'hour:', hour)
                return slotTime
              }
            }
          }

          return null // no slot found in next N days
        }

        // In bulk mode, find multiple slots
        const slotsNeeded = bulkMode ? queuedTweets.length : 1
        const availableSlots: Date[] = []
        
        // Modified slot finding for bulk operations
        if (bulkMode) {
          // Find multiple available slots
          let daysChecked = 0
          const maxDaysAhead = 90
          
          while (availableSlots.length < slotsNeeded && daysChecked <= maxDaysAhead) {
            const checkDay = startOfDay(addDays(userNow, daysChecked))
            
            // Get preset slots based on user frequency
            let presetSlots: number[]
            if (userFrequency === 1) {
              presetSlots = [12] // Just noon
            } else if (userFrequency === 2) {
              presetSlots = [10, 12] // 10am and noon
            } else {
              presetSlots = [10, 12, 14] // 10am, noon, 2pm (default for 3+ posts)
            }
            
            for (const hour of presetSlots) {
              const localSlotTime = startOfHour(setHours(checkDay, hour))
              const slotTime = fromZonedTime(localSlotTime, timezone)
              
              if (isAfter(slotTime, userNow) && isSpotEmpty(slotTime)) {
                availableSlots.push(slotTime)
                console.log('[QUEUE_TOOL] Found available slot:', slotTime, 'hour:', hour)
                
                if (availableSlots.length >= slotsNeeded) {
                  break
                }
              }
            }
            
            daysChecked++
          }
          
          if (availableSlots.length < slotsNeeded) {
            throw new Error(`Could only find ${availableSlots.length} available slots out of ${slotsNeeded} needed. Try queueing fewer tweets.`)
          }
        } else {
          // Single slot mode - use existing logic
          const nextSlot = getNextAvailableSlot({ 
            userNow, 
            timezone, 
            maxDaysAhead: 90,
            userFrequency 
          })

          console.log('[QUEUE_TOOL] Next available slot:', nextSlot)

          if (!nextSlot) {
            throw new Error('Queue for the next 3 months is already full!')
          }
          
          availableSlots.push(nextSlot)
        }

        // Schedule each tweet/thread
        const scheduledResults: Array<{ threadId: string, time: Date, messageId: string | null }> = []
        
        for (let i = 0; i < queuedTweets.length; i++) {
          const { threadId } = queuedTweets[i]!
          const scheduledTime = availableSlots[i]!
          const scheduledUnix = scheduledTime.getTime()
          
          let messageId = null
          
          if (process.env.NODE_ENV === 'development' || !process.env.WEBHOOK_URL) {
            // In development, generate a fake message ID
            messageId = `local-${Date.now()}-${Math.random().toString(36).substring(7)}`
            console.log('[QUEUE_TOOL] Local development - skipping QStash for thread:', threadId)
          } else {
            // In production, use QStash
            const baseUrl = process.env.WEBHOOK_URL
            const qstashResponse = await qstash.publishJSON({
              url: baseUrl + '/api/tweet/postThread',
              body: { threadId, userId: userId, accountId: dbAccount.id },
              notBefore: scheduledUnix / 1000, // needs to be in seconds
            })
            messageId = qstashResponse.messageId
          }

          console.log('[QUEUE_TOOL] QStash message created for thread:', threadId, 'messageId:', messageId)

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
                eq(tweets.userId, userId),
              ))

            scheduledResults.push({ threadId, time: scheduledTime, messageId })
            console.log('[QUEUE_TOOL] Thread queued successfully:', threadId, 'at', scheduledTime)
          } catch (err) {
            console.error('[QUEUE_TOOL] Database error for thread:', threadId, err)
            
            // If QStash message was created, try to delete it
            if (messageId && !messageId.startsWith('local-')) {
              try {
                const messages = qstash.messages
                await messages.delete(messageId)
              } catch (deleteErr) {
                console.error('[QUEUE_TOOL] Failed to delete QStash message:', deleteErr)
              }
            }

            throw new Error(`Problem scheduling tweet ${i + 1} of ${queuedTweets.length}`)
          }
        }

        console.log('[QUEUE_TOOL] All tweets queued successfully:', scheduledResults.length)

        // Format success message based on mode
        const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone
        let successMessage = ''
        
        if (bulkMode) {
          // Create a summary of when tweets are scheduled
          const scheduleSummary = scheduledResults.map((result, index) => {
            const friendlyTime = new Intl.DateTimeFormat('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: userTz,
            }).format(result.time)
            
            // Show first 3 tweets preview
            if (index < 3) {
              const preview = queuedTweets[index]?.content.substring(0, 50) + '...'
              return `• ${friendlyTime}: "${preview}"`
            }
            return null
          }).filter(Boolean)
          
          if (scheduledResults.length > 3) {
            scheduleSummary.push(`• ...and ${scheduledResults.length - 3} more tweets`)
          }
          
          successMessage = `Successfully queued ${scheduledResults.length} tweets!\n\n${scheduleSummary.join('\n')}\n\n💡 **Tip**: Press Cmd/Ctrl + 3 to view your complete queue.`
        } else {
          // Single tweet or thread mode
          const firstResult = scheduledResults[0]!
          const friendlyTime = new Intl.DateTimeFormat('en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: userTz,
          }).format(firstResult.time)
          
          const baseMessage = tweetsToQueue.length > 1 
            ? `Thread added to queue! ${tweetsToQueue.length} tweets will be posted on ${friendlyTime}.`
            : `Tweet added to queue! It will be posted on ${friendlyTime}.`
          
          successMessage = `${baseMessage}\n\n💡 **Tip**: Press Cmd/Ctrl + 3 to quickly open the Schedule page and view your queue.`
        }

        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: successMessage,
            status: 'complete',
            bulkMode: bulkMode,
            scheduledCount: scheduledResults.length
          },
        })

        return {
          success: true,
          message: successMessage,
          scheduledCount: scheduledResults.length,
          results: scheduledResults
        }

      } catch (error) {
        console.error('[QUEUE_TOOL] Error:', error)
        
        const errorMessage = error instanceof Error ? error.message : 'Failed to queue tweet'
        
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: `Error: ${errorMessage}`,
            status: 'error',
          },
        })
        
        throw error
      }
    },
  })
}
