import { j, privateProcedure } from '../jstack'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { nanoid } from 'nanoid'

const BUCKET_NAME = process.env.NEXT_PUBLIC_S3_BUCKET_NAME!

const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_GENERAL_ACCESS_KEY!,
    secretAccessKey: process.env.AWS_GENERAL_SECRET_KEY!,
  },
})

console.log('[VideoDownloader] Environment check:', {
  hasApifyToken: !!process.env.APIFY_API_TOKEN,
  hasBucket: !!BUCKET_NAME,
  hasAwsCredentials: !!process.env.AWS_GENERAL_ACCESS_KEY,
  nodeEnv: process.env.NODE_ENV,
  timestamp: new Date().toISOString()
})

export const videoDownloaderRouter = j.router({
  downloadVideo: privateProcedure
    .input(
      z.object({
        url: z.string().url(),
        platform: z.string(),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { url, platform } = input

      console.log('[VideoDownloader] Starting download for:', {
        url: url.substring(0, 50) + '...',
        platform,
        userId: user.id,
      })

      if (!process.env.APIFY_API_TOKEN) {
        throw new HTTPException(500, {
          message: 'Video downloader service not configured.',
        })
      }

      try {
        // Start Apify actor run
        const runResponse = await fetch(
          `https://api.apify.com/v2/acts/ceeA8aQjRcp3E6cNx/runs?token=${process.env.APIFY_API_TOKEN}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              video_url: url,
              quality: 'high',
            }),
          },
        )

        if (!runResponse.ok) {
          throw new HTTPException(500, {
            message: 'Failed to start video download process.',
          })
        }

        const runData: any = await runResponse.json()
        const runId = runData.data.id
        console.log('[VideoDownloader] Started Apify run:', runId)

        // Instead of synchronous polling, immediately return the runId
        // The frontend can poll or use webhooks for completion
        console.log('[VideoDownloader] ✅ Video download started with Apify run:', runId)
        
        return c.json({
          success: true,
          message: 'Video download started successfully',
          runId: runId,
          pollingUrl: `/api/video/download/status/${runId}`,
          status: 'processing'
        })
        
      } catch (error: any) {
        console.error('[VideoDownloader] Error:', error.message)
        throw new HTTPException(500, {
          message: error.message || 'Failed to start video download.',
        })
      }
    }),
    
  // Add a new endpoint to check download status
  checkDownloadStatus: privateProcedure
    .input(z.object({ runId: z.string() }))
    .get(async ({ c, input }) => {
      const { runId } = input
      
      try {
        // Check run status
        const statusResponse = await fetch(
          `https://api.apify.com/v2/acts/ceeA8aQjRcp3E6cNx/runs/${runId}?token=${process.env.APIFY_API_TOKEN}`,
        )
        
        if (!statusResponse.ok) {
          throw new HTTPException(500, {
            message: 'Failed to check download status.',
          })
        }
        
        const runStatus: any = await statusResponse.json()
        const status = runStatus.data.status
        
        if (status === 'SUCCEEDED') {
          // Get the output data
          const datasetItemsResponse = await fetch(
            `https://api.apify.com/v2/datasets/${runStatus.data.defaultDatasetId}/items?token=${process.env.APIFY_API_TOKEN}`,
          )

          if (!datasetItemsResponse.ok) {
            throw new HTTPException(500, {
              message: 'Failed to retrieve video data.',
            })
          }

          const items: any[] = await datasetItemsResponse.json()
          
          if (!items.length) {
            throw new HTTPException(404, {
              message: 'No video found at the provided URL',
            })
          }

          const videoData = items[0]
          
          return c.json({
            success: true,
            status: 'completed',
            videoData: {
              platform: videoData.platform,
              title: videoData.title,
              durationSeconds: videoData.durationSeconds,
              mediaUrl: videoData.mediaUrl,
              thumbnailUrl: videoData.thumbnailUrl,
              description: videoData.description,
            },
          })
        } else if (status === 'FAILED' || status === 'ABORTED') {
          throw new HTTPException(500, {
            message: 'Video download failed. Please try again.',
          })
        } else {
          // Still running
          return c.json({
            success: true,
            status: 'processing',
            message: 'Download still in progress'
          })
        }
        
      } catch (error: any) {
        console.error('[VideoDownloader] Status check error:', error.message)
        throw new HTTPException(500, {
          message: error.message || 'Failed to check download status.',
        })
      }
    }),
})