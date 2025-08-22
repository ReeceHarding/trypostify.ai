import { j } from '@/lib/juxt'
import { privateProcedure } from '../middleware/auth'
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
    .mutation(async ({ c, ctx, input }) => {
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

        // Call Apify Video Downloader API
        const apifyResponse = await fetch(
          'https://api.apify.com/v2/acts/ceeA8aQjRcp3E6cNx/run-sync',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.APIFY_API_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              video_urls: [url],
              quality: 'high',
            }),
          },
        )

        if (!apifyResponse.ok) {
          const error = await apifyResponse.text()
          console.error('[VideoDownloader] Apify API error:', error)
          throw new HTTPException(500, {
            message: 'Failed to download video. Please try again.',
          })
        }

        const result = await apifyResponse.json()
        console.log('[VideoDownloader] Apify response:', result)

        // Extract video data from response
        const videos = result.videos || result.data?.items || []
        if (!videos.length) {
          throw new HTTPException(404, {
            message: 'No video found at the provided URL.',
          })
        }

        const video = videos[0]
        const mediaUrl = video.mediaUrl || video.videoUrl || video.url

        if (!mediaUrl) {
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
        const contentType = videoResponse.headers.get('content-type') || 'video/mp4'
        
        // Validate video size (Twitter limit is 512MB)
        const sizeInMB = videoBuffer.length / (1024 * 1024)
        if (sizeInMB > 512) {
          throw new HTTPException(413, {
            message: `Video is too large (${sizeInMB.toFixed(2)}MB). Twitter's limit is 512MB.`,
          })
        }

        // Generate S3 key
        const fileExtension = contentType.includes('mp4') ? 'mp4' : 'mp4' // Default to mp4
        const s3Key = `tweet-media/${user.id}/${nanoid()}.${fileExtension}`

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

        return c.json({
          success: true,
          s3Key,
          url: publicUrl,
          mediaType: 'video' as const,
          platform,
          originalUrl: url,
          title: video.title || video.description || 'Downloaded video',
          sizeBytes: videoBuffer.length,
          duration: video.durationSeconds || video.duration,
        })
      } catch (error) {
        console.error('[VideoDownloader] Error:', error)
        if (error instanceof HTTPException) {
          throw error
        }
        throw new HTTPException(500, {
          message: 'An unexpected error occurred while downloading the video.',
        })
      }
    }),
})
