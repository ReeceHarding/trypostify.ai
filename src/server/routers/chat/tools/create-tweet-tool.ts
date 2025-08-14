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
        writer.write({
          type: 'data-tool-output',
          id: generationId,
          data: {
            text: '',
            status: 'processing',
          },
        })

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
${JSON.stringify(style, null, 2)}

CHARACTER LIMIT: ${hasXPremium ? 25000 : 280}`

        const result = streamText({
          model: openai('gpt-4o-mini'),
          system: systemPrompt,
          prompt: fullPrompt,
        })

        let fullText = ''
        for await (const textPart of result.textStream) {
          fullText += textPart
          writer.write({
            type: 'data-tool-output',
            id: generationId,
            data: {
              text: fullText,
              status: 'streaming',
            },
          })
        }

        writer.write({
          type: 'data-tool-output',
          id: generationId,
          data: {
            text: fullText,
            status: 'complete',
          },
        })

        return fullText
    } catch (error) {
      console.error('[CREATE_TWEET_TOOL] Error:', error)
      
      writer.write({
        type: 'data-tool-output',
        id: generationId,
        data: {
          text: 'Sorry, I encountered an error while creating your tweet. Please try again.',
          status: 'error',
        },
      })
      
      throw error
    }
    },
  })
}
