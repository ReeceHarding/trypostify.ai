import { tool, UIMessageStreamWriter } from 'ai'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { redis } from '../../../../lib/redis'

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
            const tweetMatch = conversationContext.match(/"text"\s*:\s*"([^"]{20,}?)"/i)
            
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

        // Check for video URLs in any tweet content and create video jobs if found
        const { extractVideoUrls, createVideoJobForAction } = await import('../../utils/video-job-utils')
        const allContent = tweetsToQueue.map(t => t.content).join(' ')
        const videoUrls = extractVideoUrls(allContent)

        if (videoUrls.length > 0) {
          console.log('[QUEUE_TOOL] 🎬 Video URLs detected:', videoUrls)
          
          writer.write({
            type: 'data-tool-output',
            id: toolId,
            data: {
              text: 'Video URLs detected. Processing videos before queueing...',
              status: 'processing',
            },
          })

          // Remove video URLs from content
          const cleanedTweets = tweetsToQueue.map(tweet => {
            let cleanedContent = tweet.content
            videoUrls.forEach(url => {
              cleanedContent = cleanedContent.replace(url, '').trim()
            })
            return { ...tweet, content: cleanedContent }
          })

          // Create a video job for each detected URL
          for (const videoUrl of videoUrls) {
            await createVideoJobForAction({
              userId,
              videoUrl,
              tweetContent: {
                action: 'queue_thread',
                userId,
                accountId,
                tweets: cleanedTweets.map(t => ({
                  ...t,
                  delayMs: t.delayMs || 0
                })),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                userNow: new Date().toISOString(),
              }
            })
          }

          writer.write({
            type: 'data-tool-output',
            id: toolId,
            data: {
              text: `Video processing started. Tweet(s) will be automatically queued when videos are ready.`,
              status: 'complete',
            },
          })
          return // Stop execution, webhook will handle the rest
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

        // Import centralized functions
        const { createThreadInternal, enqueueThreadInternal } = await import('../../utils/tweet-utils')

        // Store results for later use
        const scheduledResults: Array<{ threadId: string, time: Date, messageId: string | null, content: string }> = []

        // In bulk mode, create separate threads for each tweet
        // In single mode or thread mode, create one thread with all tweets
        if (bulkMode) {
          // Create separate single-tweet threads for each tweet
          for (const tweet of tweetsToQueue) {
            console.log('[QUEUE_TOOL] Creating single-tweet thread for bulk mode')
            const { threadId } = await createThreadInternal({ tweets: [tweet] }, userId)
            const result = await enqueueThreadInternal({ threadId, userId, userNow, timezone })
            scheduledResults.push({ 
              threadId, 
              time: new Date(result.scheduledUnix), 
              messageId: result.messageId,
              content: tweet.content
            })
            console.log('[QUEUE_TOOL] Single-tweet thread queued:', { threadId, scheduledUnix: result.scheduledUnix })
          }
        } else {
          // Single mode or thread mode - create one thread with all tweets
          console.log('[QUEUE_TOOL] Creating thread for single/thread mode with', tweetsToQueue.length, 'tweets')
          const { threadId } = await createThreadInternal({ tweets: tweetsToQueue }, userId)
          const result = await enqueueThreadInternal({ threadId, userId, userNow, timezone })
          scheduledResults.push({ 
            threadId, 
            time: new Date(result.scheduledUnix), 
            messageId: result.messageId,
            content: tweetsToQueue[0]?.content || ''
          })
          console.log('[QUEUE_TOOL] Thread queued:', { threadId, scheduledUnix: result.scheduledUnix })
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
            const preview = result.content.substring(0, 50) + '...'
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
          results: scheduledResults.map(r => ({ threadId: r.threadId, time: r.time, messageId: r.messageId }))
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
