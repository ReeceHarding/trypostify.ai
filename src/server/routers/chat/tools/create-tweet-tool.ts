import { editToolSystemPrompt } from '@/lib/prompt-utils'
import { streamText, tool, UIMessageStreamWriter } from 'ai'
import { openai } from '@ai-sdk/openai'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { Account } from '../../settings-router'
import { Style } from '../../style-router'

// Use official OpenAI adapter to ensure SDK-compliant chunks

export const createTweetTool = (
  writer: UIMessageStreamWriter,
  account: Account,
  style: Style,
  hasXPremium: boolean,
  conversationContext?: string,
  websiteContent?: any[]
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

        const systemPrompt = `${editToolSystemPrompt({ name: account.name, hasXPremium })}

${conversationContext ? `CONVERSATION CONTEXT:
${conversationContext}

Use this context to understand what the user is referring to when creating the tweet.
` : ''}

STYLE GUIDE:
${style.prompt ? `Custom Instructions: ${style.prompt}\n` : ''}
${style.tweets && style.tweets.length > 0 ? `\nExample tweets that demonstrate the writing style to follow:\n${style.tweets.map((t, i) => `${i + 1}. ${t.text}`).join('\n')}\n` : ''}

CHARACTER LIMIT: ${hasXPremium ? 25000 : 280}`

        const result = streamText({
          model: openai('gpt-4o-mini'),
          system: systemPrompt,
          prompt: fullPrompt,
        })

        let fullText = ''
        for await (const textPart of result.textStream) {
          fullText += textPart
          console.log('[CREATE_TWEET_TOOL] Streaming text chunk, total length:', fullText.length)
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
        writer.write({
          type: 'data-tool-output',
          id: generationId,
          data: {
            text: fullText,
            status: 'complete',
          },
        })
        console.log('[CREATE_TWEET_TOOL] Tweet generation completed successfully')

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
