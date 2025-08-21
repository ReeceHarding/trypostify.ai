import { editToolSystemPrompt } from '@/lib/prompt-utils'
import { streamText, tool, UIMessageStreamWriter } from 'ai'
import { openai } from '@ai-sdk/openai'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { Account } from '../../settings-router'
import { redis } from '../../../../lib/redis'
import { Style } from '../../style-router'

// Use official OpenAI adapter to ensure SDK-compliant chunks

export const createTweetTool = (
  writer: UIMessageStreamWriter,
  account: Account,
  style: Style,
  hasXPremium: boolean,
  conversationContext?: string,
  websiteContent?: any[],
  chatId?: string
) => {
  return tool({
    description: 'Write a tweet based on user instruction',
    inputSchema: z.object({
      instruction: z.string().describe('User instruction for tweet creation'),
      tweetContent: z
        .string()
        .optional()
        .describe(
          "Optional: If editing an existing tweet, the exact content of that tweet"
        ),
      imageDescriptions: z
        .array(z.string())
        .optional()
        .describe(
          'Optional: Descriptions of any attached images to use as context'
        ),
    }),
    execute: async ({ instruction, tweetContent, imageDescriptions }) => {
      const generationId = nanoid()

      try {
        console.log('[CREATE_TWEET_TOOL] ===== TOOL CALLED =====')
        console.log('[CREATE_TWEET_TOOL] Instruction:', instruction)
        console.log('[CREATE_TWEET_TOOL] Has existing content:', !!tweetContent)
        console.log('[CREATE_TWEET_TOOL] Has images:', !!imageDescriptions?.length)
        console.log('[CREATE_TWEET_TOOL] Starting tweet generation with ID:', generationId)
        writer.write({
          type: 'data-tool-output',
          id: generationId,
          data: {
            text: '',
            status: 'processing',
          },
        })
        console.log('[CREATE_TWEET_TOOL] Sent processing status')

        let fullPrompt = instruction

        // Add image descriptions if provided
        if (imageDescriptions && imageDescriptions.length > 0) {
          fullPrompt += '\n\nAttached images:\n' + imageDescriptions.join('\n')
        }

        // Add tweet content if editing
        if (tweetContent) {
          fullPrompt += `\n\nExisting tweet to edit:\n${tweetContent}`
        }

        // Log style data for debugging
        console.log('[CREATE_TWEET_TOOL] ===== STYLE DATA DEBUG =====')
        console.log('[CREATE_TWEET_TOOL] Style prompt exists:', !!style.prompt)
        console.log('[CREATE_TWEET_TOOL] Style prompt content:', JSON.stringify(style.prompt))
        console.log('[CREATE_TWEET_TOOL] Style tweets count:', style.tweets?.length || 0)
        console.log('[CREATE_TWEET_TOOL] Style tweets preview:', style.tweets?.slice(0, 2).map(t => t.text.substring(0, 50) + '...'))
        console.log('[CREATE_TWEET_TOOL] Account name for style:', account.name)
        console.log('[CREATE_TWEET_TOOL] ===== END STYLE DEBUG =====')

        // Build comprehensive style section
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
        
        if (!style.prompt?.trim() && (!style.tweets || style.tweets.length === 0)) {
          styleSection += `WARNING: No custom style data available. Use natural, engaging Twitter style.\n\n`
        }
        
        styleSection += '=== END STYLE REQUIREMENTS ===\n\n'

        const systemPrompt = `${editToolSystemPrompt({ name: account.name, hasXPremium })}

${conversationContext ? `CONVERSATION CONTEXT:
${conversationContext}

Use this context to understand what the user is referring to when creating the tweet.
` : ''}

${styleSection}

CHARACTER LIMIT: ${hasXPremium ? 25000 : 280}`

        console.log('[CREATE_TWEET_TOOL] System prompt being sent to AI:', systemPrompt.substring(0, 500) + '...')
        console.log('[CREATE_TWEET_TOOL] Full prompt being sent to AI:', fullPrompt)
        
        const result = streamText({
          model: openai('gpt-4o-mini'),
          system: systemPrompt,
          prompt: fullPrompt,
        })

        let fullText = ''
        for await (const textPart of result.textStream) {
          fullText += textPart
          console.log('[CREATE_TWEET_TOOL] Streaming text chunk:', JSON.stringify(textPart), 'total length:', fullText.length)
          writer.write({
            type: 'data-tool-output',
            id: generationId,
            data: {
              text: fullText,
              status: 'streaming',
            },
          })
        }

        console.log('[CREATE_TWEET_TOOL] Sending final result, text length:', fullText.length)
        console.log('[CREATE_TWEET_TOOL] Final generated content:', JSON.stringify(fullText))
        writer.write({
          type: 'data-tool-output',
          id: generationId,
          data: {
            text: fullText,
            status: 'complete',
          },
        })
        console.log('[CREATE_TWEET_TOOL] Tweet generation completed successfully')

        // Persist last generated tweet text for this chat to enable commands like "post it"
        try {
          if (chatId && fullText && fullText.trim().length > 0) {
            await redis.setex(`chat:last-tweet:${chatId}`, 60 * 60, fullText)
            console.log('[CREATE_TWEET_TOOL] Cached last tweet for chat:', chatId, 'Content length:', fullText.length, 'Content preview:', fullText.substring(0, 100) + '...', 'Full content:', JSON.stringify(fullText))
          }
        } catch (cacheErr) {
          console.warn('[CREATE_TWEET_TOOL] Failed to cache last tweet:', (cacheErr as Error)?.message)
        }

        return fullText
    } catch (error) {
      console.error('[CREATE_TWEET_TOOL] Error:', error)
      
      writer.write({
        type: 'data-tool-output',
        id: generationId,
        data: {
          text: `Sorry, I encountered an error while creating your tweet: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`,
          status: 'error',
        },
      })
      
      throw error
    }
    },
  })
}
