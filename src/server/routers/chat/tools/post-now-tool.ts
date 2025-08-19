import { db } from '@/db'
import { tweets } from '@/db/schema'
import { tool, UIMessageStreamWriter } from 'ai'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { client } from '@/lib/client'
import { HTTPException } from 'hono/http-exception'

export const createPostNowTool = (
  writer: UIMessageStreamWriter,
  userId: string,
  accountId: string
) => {
  return tool({
    description: 'Post a tweet immediately to Twitter/X',
    inputSchema: z.object({
      content: z.string().describe('The tweet content to post'),
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
        console.log('[POST_NOW_TOOL] ===== TOOL CALLED =====')
        console.log('[POST_NOW_TOOL] Content:', content)
        console.log('[POST_NOW_TOOL] Has media:', !!media?.length)
        console.log('[POST_NOW_TOOL] Is thread:', isThread)
        console.log('[POST_NOW_TOOL] Additional tweets:', additionalTweets?.length || 0)
        
        // Send initial status
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: 'Preparing to post...',
            status: 'processing',
          },
        })

        // Prepare tweets array
        const tweetsToPost = [{
          content,
          media: media || [],
          delayMs: 0
        }]

        // Add additional tweets if it's a thread
        if (additionalTweets && additionalTweets.length > 0) {
          tweetsToPost.push(...additionalTweets.map((tweet, index) => ({
            content: tweet.content,
            media: tweet.media || [],
            delayMs: tweet.delayMs || (index > 0 ? 1000 : 0)
          })))
        }

        console.log('[POST_NOW_TOOL] Posting', tweetsToPost.length, 'tweet(s)')

        // Create and post the thread
        const createRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/tweet/createThread`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tweets: tweetsToPost
          }),
        })

        if (!createRes.ok) {
          const error = await createRes.json() as { message?: string }
          throw new Error(error.message || 'Failed to create thread')
        }

        const createResult = await createRes.json() as { threadId: string }
        const { threadId } = createResult
        console.log('[POST_NOW_TOOL] Thread created with ID:', threadId)

        // Update status
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: 'Posting to Twitter...',
            status: 'processing',
          },
        })

        // Post the thread immediately
        const postRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/tweet/postThreadNow`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tweets: tweetsToPost
          }),
        })

        if (!postRes.ok) {
          const error = await postRes.json() as { message?: string }
          throw new Error(error.message || 'Failed to post thread')
        }

        const result = await postRes.json() as { threadUrl?: string }
        console.log('[POST_NOW_TOOL] Posted successfully:', result)

        // Send success message
        const successMessage = tweetsToPost.length > 1 
          ? `Thread posted successfully! ${tweetsToPost.length} tweets sent.`
          : 'Tweet posted successfully!'

        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: successMessage,
            status: 'complete',
            threadUrl: result.threadUrl,
          },
        })

        return {
          success: true,
          message: successMessage,
          threadUrl: result.threadUrl,
          threadId: threadId
        }

      } catch (error) {
        console.error('[POST_NOW_TOOL] Error:', error)
        
        const errorMessage = error instanceof Error ? error.message : 'Failed to post tweet'
        
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
