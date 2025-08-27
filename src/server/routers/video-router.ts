import { j, privateProcedure } from '../jstack'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { nanoid } from 'nanoid'
import { qstash } from '@/lib/qstash'
import { getBaseUrl } from '@/constants/base-url'
import { getAccount } from './utils/get-account'
import * as ffmpeg from 'fluent-ffmpeg'
import { promises as fs } from 'fs'
import * as path from 'path'
import * as os from 'os'
import { db } from '@/db'
import { tweets } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { TwitterApi } from 'twitter-api-v2'

// Log environment setup at module load
console.log('[VideoRouter] Module loading with environment:', {
  hasApifyToken: !!process.env.APIFY_API_TOKEN,
  apifyTokenLength: process.env.APIFY_API_TOKEN?.length || 0,
  s3Bucket: process.env.NEXT_PUBLIC_S3_BUCKET_NAME,
  hasAwsCredentials: !!process.env.AWS_GENERAL_ACCESS_KEY,
  nodeEnv: process.env.NODE_ENV,
  timestamp: new Date().toISOString()
})

// Configure FFmpeg path - let fluent-ffmpeg auto-detect FFmpeg location
// This works on Vercel, local dev, and any system with FFmpeg in PATH
try {
  // Only set path if explicitly provided via environment variable
  if (process.env.FFMPEG_PATH) {
    ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH)
    console.log('[FFmpeg] Using custom FFmpeg path:', process.env.FFMPEG_PATH)
  } else {
    console.log('[FFmpeg] Using auto-detected FFmpeg from system PATH')
  }
} catch (error) {
  console.warn('[FFmpeg] FFmpeg path configuration warning:', error)
}

const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_GENERAL_ACCESS_KEY!,
    secretAccessKey: process.env.AWS_GENERAL_SECRET_KEY!,
  },
})

const BUCKET_NAME = process.env.NEXT_PUBLIC_S3_BUCKET_NAME!

// Platform detection patterns - comprehensive regex for all supported platforms
const PLATFORM_PATTERNS = {
  // TikTok - all known URL formats
  tiktok: /(?:(?:www\.)?(?:tiktok\.com\/(?:@[\w.-]+\/video\/\d+|t\/[A-Za-z0-9_-]+|v\/\d+|\w+\/video\/\d+)|vm\.tiktok\.com\/[A-Za-z0-9_-]+|m\.tiktok\.com\/v\/\d+))/i,
  
  // Instagram - reels, posts, TV, stories
  instagram: /(?:(?:www\.)?(?:instagram\.com|instagr\.am)\/(?:p|reel|tv|stories)\/[A-Za-z0-9_-]+(?:\/.*)?)/i,
  
  // YouTube - all formats including Shorts
  youtube: /(?:(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)[A-Za-z0-9_-]{11}(?:\S*)?)/i,
  
  // Twitter/X - all status formats
  twitter: /(?:(?:www\.)?(?:twitter\.com|x\.com)\/(?:\w+\/status\/\d+|i\/web\/status\/\d+)(?:\/.*)?)/i,
  
  // Facebook - videos and watch
  facebook: /(?:(?:www\.)?(?:facebook\.com|fb\.watch)\/(?:watch\/?\?v=|.*\/videos\/|video\.php\?v=)\d+)/i,
  
  // Vimeo - all formats
  vimeo: /(?:(?:www\.)?vimeo\.com\/(?:channels\/(?:\w+\/)?|groups\/(?:[^\/]*)\/videos\/|album\/(?:\d+)\/video\/|video\/|)\d+)/i,
  
  // Dailymotion
  dailymotion: /(?:(?:www\.)?dailymotion\.com\/video\/[A-Za-z0-9]+)/i,
  
  // LinkedIn posts with videos
  linkedin: /(?:(?:www\.)?linkedin\.com\/posts\/.*)/i,
  
  // Twitch clips and videos
  twitch: /(?:(?:www\.)?(?:twitch\.tv|clips\.twitch\.tv)\/(?:\w+\/clip\/[A-Za-z0-9_-]+|\w+\/video\/\d+|clip\/[A-Za-z0-9_-]+))/i,
  
  // Reddit videos
  reddit: /(?:(?:www\.)?reddit\.com\/r\/\w+\/comments\/[A-Za-z0-9_]+\/.*)/i,
  
  // Snapchat
  snapchat: /(?:(?:www\.)?snapchat\.com\/(?:add\/\w+|t\/[A-Za-z0-9_-]+))/i,
}

function detectPlatform(url: string): string | null {
  console.log('[VideoRouter] Detecting platform for URL:', url)
  
  // Test each pattern and log the results for debugging
  for (const [platform, pattern] of Object.entries(PLATFORM_PATTERNS)) {
    const matches = pattern.test(url)
    console.log(`[VideoRouter] Testing ${platform}:`, {
      pattern: pattern.toString(),
      matches,
      url: url.substring(0, 100) + (url.length > 100 ? '...' : '')
    })
    
    if (matches) {
      console.log('[VideoRouter] Detected platform:', platform)
      return platform
    }
  }
  
  console.log('[VideoRouter] No platform detected for URL:', url)
  console.log('[VideoRouter] Supported platforms:', Object.keys(PLATFORM_PATTERNS))
  return null
}

// Video processing status types
export type VideoProcessingStatus = 'downloading' | 'transcoding' | 'uploading' | 'complete' | 'failed'

// Progress update structure
interface ProgressUpdate {
  stage: 'downloading' | 'transcoding' | 'uploading_s3' | 'uploading_twitter' | 'complete'
  progress: number // 0-100 percentage
  message: string
  estimatedTimeRemaining?: number // seconds
}

// Shared async Apify processing flow used by both dev (background poller) and prod (webhook)
async function processVideoAsyncFlow({
  url,
  platform,
  tweetId,
  userId,
  autoPost,
}: {
  url: string
  platform: string
  tweetId?: string
  userId: string
  autoPost: boolean
}) {
  console.log('🎬🎬🎬 [processVideoAsyncFlow] ========== ASYNC VIDEO PROCESSING START =========')
  console.log('[processVideoAsyncFlow] 📋 Full input parameters:', {
    url: url,
    urlRaw: JSON.stringify(url),
    platform: platform,
    tweetId: tweetId || 'NO_TWEET_ID',
    userId: userId,
    autoPost: autoPost,
    timestamp: new Date().toISOString(),
    memoryUsage: process.memoryUsage(),
    nodeVersion: process.version
  })

  console.log('[processVideoAsyncFlow] 🔍 Starting URL validation...')
  if (!url || typeof url !== 'string' || url.trim() === '') {
    console.error('[processVideoAsyncFlow] ❌ CRITICAL ERROR: Invalid URL provided:', {
      url: url,
      urlRaw: JSON.stringify(url),
      urlType: typeof url,
      urlLength: url?.length || 0,
      isEmpty: !url,
      isEmptyString: url === '',
      isUndefined: url === undefined,
      isNull: url === null,
      validationTimestamp: new Date().toISOString()
    })
    throw new Error('Invalid or missing video URL')
  }

  const sanitizedUrl = url.trim()
  console.log('[processVideoAsyncFlow] ✅ URL validation passed:', {
    originalUrl: url,
    originalUrlLength: url.length,
    sanitizedUrl: sanitizedUrl,
    sanitizedUrlLength: sanitizedUrl.length,
    trimmedCharacters: url.length - sanitizedUrl.length,
    validationSuccess: true,
    timestamp: new Date().toISOString()
  })

  try {
    console.log('[processVideoAsyncFlow] 🏗️ Starting async processing logic with marketingme actor')

    if (tweetId) {
      await db
        .update(tweets)
        .set({
          videoProcessingStatus: 'downloading',
          updatedAt: new Date(),
        })
        .where(eq(tweets.id, tweetId))
    }

    const apifyPayload = {
      input: {
        video_url: sanitizedUrl,
        downloadVideo: true,
        downloadAudio: false,
        downloadThumbnail: true,
      }
    }

    const runResponse = await fetch(
      `https://api.apify.com/v2/acts/marketingme~video-downloader/runs`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(apifyPayload),
      },
    )

    if (!runResponse.ok) {
      const error = await runResponse.text()
      console.error('[processVideoAsyncFlow] Failed to start Apify run:', {
        status: runResponse.status,
        statusText: runResponse.statusText,
        error,
        url: sanitizedUrl,
      })
      throw new Error(`Failed to start video download process. Status: ${runResponse.status}. Error: ${error}`)
    }

    const runData: any = await runResponse.json()
    const runId = runData.data.id
    console.log('[processVideoAsyncFlow] Started Apify run:', runId)

    const maxAttempts = 90
    let attempts = 0
    let runStatus: any
    let currentDelayMs = 1500
    const backoff = 1.25
    const maxDelayMs = 8000

    while (attempts < maxAttempts) {
      attempts++
      await new Promise(resolve => setTimeout(resolve, currentDelayMs))
      console.log(`[processVideoAsyncFlow] Polling attempt ${attempts}/${maxAttempts}, delay: ${currentDelayMs}ms`)
      currentDelayMs = Math.min(Math.round(currentDelayMs * backoff), maxDelayMs)

      const statusResponse = await fetch(
        `https://api.apify.com/v2/acts/marketingme~video-downloader/runs/${runId}`,
        {
          headers: {
            'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}`,
          },
        }
      )

      if (!statusResponse.ok) {
        console.error('[processVideoAsyncFlow] Failed to check run status')
        continue
      }

      runStatus = await statusResponse.json()
      console.log(`[processVideoAsyncFlow] Run status: ${runStatus.data.status}`)

      if (runStatus.data.status === 'SUCCEEDED') {
        break
      } else if (runStatus.data.status === 'FAILED' || runStatus.data.status === 'ABORTED') {
        throw new Error('Video download failed')
      }
    }

    if (runStatus?.data?.status !== 'SUCCEEDED') {
      throw new Error('Video download timed out')
    }

    const datasetId = runStatus.data.defaultDatasetId
    const itemsResponse = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}`,
        },
      }
    )

    if (!itemsResponse.ok) {
      throw new Error('Failed to retrieve video data')
    }

    const items: any[] = await itemsResponse.json()
    console.log('[processVideoAsyncFlow] Retrieved dataset items:', items.length)

    if (!items.length) {
      throw new Error('No video found at the provided URL')
    }

    const videoData = items[0]
    console.log('[processVideoAsyncFlow] Video data:', {
      platform: videoData.platform,
      title: videoData.title,
      duration: videoData.durationSeconds,
      mediaUrl: videoData.mediaUrl?.substring(0, 100) + '...',
      thumbnailUrl: videoData.thumbnailUrl?.substring(0, 100) + '...',
    })

    console.log('[processVideoAsyncFlow] Downloading video from:', videoData.mediaUrl)
    const videoResponse = await fetch(videoData.mediaUrl)
    if (!videoResponse.ok) {
      throw new Error('Failed to download video file')
    }

    let videoBuffer = Buffer.from(await videoResponse.arrayBuffer())
    console.log('[processVideoAsyncFlow] Downloaded video size:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB')

    if (tweetId) {
      await db
        .update(tweets)
        .set({
          videoProcessingStatus: 'transcoding',
          updatedAt: new Date(),
        })
        .where(eq(tweets.id, tweetId))
    }

    console.log('[processVideoAsyncFlow] Starting video transcoding')
    try {
      const tempDir = os.tmpdir()
      const inputPath = path.join(tempDir, `input_${nanoid()}.mp4`)
      const outputPath = path.join(tempDir, `output_${nanoid()}.mp4`)

      await fs.writeFile(inputPath, videoBuffer)
      console.log('[processVideoAsyncFlow] Wrote input file:', inputPath)

      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .videoCodec('libx264')
          .audioCodec('aac')
          .format('mp4')
          .outputOptions([
            '-preset fast',
            '-crf 23',
            '-movflags +faststart',
            '-pix_fmt yuv420p',
          ])
          .on('start', (cmd) => {
            console.log('[processVideoAsyncFlow] FFmpeg command:', cmd)
          })
          .on('progress', (progress) => {
            console.log('[processVideoAsyncFlow] Transcoding progress:', Math.round(progress.percent || 0) + '%')
          })
          .on('end', () => {
            console.log('[processVideoAsyncFlow] Transcoding completed')
            resolve()
          })
          .on('error', (err) => {
            console.error('[processVideoAsyncFlow] FFmpeg error:', err)
            reject(err)
          })
          .save(outputPath)
      })

      const transcodedBuffer = await fs.readFile(outputPath)
      videoBuffer = transcodedBuffer

      console.log('[processVideoAsyncFlow] Transcoding complete:', {
        originalSize: (await fs.stat(inputPath)).size,
        transcodedSize: transcodedBuffer.length,
        reduction: `${(100 - (transcodedBuffer.length / (await fs.stat(inputPath)).size) * 100).toFixed(1)}%`
      })

      await fs.unlink(inputPath).catch(() => {})
      await fs.unlink(outputPath).catch(() => {})

    } catch (error) {
      console.error('[processVideoAsyncFlow] Transcoding failed:', error)
    }

    const sizeInMB = videoBuffer.length / (1024 * 1024)
    if (sizeInMB > 512) {
      throw new Error(`Video too large (${sizeInMB.toFixed(2)}MB). Twitter limit is 512MB.`)
    }

    if (videoData.durationSeconds && videoData.durationSeconds > 140) {
      throw new Error(`Video too long (${Math.round(videoData.durationSeconds)}s). Twitter limit is 140s.`)
    }

    if (tweetId) {
      await db
        .update(tweets)
        .set({
          videoProcessingStatus: 'uploading',
          updatedAt: new Date(),
        })
        .where(eq(tweets.id, tweetId))
    }

    const s3Key = `tweet-media/${userId}/${nanoid()}.mp4`
    console.log('[processVideoAsyncFlow] Uploading to S3:', s3Key)

    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: videoBuffer,
        ContentType: 'video/mp4',
      }),
    )

    const publicUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/${s3Key}`
    console.log('[processVideoAsyncFlow] S3 upload complete:', publicUrl)

    console.log('[processVideoAsyncFlow] Starting Twitter upload')

    const { user: userSchema } = await import('@/db/schema')
    const [user] = await db
      .select({ email: userSchema.email })
      .from(userSchema)
      .where(eq(userSchema.id, userId))
      .limit(1)

    if (!user) {
      throw new Error('User not found')
    }

    console.log('[processVideoAsyncFlow] Found user email:', user.email)

    const account = await getAccount({ email: user.email })

    if (!account) {
      throw new Error('No Twitter account found. Please connect your Twitter account in Settings.')
    }

    console.log('[processVideoAsyncFlow] Found Twitter account:', account.username)

    const twitterClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY!,
      appSecret: process.env.TWITTER_API_SECRET!,
      accessToken: account.accessToken!,
      accessSecret: account.accessTokenSecret!,
    })

    const videoSizeMB = (videoBuffer.length / (1024 * 1024)).toFixed(2)
    const isLongVideo = videoBuffer.length > 15 * 1024 * 1024

    console.log('[processVideoAsyncFlow] Preparing Twitter upload:', {
      videoSize: `${videoSizeMB}MB`,
      isLongVideo,
      duration: videoData.durationSeconds || videoData.duration,
      platform: videoData.platform,
      title: videoData.title?.substring(0, 50) + '...'
    })

    let mediaId: string
    try {
      const mediaUpload = await twitterClient.v1.uploadMedia(videoBuffer, {
        mimeType: 'video/mp4',
        target: 'tweet',
        mediaCategory: 'tweet_video',
        waitForProcessing: true,
        longVideo: isLongVideo,
      })

      console.log('[processVideoAsyncFlow] Twitter upload successful:', {
        media_id: mediaUpload,
        videoSize: `${videoSizeMB}MB`,
        processingTime: 'completed'
      })

      mediaId = mediaUpload

    } catch (twitterError: any) {
      console.error('[processVideoAsyncFlow] Twitter upload failed:', {
        error: twitterError.message,
        code: twitterError.code,
        data: twitterError.data,
        videoSize: `${videoSizeMB}MB`,
        isLongVideo,
        accountUsername: account.username
      })

      if (twitterError.code === 403) {
        throw new Error('Twitter upload failed: Your Twitter app may not have video upload permissions. Please check your Twitter Developer app settings.')
      } else if (twitterError.code === 413) {
        throw new Error('Video too large for Twitter. Please use a smaller video.')
      } else if (twitterError.code === 400) {
        throw new Error('Invalid video format. Twitter requires MP4 videos with H.264 encoding.')
      } else {
        throw new Error(`Twitter upload failed: ${twitterError.message || 'Unknown error'}`)
      }
    }

    if (tweetId) {
      const tweet = await db.query.tweets.findFirst({
        where: eq(tweets.id, tweetId),
      })

      if (tweet) {
        const updatedMedia = [
          ...(tweet.media || []),
          {
            s3Key,
            media_id: mediaId,
            url: publicUrl,
            type: 'video' as const,
            platform: videoData.platform || platform,
            originalUrl: videoData.sourceUrl || url,
            title: videoData.title,
            duration: videoData.durationSeconds,
            size: videoBuffer.length,
          },
        ]

        await db
          .update(tweets)
          .set({
            media: updatedMedia as any,
            videoProcessingStatus: 'complete',
            pendingVideoUrl: null,
            updatedAt: new Date(),
          })
          .where(eq(tweets.id, tweetId))

        console.log('[processVideoAsyncFlow] Updated tweet with video:', tweetId)
      }
    }

    if (autoPost && tweetId) {
      console.log('[processVideoAsyncFlow] Auto-posting tweet with video')
      const { publishThreadById } = await import('./chat/utils')
      await publishThreadById({
        threadId: tweetId,
        userId,
        accountId: account.id,
        logPrefix: 'processVideoAsyncFlow'
      })
    }

    return {
      success: true,
      s3Key,
      url: publicUrl,
      media_id: mediaId,
      platform: videoData.platform || platform,
    }

  } catch (error) {
    console.error('[processVideoAsyncFlow] Video processing error:', error)
    if (tweetId) {
      await db
        .update(tweets)
        .set({
          videoProcessingStatus: 'failed',
          videoErrorMessage: error instanceof Error ? error.message : 'Unknown error',
          updatedAt: new Date(),
        })
        .where(eq(tweets.id, tweetId))
    }
    throw error
  }
}

// Direct video processing function for development mode
async function processVideoDirectly({
  url,
  platform,
  tweetId,
  userId,
  autoPost,
}: {
  url: string
  platform: string
  tweetId?: string
  userId: string
  autoPost: boolean
}) {
  return processVideoAsyncFlow({ url, platform, tweetId, userId, autoPost })
  console.log('🎬🎬🎬 [processVideoDirectly] ========== DIRECT VIDEO PROCESSING STARTED ==========')
  console.log('[processVideoDirectly] 📋 Full input parameters:', {
    url: url,
    urlRaw: JSON.stringify(url),
    platform: platform,
    tweetId: tweetId || 'NO_TWEET_ID',
    userId: userId,
    autoPost: autoPost,
    timestamp: new Date().toISOString(),
    memoryUsage: process.memoryUsage(),
    nodeVersion: process.version
  })

  // CRITICAL: Validate URL parameter before proceeding
  console.log('[processVideoDirectly] 🔍 Starting URL validation...')
  if (!url || typeof url !== 'string' || url.trim() === '') {
    console.error('[processVideoDirectly] ❌ CRITICAL ERROR: Invalid URL provided:', {
      url: url,
      urlRaw: JSON.stringify(url),
      urlType: typeof url,
      urlLength: url?.length || 0,
      isEmpty: !url,
      isEmptyString: url === '',
      isUndefined: url === undefined,
      isNull: url === null,
      validationTimestamp: new Date().toISOString()
    })
    throw new Error('Invalid or missing video URL')
  }

  const sanitizedUrl = url.trim()
  console.log('[processVideoDirectly] ✅ URL validation passed:', {
    originalUrl: url,
    originalUrlLength: url.length,
    sanitizedUrl: sanitizedUrl,
    sanitizedUrlLength: sanitizedUrl.length,
    trimmedCharacters: url.length - sanitizedUrl.length,
    validationSuccess: true,
    timestamp: new Date().toISOString()
  })

  try {
    console.log('[processVideoDirectly] 🏗️ Starting try block - main processing logic')
    
    // Update status to downloading
    if (tweetId) {
      console.log('[processVideoDirectly] 📝 Updating tweet status to downloading:', {
        tweetId: tweetId,
        newStatus: 'downloading',
        timestamp: new Date().toISOString()
      })
      
      const dbUpdateResult = await db
        .update(tweets)
        .set({
          videoProcessingStatus: 'downloading',
          updatedAt: new Date(),
        })
        .where(eq(tweets.id, tweetId))
        
      console.log('[processVideoDirectly] ✅ Tweet status updated successfully:', {
        tweetId: tweetId,
        updateResult: 'SUCCESS',
        timestamp: new Date().toISOString()
      })
    } else {
      console.log('[processVideoDirectly] ⚠️ No tweetId provided, skipping status update')
    }

    // Use the format from your documentation: video_urls array
    const apifyPayload = {
      video_urls: [sanitizedUrl],
      quality: "high"
    }

    console.log('[processVideoDirectly] Calling Apify with payload:', apifyPayload)
    
    const runResponse = await fetch(
      `https://api.apify.com/v2/acts/ceeA8aQjRcp3E6cNx/run-sync`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(apifyPayload),
      },
    )
    
    console.log(`[processVideoDirectly] Apify response: ${runResponse.status}`)

    if (!runResponse.ok) {
      const error = await runResponse.text()
      console.error('[processVideoDirectly] Error:', error)
      throw new Error(`Apify failed: ${runResponse.status} - ${error}`)
    }

    // run-sync returns results immediately
    const responseData: any = await runResponse.json()
    console.log('[processVideoDirectly] Received sync response:', responseData)
    
    if (!responseData.videos || !responseData.videos.length) {
      throw new Error('No video found at the provided URL')
    }
    
    const videoData = responseData.videos[0]
    console.log('[processVideoDirectly] Video data:', {
      platform: videoData.platform,
      title: videoData.title,
      duration: videoData.durationSeconds,
      mediaUrl: videoData.mediaUrl?.substring(0, 100) + '...',
    })

    // Download video file
    console.log('[processVideoDirectly] Downloading video from:', videoData.mediaUrl)
    const videoResponse = await fetch(videoData.mediaUrl)
    if (!videoResponse.ok) {
      throw new Error('Failed to download video file')
    }

    let videoBuffer = Buffer.from(await videoResponse.arrayBuffer())
    console.log('[processVideoDirectly] Downloaded video size:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB')

    // Update status to transcoding
    if (tweetId) {
      await db
        .update(tweets)
        .set({
          videoProcessingStatus: 'transcoding',
          updatedAt: new Date(),
        })
        .where(eq(tweets.id, tweetId))
    }

    // Transcode video to Twitter-compatible format
    console.log('[processVideoDirectly] Starting video transcoding')
    try {
      const tempDir = os.tmpdir()
      const inputPath = path.join(tempDir, `input_${nanoid()}.mp4`)
      const outputPath = path.join(tempDir, `output_${nanoid()}.mp4`)
      
      await fs.writeFile(inputPath, videoBuffer)
      console.log('[processVideoDirectly] Wrote input file:', inputPath)
      
      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .videoCodec('libx264')
          .audioCodec('aac')
          .format('mp4')
          .outputOptions([
            '-preset fast',
            '-crf 23',
            '-movflags +faststart',
            '-pix_fmt yuv420p',
          ])
          .on('start', (cmd) => {
            console.log('[processVideoDirectly] FFmpeg command:', cmd)
          })
          .on('progress', (progress) => {
            console.log('[processVideoDirectly] Transcoding progress:', Math.round(progress.percent || 0) + '%')
          })
          .on('end', () => {
            console.log('[processVideoDirectly] Transcoding completed')
            resolve()
          })
          .on('error', (err) => {
            console.error('[processVideoDirectly] FFmpeg error:', err)
            reject(err)
          })
          .save(outputPath)
      })
      
      const transcodedBuffer = await fs.readFile(outputPath)
      videoBuffer = transcodedBuffer
      
      console.log('[processVideoDirectly] Transcoding complete:', {
        originalSize: (await fs.stat(inputPath)).size,
        transcodedSize: transcodedBuffer.length,
        reduction: `${(100 - (transcodedBuffer.length / (await fs.stat(inputPath)).size) * 100).toFixed(1)}%`
      })
      
      // Clean up temp files
      await fs.unlink(inputPath).catch(() => {})
      await fs.unlink(outputPath).catch(() => {})
      
    } catch (error) {
      console.error('[processVideoDirectly] Transcoding failed:', error)
      // Continue with original video
    }

    // Validate video constraints
    const sizeInMB = videoBuffer.length / (1024 * 1024)
    if (sizeInMB > 512) {
      throw new Error(`Video too large (${sizeInMB.toFixed(2)}MB). Twitter limit is 512MB.`)
    }

    if (videoData.durationSeconds && videoData.durationSeconds > 140) {
      throw new Error(`Video too long (${Math.round(videoData.durationSeconds)}s). Twitter limit is 140s.`)
    }

    // Update status to uploading
    if (tweetId) {
      await db
        .update(tweets)
        .set({
          videoProcessingStatus: 'uploading',
          updatedAt: new Date(),
        })
        .where(eq(tweets.id, tweetId))
    }

    // Upload to S3
    const s3Key = `tweet-media/${userId}/${nanoid()}.mp4`
    console.log('[processVideoDirectly] Uploading to S3:', s3Key)

    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: videoBuffer,
        ContentType: 'video/mp4',
      }),
    )

    const publicUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/${s3Key}`
    console.log('[processVideoDirectly] S3 upload complete:', publicUrl)

    // Upload to Twitter
    console.log('[processVideoDirectly] Starting Twitter upload')
    
    // Get user's email from database first
    const { user: userSchema } = await import('@/db/schema')
    const [user] = await db
      .select({ email: userSchema.email })
      .from(userSchema)
      .where(eq(userSchema.id, userId))
      .limit(1)
    
    if (!user) {
      throw new Error('User not found')
    }
    
    console.log('[processVideoDirectly] Found user email:', user.email)
    
    // Get user's Twitter account
    const account = await getAccount({ email: user.email })
    
    if (!account) {
      throw new Error('No Twitter account found. Please connect your Twitter account in Settings.')
    }
    
    console.log('[processVideoDirectly] Found Twitter account:', account.username)
    
    const twitterClient = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY!,
      appSecret: process.env.TWITTER_API_SECRET!,
      accessToken: account.accessToken!,
      accessSecret: account.accessTokenSecret!,
    })

    // Log video details before upload
    const videoSizeMB = (videoBuffer.length / (1024 * 1024)).toFixed(2)
    const isLongVideo = videoBuffer.length > 15 * 1024 * 1024
    
    console.log('[processVideoDirectly] Preparing Twitter upload:', {
      videoSize: `${videoSizeMB}MB`,
      isLongVideo,
      duration: videoData.durationSeconds || videoData.duration,
      platform: videoData.platform,
      title: videoData.title?.substring(0, 50) + '...'
    })

    // Initialize chunked upload with proper media category
    let mediaId: string
    try {
      const mediaUpload = await twitterClient.v1.uploadMedia(videoBuffer, {
        mimeType: 'video/mp4',
        target: 'tweet',
        mediaCategory: 'tweet_video', // This is required for videos!
        waitForProcessing: true,
        longVideo: isLongVideo, // Use longVideo for files > 15MB
      })
      
      console.log('[processVideoDirectly] Twitter upload successful:', {
        media_id: mediaUpload,
        videoSize: `${videoSizeMB}MB`,
        processingTime: 'completed'
      })
      
      mediaId = mediaUpload
      
    } catch (twitterError: any) {
      console.error('[processVideoDirectly] Twitter upload failed:', {
        error: twitterError.message,
        code: twitterError.code,
        data: twitterError.data,
        videoSize: `${videoSizeMB}MB`,
        isLongVideo,
        accountUsername: account.username
      })
      
      // Provide specific error messages based on Twitter error codes
      if (twitterError.code === 403) {
        throw new Error('Twitter upload failed: Your Twitter app may not have video upload permissions. Please check your Twitter Developer app settings.')
      } else if (twitterError.code === 413) {
        throw new Error('Video too large for Twitter. Please use a smaller video.')
      } else if (twitterError.code === 400) {
        throw new Error('Invalid video format. Twitter requires MP4 videos with H.264 encoding.')
      } else {
        throw new Error(`Twitter upload failed: ${twitterError.message || 'Unknown error'}`)
      }
    }

    // Update tweet with video information
    if (tweetId) {
      const tweet = await db.query.tweets.findFirst({
        where: eq(tweets.id, tweetId),
      })

      if (tweet) {
        const updatedMedia = [
          ...(tweet.media || []),
          {
            s3Key,
            media_id: mediaId,
            url: publicUrl,
            type: 'video' as const,
            platform: videoData.platform || platform,
            originalUrl: videoData.sourceUrl || url,
            title: videoData.title,
            duration: videoData.durationSeconds,
            size: videoBuffer.length,
          },
        ]

        await db
          .update(tweets)
          .set({
            media: updatedMedia as any,
            videoProcessingStatus: 'complete',
            pendingVideoUrl: null,
            updatedAt: new Date(),
          })
          .where(eq(tweets.id, tweetId))

        console.log('[processVideoDirectly] Updated tweet with video:', tweetId)
      }
    }

    // Auto-post if enabled
    if (autoPost && tweetId) {
      console.log('[processVideoDirectly] Auto-posting tweet with video')
      const { publishThreadById } = await import('./chat/utils')
      await publishThreadById({
        threadId: tweetId,
        userId,
        accountId: account.id,
        logPrefix: 'processVideoDirectly'
      })
    }

    return {
      success: true,
      s3Key,
      url: publicUrl,
      media_id: mediaUpload,
      platform: videoData.platform || platform,
    }

  } catch (error) {
    console.error('[processVideoDirectly] Video processing error:', error)
    
    // Update tweet status
    if (tweetId) {
      await db
        .update(tweets)
        .set({
          videoProcessingStatus: 'failed',
          videoErrorMessage: error instanceof Error ? error.message : 'Unknown error',
          updatedAt: new Date(),
        })
        .where(eq(tweets.id, tweetId))
    }

    throw error
  }
}

export const videoRouter = j.router({
  // Submit video URL for processing
  submitVideoUrl: privateProcedure
    .input(
      z.object({
        url: z.string().url(),
        tweetId: z.string().optional(), // Optional: attach to existing tweet
        autoPost: z.boolean().default(false), // Whether to auto-post when ready
        tweetContent: z.string().optional(), // Content for auto-post
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { url, tweetId, autoPost, tweetContent } = input
      
      console.log('🔥🔥🔥 [VideoRouter] ========== VIDEO URL SUBMISSION STARTED ==========')
      console.log('[VideoRouter] submitVideoUrl called with full details:', {
        url: url,
        urlLength: url?.length,
        urlType: typeof url,
        tweetId: tweetId || 'NONE',
        autoPost: autoPost,
        tweetContent: tweetContent || 'NONE',
        tweetContentLength: tweetContent?.length || 0,
        userId: user.id,
        userEmail: user.email || 'NO_EMAIL',
        timestamp: new Date().toISOString(),
        requestHeaders: Object.fromEntries(c.req.raw.headers.entries()),
        environment: process.env.NODE_ENV
      })
      
      console.log('[VideoRouter] Environment check:', {
        hasApifyToken: !!process.env.APIFY_API_TOKEN,
        apifyTokenStart: process.env.APIFY_API_TOKEN?.substring(0, 8) + '...',
        hasS3Bucket: !!process.env.NEXT_PUBLIC_S3_BUCKET_NAME,
        s3Bucket: process.env.NEXT_PUBLIC_S3_BUCKET_NAME,
        hasAwsCredentials: !!process.env.AWS_GENERAL_ACCESS_KEY,
        nodeEnv: process.env.NODE_ENV
      })

      // Detect platform
      console.log('[VideoRouter] 🎯 Starting platform detection for URL:', url)
      const platform = detectPlatform(url)
      console.log('[VideoRouter] 📍 Platform detection result:', {
        detectedPlatform: platform || 'NONE_DETECTED',
        url: url,
        supportedPlatforms: Object.keys(PLATFORM_PATTERNS)
      })
      
      if (!platform) {
        console.error('[VideoRouter] ❌ PLATFORM DETECTION FAILED:', {
          url: url,
          supportedPlatforms: Object.keys(PLATFORM_PATTERNS),
          failureReason: 'URL did not match any supported platform patterns'
        })
        throw new HTTPException(400, {
          message: 'Unsupported URL. Please provide a valid video link from: TikTok, Instagram, YouTube, Twitter/X, Facebook, Vimeo, Dailymotion, LinkedIn, Twitch, Reddit, or Snapchat.',
        })
      }

      // Check if Apify API token is configured
      console.log('[VideoRouter] 🔐 Checking Apify API token configuration...')
      if (!process.env.APIFY_API_TOKEN) {
        console.error('[VideoRouter] ❌ CRITICAL ERROR: APIFY_API_TOKEN not configured:', {
          hasToken: false,
          tokenValue: 'UNDEFINED',
          envKeys: Object.keys(process.env).filter(k => k.includes('APIFY')),
          timestamp: new Date().toISOString()
        })
        throw new HTTPException(500, {
          message: 'Video downloader is not configured. Please add APIFY_API_TOKEN to your environment variables.',
        })
      }
      
      console.log('[VideoRouter] ✅ Apify token validated:', {
        hasToken: true,
        tokenLength: process.env.APIFY_API_TOKEN.length,
        tokenStart: process.env.APIFY_API_TOKEN.substring(0, 8) + '...',
        tokenEnd: '...' + process.env.APIFY_API_TOKEN.substring(-4)
      })

      try {
        console.log('[VideoRouter] 🚀 Starting video processing workflow...')
        
        // If we have a tweetId, update it with pending video status
        if (tweetId) {
          console.log('[VideoRouter] 📝 Updating existing tweet with pending video status:', {
            tweetId: tweetId,
            url: url,
            action: 'UPDATE_EXISTING_TWEET'
          })
          
          const updateResult = await db
            .update(tweets)
            .set({
              pendingVideoUrl: url,
              videoProcessingStatus: 'downloading',
              updatedAt: new Date(),
            })
            .where(eq(tweets.id, tweetId))
            
          console.log('[VideoRouter] ✅ Tweet update completed:', {
            tweetId: tweetId,
            updateResult: 'SUCCESS',
            timestamp: new Date().toISOString()
          })
        }

        // Create a new tweet if auto-post is enabled and no tweetId provided
        let processedTweetId = tweetId
        if (autoPost && !tweetId) {
          console.log('[VideoRouter] 🆕 Creating new tweet for auto-post:', {
            autoPost: autoPost,
            tweetId: tweetId,
            userId: user.id,
            platform: platform
          })
          
          console.log('[VideoRouter] 🔍 Getting user account for new tweet...')
          const account = await getAccount(user.id)
          console.log('[VideoRouter] 📊 Account retrieved:', {
            accountId: account?.id || 'NONE',
            hasAccount: !!account,
            userId: user.id
          })
          
          const newTweetData = {
            content: tweetContent || `Check out this video from ${platform}!`,
            userId: user.id,
            accountId: account?.id,
            pendingVideoUrl: url,
            videoProcessingStatus: 'downloading',
            isScheduled: false, // Will be scheduled when video is ready
            media: [],
          }
          
          console.log('[VideoRouter] 💾 Inserting new tweet with data:', newTweetData)
          
          const [newTweet] = await db
            .insert(tweets)
            .values(newTweetData)
            .returning()
          
          processedTweetId = newTweet?.id
          console.log('[VideoRouter] ✅ New tweet created successfully:', {
            newTweetId: processedTweetId,
            content: newTweetData.content,
            timestamp: new Date().toISOString()
          })
        }

        // In development, process video synchronously to avoid QStash localhost issues
        if (process.env.NODE_ENV === 'development') {
          console.log('[VideoRouter] 🧪 DEVELOPMENT MODE DETECTED - Processing video synchronously')
          console.log('[VideoRouter] 🔄 Development processing parameters:', {
            url: url,
            platform: platform,
            tweetId: processedTweetId || 'NONE',
            userId: user.id,
            autoPost: autoPost,
            timestamp: new Date().toISOString()
          })
          
          // Process video directly in the same request (but in background)
          setImmediate(async () => {
            try {
              console.log('[VideoRouter] 🏁 Starting background video processing in development...')
              console.log('[VideoRouter] 📤 Calling processVideoDirectly with parameters:', {
                url,
                platform,
                tweetId: processedTweetId,
                userId: user.id,
                autoPost,
                currentTime: new Date().toISOString()
              })
              
              await processVideoDirectly({
                url,
                platform,
                tweetId: processedTweetId,
                userId: user.id,
                autoPost,
              })
              
              console.log('[VideoRouter] ✅ Video processed successfully in development mode:', {
                url: url,
                platform: platform,
                tweetId: processedTweetId,
                completedAt: new Date().toISOString()
              })
            } catch (error) {
              console.error('[VideoRouter] ❌ Development video processing failed:', {
                error: error,
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
                errorStack: error instanceof Error ? error.stack : 'No stack',
                url: url,
                platform: platform,
                tweetId: processedTweetId,
                failedAt: new Date().toISOString()
              })
              
              // Update tweet status on error
              if (processedTweetId) {
                console.log('[VideoRouter] 🔄 Updating tweet status to failed:', {
                  tweetId: processedTweetId,
                  errorMessage: error instanceof Error ? error.message : 'Video processing failed'
                })
                
                await db
                  .update(tweets)
                  .set({
                    videoProcessingStatus: 'failed',
                    videoErrorMessage: error instanceof Error ? error.message : 'Video processing failed',
                    updatedAt: new Date(),
                  })
                  .where(eq(tweets.id, processedTweetId))
                  
                console.log('[VideoRouter] ✅ Tweet status updated to failed')
              }
            }
          })
        } else {
          // Production: use QStash for async processing
          const webhookUrl = process.env.WEBHOOK_URL || getBaseUrl() + '/api/video/processVideo'
          console.log('[VideoRouter] Production mode: enqueueing video processing job:', {
            webhookUrl,
            tweetId: processedTweetId,
            url
          })

          await qstash.publishJSON({
            url: webhookUrl,
            body: {
              url,
              platform,
              tweetId: processedTweetId,
              userId: user.id,
              autoPost,
            },
          })
        }

        return c.json({
          success: true,
          message: 'Video processing started',
          tweetId: processedTweetId,
          platform,
        })
      } catch (error) {
        console.error('[VideoRouter] Error starting video processing:', error)
        
        // Update tweet status if we have one
        if (tweetId) {
          await db
            .update(tweets)
            .set({
              videoProcessingStatus: 'failed',
              videoErrorMessage: error instanceof Error ? error.message : 'Unknown error',
              updatedAt: new Date(),
            })
            .where(eq(tweets.id, tweetId))
        }

        if (error instanceof HTTPException) {
          throw error
        }
        
        throw new HTTPException(500, {
          message: 'Failed to start video processing',
        })
      }
    }),

  // Process video (called by QStash webhook)
  processVideo: privateProcedure
    .input(
      z.object({
        url: z.string(),
        platform: z.string(),
        tweetId: z.string().optional(),
        userId: z.string(),
        autoPost: z.boolean().default(false),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { url, platform, tweetId, userId, autoPost } = input
      
      console.log('[VideoRouter] processVideo webhook called:', {
        url,
        platform,
        tweetId,
        userId,
        autoPost,
        timestamp: new Date().toISOString()
      })

      try {
        // CRITICAL: Validate URL parameter before proceeding
        if (!url || typeof url !== 'string' || url.trim() === '') {
          console.error('[VideoRouter] CRITICAL ERROR: Invalid URL provided:', {
            url,
            urlType: typeof url,
            urlLength: url?.length || 0,
            isEmpty: !url,
            isEmptyString: url === '',
            isUndefined: url === undefined,
            isNull: url === null
          })
          throw new Error('Invalid or missing video URL')
        }

        const sanitizedUrl = url.trim()
        console.log('[VideoRouter] URL validation passed:', {
          originalUrl: url,
          sanitizedUrl,
          urlLength: sanitizedUrl.length
        })

        // Update status to downloading
        if (tweetId) {
          await db
            .update(tweets)
            .set({
              videoProcessingStatus: 'downloading',
              updatedAt: new Date(),
            })
            .where(eq(tweets.id, tweetId))
        }

        // Prepare Apify request payload (trying original nested format with Bearer auth)
        const apifyPayload = {
          input: {
            video_url: sanitizedUrl,
            downloadVideo: true,
            downloadAudio: false,
            downloadThumbnail: true,
          }
        }

        console.log('[VideoRouter] Preparing Apify request:', {
          apiEndpoint: `https://api.apify.com/v2/acts/marketingme~video-downloader/runs`,
          hasApiToken: !!process.env.APIFY_API_TOKEN,
          apiTokenLength: process.env.APIFY_API_TOKEN?.length || 0,
          payload: apifyPayload,
          payloadString: JSON.stringify(apifyPayload)
        })

        // Call Apify marketingme/video-downloader actor with Bearer auth
        console.log('[VideoRouter] Starting Apify actor run')
        const runResponse = await fetch(
          `https://api.apify.com/v2/acts/marketingme~video-downloader/runs`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(apifyPayload),
          },
        )

        if (!runResponse.ok) {
          const error = await runResponse.text()
          console.error('[VideoRouter] Failed to start Apify run:', {
            status: runResponse.status,
            statusText: runResponse.statusText,
            error,
            url: sanitizedUrl,
            headers: Object.fromEntries(runResponse.headers.entries())
          })
          
          // Try to parse error as JSON for better error details
          try {
            const errorJson = JSON.parse(error)
            console.error('[VideoRouter] Parsed Apify error:', errorJson)
            
            if (errorJson.error?.message) {
              throw new Error(`Apify API Error: ${errorJson.error.message}`)
            }
          } catch (parseError) {
            console.log('[VideoRouter] Could not parse error as JSON, using raw text')
          }
          
          throw new Error(`Failed to start video download process. Status: ${runResponse.status}. Error: ${error}`)
        }

        const runData: any = await runResponse.json()
        const runId = runData.data.id
        console.log('[VideoRouter] Started Apify run:', runId)

        // Poll for completion with exponential backoff
        const maxAttempts = 90
        let attempts = 0
        let runStatus: any
        let currentDelayMs = 1500
        const backoff = 1.25
        const maxDelayMs = 8000

        while (attempts < maxAttempts) {
          attempts++
          
          await new Promise(resolve => setTimeout(resolve, currentDelayMs))
          console.log(`[VideoRouter] Polling attempt ${attempts}/${maxAttempts}, delay: ${currentDelayMs}ms`)
          currentDelayMs = Math.min(Math.round(currentDelayMs * backoff), maxDelayMs)
          
          const statusResponse = await fetch(
            `https://api.apify.com/v2/acts/marketingme~video-downloader/runs/${runId}`,
            {
              headers: {
                'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}`,
              },
            }
          )
          
          if (!statusResponse.ok) {
            console.error('[VideoRouter] Failed to check run status')
            continue
          }
          
          runStatus = await statusResponse.json()
          console.log(`[VideoRouter] Run status: ${runStatus.data.status}`)
          
          if (runStatus.data.status === 'SUCCEEDED') {
            break
          } else if (runStatus.data.status === 'FAILED' || runStatus.data.status === 'ABORTED') {
            throw new Error('Video download failed')
          }
        }

        if (runStatus?.data?.status !== 'SUCCEEDED') {
          throw new Error('Video download timed out')
        }

        // Get the dataset items
        const datasetId = runStatus.data.defaultDatasetId
        const itemsResponse = await fetch(
          `https://api.apify.com/v2/datasets/${datasetId}/items`,
          {
            headers: {
              'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}`,
            },
          }
        )

        if (!itemsResponse.ok) {
          throw new Error('Failed to retrieve video data')
        }

        const items: any[] = await itemsResponse.json()
        console.log('[VideoRouter] Retrieved dataset items:', items.length)

        if (!items.length) {
          throw new Error('No video found at the provided URL')
        }

        const videoData = items[0]
        console.log('[VideoRouter] Video data:', {
          platform: videoData.platform,
          title: videoData.title,
          duration: videoData.durationSeconds,
          mediaUrl: videoData.mediaUrl?.substring(0, 100) + '...',
          thumbnailUrl: videoData.thumbnailUrl?.substring(0, 100) + '...',
        })

        // Download video file
        console.log('[VideoRouter] Downloading video from:', videoData.mediaUrl)
        const videoResponse = await fetch(videoData.mediaUrl)
        if (!videoResponse.ok) {
          throw new Error('Failed to download video file')
        }

        let videoBuffer = Buffer.from(await videoResponse.arrayBuffer())
        console.log('[VideoRouter] Downloaded video size:', (videoBuffer.length / 1024 / 1024).toFixed(2), 'MB')

        // Update status to transcoding
        if (tweetId) {
          await db
            .update(tweets)
            .set({
              videoProcessingStatus: 'transcoding',
              updatedAt: new Date(),
            })
            .where(eq(tweets.id, tweetId))
        }

        // Transcode video to Twitter-compatible format
        console.log('[VideoRouter] Starting video transcoding')
        try {
          const tempDir = os.tmpdir()
          const inputPath = path.join(tempDir, `input_${nanoid()}.mp4`)
          const outputPath = path.join(tempDir, `output_${nanoid()}.mp4`)
          
          await fs.writeFile(inputPath, videoBuffer)
          console.log('[VideoRouter] Wrote input file:', inputPath)
          
          await new Promise<void>((resolve, reject) => {
            ffmpeg(inputPath)
              .videoCodec('libx264')
              .audioCodec('aac')
              .format('mp4')
              .outputOptions([
                '-preset fast',
                '-crf 23',
                '-movflags +faststart',
                '-pix_fmt yuv420p',
              ])
              .on('start', (cmd) => {
                console.log('[VideoRouter] FFmpeg command:', cmd)
              })
              .on('progress', (progress) => {
                console.log('[VideoRouter] Transcoding progress:', Math.round(progress.percent || 0) + '%')
              })
              .on('end', () => {
                console.log('[VideoRouter] Transcoding completed')
                resolve()
              })
              .on('error', (err) => {
                console.error('[VideoRouter] FFmpeg error:', err)
                reject(err)
              })
              .save(outputPath)
          })
          
          const transcodedBuffer = await fs.readFile(outputPath)
          videoBuffer = transcodedBuffer
          
          console.log('[VideoRouter] Transcoding complete:', {
            originalSize: (await fs.stat(inputPath)).size,
            transcodedSize: transcodedBuffer.length,
            reduction: `${(100 - (transcodedBuffer.length / (await fs.stat(inputPath)).size) * 100).toFixed(1)}%`
          })
          
          // Clean up temp files
          await fs.unlink(inputPath).catch(() => {})
          await fs.unlink(outputPath).catch(() => {})
          
        } catch (error) {
          console.error('[VideoRouter] Transcoding failed:', error)
          // Continue with original video
        }

        // Validate video constraints
        const sizeInMB = videoBuffer.length / (1024 * 1024)
        if (sizeInMB > 512) {
          throw new Error(`Video too large (${sizeInMB.toFixed(2)}MB). Twitter limit is 512MB.`)
        }

        if (videoData.durationSeconds && videoData.durationSeconds > 140) {
          throw new Error(`Video too long (${Math.round(videoData.durationSeconds)}s). Twitter limit is 140s.`)
        }

        // Update status to uploading
        if (tweetId) {
          await db
            .update(tweets)
            .set({
              videoProcessingStatus: 'uploading',
              updatedAt: new Date(),
            })
            .where(eq(tweets.id, tweetId))
        }

        // Upload to S3
        const s3Key = `tweet-media/${userId}/${nanoid()}.mp4`
        console.log('[VideoRouter] Uploading to S3:', s3Key)

        await s3Client.send(
          new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key,
            Body: videoBuffer,
            ContentType: 'video/mp4',
          }),
        )

        const publicUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/${s3Key}`
        console.log('[VideoRouter] S3 upload complete:', publicUrl)

        // Upload to Twitter
        console.log('[VideoRouter] Starting Twitter upload')
        const account = await getAccount(userId)
        
        const twitterClient = new TwitterApi({
          appKey: process.env.TWITTER_API_KEY!,
          appSecret: process.env.TWITTER_API_SECRET!,
          accessToken: account.accessToken!,
          accessSecret: account.accessTokenSecret!,
        })

        // Initialize chunked upload
        const mediaUpload = await twitterClient.v1.uploadMedia(videoBuffer, {
          mimeType: 'video/mp4',
          target: 'tweet',
          waitForProcessing: true,
          longVideo: false,
        })

        console.log('[VideoRouter] Twitter upload complete:', {
          media_id: mediaUpload,
        })

        // Update tweet with video information
        if (tweetId) {
          const tweet = await db.query.tweets.findFirst({
            where: eq(tweets.id, tweetId),
          })

          if (tweet) {
            const updatedMedia = [
              ...(tweet.media || []),
              {
                s3Key,
                media_id: mediaUpload,
                url: publicUrl,
                type: 'video' as const,
                platform: videoData.platform || platform,
                originalUrl: videoData.sourceUrl || url,
                title: videoData.title,
                duration: videoData.durationSeconds,
                size: videoBuffer.length,
              },
            ]

            await db
              .update(tweets)
              .set({
                media: updatedMedia as any,
                videoProcessingStatus: 'complete',
                pendingVideoUrl: null,
                updatedAt: new Date(),
              })
              .where(eq(tweets.id, tweetId))

            console.log('[VideoRouter] Updated tweet with video:', tweetId)
          }
        }

        // Auto-post if enabled
        if (autoPost && tweetId) {
          console.log('[VideoRouter] Auto-posting tweet with video')
          await qstash.publishJSON({
            url: process.env.WEBHOOK_URL || getBaseUrl() + '/api/tweet/postThread',
            body: {
              threadId: tweetId,
              userId,
              accountId: account.id,
            },
          })
        }

        return c.json({
          success: true,
          message: 'Video processed successfully',
          s3Key,
          url: publicUrl,
          media_id: mediaUpload,
          platform: videoData.platform || platform,
        })

      } catch (error) {
        console.error('[VideoRouter] Video processing error:', error)
        
        // Update tweet status
        if (tweetId) {
          await db
            .update(tweets)
            .set({
              videoProcessingStatus: 'failed',
              videoErrorMessage: error instanceof Error ? error.message : 'Unknown error',
              updatedAt: new Date(),
            })
            .where(eq(tweets.id, tweetId))
        }

        throw new HTTPException(500, {
          message: error instanceof Error ? error.message : 'Video processing failed',
        })
      }
    }),

  // Get video processing status
  getVideoProcessingStatus: privateProcedure
    .input(
      z.object({
        tweetId: z.string(),
      }),
    )
    .get(async ({ c, ctx, input }) => {
      const { tweetId } = input
      
      const tweet = await db.query.tweets.findFirst({
        where: eq(tweets.id, tweetId),
      })

      if (!tweet) {
        throw new HTTPException(404, {
          message: 'Tweet not found',
        })
      }

      return c.json({
        status: tweet.videoProcessingStatus || null,
        errorMessage: tweet.videoErrorMessage || null,
        pendingVideoUrl: tweet.pendingVideoUrl || null,
      })
    }),

  // Get all tweets with processing videos
  getProcessingVideos: privateProcedure
    .get(async ({ c, ctx }) => {
      const { user } = ctx
      
      console.log('[VideoRouter] Getting processing videos for user:', user.id)
      
      const processingTweets = await db.query.tweets.findMany({
        where: and(
          eq(tweets.userId, user.id),
          // Get all tweets that have any video processing status or pending video URL
          // This includes downloading, transcoding, uploading, complete, and failed
        ),
      })

      // Filter for tweets that actually have video processing activity
      const videosInProgress = processingTweets.filter(tweet => 
        tweet.videoProcessingStatus || 
        tweet.pendingVideoUrl ||
        (tweet.media && tweet.media.some((m: any) => m.type === 'video'))
      )

      console.log('[VideoRouter] Found video-related tweets:', videosInProgress.length)

      return c.json({
        tweets: videosInProgress,
      })
    }),
})
