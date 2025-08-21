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
import { createPostNowTool } from './tools/post-now-tool'
import { createQueueTool } from './tools/queue-tool'
import { createScheduleTool } from './tools/schedule-tool'

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
    'data-tool-output': {
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

      // Regenerate fresh signed URLs for any expired image URLs in message history
      const refreshedMessages = await Promise.all(messages.map(async (message) => {
        if (!message.parts) return message;
        
        const refreshedParts = await Promise.all(message.parts.map(async (part) => {
          // Check if this is a file part with an S3 URL that might be expired
          if (part.type === 'file' && 'url' in part && part.url?.includes('s3.us-east-1.amazonaws.com')) {
            console.log('[CHAT_HISTORY] Found S3 URL in chat history, checking expiration:', part.url.substring(0, 100) + '...')
            
            // Check if URL has expired by looking at X-Amz-Date and X-Amz-Expires
            try {
              const url = new URL(part.url)
              const amzDate = url.searchParams.get('X-Amz-Date')
              const amzExpires = url.searchParams.get('X-Amz-Expires')
              
              if (amzDate && amzExpires) {
                const signedTime = new Date(amzDate.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z'))
                const expiresInMs = parseInt(amzExpires) * 1000
                const expirationTime = new Date(signedTime.getTime() + expiresInMs)
                
                if (new Date() > expirationTime) {
                  console.log('[CHAT_HISTORY] S3 URL expired, removing from chat history to prevent OpenAI errors')
                  // Return a text part explaining the image was removed due to expiration
                  return {
                    type: 'text' as const,
                    text: '[Image removed - expired]'
                  }
                }
              }
            } catch (error) {
              console.log('[CHAT_HISTORY] Error parsing S3 URL, removing to be safe:', error)
              return {
                type: 'text' as const,
                text: '[Image removed - invalid URL]'
              }
            }
          }
          

          return part;
        }));
        
        // Filter out any null parts (failed URL regenerations)
        const validParts = refreshedParts.filter(Boolean);
        return { ...message, parts: validParts };
      }));

      return c.superjson({ messages: refreshedMessages })
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

      // All users now have pro-level rate limiting
      const limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(80, '4h') })

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
          throw new HTTPException(429, {
            message: `You've reached your hourly message limit. Please try again in a few hours.`,
          })
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

      // Include text parts always; include only true image files in vision-capable model path
      const textParts = attachments.filter((p) => p?.type === 'text')
      // Only include UI file parts (with url); then filter to image/* media types explicitly
      const fileParts = attachments.filter((p: any) => p?.type === 'file' && 'url' in p)
      const imageFileParts = (fileParts as any[]).filter(
        (p: any) => typeof p.mediaType === 'string' && p.mediaType.startsWith('image/'),
      )

      const hasImage = imageFileParts.length > 0

      try {
        console.log('[CHAT] file parts mediaTypes', (fileParts as any[]).map((p: any) => p.mediaType))
      } catch {}

      const userMessage: MyUIMessage = {
        ...message,
        parts: [
          { type: 'text', text: content.toString() },
          ...textParts,
          // pass only image files (image/*) when present; we will route to a vision model below
          ...(hasImage ? imageFileParts : []),
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
          
          // Check if this is an S3 URL download error from OpenAI
          const errorMessage = error instanceof Error ? error.message : 'Something went wrong.'
          if (errorMessage.includes('Error while downloading') && errorMessage.includes('s3.us-east-1.amazonaws.com')) {
            console.log('[CHAT_ROUTER] S3 URL download error detected - this should have been prevented by URL filtering')
            console.log('[CHAT_ROUTER] Please check the chat history filtering logic')
            // Return a helpful message instead of throwing
            return 'I encountered an issue with an expired image from your chat history. The image has been removed to prevent future errors.'
          }

          throw new HTTPException(500, {
            message: errorMessage,
          })
        },
        execute: async ({ writer }) => {
          const readWebsiteContent = create_read_website_content({ chatId: id })
          
          // Fetch account data once 
          const [style, accountData] = await Promise.all([
            redis.json.get<Style>(`style:${user.email}:${account.id}`),
            redis.json.get<Account>(`account:${user.email}:${account.id}`),
          ])

          console.log('[CHAT] ===== STYLE RETRIEVAL DEBUG =====')
          console.log('[CHAT] Style key used:', `style:${user.email}:${account.id}`)
          console.log('[CHAT] Style retrieved:', !!style)
          console.log('[CHAT] Style prompt:', style?.prompt ? 'EXISTS' : 'EMPTY')
          console.log('[CHAT] Style tweets count:', style?.tweets?.length || 0)
          console.log('[CHAT] Account data retrieved:', !!accountData)
          console.log('[CHAT] ===== END STYLE RETRIEVAL DEBUG =====')

          if (!style || !accountData) {
            console.log('[CHAT] ERROR: Missing style or account data', { 
              hasStyle: !!style, 
              hasAccountData: !!accountData,
              styleKey: `style:${user.email}:${account.id}`
            })
            throw new HTTPException(412, { 
              message: 'Account settings not found. Please configure your account settings first.' 
            })
          }

          // Get any website content that was scraped
          const websiteContent = await redis.lrange(`website-contents:${id}`, 0, -1)
          
          // Log website content retrieval
          console.log(`[CHAT] Retrieved ${websiteContent?.length || 0} website content items for chat ${id}`)
          
          // Clean up website content after reading
          if (websiteContent && websiteContent.length > 0) {
            await redis.del(`website-contents:${id}`)
            console.log(`[CHAT] Cleaned up website content for chat ${id}`)
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

          // Create writeTweet tool with conversation context and website content
          console.log('[CHAT_ROUTER] Creating tweet tool for user:', user.id, 'account:', accountData?.name)
          console.log('[CHAT_ROUTER] User message content:', userContent)
          console.log('[CHAT_ROUTER] Has conversation context:', !!conversationContext)
          console.log('[CHAT_ROUTER] Has website content:', websiteContent?.length || 0)
          console.log('[CHAT_ROUTER] Editor content present:', !!message.metadata?.editorContent)
          
          const writeTweet = createTweetTool(
            writer, 
            accountData, 
            style, 
            user.hasXPremium || false,
            conversationContext,
            websiteContent,
            id
          )
          
          // Create posting/scheduling tools with conversation context
          const postNow = createPostNowTool(writer, user.id, accountData.id, conversationContext, id)
          const queueTweet = createQueueTool(writer, user.id, accountData.id, conversationContext, id)
          const scheduleTweet = createScheduleTool(writer, user.id, accountData.id, conversationContext, id)
          
          console.log('[CHAT_ROUTER] All tools created successfully')

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
              const systemPromptContent = assistantPrompt({ editorContent: message.metadata?.editorContent })
              console.log('[CHAT_ROUTER] System prompt length:', systemPromptContent.length)
              console.log('[CHAT_ROUTER] System prompt contains "writeTweet":', systemPromptContent.includes('writeTweet'))
              console.log('[CHAT_ROUTER] System prompt contains "DEFAULT":', systemPromptContent.includes('DEFAULT'))
              
              if (hasImage) {
                // For vision models, convert the last message to include image format
                console.log('[CHAT_ROUTER] Using vision model path with images')
                
                // Validate and potentially regenerate URLs in historical messages before converting
                const historicalMessages = messages.slice(0, -1);
                const validatedHistoricalMessages = await Promise.all(historicalMessages.map(async (msg) => {
                  if (!msg.parts) return msg;
                  
                  const validatedParts = await Promise.all(msg.parts.map(async (part) => {
                    // Check if this is a file part with an image URL that might be expired
                    if (part.type === 'file' && 'url' in part && part.url && 'fileKey' in part && part.fileKey && typeof part.fileKey === 'string') {
                      try {
                        // Check if URL is expired by looking at the expiration time in the URL
                        const url = new URL(part.url);
                        const expiresParam = url.searchParams.get('X-Amz-Expires');
                        const dateParam = url.searchParams.get('X-Amz-Date');
                        
                        if (expiresParam && dateParam) {
                          // Parse AWS ISO 8601 format: 20250819T203653Z -> 2025-08-19T20:36:53Z
                          const formattedDate = dateParam.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z');
                          const signedDate = new Date(formattedDate);
                          const expirationDate = new Date(signedDate.getTime() + parseInt(expiresParam) * 1000);
                          
                          // If URL expires within the next 5 minutes, regenerate it
                          if (expirationDate.getTime() < Date.now() + (5 * 60 * 1000)) {
                            console.log('[CHAT_ROUTER] Regenerating expired S3 URL in historical message for fileKey:', part.fileKey);
                            
                            // Import S3 utilities
                            const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
                            const { GetObjectCommand } = await import('@aws-sdk/client-s3');
                            const { s3Client, BUCKET_NAME } = await import('@/lib/s3');
                            
                            // Generate fresh signed URL
                            const freshUrl = await getSignedUrl(
                              s3Client,
                              new GetObjectCommand({ Bucket: BUCKET_NAME, Key: part.fileKey }),
                              { expiresIn: 3600 } // 1 hour
                            );
                            
                            console.log('[CHAT_ROUTER] Generated fresh S3 URL in historical message for fileKey:', part.fileKey);
                            return { ...part, url: freshUrl };
                          }
                        }
                        return part;
                      } catch (error) {
                        console.error('[CHAT_ROUTER] Error validating/regenerating S3 URL in historical message:', error);
                        // If we can't validate/regenerate, exclude this image to prevent OpenAI errors
                        return null;
                      }
                    }
                    return part;
                  }));
                  
                  // Filter out any null parts (failed URL regenerations)
                  const validParts = validatedParts.filter(Boolean);
                  return { ...msg, parts: validParts };
                }));
                
                const modelMessages = convertToModelMessages(validatedHistoricalMessages as any)
                
                // Validate and potentially regenerate image URLs before sending to OpenAI
                const validatedImageParts = await Promise.all(imageFileParts.map(async (p: any) => {
                  try {
                    // Check if URL is expired by looking at the expiration time in the URL
                    const url = new URL(p.url);
                    const expiresParam = url.searchParams.get('X-Amz-Expires');
                    const dateParam = url.searchParams.get('X-Amz-Date');
                    
                    console.log('[CHAT_ROUTER] Validating image URL:', {
                      hasFileKey: Boolean((p as any)?.fileKey),
                      fileKey: (p as any)?.fileKey,
                      hasExpiresParam: Boolean(expiresParam),
                      hasDateParam: Boolean(dateParam),
                      urlHost: url.hostname
                    });
                    
                    if (expiresParam && dateParam) {
                      // Parse AWS ISO 8601 format: 20250819T203653Z -> 2025-08-19T20:36:53Z
                      const formattedDate = dateParam.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z');
                      const signedDate = new Date(formattedDate);
                      const expirationDate = new Date(signedDate.getTime() + parseInt(expiresParam) * 1000);
                      
                      console.log('[CHAT_ROUTER] URL expiration check:', {
                        dateParam,
                        formattedDate,
                        signedDate: signedDate.toISOString(),
                        expirationDate: expirationDate.toISOString(),
                        currentTime: new Date().toISOString(),
                        isExpired: expirationDate.getTime() < Date.now(),
                        fileKey: (p as any).fileKey
                      });
                      
                      // If URL expires within the next 5 minutes, regenerate it
                      if (expirationDate.getTime() < Date.now() + (5 * 60 * 1000)) {
                        console.log('[CHAT_ROUTER] Regenerating expired S3 URL before OpenAI call for fileKey:', (p as any).fileKey);
                        
                        if ((p as any).fileKey) {
                          try {
                            // Import S3 utilities
                            const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
                            const { GetObjectCommand } = await import('@aws-sdk/client-s3');
                            const { s3Client, BUCKET_NAME } = await import('@/lib/s3');
                            
                            // Generate fresh signed URL
                            const freshUrl = await getSignedUrl(
                              s3Client,
                              new GetObjectCommand({ Bucket: BUCKET_NAME, Key: (p as any).fileKey! }),
                              { expiresIn: 3600 } // 1 hour
                            );
                            
                            console.log('[CHAT_ROUTER] Generated fresh S3 URL before OpenAI call for fileKey:', (p as any).fileKey);
                            return { ...p, url: freshUrl };
                          } catch (s3Error) {
                            console.error('[CHAT_ROUTER] Failed to regenerate S3 URL for fileKey:', (p as any).fileKey, s3Error);
                            // Return null to exclude this image from the request
                            return null;
                          }
                        } else {
                          console.warn('[CHAT_ROUTER] No fileKey available for expired URL regeneration');
                          return null;
                        }
                      }
                    } else {
                      console.log('[CHAT_ROUTER] URL missing expiration parameters, assuming valid:', p.url);
                    }
                    return p;
                  } catch (error) {
                    console.error('[CHAT_ROUTER] Error validating/regenerating S3 URL:', error, {
                      url: p?.url,
                      fileKey: (p as any)?.fileKey,
                      hasFileKey: Boolean((p as any)?.fileKey)
                    });
                    // If we can't validate/regenerate, exclude this image to prevent OpenAI errors
                    return null;
                  }
                }));
                
                // Filter out any null entries and convert to Vercel AI SDK image format
                const imageParts = validatedImageParts
                  .filter(Boolean)
                  .map((p: any) => ({
                  type: 'image' as const,
                  image: p.url,
                }))
                
                console.log('[CHAT_ROUTER] Image processing summary:', {
                  originalImageCount: imageFileParts.length,
                  validatedImageCount: validatedImageParts.filter(Boolean).length,
                  excludedImageCount: validatedImageParts.filter(p => p === null).length
                });

                // Limit history to the last few messages to reduce prompt size/latency
                const limitedModelMessages = modelMessages.slice(-12)
                console.log('[CHAT_ROUTER] Vision model - message count:', limitedModelMessages.length, 'image parts:', imageParts.length)
                
                return streamText({
                  model: openai('gpt-4o-mini'),
                  system: systemPromptContent,
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
                  tools: { readWebsiteContent, writeTweet, postNow, queueTweet, scheduleTweet },
                  stopWhen: stepCountIs(2),
                })
              } else {
                // For non-vision models, use standard conversion
                console.log(`[${new Date().toISOString()}] [chat-router] using fast model for non-vision path: openai/gpt-4o-mini (official adapter)`)
                console.log('[CHAT_ROUTER] Standard model - final user message:', content.toString().substring(0, 200))
                console.log('[CHAT_ROUTER] Available tools:', Object.keys({ readWebsiteContent, writeTweet }))
                
                // Validate and potentially regenerate URLs in historical messages before converting (non-vision)
                const historicalMessages = messages.slice(-12);
                const validatedHistoricalMessages = await Promise.all(historicalMessages.map(async (msg) => {
                  if (!msg.parts) return msg;
                  
                  const validatedParts = await Promise.all(msg.parts.map(async (part) => {
                    // Check if this is a file part with an image URL that might be expired
                    if (part.type === 'file' && 'url' in part && part.url && 'fileKey' in part && part.fileKey && typeof part.fileKey === 'string') {
                      try {
                        // Check if URL is expired by looking at the expiration time in the URL
                        const url = new URL(part.url);
                        const expiresParam = url.searchParams.get('X-Amz-Expires');
                        const dateParam = url.searchParams.get('X-Amz-Date');
                        
                        if (expiresParam && dateParam) {
                          // Parse AWS ISO 8601 format: 20250819T203653Z -> 2025-08-19T20:36:53Z
                          const formattedDate = dateParam.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z');
                          const signedDate = new Date(formattedDate);
                          const expirationDate = new Date(signedDate.getTime() + parseInt(expiresParam) * 1000);
                          
                          // If URL expires within the next 5 minutes, regenerate it
                          if (expirationDate.getTime() < Date.now() + (5 * 60 * 1000)) {
                            console.log('[CHAT_ROUTER] Regenerating expired S3 URL in non-vision historical message for fileKey:', part.fileKey);
                            
                            // Import S3 utilities
                            const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
                            const { GetObjectCommand } = await import('@aws-sdk/client-s3');
                            const { s3Client, BUCKET_NAME } = await import('@/lib/s3');
                            
                            // Generate fresh signed URL
                            const freshUrl = await getSignedUrl(
                              s3Client,
                              new GetObjectCommand({ Bucket: BUCKET_NAME, Key: part.fileKey }),
                              { expiresIn: 3600 } // 1 hour
                            );
                            
                            console.log('[CHAT_ROUTER] Generated fresh S3 URL in non-vision historical message for fileKey:', part.fileKey);
                            return { ...part, url: freshUrl };
                          }
                        }
                        return part;
                      } catch (error) {
                        console.error('[CHAT_ROUTER] Error validating/regenerating S3 URL in non-vision historical message:', error);
                        // If we can't validate/regenerate, exclude this image to prevent OpenAI errors
                        return null;
                      }
                    }
                    return part;
                  }));
                  
                  // Filter out any null parts (failed URL regenerations)
                  const validParts = validatedParts.filter(Boolean);
                  return { ...msg, parts: validParts };
                }));
                
                const limited = validatedHistoricalMessages as any
                console.log('[CHAT_ROUTER] Standard model - message count:', limited.length)
                
                return streamText({
                  model: openai('gpt-4o-mini'),
                  system: systemPromptContent,
                  messages: convertToModelMessages(limited),
                  tools: { readWebsiteContent, writeTweet, postNow, queueTweet, scheduleTweet },
                  stopWhen: stepCountIs(2),
                })
              }
            })()
            
            console.log('[CHAT_ROUTER] Model stream initiated successfully')
          } catch (err: any) {
            // Fallback retry using official OpenAI adapter to avoid provider-specific annotations
            console.error(`[${new Date().toISOString()}] [chat-router] primary model failed, retrying with @ai-sdk/openai. errorName=${err?.name} message=${err?.message}`)
            console.log('[CHAT_ROUTER] Attempting fallback with identical system prompt')
            if (hasImage) {
              // Validate and potentially regenerate URLs in historical messages before converting (fallback vision)
              const historicalMessages = messages.slice(0, -1);
              const validatedHistoricalMessages = await Promise.all(historicalMessages.map(async (msg) => {
                if (!msg.parts) return msg;
                
                const validatedParts = await Promise.all(msg.parts.map(async (part) => {
                  // Check if this is a file part with an image URL that might be expired
                  if (part.type === 'file' && 'url' in part && part.url && 'fileKey' in part && part.fileKey && typeof part.fileKey === 'string') {
                    try {
                      // Check if URL is expired by looking at the expiration time in the URL
                      const url = new URL(part.url);
                      const expiresParam = url.searchParams.get('X-Amz-Expires');
                      const dateParam = url.searchParams.get('X-Amz-Date');
                      
                      if (expiresParam && dateParam) {
                        // Parse AWS ISO 8601 format: 20250819T203653Z -> 2025-08-19T20:36:53Z
                        const formattedDate = dateParam.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z');
                        const signedDate = new Date(formattedDate);
                        const expirationDate = new Date(signedDate.getTime() + parseInt(expiresParam) * 1000);
                        
                        // If URL expires within the next 5 minutes, regenerate it
                        if (expirationDate.getTime() < Date.now() + (5 * 60 * 1000)) {
                          console.log('[CHAT_ROUTER] Regenerating expired S3 URL in fallback vision historical message for fileKey:', part.fileKey);
                          
                          // Import S3 utilities
                          const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
                          const { GetObjectCommand } = await import('@aws-sdk/client-s3');
                          const { s3Client, BUCKET_NAME } = await import('@/lib/s3');
                          
                          // Generate fresh signed URL
                          const freshUrl = await getSignedUrl(
                            s3Client,
                            new GetObjectCommand({ Bucket: BUCKET_NAME, Key: part.fileKey }),
                            { expiresIn: 3600 } // 1 hour
                          );
                          
                          console.log('[CHAT_ROUTER] Generated fresh S3 URL in fallback vision historical message for fileKey:', part.fileKey);
                          return { ...part, url: freshUrl };
                        }
                      }
                      return part;
                    } catch (error) {
                      console.error('[CHAT_ROUTER] Error validating/regenerating S3 URL in fallback vision historical message:', error);
                      // If we can't validate/regenerate, exclude this image to prevent OpenAI errors
                      return null;
                    }
                  }
                  return part;
                }));
                
                // Filter out any null parts (failed URL regenerations)
                const validParts = validatedParts.filter(Boolean);
                return { ...msg, parts: validParts };
              }));
              
              const modelMessages = convertToModelMessages(validatedHistoricalMessages as any)
              
              // Validate and potentially regenerate image URLs before sending to OpenAI (fallback)
              const validatedImageParts = await Promise.all(imageFileParts.map(async (p: any) => {
                try {
                  // Check if URL is expired by looking at the expiration time in the URL
                  const url = new URL(p.url);
                  const expiresParam = url.searchParams.get('X-Amz-Expires');
                  const dateParam = url.searchParams.get('X-Amz-Date');
                  
                  if (expiresParam && dateParam) {
                    // Parse AWS ISO 8601 format: 20250819T203653Z -> 2025-08-19T20:36:53Z
                    const formattedDate = dateParam.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z');
                    const signedDate = new Date(formattedDate);
                    const expirationDate = new Date(signedDate.getTime() + parseInt(expiresParam) * 1000);
                    
                    // If URL expires within the next 5 minutes, regenerate it
                    if (expirationDate.getTime() < Date.now() + (5 * 60 * 1000)) {
                      console.log('[CHAT_ROUTER] Regenerating expired S3 URL before OpenAI fallback call for fileKey:', (p as any).fileKey);
                      
                      if ((p as any).fileKey) {
                        // Import S3 utilities
                        const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
                        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
                        const { s3Client, BUCKET_NAME } = await import('@/lib/s3');
                        
                        // Generate fresh signed URL
                        const freshUrl = await getSignedUrl(
                          s3Client,
                          new GetObjectCommand({ Bucket: BUCKET_NAME, Key: (p as any).fileKey! }),
                          { expiresIn: 3600 } // 1 hour
                        );
                        
                        console.log('[CHAT_ROUTER] Generated fresh S3 URL before OpenAI fallback call for fileKey:', (p as any).fileKey);
                        return { ...p, url: freshUrl };
                      }
                    }
                  }
                  return p;
                } catch (error) {
                  console.error('[CHAT_ROUTER] Error validating/regenerating S3 URL in fallback:', error);
                  // If we can't validate/regenerate, exclude this image to prevent OpenAI errors
                  return null;
                }
              }));
              
              // Filter out any null entries and convert to Vercel AI SDK image format
              const imageParts = validatedImageParts
                .filter(Boolean)
                .map((p: any) => ({
                type: 'image' as const,
                image: p.url,
              }))
              const limitedModelMessages = modelMessages.slice(-8)
              console.log('[CHAT_ROUTER] Starting vision streamText call with tools')
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
                tools: { readWebsiteContent, writeTweet, postNow, queueTweet, scheduleTweet },
                stopWhen: stepCountIs(2),
              })
              console.log('[CHAT_ROUTER] Vision streamText call completed')
            } else {
              // Validate and potentially regenerate URLs in historical messages before converting (fallback non-vision)
              const historicalMessages = messages.slice(-8);
              const validatedHistoricalMessages = await Promise.all(historicalMessages.map(async (msg) => {
                if (!msg.parts) return msg;
                
                const validatedParts = await Promise.all(msg.parts.map(async (part) => {
                  // Check if this is a file part with an image URL that might be expired
                  if (part.type === 'file' && 'url' in part && part.url && 'fileKey' in part && part.fileKey && typeof part.fileKey === 'string') {
                    try {
                      // Check if URL is expired by looking at the expiration time in the URL
                      const url = new URL(part.url);
                      const expiresParam = url.searchParams.get('X-Amz-Expires');
                      const dateParam = url.searchParams.get('X-Amz-Date');
                      
                      if (expiresParam && dateParam) {
                        // Parse AWS ISO 8601 format: 20250819T203653Z -> 2025-08-19T20:36:53Z
                        const formattedDate = dateParam.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3T$4:$5:$6Z');
                        const signedDate = new Date(formattedDate);
                        const expirationDate = new Date(signedDate.getTime() + parseInt(expiresParam) * 1000);
                        
                        // If URL expires within the next 5 minutes, regenerate it
                        if (expirationDate.getTime() < Date.now() + (5 * 60 * 1000)) {
                          console.log('[CHAT_ROUTER] Regenerating expired S3 URL in fallback non-vision historical message for fileKey:', part.fileKey);
                          
                          // Import S3 utilities
                          const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
                          const { GetObjectCommand } = await import('@aws-sdk/client-s3');
                          const { s3Client, BUCKET_NAME } = await import('@/lib/s3');
                          
                          // Generate fresh signed URL
                          const freshUrl = await getSignedUrl(
                            s3Client,
                            new GetObjectCommand({ Bucket: BUCKET_NAME, Key: part.fileKey }),
                            { expiresIn: 3600 } // 1 hour
                          );
                          
                          console.log('[CHAT_ROUTER] Generated fresh S3 URL in fallback non-vision historical message for fileKey:', part.fileKey);
                          return { ...part, url: freshUrl };
                        }
                      }
                      return part;
                    } catch (error) {
                      console.error('[CHAT_ROUTER] Error validating/regenerating S3 URL in fallback non-vision historical message:', error);
                      // If we can't validate/regenerate, exclude this image to prevent OpenAI errors
                      return null;
                    }
                  }
                  return part;
                }));
                
                // Filter out any null parts (failed URL regenerations)
                const validParts = validatedParts.filter(Boolean);
                return { ...msg, parts: validParts };
              }));
              
              const limited = validatedHistoricalMessages as any
              console.log('[CHAT_ROUTER] Starting standard streamText call with tools')
              result = await streamText({
                model: openai('gpt-4o-mini'),
                system: assistantPrompt({ editorContent: message.metadata?.editorContent }),
                messages: convertToModelMessages(limited),
                tools: { readWebsiteContent, writeTweet, postNow, queueTweet, scheduleTweet },
                stopWhen: stepCountIs(2),
              })
              console.log('[CHAT_ROUTER] Standard streamText call completed')
            }
          }

          console.log('[CHAT_ROUTER] About to merge result stream with writer')
          writer.merge(result.toUIMessageStream())
        },
      })

      return createUIMessageStreamResponse({ stream })
    }),
})
