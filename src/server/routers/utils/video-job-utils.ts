import { db } from '@/db'
import { videoJob } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { qstash } from '@/lib/qstash'
import { getBaseUrl } from '@/constants/base-url'
import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'

/**
 * Supported video platform patterns for URL detection
 */
const VIDEO_PATTERNS = [
  /(?:instagram\.com|instagr\.am)\/(?:p|reel|tv)\//,
  /(?:tiktok\.com\/@[\w.-]+\/video\/|vm\.tiktok\.com\/)/,
  /(?:twitter\.com|x\.com)\/\w+\/status\//,
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)/,
]

/**
 * Extract video URLs from text content
 */
export function extractVideoUrls(content: string): string[] {
  const urlRegex = /https?:\/\/[^\s]+/g
  const urls = content.match(urlRegex) || []
  return urls.filter(url => VIDEO_PATTERNS.some(pattern => pattern.test(url)))
}

/**
 * Determine platform from video URL
 */
export function getPlatformFromUrl(videoUrl: string): string {
  if (videoUrl.includes('instagram')) return 'instagram'
  if (videoUrl.includes('tiktok')) return 'tiktok'
  if (videoUrl.includes('youtube') || videoUrl.includes('youtu.be')) return 'youtube'
  if (videoUrl.includes('twitter') || videoUrl.includes('x.com')) return 'twitter'
  return 'unknown'
}

/**
 * Tweet content structure for video jobs
 */
export interface VideoJobTweetContent {
  action: 'post_thread_now' | 'queue_thread' | 'schedule_thread'
  threadId?: string
  userId: string
  accountId: string
  tweets: Array<{
    content: string
    media: any[]
    delayMs: number
  }>
  // For queue action
  timezone?: string
  userNow?: string
  // For schedule action
  scheduledUnix?: number
  scheduledTime?: string
}

/**
 * Create video job with proper action tracking
 */
export async function createVideoJobForAction(params: {
  userId: string
  videoUrl: string
  tweetContent: VideoJobTweetContent
  threadId?: string
  tweetId?: string
}): Promise<{ jobId: string; qstashMessageId: string }> {
  const { userId, videoUrl, tweetContent, threadId, tweetId = '' } = params
  
  const jobId = uuidv4()
  const platform = getPlatformFromUrl(videoUrl)
  
  console.log(`[VideoJobUtils] Creating video job for action: ${tweetContent.action}`, {
    jobId,
    videoUrl,
    platform,
    userId,
    threadId,
    action: tweetContent.action
  })
  
  // Create video job record
  await db.insert(videoJob).values({
    id: jobId,
    userId,
    tweetId,
    threadId: threadId || crypto.randomUUID(),
    videoUrl,
    platform,
    status: 'pending',
    tweetContent: tweetContent as any, // Cast to satisfy JSON type
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  
  // Enqueue video processing with QStash
  const webhookUrl = `${getBaseUrl()}/api/video/process`
  const qstashResponse = await qstash.publishJSON({
    url: webhookUrl,
    body: { 
      videoJobId: jobId,
      pollingAttempt: 0
    },
    retries: 3,
  })
  
  // Update job with QStash ID
  await db.update(videoJob)
    .set({
      qstashId: qstashResponse.messageId,
      updatedAt: new Date(),
    })
    .where(eq(videoJob.id, jobId))
  
  console.log(`[VideoJobUtils] Video job created successfully:`, {
    jobId,
    qstashMessageId: qstashResponse.messageId,
    action: tweetContent.action
  })
  
  return {
    jobId,
    qstashMessageId: qstashResponse.messageId
  }
}
