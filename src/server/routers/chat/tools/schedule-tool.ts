import { tool, UIMessageStreamWriter } from 'ai'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import { parse, format, addDays, setHours, setMinutes, isAfter, isBefore, startOfDay, endOfDay } from 'date-fns'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import { redis } from '../../../../lib/redis'

// Helper to parse natural language time expressions
function parseTimeExpression(expression: string, userTimezone: string): Date | null {
  const now = new Date()
  const userNow = toZonedTime(now, userTimezone)
  const expr = expression.toLowerCase().trim()
  
  console.log('[SCHEDULE_TOOL] Parsing time expression:', expr)
  console.log('[SCHEDULE_TOOL] User timezone:', userTimezone)
  console.log('[SCHEDULE_TOOL] User current time:', userNow.toLocaleString())

  // Handle "in X hours/minutes"
  const inMatch = expr.match(/in\s+(\d+)\s+(hour|minute|min)s?/i)
  if (inMatch) {
    const amount = parseInt(inMatch[1])
    const unit = inMatch[2].toLowerCase()
    const result = new Date(userNow)
    
    if (unit.startsWith('hour')) {
      result.setHours(result.getHours() + amount)
    } else {
      result.setMinutes(result.getMinutes() + amount)
    }
    
    return fromZonedTime(result, userTimezone)
  }

  // Handle "at HH:MM" or "at H:MM am/pm"
  const atTimeMatch = expr.match(/at\s+(\d{1,2}):(\d{2})\s*(am|pm)?/i)
  if (atTimeMatch) {
    let hours = parseInt(atTimeMatch[1])
    const minutes = parseInt(atTimeMatch[2])
    const ampm = atTimeMatch[3]?.toLowerCase()
    
    if (ampm === 'pm' && hours < 12) hours += 12
    if (ampm === 'am' && hours === 12) hours = 0
    
    let result = new Date(userNow)
    result = setHours(result, hours)
    result = setMinutes(result, minutes)
    result.setSeconds(0)
    result.setMilliseconds(0)
    
    // If the time is in the past today, assume tomorrow
    if (isBefore(result, userNow)) {
      result = addDays(result, 1)
    }
    
    return fromZonedTime(result, userTimezone)
  }

  // Handle "tomorrow at HH:MM"
  const tomorrowMatch = expr.match(/tomorrow\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?/i)
  if (tomorrowMatch) {
    let hours = parseInt(tomorrowMatch[1])
    const minutes = parseInt(tomorrowMatch[2])
    const ampm = tomorrowMatch[3]?.toLowerCase()
    
    if (ampm === 'pm' && hours < 12) hours += 12
    if (ampm === 'am' && hours === 12) hours = 0
    
    let result = addDays(userNow, 1)
    result = setHours(result, hours)
    result = setMinutes(result, minutes)
    result.setSeconds(0)
    result.setMilliseconds(0)
    
    return fromZonedTime(result, userTimezone)
  }

  // Handle relative day expressions with time
  const dayTimeMatch = expr.match(/(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?/i)
  if (dayTimeMatch) {
    const day = dayTimeMatch[1].toLowerCase()
    let hours = parseInt(dayTimeMatch[2])
    const minutes = parseInt(dayTimeMatch[3])
    const ampm = dayTimeMatch[4]?.toLowerCase()
    
    if (ampm === 'pm' && hours < 12) hours += 12
    if (ampm === 'am' && hours === 12) hours = 0
    
    let result = new Date(userNow)
    
    // Handle relative days
    if (day === 'today' || day === 'tonight') {
      // Keep current date
    } else if (day === 'tomorrow') {
      result = addDays(result, 1)
    } else {
      // Handle day names - find next occurrence
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
      const targetDay = days.indexOf(day)
      const currentDay = result.getDay()
      let daysToAdd = targetDay - currentDay
      if (daysToAdd <= 0) daysToAdd += 7
      result = addDays(result, daysToAdd)
    }
    
    result = setHours(result, hours)
    result = setMinutes(result, minutes)
    result.setSeconds(0)
    result.setMilliseconds(0)
    
    return fromZonedTime(result, userTimezone)
  }

  // Handle simple time without date (e.g., "9am", "3:30pm")
  const simpleTimeMatch = expr.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (simpleTimeMatch) {
    let hours = parseInt(simpleTimeMatch[1])
    const minutes = parseInt(simpleTimeMatch[2] || '0')
    const ampm = simpleTimeMatch[3]?.toLowerCase()
    
    if (ampm === 'pm' && hours < 12) hours += 12
    if (ampm === 'am' && hours === 12) hours = 0
    
    let result = new Date(userNow)
    result = setHours(result, hours)
    result = setMinutes(result, minutes)
    result.setSeconds(0)
    result.setMilliseconds(0)
    
    // If the time is in the past today, assume tomorrow
    if (isBefore(result, userNow)) {
      result = addDays(result, 1)
    }
    
    return fromZonedTime(result, userTimezone)
  }

  return null
}

export const createScheduleTool = (
  writer: UIMessageStreamWriter,
  userId: string,
  accountId: string,
  conversationContext?: string,
  chatId?: string
) => {
  return tool({
    description: 'Schedule a tweet to be posted at a specific time. If content is not provided, uses the most recent tweet from the conversation.',
    inputSchema: z.object({
      content: z.string().optional().describe('The tweet content to schedule. If not provided, uses the most recent tweet from conversation'),
      scheduledTime: z.string().describe('When to post the tweet (e.g., "tomorrow at 9am", "in 2 hours", "3:30pm")'),
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
    execute: async ({ content, scheduledTime, media = [], isThread = false, additionalTweets = [] }) => {
      const toolId = nanoid()
      
      try {
        console.log('[SCHEDULE_TOOL] ===== TOOL CALLED =====')
        console.log('[SCHEDULE_TOOL] Content provided:', content)
        console.log('[SCHEDULE_TOOL] Has conversation context:', !!conversationContext)
        console.log('[SCHEDULE_TOOL] Scheduled time expression:', scheduledTime)
        console.log('[SCHEDULE_TOOL] Has media:', !!media?.length)
        console.log('[SCHEDULE_TOOL] Is thread:', isThread)
        console.log('[SCHEDULE_TOOL] Additional tweets:', additionalTweets?.length || 0)
        
        // If no content provided, try to extract from conversation context
        let finalContent = content
        if (!finalContent && conversationContext) {
          console.log('[SCHEDULE_TOOL] No content provided, extracting from conversation context')
          
          // Look for the most recent tweet in the conversation
          // Try multiple patterns to find tweet content
          
          // Pattern 1: Look for tool output with text field
          let tweetMatch = conversationContext.match(/data-tool-output[^}]*?"text"\s*:\s*"([^"]+)"/i)
          
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
                  !line.includes('https://timebacklearn.com') && // Skip website URLs
                  !line.includes('dicebear.com') && // Skip image service URLs
                  !line.includes('<') && // Skip HTML tags
                  !line.includes('>')) { // Skip HTML tags
                finalContent = line
                console.log('[SCHEDULE_TOOL] Extracted tweet from conversation line:', finalContent)
                break
              }
            }
          } else if (tweetMatch && tweetMatch[1]) {
            finalContent = tweetMatch[1]
            console.log('[SCHEDULE_TOOL] Extracted tweet from tool output:', finalContent)
          }
        }
        
        // Fallback to durable cache if still missing
        if (!finalContent && chatId) {
          try {
            const cached = await redis.get<string>(`chat:last-tweet:${chatId}`)
            if (cached && cached.trim().length > 0) {
              finalContent = cached
              console.log('[SCHEDULE_TOOL] Loaded tweet from cache for chat:', chatId)
            }
          } catch (cacheErr) {
            console.warn('[SCHEDULE_TOOL] Failed to read cached tweet:', (cacheErr as Error)?.message)
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
            text: 'Parsing schedule time...',
            status: 'processing',
          },
        })

        // Parse the time expression
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
        const parsedTime = parseTimeExpression(scheduledTime, timezone)
        
        if (!parsedTime) {
          throw new Error(`Could not understand the time "${scheduledTime}". Try phrases like "tomorrow at 9am", "in 2 hours", or "3:30pm".`)
        }

        // Validate the time is in the future
        if (isBefore(parsedTime, new Date())) {
          throw new Error('Cannot schedule tweets in the past')
        }

        console.log('[SCHEDULE_TOOL] Parsed time:', parsedTime.toISOString())
        console.log('[SCHEDULE_TOOL] Local time:', parsedTime.toLocaleString())

        // Prepare tweets array
        const tweetsToSchedule = [{
          content: finalContent,
          media: media || [],
          delayMs: 0
        }]

        // Add additional tweets if it's a thread
        if (additionalTweets && additionalTweets.length > 0) {
          tweetsToSchedule.push(...additionalTweets.map((tweet, index) => ({
            content: tweet.content,
            media: tweet.media || [],
            delayMs: tweet.delayMs || (index > 0 ? 1000 : 0)
          })))
        }

        console.log('[SCHEDULE_TOOL] Scheduling', tweetsToSchedule.length, 'tweet(s)')

        // Update status
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: 'Creating thread...',
            status: 'processing',
          },
        })

        // Create the thread using direct function call (more efficient than fetch)
        const { createThreadInternal } = await import('../../tweet-router')
        const createResult = await createThreadInternal(
          { tweets: tweetsToSchedule },
          user.id
        )
        const threadId = createResult.threadId
        console.log('[SCHEDULE_TOOL] Thread created with ID:', threadId)

        // Update status
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: 'Scheduling tweet...',
            status: 'processing',
          },
        })

        // Schedule the thread using direct function call (more efficient than fetch)
        const { scheduleThreadInternal } = await import('../../tweet-router')
        const result = await scheduleThreadInternal(
          {
            threadId,
            scheduledUnix: Math.floor(parsedTime.getTime() / 1000) // API expects seconds
          },
          user.id
        )
        console.log('[SCHEDULE_TOOL] Scheduled successfully:', result)

        // Format the scheduled time for display
        const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone
        const friendlyTime = new Intl.DateTimeFormat('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: userTz,
        }).format(parsedTime)

        // Send success message
        const successMessage = tweetsToSchedule.length > 1 
          ? `Thread scheduled! ${tweetsToSchedule.length} tweets will be posted on ${friendlyTime}.`
          : `Tweet scheduled! It will be posted on ${friendlyTime}.`

        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: successMessage,
            status: 'complete',
            scheduledTime: parsedTime.toISOString()
          },
        })

        return {
          success: true,
          message: successMessage,
          threadId: threadId,
          scheduledTime: parsedTime.toISOString()
        }

      } catch (error) {
        console.error('[SCHEDULE_TOOL] Error:', error)
        
        const errorMessage = error instanceof Error ? error.message : 'Failed to schedule tweet'
        
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
