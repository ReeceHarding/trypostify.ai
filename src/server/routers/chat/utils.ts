import { HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { Attachment } from './chat-router'
import { BUCKET_NAME, FILE_TYPE_MAP, s3Client } from '@/lib/s3'
import mammoth from 'mammoth'
import { FilePart, FileUIPart, ImagePart, TextPart } from 'ai'
import { db } from '@/db'
import { knowledgeDocument, tweets, account as accountSchema } from '@/db/schema'
import { and, asc, eq } from 'drizzle-orm'
import { SendTweetV2Params, TwitterApi } from 'twitter-api-v2'

// Helper function to fetch video transcript with polling
const fetchVideoTranscript = async (
  s3Key: string,
  maxAttempts: number = 10,
  delayMs: number = 2000,
): Promise<string | null> => {
  const transcriptKey = s3Key.replace(/\.[^/.]+$/, '.json') // Replace file extension with .json

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `transcriptions/${transcriptKey}`,
      })

      const response = await s3Client.send(command)

      if (response.Body) {
        const bodyContents = await response.Body.transformToString()
        const transcriptionData = JSON.parse(bodyContents) as any

        // Extract transcript text from the transcription JSON
        if (transcriptionData.text) {
          return transcriptionData.text
        }

        return 'Transcript content found but format not recognized'
      }
    } catch (error: any) {
      // Check if it's a NoSuchKey error (404 equivalent)
      if (error.name === 'NoSuchKey' && attempt < maxAttempts) {
        console.log(`Transcript not ready yet (attempt ${attempt}), waiting...`)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
        continue
      }

      console.error(`Error fetching transcript (attempt ${attempt}):`, error)

      // If not the last attempt, wait and try again
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
        continue
      }
    }
  }

  return null // Transcript not ready or doesn't exist
}

export const parseAttachments = async ({
  attachments = [],
}: {
  attachments?: Attachment[]
}) => {
  const validAttachments = attachments?.filter((a) => Boolean(a?.fileKey) && (a?.fileKey?.trim()?.length ?? 0) > 0) ?? []

  const links = await Promise.all(
    attachments
      .filter((a) => a.type === 'url')
      .map(async (attachment) => {
        const { id } = attachment
        const [document] = await db
          .select()
          .from(knowledgeDocument)
          .where(eq(knowledgeDocument.id, id))

        if (document && document.sourceUrl) {
          return { type: 'link' as const, link: document.sourceUrl }
        }
      }),
  )

  const attachmentContents = await Promise.all(
    validAttachments.map(async (attachment) => {
      try {
        const command = new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: attachment.fileKey,
        })

        const data = await s3Client.send(command)
        const mediaType = (data.ContentType as string) || 'application/octet-stream'

        const type = FILE_TYPE_MAP[mediaType as keyof typeof FILE_TYPE_MAP]
        // Prefer a short-lived presigned S3 URL so external providers can fetch reliably
        const signedUrl = await getSignedUrl(
          s3Client,
          new GetObjectCommand({ Bucket: BUCKET_NAME, Key: attachment.fileKey! }),
          { expiresIn: 3600 }, // 1 hour to prevent OpenAI API timeouts
        )

        if (type === 'image') {
          return { 
            mediaType, 
            url: signedUrl, 
            filename: attachment.title, 
            type: 'file', 
            fileKey: attachment.fileKey,
            // Store both URL and fileKey so we can regenerate URL later if needed
            _permanentFileKey: attachment.fileKey 
          } as FileUIPart & { fileKey: string; _permanentFileKey: string }
        } else if (type === 'docx') {
          const response = await fetch(signedUrl)
          const buffer = await response.arrayBuffer()
          const { value } = await mammoth.extractRawText({
            buffer: Buffer.from(buffer),
          })
          return {
            type: 'text' as const,
            text: `<attached_docx>${value}</attached_docx>`,
          } as TextPart
        } else if (attachment.type === 'video') {
          // Handle video transcript
          const transcript = await fetchVideoTranscript(attachment.fileKey!)

          if (transcript) {
            return {
              type: 'text' as const,
              text: `<video_transcript>${transcript}</video_transcript>`,
            } as TextPart
          } else {
            // If transcript is not ready, return a placeholder
            return {
              type: 'text' as const,
              text: `<video_transcript>Video transcript is being processed and is not yet available. Please try again in a few moments.</video_transcript>`,
            } as TextPart
          }
        } else {
          return { 
            mediaType, 
            url: signedUrl, 
            type: 'file', 
            fileKey: attachment.fileKey,
            _permanentFileKey: attachment.fileKey 
          } as FileUIPart & { fileKey: string; _permanentFileKey: string }
        }
      } catch (error) {
        console.error('[PARSE_ATTACHMENTS] Error accessing S3 file:', attachment.fileKey, error)
        // Return null for missing files - they'll be filtered out
        return null
      }
    }),
  )

  // const images = attachmentContents.filter(Boolean).filter((a) => a.type === 'image')
  // const files = attachmentContents
  //   .filter(Boolean)
  //   .filter((a) => a.type !== 'image' && a.type !== 'link')
  // const links = attachmentContents.filter(Boolean).filter((a) => a.type === 'link')

  return { links, attachments: attachmentContents.filter(Boolean) }
}

export class PromptBuilder {
  private parts: string[] = []
  private startTag?: string
  private endTag?: string

  constructor(startTag?: string, endTag?: string) {
    this.startTag = startTag
    this.endTag = endTag
  }

  add(content: string | undefined | null): this {
    if (content && content?.trim()) {
      this.parts.push(content.trim())
    }
    return this
  }

  build(): string {
    const content = this.parts.join('\n\n').trim()

    if (this.startTag && this.endTag) {
      return `${this.startTag}${content}${this.endTag}`
    }

    return content
  }
}

// Twitter credentials
const consumerKey = process.env.TWITTER_CONSUMER_KEY as string
const consumerSecret = process.env.TWITTER_CONSUMER_SECRET as string

// Shared publisher used by tools and routers
export async function publishThreadById({
  threadId,
  userId,
  accountId,
  logPrefix = 'Publisher',
}: {
  threadId: string
  userId?: string
  accountId?: string
  logPrefix?: string
}) {
  console.log(`[${logPrefix}] Starting to publish thread: ${threadId}`)
  let effectiveUserId = userId
  let effectiveAccountId = accountId

  const firstTweet = await (db as any).query.tweets.findFirst({
    where: and(eq(tweets.threadId, threadId), eq(tweets.isPublished, false)),
  })
  if (!firstTweet) {
    console.log(`[${logPrefix}] No unpublished tweets in thread ${threadId}`)
    return
  }
  if (!effectiveUserId) effectiveUserId = firstTweet.userId

  let threadTweets = await (db as any).query.tweets.findMany({
    where: and(eq(tweets.threadId, threadId), eq(tweets.isPublished, false)),
    orderBy: asc(tweets.position),
  })
  if (threadTweets.length === 0) return

  // Check for pending videos and wait for them to complete
  const hasPendingVideos = threadTweets.some((tweet: any) => 
    tweet.videoProcessingStatus && 
    tweet.videoProcessingStatus !== 'complete' && 
    tweet.videoProcessingStatus !== 'failed'
  )

  if (hasPendingVideos) {
    console.log(`[${logPrefix}] Thread has pending videos, waiting for completion`)
    
    // Wait for videos to complete (max 5 minutes)
    const maxWaitTime = 5 * 60 * 1000 // 5 minutes
    const startTime = Date.now()
    
    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 5000)) // Check every 5 seconds
      
      // Re-check video status
      const updatedTweets = await (db as any).query.tweets.findMany({
        where: eq(tweets.threadId, threadId),
      })
      
      const stillPending = updatedTweets.some((tweet: any) => 
        tweet.videoProcessingStatus && 
        tweet.videoProcessingStatus !== 'complete' && 
        tweet.videoProcessingStatus !== 'failed'
      )
      
      if (!stillPending) {
        console.log(`[${logPrefix}] All videos processed, continuing with post`)
        break
      }
      
      console.log(`[${logPrefix}] Still waiting for videos...`, {
        elapsed: Math.round((Date.now() - startTime) / 1000) + 's'
      })
    }
    
    // Re-fetch tweets after waiting to get updated media info
    threadTweets = await (db as any).query.tweets.findMany({
      where: and(eq(tweets.threadId, threadId), eq(tweets.isPublished, false)),
      orderBy: asc(tweets.position),
    })
  }

  let accountData = null as any
  if (effectiveAccountId) {
    accountData = await (db as any).query.account.findFirst({
      where: and(eq(accountSchema.userId, effectiveUserId!), eq(accountSchema.id, effectiveAccountId)),
    })
  } else {
    accountData = await (db as any).query.account.findFirst({
      where: and(eq(accountSchema.userId, effectiveUserId!), eq(accountSchema.providerId, 'twitter')),
    })
  }
  if (!accountData?.accessToken) {
    console.log(`[${logPrefix}] Missing X access token for user ${effectiveUserId}`)
    return
  }

  const client = new TwitterApi({
    appKey: consumerKey as string,
    appSecret: consumerSecret as string,
    accessToken: accountData.accessToken as string,
    accessSecret: accountData.accessSecret as string,
  })

  let previousTweetId: string | null = null
  for (const [index, tweet] of threadTweets.entries()) {
    try {
      console.log(`[${logPrefix}] Processing tweet ${index + 1}/${threadTweets.length}:`, {
        tweetId: tweet.id,
        contentLength: tweet.content?.length || 0,
        contentPreview: tweet.content?.substring(0, 100) + '...',
        mediaCount: tweet.media?.length || 0,
        position: tweet.position,
        timestamp: new Date().toISOString()
      })
      
      if (index > 0 && tweet.delayMs && tweet.delayMs > 0) {
        console.log(`[${logPrefix}] Waiting ${tweet.delayMs}ms before posting tweet ${index + 1}`)
        await new Promise((r) => setTimeout(r, tweet.delayMs))
      }
      
      const payload: SendTweetV2Params = { text: tweet.content }
      console.log(`[${logPrefix}] Tweet payload being sent to Twitter:`, {
        textLength: payload.text?.length || 0,
        textContent: payload.text,
        hasReply: !!previousTweetId,
        replyToId: previousTweetId
      })
      
      if (previousTweetId && index > 0) {
        payload.reply = { in_reply_to_tweet_id: previousTweetId }
        console.log(`[${logPrefix}] Adding reply reference to tweet ${previousTweetId}`)
      }
      
      if (tweet.media?.length) {
        const ids = tweet.media
          .map((m: any) => m.media_id)
          .filter((id: any) => typeof id === 'string' && id.trim().length > 0)
        console.log(`[${logPrefix}] Media processing:`, {
          originalMediaCount: tweet.media.length,
          validMediaIds: ids,
          mediaData: tweet.media
        })
        if (ids.length) {
          payload.media = { media_ids: ids as any }
          console.log(`[${logPrefix}] Added media to payload:`, payload.media)
        }
      }
      
      console.log(`[${logPrefix}] Final payload before Twitter API call:`, JSON.stringify(payload, null, 2))
      const res = await client.v2.tweet(payload)
      console.log(`[${logPrefix}] Twitter API response:`, {
        success: true,
        tweetId: res.data.id,
        text: res.data.text,
        timestamp: new Date().toISOString()
      })
      await db
        .update(tweets)
        .set({
          isScheduled: false,
          isPublished: true,
          twitterId: res.data.id,
          replyToTweetId: previousTweetId,
          updatedAt: new Date(),
        })
        .where(eq(tweets.id, tweet.id))
      previousTweetId = res.data.id
    } catch (error) {
      if ((error as any)?.code === 400) {
        await db
          .update(tweets)
          .set({ isScheduled: false, isPublished: false, updatedAt: new Date() })
          .where(eq(tweets.id, tweet.id))
        continue
      }
      throw error
    }
  }
}
