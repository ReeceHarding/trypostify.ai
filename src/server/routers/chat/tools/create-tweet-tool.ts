import { editToolSystemPrompt } from '@/lib/prompt-utils'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { streamText, tool, UIMessageStreamWriter } from 'ai'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { Account } from '../../settings-router'
import { Style } from '../../style-router'

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

export const createTweetTool = (
  writer: UIMessageStreamWriter,
  account: Account,
  style: Style,
  hasXPremium: boolean
) => {
  return tool({
    description: 'Write a tweet based on user instruction',
    inputSchema: z.object({
      instruction: z.string().describe('User instruction for tweet creation'),
    }),
    execute: async ({ instruction }) => {
      const generationId = nanoid()

      writer.write({
        type: 'data-tool-output',
        id: generationId,
        data: {
          text: '',
          status: 'processing',
        },
      })

      const systemPrompt = editToolSystemPrompt({ name: account.name, hasXPremium })

      const result = streamText({
        model: openrouter.chat('openai/o4-mini'),
        system: systemPrompt,
        prompt: instruction,
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
    },
  })
}
