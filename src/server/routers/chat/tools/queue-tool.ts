import { tool, UIMessageStreamWriter } from 'ai'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { format, addDays } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

export const createQueueTool = (
  writer: UIMessageStreamWriter,
  userId: string,
  accountId: string
) => {
  return tool({
    description: 'Add a tweet to the queue for automatic scheduling at the next available slot',
    inputSchema: z.object({
      content: z.string().describe('The tweet content to queue'),
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
        console.log('[QUEUE_TOOL] Content:', content)
        console.log('[QUEUE_TOOL] Has media:', !!media?.length)
        console.log('[QUEUE_TOOL] Is thread:', isThread)
        console.log('[QUEUE_TOOL] Additional tweets:', additionalTweets?.length || 0)
        
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
          content,
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
