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

// Configure FFmpeg path (use system FFmpeg)
// TODO: Make this configurable via environment variable
ffmpeg.setFfmpegPath('/opt/homebrew/bin/ffmpeg')

const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_GENERAL_ACCESS_KEY!,
    secretAccessKey: process.env.AWS_GENERAL_SECRET_KEY!,
  },
})

const BUCKET_NAME = process.env.NEXT_PUBLIC_S3_BUCKET_NAME!

// Platform detection patterns
const PLATFORM_PATTERNS = {
  tiktok: /(?:(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/(\d+)|vm\.tiktok\.com\/([A-Za-z0-9_-]+))/,
  instagram: /(?:(?:www\.)?instagram\.com\/(?:reel|p)\/([A-Za-z0-9_-]+))/,
  youtube: /(?:(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11}))/,
  twitter: /(?:(?:www\.)?(?:twitter\.com|x\.com)\/\w+\/status\/(\d+))/,
  facebook: /(?:(?:www\.)?facebook\.com\/.*\/videos\/(\d+))/,
  linkedin: /(?:(?:www\.)?linkedin\.com\/posts\/.*)/,
}

function detectPlatform(url: string): string | null {
  console.log('[VideoRouter] Detecting platform for URL:', url)
  for (const [platform, pattern] of Object.entries(PLATFORM_PATTERNS)) {
    if (pattern.test(url)) {
      console.log('[VideoRouter] Detected platform:', platform)
      return platform
    }
  }
  console.log('[VideoRouter] No platform detected for URL:', url)
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
  console.log('[processVideoDirectly] Starting video processing:', {
    url,
    platform,
    tweetId,
    userId,
    autoPost,
    timestamp: new Date().toISOString()
  })

  try {
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

    // Call Apify marketingme/video-downloader actor
    console.log('[processVideoDirectly] Starting Apify actor run')
    const runResponse = await fetch(
      `https://api.apify.com/v2/acts/marketingme~video-downloader/runs?token=${process.env.APIFY_API_TOKEN}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          video_urls: [url],
          downloadVideo: true,
          downloadAudio: false,
          downloadThumbnail: true,
        }),
      },
    )

    if (!runResponse.ok) {
      const error = await runResponse.text()
      console.error('[processVideoDirectly] Failed to start Apify run:', error)
      throw new Error('Failed to start video download process')
    }

    const runData: any = await runResponse.json()
    const runId = runData.data.id
    console.log('[processVideoDirectly] Started Apify run:', runId)

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
      console.log(`[processVideoDirectly] Polling attempt ${attempts}/${maxAttempts}, delay: ${currentDelayMs}ms`)
      currentDelayMs = Math.min(Math.round(currentDelayMs * backoff), maxDelayMs)
      
      const statusResponse = await fetch(
        `https://api.apify.com/v2/acts/marketingme~video-downloader/runs/${runId}?token=${process.env.APIFY_API_TOKEN}`,
      )
      
      if (!statusResponse.ok) {
        console.error('[processVideoDirectly] Failed to check run status')
        continue
      }
      
      runStatus = await statusResponse.json()
      console.log(`[processVideoDirectly] Run status: ${runStatus.data.status}`)
      
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
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${process.env.APIFY_API_TOKEN}`,
    )

    if (!itemsResponse.ok) {
      throw new Error('Failed to retrieve video data')
    }

    const items: any[] = await itemsResponse.json()
    console.log('[processVideoDirectly] Retrieved dataset items:', items.length)

    if (!items.length) {
      throw new Error('No video found at the provided URL')
    }

    const videoData = items[0]
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

    console.log('[processVideoDirectly] Twitter upload complete:', {
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
      
      console.log('[VideoRouter] submitVideoUrl called:', {
        url,
        tweetId,
        autoPost,
        tweetContent: tweetContent?.substring(0, 50) + '...',
        userId: user.id,
        timestamp: new Date().toISOString()
      })

      // Detect platform
      const platform = detectPlatform(url)
      if (!platform) {
        throw new HTTPException(400, {
          message: 'Unsupported URL. Please provide a valid video link from: TikTok, Instagram, YouTube, Twitter/X, Facebook, or LinkedIn.',
        })
      }

      // Check if Apify API token is configured
      if (!process.env.APIFY_API_TOKEN) {
        console.error('[VideoRouter] APIFY_API_TOKEN not configured')
        throw new HTTPException(500, {
          message: 'Video downloader is not configured. Please add APIFY_API_TOKEN to your environment variables.',
        })
      }

      try {
        // If we have a tweetId, update it with pending video status
        if (tweetId) {
          console.log('[VideoRouter] Updating tweet with pending video status:', tweetId)
          await db
            .update(tweets)
            .set({
              pendingVideoUrl: url,
              videoProcessingStatus: 'downloading',
              updatedAt: new Date(),
            })
            .where(eq(tweets.id, tweetId))
        }

        // Create a new tweet if auto-post is enabled and no tweetId provided
        let processedTweetId = tweetId
        if (autoPost && !tweetId) {
          console.log('[VideoRouter] Creating new tweet for auto-post')
          const account = await getAccount(user.id)
          
          const [newTweet] = await db
            .insert(tweets)
            .values({
              content: tweetContent || `Check out this video from ${platform}!`,
              userId: user.id,
              accountId: account.id,
              pendingVideoUrl: url,
              videoProcessingStatus: 'downloading',
              isScheduled: false, // Will be scheduled when video is ready
              media: [],
            })
            .returning()
          
          processedTweetId = newTweet.id
          console.log('[VideoRouter] Created new tweet for video:', processedTweetId)
        }

        // In development, process video synchronously to avoid QStash localhost issues
        if (process.env.NODE_ENV === 'development') {
          console.log('[VideoRouter] Development mode: processing video synchronously')
          
          // Process video directly in the same request (but in background)
          setImmediate(async () => {
            try {
              console.log('[VideoRouter] Starting background video processing in development')
              await processVideoDirectly({
                url,
                platform,
                tweetId: processedTweetId,
                userId: user.id,
                autoPost,
              })
              console.log('[VideoRouter] Video processed successfully in development mode')
            } catch (error) {
              console.error('[VideoRouter] Development video processing failed:', error)
              // Update tweet status on error
              if (processedTweetId) {
                await db
                  .update(tweets)
                  .set({
                    videoProcessingStatus: 'failed',
                    videoErrorMessage: error instanceof Error ? error.message : 'Video processing failed',
                    updatedAt: new Date(),
                  })
                  .where(eq(tweets.id, processedTweetId))
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

        // Call Apify marketingme/video-downloader actor
        console.log('[VideoRouter] Starting Apify actor run')
        const runResponse = await fetch(
          `https://api.apify.com/v2/acts/marketingme~video-downloader/runs?token=${process.env.APIFY_API_TOKEN}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              video_urls: [url],
              downloadVideo: true,
              downloadAudio: false,
              downloadThumbnail: true,
            }),
          },
        )

        if (!runResponse.ok) {
          const error = await runResponse.text()
          console.error('[VideoRouter] Failed to start Apify run:', error)
          throw new Error('Failed to start video download process')
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
            `https://api.apify.com/v2/acts/marketingme~video-downloader/runs/${runId}?token=${process.env.APIFY_API_TOKEN}`,
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
          `https://api.apify.com/v2/datasets/${datasetId}/items?token=${process.env.APIFY_API_TOKEN}`,
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
