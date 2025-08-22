import { j, privateProcedure } from '../jstack'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { nanoid } from 'nanoid'

const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_GENERAL_ACCESS_KEY!,
    secretAccessKey: process.env.AWS_GENERAL_SECRET_KEY!,
  },
})

const BUCKET_NAME = process.env.NEXT_PUBLIC_S3_BUCKET_NAME!

// Regex patterns for supported platforms
const PLATFORM_PATTERNS = {
  instagram: /(?:instagram\.com|instagr\.am)\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/,
  tiktok: /(?:tiktok\.com\/@[\w.-]+\/video\/(\d+)|vm\.tiktok\.com\/([A-Za-z0-9]+))/,
  twitter: /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/,
  youtube: /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]+)/,
}

function detectPlatform(url: string): string | null {
  for (const [platform, pattern] of Object.entries(PLATFORM_PATTERNS)) {
    if (pattern.test(url)) {
      return platform
    }
  }
  return null
}

export const videoDownloaderRouter = j.router({
  downloadVideo: privateProcedure
    .input(
      z.object({
        url: z.string().url(),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { url } = input

      // Detect platform
      const platform = detectPlatform(url)
      if (!platform) {
        throw new HTTPException(400, {
          message: 'Unsupported URL. Please provide a valid Instagram, TikTok, Twitter/X, or YouTube link.',
        })
      }

      // Check if Apify API token is configured
      if (!process.env.APIFY_API_TOKEN) {
        throw new HTTPException(500, {
          message: 'Video downloader is not configured. Please add APIFY_API_TOKEN to your environment variables.',
        })
      }

      try {
        console.log(`[VideoDownloader] Downloading video from ${platform}: ${url}`)

        // Start Apify actor run (async)
        const runResponse = await fetch(
          `https://api.apify.com/v2/acts/ceeA8aQjRcp3E6cNx/runs?token=${process.env.APIFY_API_TOKEN}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              video_urls: [url],
              quality: 'high',
            }),
          },
        )

        if (!runResponse.ok) {
          const error = await runResponse.text()
          console.error('[VideoDownloader] Failed to start Apify run:', error)
          throw new HTTPException(500, {
            message: 'Failed to start video download process.',
          })
        }

        const runData: any = await runResponse.json()
        const runId = runData.data.id
        console.log('[VideoDownloader] Started Apify run:', runId)

        // Poll for completion (max 60 seconds)
        const maxAttempts = 90 // extended window with backoff (~3-4 minutes max)
        let attempts = 0
        let runStatus: any
        // Exponential backoff for polling, capped to avoid too long waits
        let baseDelayMs = 1500
        const backoff = 1.25
        const maxDelayMs = 8000
        let currentDelayMs = baseDelayMs

        while (attempts < maxAttempts) {
          attempts++
          
          // Wait with exponential backoff between checks
          await new Promise(resolve => setTimeout(resolve, currentDelayMs))
          console.log(`[VideoDownloader] Poll wait: ${currentDelayMs}ms (attempt ${attempts}/${maxAttempts})`)
          currentDelayMs = Math.min(Math.round(currentDelayMs * backoff), maxDelayMs)
          
          // Check run status
          const statusResponse = await fetch(
            `https://api.apify.com/v2/acts/ceeA8aQjRcp3E6cNx/runs/${runId}?token=${process.env.APIFY_API_TOKEN}`,
          )
          
          if (!statusResponse.ok) {
            console.error('[VideoDownloader] Failed to check run status')
            continue
          }
          
          runStatus = await statusResponse.json()
          console.log(`[VideoDownloader] Run status (attempt ${attempts}):`, runStatus.data.status)
          
          if (runStatus.data.status === 'SUCCEEDED') {
            break
          } else if (runStatus.data.status === 'FAILED' || runStatus.data.status === 'ABORTED') {
            throw new HTTPException(500, {
              message: 'Video download failed. Please try again.',
            })
          }
        }

        if (runStatus?.data?.status !== 'SUCCEEDED') {
          throw new HTTPException(408, {
            message: 'Video download timed out. The source platform may be slow. Please retry or try a shorter video.',
          })
        }

        // Get the dataset items (results)
        const datasetId = runStatus.data.defaultDatasetId
        const itemsResponse = await fetch(
          `https://api.apify.com/v2/datasets/${datasetId}/items?token=${process.env.APIFY_API_TOKEN}`,
        )

        if (!itemsResponse.ok) {
          throw new HTTPException(500, {
            message: 'Failed to retrieve video data.',
          })
        }

        const result: any = await itemsResponse.json()
        console.log('[VideoDownloader] Dataset items:', result)

        // Extract video data from dataset items
        // The result is an array of items, not an object with videos property
        const items = Array.isArray(result) ? result : (result.items || [])
        if (!items.length) {
          throw new HTTPException(404, {
            message: 'No video found at the provided URL.',
          })
        }

        const video = items[0]
        const mediaUrl = video.mediaUrl // Direct video file URL (watermark-free)

        if (!mediaUrl) {
          console.error('[VideoDownloader] Video object missing mediaUrl:', video)
          throw new HTTPException(404, {
            message: 'Could not extract video URL from the response.',
          })
        }

        console.log(`[VideoDownloader] Downloading video from: ${mediaUrl}`)

        // Download the video
        const videoResponse = await fetch(mediaUrl)
        if (!videoResponse.ok) {
          throw new HTTPException(500, {
            message: 'Failed to download video file.',
          })
        }

        const videoBuffer = Buffer.from(await videoResponse.arrayBuffer())
        
        // Validate video size (Twitter limit is 512MB)
        const sizeInMB = videoBuffer.length / (1024 * 1024)
        if (sizeInMB > 512) {
          throw new HTTPException(413, {
            message: `Video is too large (${sizeInMB.toFixed(2)}MB). Twitter's limit is 512MB.`,
          })
        }

        // Check video duration (Twitter limit is 140 seconds)
        if (video.durationSeconds && video.durationSeconds > 140) {
          throw new HTTPException(413, {
            message: `Video is too long (${Math.round(video.durationSeconds)}s). Twitter's limit is 140 seconds.`,
          })
        }

        // Check video dimensions and preserve orientation
        if (video.width && video.height) {
          const aspectRatio = video.width / video.height
          const isPortrait = video.height > video.width
          const isLandscape = video.width > video.height
          const isSquare = video.width === video.height
          
          console.log(`[VideoDownloader] Video info:`, {
            dimensions: `${video.width}x${video.height}`,
            aspectRatio: aspectRatio.toFixed(2),
            orientation: isPortrait ? 'portrait' : isLandscape ? 'landscape' : 'square',
            duration: `${video.durationSeconds}s`,
            size: `${sizeInMB.toFixed(2)}MB`
          })
          
          // Twitter aspect ratio requirements: between 1:2.39 and 2.39:1
          if (aspectRatio < (1/2.39) || aspectRatio > 2.39) {
            console.warn(`[VideoDownloader] Video aspect ratio ${aspectRatio.toFixed(2)} might not be ideal for Twitter`)
          }
          
          // Check minimum dimensions (32x32)
          if (video.width < 32 || video.height < 32) {
            throw new HTTPException(413, {
              message: `Video dimensions too small (${video.width}x${video.height}). Twitter requires at least 32x32 pixels.`,
            })
          }

          // Check maximum dimensions (1920x1200 for landscape, but Twitter accepts up to 1920 width)
          if (video.width > 1920 || video.height > 1920) {
            console.warn(`[VideoDownloader] Video dimensions ${video.width}x${video.height} exceed Twitter's recommended limits`)
          }
        }

        // Force MP4 content type for Twitter compatibility
        const contentType = 'video/mp4'
        
        // SIMPLE FIX: Check if this is an Instagram Reel (often incompatible with Twitter)
        if (platform === 'instagram' && video.height > video.width) {
          console.warn('[VideoDownloader] Instagram Reel detected - Twitter may reject due to codec incompatibility')
          // Add a warning to the response
        }

        // Generate S3 key - always use .mp4 extension for Twitter compatibility
        const s3Key = `tweet-media/${user.id}/${nanoid()}.mp4`

        console.log(`[VideoDownloader] Uploading to S3: ${s3Key}`)

        // Upload to S3
        await s3Client.send(
          new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key,
            Body: videoBuffer,
            ContentType: contentType,
          }),
        )

        // Generate public URL
        const publicUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/${s3Key}`

        console.log(`[VideoDownloader] Video uploaded successfully: ${publicUrl}`)

        // Check if video might have Twitter compatibility issues
        const warningMessage = platform === 'instagram' 
          ? 'Note: Instagram videos may fail to upload to Twitter due to codec incompatibility. Twitter requires H.264/AAC encoding.'
          : null

        // Return response matching the Apify documentation fields
        return c.json({
          success: true,
          s3Key,
          url: publicUrl,
          mediaType: 'video' as const,
          platform: video.platform || platform,
          originalUrl: video.sourceUrl || url,
          title: video.title || 'Downloaded video',
          description: video.description,
          author: video.author,
          authorUrl: video.authorUrl,
          sizeBytes: videoBuffer.length,
          duration: video.durationSeconds,
          viewCount: video.viewCount,
          likeCount: video.likeCount,
          width: video.width,
          height: video.height,
          fps: video.fps,
          thumbnailUrl: video.thumbnailUrl,
          // Add orientation info for proper display
          orientation: video.height > video.width ? 'portrait' : video.width > video.height ? 'landscape' : 'square',
          aspectRatio: video.width && video.height ? (video.width / video.height).toFixed(2) : null,
          // Add compatibility warning
          compatibilityWarning: warningMessage,
        })
      } catch (error) {
        console.error('[VideoDownloader] Error:', error)
        if (error instanceof HTTPException) {
          throw error
        }
        
        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            throw new HTTPException(408, {
              message: 'Video download timed out. Please try again.',
            })
          }
          
          if (error.message.includes('fetch')) {
            throw new HTTPException(503, {
              message: 'Unable to connect to video downloader service. Please try again later.',
            })
          }
        }
        
        throw new HTTPException(500, {
          message: 'An unexpected error occurred while downloading the video.',
        })
      }
    }),
})
