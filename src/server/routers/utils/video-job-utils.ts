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
  console.log(`[VideoJobUtils] 🔍 EXTRACTING VIDEO URLs from content: "${content.substring(0, 200)}..."`)
  
  const urlRegex = /https?:\/\/[^\s]+/g
  const urls = content.match(urlRegex) || []
  console.log(`[VideoJobUtils] 🔗 Found ${urls.length} total URLs:`, urls)
  
  const videoUrls = urls.filter(url => {
    const isVideo = VIDEO_PATTERNS.some(pattern => {
      const matches = pattern.test(url)
      console.log(`[VideoJobUtils] 🎬 Testing URL "${url}" against pattern ${pattern}: ${matches}`)
      return matches
    })
    return isVideo
  })
  
  console.log(`[VideoJobUtils] ✅ Filtered to ${videoUrls.length} video URLs:`, videoUrls)
  return videoUrls
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
  const timestamp = new Date().toISOString()
  
  console.log(`[VideoJobUtils] 🚀 STARTING VIDEO JOB CREATION at ${timestamp}`)
  console.log(`[VideoJobUtils] 📋 Job Parameters:`, {
    jobId,
    userId,
    videoUrl,
    platform,
    threadId,
    tweetId,
    action: tweetContent.action,
    tweetContentKeys: Object.keys(tweetContent)
  })
  
  console.log(`[VideoJobUtils] 📝 Full tweetContent structure:`, JSON.stringify(tweetContent, null, 2))
  
  try {
    console.log(`[VideoJobUtils] 💾 INSERTING video job record into database...`)
    
    // Create video job record
    const insertResult = await db.insert(videoJob).values({
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
    }).returning()
    
    console.log(`[VideoJobUtils] ✅ Video job record inserted:`, {
      jobId,
      insertedRecord: insertResult[0] ? 'SUCCESS' : 'FAILED'
    })
    
    // Enqueue video processing with QStash
    const webhookUrl = `${getBaseUrl()}/api/video/process`
    console.log(`[VideoJobUtils] 📤 ENQUEUEING with QStash:`, {
      webhookUrl,
      jobId,
      pollingAttempt: 0
    })
    
    const qstashResponse = await qstash.publishJSON({
      url: webhookUrl,
      body: { 
        videoJobId: jobId,
        pollingAttempt: 0
      },
      retries: 3,
    })
    
    console.log(`[VideoJobUtils] ✅ QStash message published:`, {
      messageId: qstashResponse.messageId,
      jobId
    })
    
    // Update job with QStash ID
    console.log(`[VideoJobUtils] 🔄 UPDATING job with QStash ID...`)
    await db.update(videoJob)
      .set({
        qstashId: qstashResponse.messageId,
        updatedAt: new Date(),
      })
      .where(eq(videoJob.id, jobId))
    
    console.log(`[VideoJobUtils] ✅ VIDEO JOB CREATION COMPLETED SUCCESSFULLY:`, {
      jobId,
      qstashMessageId: qstashResponse.messageId,
      action: tweetContent.action,
      platform,
      videoUrl,
      timestamp: new Date().toISOString()
    })
    
    return {
      jobId,
      qstashMessageId: qstashResponse.messageId
    }
    
  } catch (error) {
    console.error(`[VideoJobUtils] ❌ CRITICAL ERROR during video job creation:`, {
      jobId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      videoUrl,
      action: tweetContent.action,
      timestamp: new Date().toISOString()
    })
    throw error
  }
}
