import { assistantPrompt } from '@/lib/prompt-utils'
import { DiffWithReplacement } from '@/lib/utils'
import { XmlPrompt } from '@/lib/xml-prompt'
import {
  convertToModelMessages,
  CoreMessage,
  createIdGenerator,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  UIMessage,
} from 'ai'
import { format } from 'date-fns'
import 'diff-match-patch-line-and-word'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { redis } from '../../../lib/redis'
import { j, privateProcedure } from '../../jstack'
import { create_read_website_content } from './read-website-content'
import { parseAttachments } from './utils'
import { createTweetTool } from './tools/create-tweet-tool'

import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { openai } from '@ai-sdk/openai'
import { getAccount } from '../utils/get-account'
import { Ratelimit } from '@upstash/ratelimit'
import { Account } from '../settings-router'
import { Style } from '../style-router'

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
})

// Validate OpenRouter API key on startup
if (!process.env.OPENROUTER_API_KEY) {
  console.error('[CHAT_ROUTER] Warning: OPENROUTER_API_KEY is not set')
}

// ==================== Types ====================

export interface EditTweetToolResult {
  id: string
  improvedText: string
  diffs: DiffWithReplacement[]
}

// Custom message type that ensures all messages have an ID
export type ChatMessage = Omit<UIMessage, 'content'> & {
  content: string | UIMessage['parts']
  role: CoreMessage['role']
  id: string
  metadata?: MessageMetadata
  chatId?: string
}

export interface Chat {
  id: string
  messages: ChatMessage[]
}

export interface WebScrapingResult {
  url: string
  content?: string
  screenshot?: string
  error?: string
}

// ==================== Schemas ====================

const attachmentSchema = z.object({
  id: z.string(),
  title: z.string().optional().nullable(),
  fileKey: z.string().optional(), // only for chat attachments
  type: z.enum(['url', 'txt', 'docx', 'pdf', 'image', 'manual', 'video']),
  variant: z.enum(['knowledge', 'chat']),
})

export type TAttachment = z.infer<typeof attachmentSchema>

const messageMetadataSchema = z.object({
  attachments: z.array(attachmentSchema).optional(),
})

export type Attachment = z.infer<typeof attachmentSchema>
export type MessageMetadata = z.infer<typeof messageMetadataSchema>

const chatMessageSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  metadata: messageMetadataSchema.optional(),
})

export type Metadata = {
  userMessage: string
  attachments: Array<TAttachment>
  editorContent: string
}

export interface ChatHistoryItem {
  id: string
  title: string
  lastUpdated: string
}

export type MyUIMessage = UIMessage<
  Metadata,
  {
    'main-response': {
      text: string
      status: 'streaming' | 'complete'
    }
    'tool-output': {
      text: string
      status: 'processing' | 'streaming' | 'complete'
    }
    writeTweet: {
      status: 'processing'
    }
  },
  {
    readWebsiteContent: {
      input: { website_url: string }
      output: {
        url: string
        title: string
        content: string
      }
    }
  }
>
// ==================== Route Handlers ====================

export const chatRouter = j.router({
  get_message_history: privateProcedure
    .input(z.object({ chatId: z.string().nullable() }))
    .get(async ({ c, input, ctx }) => {
      const { chatId } = input
      const { user } = ctx

      if (!chatId) {
        return c.superjson({ messages: [] })
      }

      const messages = await redis.get<MyUIMessage[]>(`chat:history:${chatId}`)

      if (!messages) {
        return c.superjson({ messages: [] })
      }

      // const chat = await redis.json.get<{ messages: UIMessage[] }>(
      //   `chat:${user.email}:${chatId}`,
      // )

      // const visibleMessages = chat ? filterVisibleMessages(chat.messages) : []

      return c.superjson({ messages })
    }),

  history: privateProcedure.query(async ({ c, ctx }) => {
    const { user } = ctx

    const historyKey = `chat:history-list:${user.email}`
    const chatHistory = (await redis.get<ChatHistoryItem[]>(historyKey)) || []

    return c.superjson({
      chatHistory: chatHistory.slice(0, 20),
    })
  }),

  chat: privateProcedure
    .input(
      z.object({
        message: z.any(),
        id: z.string(),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { id, message } = input as { message: MyUIMessage; id: string }

      const limiter =
        user.plan === 'pro'
          ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(80, '4h') })
          : new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(5, '1d') })

      const [account, history, parsedAttachments, limitResult] = await Promise.all([
        getAccount({ email: user.email }),
        redis.get<MyUIMessage[]>(`chat:history:${id}`),
        parseAttachments({
          attachments: message.metadata?.attachments,
        }),
        limiter.limit(user.email),
      ])

      if (process.env.NODE_ENV === 'production') {
        const { success } = limitResult

        if (!success) {
          if (user.plan === 'pro') {
            throw new HTTPException(429, {
              message: `You've reached your hourly message limit. Please try again in a few hours.`,
            })
          } else {
            throw new HTTPException(429, {
              message: 'Free plan limit reached, please upgrade to continue.',
            })
          }
        }
      }

      if (!account) {
        throw new HTTPException(412, { message: 'No connected account' })
      }

      const { links, attachments } = parsedAttachments

      const content = new XmlPrompt()
      const userContent = message.parts.reduce(
        (acc, curr) => (curr.type === 'text' ? acc + curr.text : ''),
        '',
      )

      content.open('message', { date: format(new Date(), 'EEEE, yyyy-MM-dd') })

      content.tag('user_message', userContent)

      if (Boolean(links.length)) {
        content.open('attached_links', { note: 'please read these links.' })
        links.filter(Boolean).forEach((l) => content.tag('link', l.link))
        content.close('attached_links')
      }

      // Add attached document content for knowledge documents
      if (Boolean(attachments.length)) {
        const textAttachments = attachments.filter((a) => a?.type === 'text')
        if (textAttachments.length > 0) {
          content.open('attached_documents', { note: 'Use this attached document content as context for your response.' })
          textAttachments.forEach((attachment: any) => {
            content.tag('document_content', attachment.text)
          })
          content.close('attached_documents')
        }
      }

      if (message.metadata?.editorContent) {
        content.tag('tweet_draft', message.metadata.editorContent)
      }

      content.close('message')

      // Include text parts always; include file parts only if using a vision-capable model
      const textParts = attachments.filter((p) => p?.type === 'text')
      // Only include UI file parts (with url) to satisfy UIMessagePart typing
      const fileParts = attachments.filter((p: any) => p?.type === 'file' && 'url' in p)

      const hasImage = fileParts.length > 0

      const userMessage: MyUIMessage = {
        ...message,
        parts: [
          { type: 'text', text: content.toString() },
          ...textParts,
          // pass images when present; we will route to a vision model below
          ...(hasImage ? fileParts : []),
        ],
      }

      const messages = [...(history ?? []), userMessage] as MyUIMessage[]

      const stream = createUIMessageStream<MyUIMessage>({
        originalMessages: messages,
        generateId: createIdGenerator({
          prefix: 'msg',
          size: 16,
        }),
        onFinish: async ({ messages }) => {
          await redis.set(`chat:history:${id}`, messages)

          const historyKey = `chat:history-list:${user.email}`
          const existingHistory = (await redis.get<ChatHistoryItem[]>(historyKey)) || []

          const title = messages[0]?.metadata?.userMessage ?? 'Unnamed chat'

          const chatHistoryItem: ChatHistoryItem = {
            id,
            title,
            lastUpdated: new Date().toISOString(),
          }

          const updatedHistory = [
            chatHistoryItem,
            ...existingHistory.filter((item) => item.id !== id),
          ]

          await redis.set(historyKey, updatedHistory)
        },
        onError(error) {
          console.log('[ERROR] CHAT_ROUTER:', JSON.stringify(error, null, 2))

          throw new HTTPException(500, {
            message: error instanceof Error ? error.message : 'Something went wrong.',
          })
        },
        execute: async ({ writer }) => {
          const readWebsiteContent = create_read_website_content({ chatId: id })
          
          // Fetch account data once 
          const [style, accountData] = await Promise.all([
            redis.json.get<Style>(`style:${user.email}:${account.id}`),
            redis.json.get<Account>(`account:${user.email}:${account.id}`),
          ])

          if (!style || !accountData) {
            throw new HTTPException(412, { 
              message: 'Account settings not found. Please configure your account settings first.' 
            })
          }

          // Get any website content that was scraped
          const websiteContent = await redis.lrange(`website-contents:${id}`, 0, -1)
          
          // Clean up website content after reading
          if (websiteContent && websiteContent.length > 0) {
            await redis.del(`website-contents:${id}`)
          }
          
          // Build conversation context from previous messages
          let conversationContext = messages
            .slice(0, -1) // Exclude current message
            .slice(-4) // Take last 4 messages for context
            .map(msg => {
              if (msg.role === 'user') {
                return `User: ${msg.metadata?.userMessage || msg.parts?.find(p => p.type === 'text')?.text || ''}`
              } else if (msg.role === 'assistant') {
                return `Assistant: ${msg.parts?.find(p => p.type === 'text')?.text || ''}`
              }
              return ''
            })
            .filter(Boolean)
            .join('\n\n')
            
          // Add website content to context if available
          if (websiteContent && websiteContent.length > 0) {
            conversationContext += '\n\nWEBSITE CONTENT:\n'
            websiteContent.forEach((content: any) => {
              if (content.title && content.content) {
                conversationContext += `\nTitle: ${content.title}\nURL: ${content.url}\nContent: ${content.content.substring(0, 1000)}...\n`
              }
            })
          }

          // Create writeTweet tool with conversation context
          const writeTweet = createTweetTool(
            writer, 
            accountData, 
            style, 
            user.hasXPremium || false,
            conversationContext
          )

          // Log attachment composition for debugging
          try {
            console.log('[CHAT] preparing model call', JSON.stringify({
              messagePartsCount: messages[messages.length - 1]?.parts?.length,
              lastMessageTypes: messages[messages.length - 1]?.parts?.map((p) => p.type),
            }))
          } catch {}

          // When we have images, we need to use a different message format
          // convertToModelMessages expects specific formats, so we'll use a different approach
          let result
          try {
            result = await (async () => {
              if (hasImage) {
                // For vision models, convert the last message to include image format
                const modelMessages = convertToModelMessages(messages.slice(0, -1) as any)
                // Convert to Vercel AI SDK image format
                const imageParts = fileParts.map((p: any) => ({
                  type: 'image' as const,
                  image: p.url,
                }))

                // Limit history to the last few messages to reduce prompt size/latency
                const limitedModelMessages = modelMessages.slice(-8)
                return streamText({
                  model: openrouter.chat('openai/gpt-4o-mini'),
                  system: assistantPrompt({ editorContent: message.metadata?.editorContent }),
                  messages: [
                    ...limitedModelMessages,
                    {
                      role: 'user',
                      content: [
                        { type: 'text', text: content.toString() },
                        ...imageParts,
                      ],
                    },
                  ],
                  tools: { readWebsiteContent, writeTweet },
                  stopWhen: stepCountIs(2),
                })
              } else {
                // For non-vision models, use standard conversion
                console.log(`[${new Date().toISOString()}] [chat-router] using fast model for non-vision path: openai/gpt-4o-mini`)
                // Limit history to the last few messages to reduce prompt size/latency
                const limited = messages.slice(-8) as any
                return streamText({
                  model: openrouter.chat('openai/gpt-4o-mini'),
                  system: assistantPrompt({ editorContent: message.metadata?.editorContent }),
                  messages: convertToModelMessages(limited),
                  tools: { readWebsiteContent, writeTweet },
                  stopWhen: stepCountIs(2),
                })
              }
            })()
          } catch (err: any) {
            // Fallback retry using official OpenAI adapter to avoid provider-specific annotations
            console.error(`[${new Date().toISOString()}] [chat-router] primary model failed, retrying with @ai-sdk/openai. errorName=${err?.name} message=${err?.message}`)
            if (hasImage) {
              const modelMessages = convertToModelMessages(messages.slice(0, -1) as any)
              const imageParts = fileParts.map((p: any) => ({
                type: 'image' as const,
                image: p.url,
              }))
              const limitedModelMessages = modelMessages.slice(-8)
              result = await streamText({
                model: openai('gpt-4o-mini'),
                system: assistantPrompt({ editorContent: message.metadata?.editorContent }),
                messages: [
                  ...limitedModelMessages,
                  {
                    role: 'user',
                    content: [
                      { type: 'text', text: content.toString() },
                      ...imageParts,
                    ],
                  },
                ],
                tools: { readWebsiteContent, writeTweet },
                stopWhen: stepCountIs(2),
              })
            } else {
              const limited = messages.slice(-8) as any
              result = await streamText({
                model: openai('gpt-4o-mini'),
                system: assistantPrompt({ editorContent: message.metadata?.editorContent }),
                messages: convertToModelMessages(limited),
                tools: { readWebsiteContent, writeTweet },
                stopWhen: stepCountIs(2),
              })
            }
          }

          writer.merge(result.toUIMessageStream())
        },
      })

      return createUIMessageStreamResponse({ stream })
    }),
})
