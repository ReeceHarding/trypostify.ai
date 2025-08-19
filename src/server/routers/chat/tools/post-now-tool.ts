import { db } from '@/db'
import { tweets, account as accountSchema } from '@/db/schema'
import { and, eq, asc } from 'drizzle-orm'
import { tool, UIMessageStreamWriter } from 'ai'
import { redis } from '../../../../lib/redis'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { HTTPException } from 'hono/http-exception'

export const createPostNowTool = (
  writer: UIMessageStreamWriter,
  userId: string,
  accountId: string,
  conversationContext?: string,
  chatId?: string,
  tweetRouterContext?: any
) => {
  return tool({
    description: 'Post a tweet immediately to Twitter/X. If content is not provided, uses the most recent tweet from the conversation.',
    inputSchema: z.object({
      content: z.string().optional().describe('The tweet content to post. If not provided, uses the most recent tweet from conversation'),
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
        console.log('[POST_NOW_TOOL] Content provided:', content)
        console.log('[POST_NOW_TOOL] Has conversation context:', !!conversationContext)
        console.log('[POST_NOW_TOOL] Has media:', !!media?.length)
        console.log('[POST_NOW_TOOL] Is thread:', isThread)
        console.log('[POST_NOW_TOOL] Additional tweets:', additionalTweets?.length || 0)
        
        // If no content provided, try to extract from conversation context
        let finalContent = content
        if (!finalContent && conversationContext) {
          console.log('[POST_NOW_TOOL] No content provided, extracting from conversation context')
          
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
                console.log('[POST_NOW_TOOL] Extracted tweet from conversation line:', finalContent)
                break
              }
            }
          } else if (tweetMatch && tweetMatch[1]) {
            finalContent = tweetMatch[1]
            console.log('[POST_NOW_TOOL] Extracted tweet from tool output:', finalContent)
          }
        }
        // Fallback to durable cache if still missing
        if (!finalContent && chatId) {
          try {
            const cached = await redis.get<string>(`chat:last-tweet:${chatId}`)
            if (cached && cached.trim().length > 0) {
              finalContent = cached
              console.log('[POST_NOW_TOOL] Loaded tweet from cache for chat:', chatId)
            }
          } catch (cacheErr) {
            console.warn('[POST_NOW_TOOL] Failed to read cached tweet:', (cacheErr as Error)?.message)
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
            text: 'Preparing to post...',
            status: 'processing',
          },
        })

        // Prepare tweets array
        const tweetsToPost = [{
          content: finalContent,
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

        // Import the tweet router functions directly to avoid auth issues
        const { publishThreadById } = await import('../../tweet-router')
        
        // Create thread in database directly
        const threadId = crypto.randomUUID()
        
        // Insert tweets into database
        for (let i = 0; i < tweetsToPost.length; i++) {
          const tweet = tweetsToPost[i]
          await db.insert(tweets).values({
            id: crypto.randomUUID(),
            threadId: threadId,
            content: tweet.content,
            media: tweet.media || [],
            userId: userId,
            accountId: accountId,
            position: i,
            isThreadStart: i === 0,
            delayMs: tweet.delayMs || 0,
            isScheduled: false,
            isPublished: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
        }
        
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

        // Post the thread immediately using the shared publisher
        await publishThreadById({
          threadId,
          userId,
          accountId,
          logPrefix: 'POST_NOW_TOOL'
        })
        
        console.log('[POST_NOW_TOOL] Posted successfully to Twitter')

        // Get the posted tweets to construct Twitter URLs
        const postedTweets = await db.query.tweets.findMany({
          where: and(
            eq(tweets.threadId, threadId),
            eq(tweets.isPublished, true)
          ),
          orderBy: asc(tweets.position),
        })

        // Get account info for username
        const account = await db.query.account.findFirst({
          where: eq(accountSchema.id, accountId),
        })

        let twitterUrl = ''
        if (postedTweets.length > 0 && postedTweets[0]?.twitterId && account?.username) {
          // Construct Twitter URL for the first tweet
          twitterUrl = `https://twitter.com/${account.username}/status/${postedTweets[0].twitterId}`
          console.log('[POST_NOW_TOOL] Generated Twitter URL:', twitterUrl)
        }

        // Send success message with link
        const successMessage = tweetsToPost.length > 1 
          ? `Thread posted successfully! ${tweetsToPost.length} tweets sent.`
          : 'Tweet posted successfully!'

        const finalMessage = twitterUrl 
          ? `${successMessage}\n\nView on Twitter: ${twitterUrl}`
          : successMessage

        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: finalMessage,
            status: 'complete',
            twitterUrl: twitterUrl || undefined,
          },
        })

        return {
          success: true,
          message: finalMessage,
          threadId: threadId,
          twitterUrl: twitterUrl || undefined
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
