import { editToolSystemPrompt } from '@/lib/prompt-utils'
import { streamText, tool, UIMessageStreamWriter } from 'ai'
import { openai } from '@ai-sdk/openai'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { Account } from '../../settings-router'
import { redis } from '../../../../lib/redis'
import { Style } from '../../style-router'

export const createBulkWriteTweetsTool = (
  writer: UIMessageStreamWriter,
  account: Account,
  style: Style,
  hasXPremium: boolean,
  conversationContext?: string,
  websiteContent?: any[],
  chatId?: string
) => {
  return tool({
    description: 'Write multiple tweets in bulk based on user instruction. Use this when user asks for multiple tweets about a topic.',
    inputSchema: z.object({
      instruction: z.string().describe('User instruction for bulk tweet creation'),
      count: z.number().min(1).max(20).describe('Number of tweets to generate (max 20)'),
      topic: z.string().describe('The main topic or theme for all tweets'),
      variations: z.boolean().optional().describe('Whether tweets should be variations of each other or distinct'),
    }),
    execute: async ({ instruction, count, topic, variations = false }) => {
      const toolId = nanoid()
      
      try {
        console.log('[BULK_WRITE_TWEETS_TOOL] ===== TOOL CALLED =====')
        console.log('[BULK_WRITE_TWEETS_TOOL] Instruction:', instruction)
        console.log('[BULK_WRITE_TWEETS_TOOL] Count:', count)
        console.log('[BULK_WRITE_TWEETS_TOOL] Topic:', topic)
        console.log('[BULK_WRITE_TWEETS_TOOL] Variations:', variations)
        console.log('[BULK_WRITE_TWEETS_TOOL] Timestamp:', new Date().toISOString())
        
        // Send initial status
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: `Generating ${count} tweets about ${topic}...`,
            status: 'processing',
            tweets: [],
          },
        })

        // Build style section
        let styleSection = '\n\n=== CRITICAL WRITING STYLE REQUIREMENTS ===\n'
        styleSection += `You are writing as ${account.name} (@${account.username}). Match their exact writing style.\n\n`
        
        if (style.prompt && style.prompt.trim()) {
          styleSection += `CUSTOM STYLE INSTRUCTIONS (HIGHEST PRIORITY):\n${style.prompt}\n\n`
        }
        
        if (style.tweets && style.tweets.length > 0) {
          styleSection += `REFERENCE TWEETS TO MATCH EXACTLY:\n`
          styleSection += `Study these tweets carefully and mirror the tone, vocabulary, punctuation, and structure:\n\n`
          style.tweets.forEach((tweet, i) => {
            styleSection += `Example ${i + 1}: "${tweet.text}"\n\n`
          })
        }
        
        styleSection += '=== END STYLE REQUIREMENTS ===\n\n'

        const systemPrompt = `${editToolSystemPrompt({ name: account.name, hasXPremium })}

${conversationContext ? `CONVERSATION CONTEXT:
${conversationContext}

Use this context to understand what the user is referring to when creating the tweets.
` : ''}

${styleSection}

CHARACTER LIMIT: ${hasXPremium ? 25000 : 280}

IMPORTANT BULK GENERATION RULES:
1. Generate EXACTLY ${count} tweets about "${topic}"
2. Each tweet must be unique and engaging
3. ${variations ? 'Create variations on the same core message' : 'Create distinct tweets covering different aspects of the topic'}
4. Maintain consistent voice across all tweets
5. NEVER use hyphenated words
6. Output tweets as a JSON array with format: [{"text": "tweet content"}, ...]
7. Make each tweet self contained and complete
8. Vary the structure and approach between tweets
9. CRITICAL: All tweets must follow the same instruction type:
   - If instruction asks to "ask" or "write tweets asking", ALL tweets must be questions
   - If instruction says "write about", ALL tweets should make statements about the topic
   - Maintain the same intent across all tweets`

        const fullPrompt = `${instruction}

Generate exactly ${count} tweets about: ${topic}

${websiteContent && websiteContent.length > 0 ? `
WEBSITE CONTENT FOR CONTEXT:
${websiteContent.map(content => `Title: ${content.title}\nURL: ${content.url}\nContent: ${content.content.substring(0, 500)}...`).join('\n\n')}
` : ''}

Return ONLY a JSON array of tweets. No other text.`

        console.log('[BULK_WRITE_TWEETS_TOOL] Starting AI generation')
        
        const result = await streamText({
          model: openai('gpt-4o-mini'),
          system: systemPrompt,
          prompt: fullPrompt,
        })

        let fullText = ''
        for await (const textPart of result.textStream) {
          fullText += textPart
        }

        console.log('[BULK_WRITE_TWEETS_TOOL] AI response received, length:', fullText.length)

        // Parse the JSON response
        let tweets = []
        try {
          // Clean up the response in case it has markdown code blocks
          const cleanedText = fullText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
          tweets = JSON.parse(cleanedText)
          
          if (!Array.isArray(tweets)) {
            throw new Error('Response is not an array')
          }
          
          // Ensure each tweet has the correct structure
          tweets = tweets.map((tweet, index) => ({
            id: nanoid(),
            text: typeof tweet === 'string' ? tweet : tweet.text || tweet.content || '',
            index,
          })).filter(tweet => tweet.text.trim().length > 0)
          
        } catch (parseError) {
          console.error('[BULK_WRITE_TWEETS_TOOL] Failed to parse AI response:', parseError)
          // Fallback: try to extract tweets from the text
          const tweetMatches = fullText.match(/"([^"]+)"/g) || []
          tweets = tweetMatches.slice(0, count).map((match, index) => ({
            id: nanoid(),
            text: match.replace(/^"|"$/g, ''),
            index,
          }))
        }

        console.log('[BULK_WRITE_TWEETS_TOOL] Parsed tweets count:', tweets.length)

        // Cache the tweets for bulk operations
        if (chatId) {
          try {
            await redis.setex(`chat:bulk-tweets:${chatId}`, 60 * 60, JSON.stringify(tweets))
            console.log('[BULK_WRITE_TWEETS_TOOL] Cached', tweets.length, 'tweets for chat:', chatId)
          } catch (cacheErr) {
            console.warn('[BULK_WRITE_TWEETS_TOOL] Failed to cache tweets:', (cacheErr as Error)?.message)
          }
        }

        // Send the final result
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: `Generated ${tweets.length} tweets about ${topic}`,
            status: 'complete',
            tweets: tweets,
          },
        })

        console.log('[BULK_WRITE_TWEETS_TOOL] Tool execution complete')
        return { success: true, tweets }
        
      } catch (error) {
        console.error('[BULK_WRITE_TWEETS_TOOL] Error:', error)
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: `Error generating tweets: ${(error as Error).message}`,
            status: 'error',
            tweets: [],
          },
        })
        throw error
      }
    },
  })
}
