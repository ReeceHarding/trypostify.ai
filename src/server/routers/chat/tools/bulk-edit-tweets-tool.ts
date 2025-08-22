import { editToolSystemPrompt } from '@/lib/prompt-utils'
import { streamText, tool, UIMessageStreamWriter } from 'ai'
import { openai } from '@ai-sdk/openai'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { Account } from '../../settings-router'
import { redis } from '../../../../lib/redis'
import { Style } from '../../style-router'

export const createBulkEditTweetsTool = (
  writer: UIMessageStreamWriter,
  account: Account,
  style: Style,
  hasXPremium: boolean,
  conversationContext?: string,
  chatId?: string
) => {
  return tool({
    description: 'Apply edits to multiple tweets at once. Use this when user wants to modify all generated tweets.',
    inputSchema: z.object({
      editInstruction: z.string().describe('How to edit the tweets (e.g., "make them more punchy", "add emojis", "make shorter")'),
      tweetIds: z.array(z.string()).optional().describe('Specific tweet IDs to edit. If not provided, edits all cached tweets'),
    }),
    execute: async ({ editInstruction, tweetIds }) => {
      const toolId = nanoid()
      
      try {
        console.log('[BULK_EDIT_TWEETS_TOOL] ===== TOOL CALLED =====')
        console.log('[BULK_EDIT_TWEETS_TOOL] Edit instruction:', editInstruction)
        console.log('[BULK_EDIT_TWEETS_TOOL] Tweet IDs:', tweetIds)
        console.log('[BULK_EDIT_TWEETS_TOOL] Timestamp:', new Date().toISOString())
        
        // Get cached tweets
        let tweets: any[] = []
        if (chatId) {
          try {
            const cached = await redis.get<string>(`chat:bulk-tweets:${chatId}`)
            if (cached) {
              tweets = JSON.parse(cached)
              console.log('[BULK_EDIT_TWEETS_TOOL] Loaded', tweets.length, 'cached tweets')
            }
          } catch (err) {
            console.error('[BULK_EDIT_TWEETS_TOOL] Failed to load cached tweets:', err)
          }
        }

        // If no cached tweets, try to extract from conversation
        if (!tweets.length && conversationContext) {
          console.log('[BULK_EDIT_TWEETS_TOOL] No cached tweets, extracting from conversation')
          // Look for tweet mockups in conversation
          const tweetMatches = conversationContext.match(/"text"\s*:\s*"([^"]+)"/g) || []
          tweets = tweetMatches.map((match, index) => ({
            id: nanoid(),
            text: match.replace(/"text"\s*:\s*"/, '').replace(/"$/, ''),
            index,
          }))
        }

        if (!tweets.length) {
          throw new Error('No tweets found to edit. Please generate tweets first.')
        }

        // Filter tweets if specific IDs provided
        if (tweetIds && tweetIds.length > 0) {
          tweets = tweets.filter(tweet => tweetIds.includes(tweet.id))
        }

        // Send initial status
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: `Editing ${tweets.length} tweets...`,
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
          style.tweets.forEach((tweet, i) => {
            styleSection += `Example ${i + 1}: "${tweet.text}"\n\n`
          })
        }
        
        styleSection += '=== END STYLE REQUIREMENTS ===\n\n'

        const systemPrompt = `${editToolSystemPrompt({ name: account.name, hasXPremium })}

${styleSection}

CHARACTER LIMIT: ${hasXPremium ? 25000 : 280}

BULK EDITING RULES:
1. Apply the edit instruction to EACH tweet individually
2. Maintain the core message of each tweet
3. Keep each tweet unique - don't make them all identical
4. Preserve the author's voice
5. NEVER use hyphenated words
6. Output as JSON array with format: [{"id": "original_id", "text": "edited tweet"}, ...]
7. Include ALL tweets in the response, even if some don't need changes
8. Make sure edits improve the tweets according to the instruction`

        const fullPrompt = `Edit instruction: "${editInstruction}"

Original tweets:
${tweets.map((tweet, i) => `${i + 1}. [ID: ${tweet.id}] "${tweet.text}"`).join('\n')}

Apply the edit instruction to each tweet and return a JSON array with the edited versions.
Maintain each tweet's unique message while applying the edit consistently.

Return ONLY a JSON array. No other text.`

        console.log('[BULK_EDIT_TWEETS_TOOL] Starting AI generation')
        
        const result = await streamText({
          model: openai('gpt-4o-mini'),
          system: systemPrompt,
          prompt: fullPrompt,
        })

        let fullText = ''
        for await (const textPart of result.textStream) {
          fullText += textPart
        }

        console.log('[BULK_EDIT_TWEETS_TOOL] AI response received, length:', fullText.length)

        // Parse the JSON response
        let editedTweets: any[] = []
        try {
          const cleanedText = fullText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
          editedTweets = JSON.parse(cleanedText)
          
          if (!Array.isArray(editedTweets)) {
            throw new Error('Response is not an array')
          }
          
          // Map edited tweets back to original structure
          editedTweets = editedTweets.map((edited: any, index: number) => {
            const originalTweet = tweets.find(t => t.id === edited.id) || tweets[index]
            return {
              id: edited.id || originalTweet?.id || nanoid(),
              text: edited.text || edited.content || '',
              index: originalTweet?.index || index,
              isOriginal: originalTweet?.isOriginal || false,
            }
          }).filter(tweet => tweet.text.trim().length > 0)
          
        } catch (parseError) {
          console.error('[BULK_EDIT_TWEETS_TOOL] Failed to parse AI response:', parseError)
          throw new Error('Failed to parse edited tweets')
        }

        console.log('[BULK_EDIT_TWEETS_TOOL] Edited tweets count:', editedTweets.length)

        // Update cache with edited tweets
        if (chatId) {
          try {
            await redis.setex(`chat:bulk-tweets:${chatId}`, 60 * 60, JSON.stringify(editedTweets))
            console.log('[BULK_EDIT_TWEETS_TOOL] Updated cache with edited tweets')
          } catch (cacheErr) {
            console.warn('[BULK_EDIT_TWEETS_TOOL] Failed to update cache:', (cacheErr as Error)?.message)
          }
        }

        // Send the final result
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: `Edited ${editedTweets.length} tweets`,
            status: 'complete',
            tweets: editedTweets,
            editInstruction,
          },
        })

        console.log('[BULK_EDIT_TWEETS_TOOL] Tool execution complete')
        return { success: true, tweets: editedTweets }
        
      } catch (error) {
        console.error('[BULK_EDIT_TWEETS_TOOL] Error:', error)
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: `Error editing tweets: ${(error as Error).message}`,
            status: 'error',
            tweets: [],
          },
        })
        throw error
      }
    },
  })
}
