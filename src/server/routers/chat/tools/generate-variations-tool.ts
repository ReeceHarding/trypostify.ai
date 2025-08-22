import { editToolSystemPrompt } from '@/lib/prompt-utils'
import { streamText, tool, UIMessageStreamWriter } from 'ai'
import { openai } from '@ai-sdk/openai'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { Account } from '../../settings-router'
import { redis } from '../../../../lib/redis'
import { Style } from '../../style-router'

export const createGenerateVariationsTool = (
  writer: UIMessageStreamWriter,
  account: Account,
  style: Style,
  hasXPremium: boolean,
  conversationContext?: string,
  chatId?: string
) => {
  return tool({
    description: 'Generate multiple variations/derivations from a single tweet. Use this when user wants variations of an existing tweet.',
    inputSchema: z.object({
      originalTweet: z.string().describe('The original tweet to create variations from'),
      count: z.number().min(1).max(20).describe('Number of variations to generate (max 20)'),
      variationType: z.enum(['similar', 'different-angles', 'different-tones']).optional()
        .describe('Type of variations: similar (same message), different-angles (different perspectives), different-tones (different emotional tones)'),
      instruction: z.string().optional().describe('Additional instructions for variations'),
    }),
    execute: async ({ originalTweet, count, variationType = 'similar', instruction }) => {
      const toolId = nanoid()
      
      try {
        console.log('[GENERATE_VARIATIONS_TOOL] ===== TOOL CALLED =====')
        console.log('[GENERATE_VARIATIONS_TOOL] Original tweet:', originalTweet)
        console.log('[GENERATE_VARIATIONS_TOOL] Count:', count)
        console.log('[GENERATE_VARIATIONS_TOOL] Variation type:', variationType)
        console.log('[GENERATE_VARIATIONS_TOOL] Additional instruction:', instruction)
        console.log('[GENERATE_VARIATIONS_TOOL] Timestamp:', new Date().toISOString())
        
        // Send initial status
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: `Generating ${count} variations...`,
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

        // Determine variation instructions based on type
        let variationInstructions = ''
        switch (variationType) {
          case 'similar':
            variationInstructions = 'Create variations that convey the same core message but with different wording, structure, or emphasis.'
            break
          case 'different-angles':
            variationInstructions = 'Create variations that approach the topic from different perspectives, angles, or viewpoints while maintaining the core theme.'
            break
          case 'different-tones':
            variationInstructions = 'Create variations with different emotional tones (e.g., serious, humorous, inspirational, conversational, professional).'
            break
        }

        const systemPrompt = `${editToolSystemPrompt({ name: account.name, hasXPremium })}

${conversationContext ? `CONVERSATION CONTEXT:
${conversationContext}
` : ''}

${styleSection}

CHARACTER LIMIT: ${hasXPremium ? 25000 : 280}

VARIATION GENERATION RULES:
1. Generate EXACTLY ${count} variations of the original tweet
2. ${variationInstructions}
3. Each variation must be unique and engaging
4. Maintain the author's voice consistently
5. NEVER use hyphenated words
6. Keep the core value/message of the original tweet
7. Output as JSON array: [{"text": "variation 1"}, {"text": "variation 2"}, ...]
8. Make each variation self contained and complete`

        const fullPrompt = `Original tweet: "${originalTweet}"

Generate ${count} variations of this tweet.
${instruction ? `\nAdditional instructions: ${instruction}` : ''}

Return ONLY a JSON array of tweet variations. No other text.`

        console.log('[GENERATE_VARIATIONS_TOOL] Starting AI generation')
        
        const result = await streamText({
          model: openai('gpt-4o-mini'),
          system: systemPrompt,
          prompt: fullPrompt,
        })

        let fullText = ''
        for await (const textPart of result.textStream) {
          fullText += textPart
        }

        console.log('[GENERATE_VARIATIONS_TOOL] AI response received, length:', fullText.length)

        // Parse the JSON response
        let tweets = []
        try {
          // Clean up the response
          const cleanedText = fullText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
          tweets = JSON.parse(cleanedText)
          
          if (!Array.isArray(tweets)) {
            throw new Error('Response is not an array')
          }
          
          // Add the original tweet as the first item
          tweets = [
            { id: nanoid(), text: originalTweet, index: 0, isOriginal: true },
            ...tweets.map((tweet, index) => ({
              id: nanoid(),
              text: typeof tweet === 'string' ? tweet : tweet.text || tweet.content || '',
              index: index + 1,
              isOriginal: false,
            }))
          ].filter(tweet => tweet.text.trim().length > 0)
          
        } catch (parseError) {
          console.error('[GENERATE_VARIATIONS_TOOL] Failed to parse AI response:', parseError)
          // Fallback: try to extract tweets from the text
          const tweetMatches = fullText.match(/"([^"]+)"/g) || []
          tweets = [
            { id: nanoid(), text: originalTweet, index: 0, isOriginal: true },
            ...tweetMatches.slice(0, count).map((match, index) => ({
              id: nanoid(),
              text: match.replace(/^"|"$/g, ''),
              index: index + 1,
              isOriginal: false,
            }))
          ]
        }

        console.log('[GENERATE_VARIATIONS_TOOL] Generated variations count:', tweets.length - 1)

        // Cache the tweets for bulk operations
        if (chatId) {
          try {
            await redis.setex(`chat:bulk-tweets:${chatId}`, 60 * 60, JSON.stringify(tweets))
            console.log('[GENERATE_VARIATIONS_TOOL] Cached tweets for chat:', chatId)
          } catch (cacheErr) {
            console.warn('[GENERATE_VARIATIONS_TOOL] Failed to cache tweets:', (cacheErr as Error)?.message)
          }
        }

        // Send the final result
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: `Generated ${tweets.length - 1} variations`,
            status: 'complete',
            tweets: tweets,
          },
        })

        console.log('[GENERATE_VARIATIONS_TOOL] Tool execution complete')
        return { success: true, tweets }
        
      } catch (error) {
        console.error('[GENERATE_VARIATIONS_TOOL] Error:', error)
        writer.write({
          type: 'data-tool-output',
          id: toolId,
          data: {
            text: `Error generating variations: ${(error as Error).message}`,
            status: 'error',
            tweets: [],
          },
        })
        throw error
      }
    },
  })
}
