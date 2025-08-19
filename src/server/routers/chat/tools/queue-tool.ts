import { tool, UIMessageStreamWriter } from 'ai'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { redis } from '../../../../lib/redis'
import { format, addDays } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

export const createQueueTool = (
  writer: UIMessageStreamWriter,
  userId: string,
  accountId: string,
  conversationContext?: string,
  chatId?: string
) => {
  return tool({
    description: 'Add a tweet to the queue for automatic scheduling at the next available slot. If content is not provided, uses the most recent tweet from the conversation.',
    inputSchema: z.object({
      content: z.string().optional().describe('The tweet content to queue. If not provided, uses the most recent tweet from conversation'),
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
    execute: async ({ content, media = [], isThread = false, additionalTweets = [] }) => {
      const toolId = nanoid()
      
      try {
        console.log('[QUEUE_TOOL] ===== TOOL CALLED =====')
        console.log('[QUEUE_TOOL] Content provided:', content)
        console.log('[QUEUE_TOOL] Has conversation context:', !!conversationContext)
        console.log('[QUEUE_TOOL] Has media:', !!media?.length)
        console.log('[QUEUE_TOOL] Is thread:', isThread)
        console.log('[QUEUE_TOOL] Additional tweets:', additionalTweets?.length || 0)
        
        // If no content provided, try to extract from conversation context
        let finalContent = content
        if (!finalContent && conversationContext) {
          console.log('[QUEUE_TOOL] No content provided, extracting from conversation context')
          
          // Look for the most recent tweet in the conversation
          // Try multiple patterns to find tweet content
          
          // Pattern 1: Look for tool output with text field
          let tweetMatch = conversationContext.match(/data-tool-output[^}]*?"text"\s*:\s*"([^"]+)"/i)
          
          // Pattern 2: If not found, look for text in conversation that looks like a tweet
          if (!tweetMatch || !tweetMatch[1]) {
            // Find the last assistant message with tweet-like content
            const lines = conversationContext.split('\n')
            for (let i = lines.length - 1; i >= 0; i--) {
              const line = lines[i].trim()
              // Skip short lines, tool outputs, and system messages
              if (line.length > 20 && 
                  !line.includes('Tool called:') && 
                  !line.includes('Assistant:') &&
                  !line.includes('User:') &&
                  !line.includes('{') &&
                  !line.includes('}')) {
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
        
        // Fallback to durable cache if still missing
        if (!finalContent && chatId) {
          try {
            const cached = await redis.get<string>(`chat:last-tweet:${chatId}`)
            if (cached && cached.trim().length > 0) {
              finalContent = cached
              console.log('[QUEUE_TOOL] Loaded tweet from cache for chat:', chatId)
            }
          } catch (cacheErr) {
            console.warn('[QUEUE_TOOL] Failed to read cached tweet:', (cacheErr as Error)?.message)
          }
        }
        
        if (!finalContent) {
          throw new Error('No tweet content provided and could not find a recent tweet in the conversation')
        }
        
        // Send initial status
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: 'Finding next available slot...',
            status: 'processing',
          },
        })

        // Prepare tweets array
        const tweetsToQueue = [{
          content: finalContent,
          media: media || [],
          delayMs: 0
        }]

        // Add additional tweets if it's a thread
        if (additionalTweets && additionalTweets.length > 0) {
          tweetsToQueue.push(...additionalTweets.map((tweet, index) => ({
            content: tweet.content,
            media: tweet.media || [],
            delayMs: tweet.delayMs || (index > 0 ? 1000 : 0)
          })))
        }

        console.log('[QUEUE_TOOL] Queueing', tweetsToQueue.length, 'tweet(s)')

        // Get user's timezone
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
        const userNow = new Date()

        // Create the thread first
        const createRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/tweet/createThread`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tweets: tweetsToQueue
          }),
        })

        if (!createRes.ok) {
          const error = await createRes.json() as { message?: string }
          throw new Error(error.message || 'Failed to create thread')
        }

        const createResult = await createRes.json() as { threadId: string }
        const { threadId } = createResult
        console.log('[QUEUE_TOOL] Thread created with ID:', threadId)

        // Update status
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: 'Adding to queue...',
            status: 'processing',
          },
        })

        // Add to queue
        const queueRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/tweet/enqueueThread`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            threadId,
            userNow: userNow.toISOString(),
            timezone
          }),
        })

        if (!queueRes.ok) {
          const error = await queueRes.json() as { message?: string }
          throw new Error(error.message || 'Failed to queue thread')
        }

        const result = await queueRes.json() as { time: string, dayName: string }
        console.log('[QUEUE_TOOL] Queued successfully:', result)

        // Format the scheduled time for display
        const scheduledDate = new Date(result.time)
        const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone
        const friendlyTime = new Intl.DateTimeFormat('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: userTz,
        }).format(scheduledDate)

        // Send success message
        const successMessage = tweetsToQueue.length > 1 
          ? `Thread added to queue! ${tweetsToQueue.length} tweets will be posted on ${friendlyTime}.`
          : `Tweet added to queue! It will be posted on ${friendlyTime}.`

        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: successMessage,
            status: 'complete',
            scheduledTime: result.time,
            dayName: result.dayName
          },
        })

        return {
          success: true,
          message: successMessage,
          threadId: threadId,
          scheduledTime: result.time,
          dayName: result.dayName
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
