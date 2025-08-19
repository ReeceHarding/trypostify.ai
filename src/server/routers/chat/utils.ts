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
  const validAttachments = attachments?.filter((a) => Boolean(a.fileKey)) ?? []

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
        { expiresIn: 600 },
      )

      if (type === 'image') {
        return { mediaType, url: signedUrl, filename: attachment.title, type: 'file' } as FileUIPart
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
        return { mediaType, url: signedUrl, type: 'file' } as FileUIPart
      }
    }),
  )

  // const images = attachmentContents.filter(Boolean).filter((a) => a.type === 'image')
  // const files = attachmentContents
  //   .filter(Boolean)
  //   .filter((a) => a.type !== 'image' && a.type !== 'link')
  // const links = attachmentContents.filter(Boolean).filter((a) => a.type === 'link')

  return { links, attachments: attachmentContents }
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

  const firstTweet = await db.query.tweets.findFirst({
    where: and(eq(tweets.threadId, threadId), eq(tweets.isPublished, false)),
  })
  if (!firstTweet) {
    console.log(`[${logPrefix}] No unpublished tweets in thread ${threadId}`)
    return
  }
  if (!effectiveUserId) effectiveUserId = firstTweet.userId

  const threadTweets = await db.query.tweets.findMany({
    where: and(eq(tweets.threadId, threadId), eq(tweets.isPublished, false)),
    orderBy: asc(tweets.position),
  })
  if (threadTweets.length === 0) return

  let account = null as any
  if (effectiveAccountId) {
    account = await db.query.account.findFirst({
      where: and(eq(accountSchema.userId, effectiveUserId!), eq(accountSchema.id, effectiveAccountId)),
    })
  } else {
    account = await db.query.account.findFirst({
      where: and(eq(accountSchema.userId, effectiveUserId!), eq(accountSchema.providerId, 'twitter')),
    })
  }
  if (!account?.accessToken) {
    console.log(`[${logPrefix}] Missing X access token for user ${effectiveUserId}`)
    return
  }

  const client = new TwitterApi({
    appKey: consumerKey as string,
    appSecret: consumerSecret as string,
    accessToken: account.accessToken as string,
    accessSecret: account.accessSecret as string,
  })

  let previousTweetId: string | null = null
  for (const [index, tweet] of threadTweets.entries()) {
    try {
      if (index > 0 && tweet.delayMs && tweet.delayMs > 0) {
        await new Promise((r) => setTimeout(r, tweet.delayMs))
      }
      const payload: SendTweetV2Params = { text: tweet.content }
      if (previousTweetId && index > 0) {
        payload.reply = { in_reply_to_tweet_id: previousTweetId }
      }
      if (tweet.media?.length) {
        const ids = tweet.media
          .map((m: any) => m.media_id)
          .filter((id: any) => typeof id === 'string' && id.trim().length > 0)
        if (ids.length) {
          payload.media = { media_ids: ids as any }
        }
      }
      const res = await client.v2.tweet(payload)
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
