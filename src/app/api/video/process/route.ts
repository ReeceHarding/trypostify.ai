import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { videoJob, tweets } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { nanoid } from 'nanoid'
import { qstash } from '@/lib/qstash'
import { getBaseUrl } from '@/constants/base-url'
import crypto from 'crypto'

const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_GENERAL_ACCESS_KEY!,
    secretAccessKey: process.env.AWS_GENERAL_SECRET_KEY!,
  },
})

const BUCKET_NAME = process.env.NEXT_PUBLIC_S3_BUCKET_NAME!

export async function POST(req: NextRequest) {
  try {
    console.log('[VideoProcessor] Processing video job webhook...')
    
    const body = await req.json()
    const { videoJobId, pollingAttempt = 0 } = body as { videoJobId: string; pollingAttempt?: number }
    const MAX_POLLING_ATTEMPTS = 90
    
    if (!videoJobId) {
      console.error('[VideoProcessor] No videoJobId provided')
      return NextResponse.json({ error: 'Missing videoJobId' }, { status: 400 })
    }
    
    console.log('[VideoProcessor] Processing video job:', videoJobId, 'polling attempt:', pollingAttempt)
    
    // Get the video job from database
    const job = await db.select().from(videoJob).where(eq(videoJob.id, videoJobId)).then(rows => rows[0])
    
    if (!job) {
      console.error('[VideoProcessor] Video job not found:', videoJobId)
      return NextResponse.json({ error: 'Video job not found' }, { status: 404 })
    }
    
    if (job.status === 'completed') {
      console.log('[VideoProcessor] Job already completed:', videoJobId)
      return NextResponse.json({ message: 'Job already completed' }, { status: 200 })
    }
    
    if (job.status === 'failed') {
      console.log('[VideoProcessor] Job already failed:', videoJobId)
      return NextResponse.json({ message: 'Job already failed' }, { status: 200 })
    }
    
    // Update status to processing
    await db
      .update(videoJob)
      .set({ 
        status: 'processing',
        updatedAt: new Date(),
      })
      .where(eq(videoJob.id, videoJobId))
    
    try {
      let runId = job.apifyRunId
      let runStatus: any
      
      // If no apifyRunId, start a new Apify run
      if (!runId) {
        console.log('[VideoProcessor] Starting video download for:', job.videoUrl)
        
        const runResponse = await fetch(
          `https://api.apify.com/v2/acts/ceeA8aQjRcp3E6cNx/runs?token=${process.env.APIFY_API_TOKEN}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              video_url: job.videoUrl,
              quality: 'high',
            }),
          },
        )

        if (!runResponse.ok) {
          const error = await runResponse.text()
          throw new Error(`Failed to start Apify run: ${error}`)
        }

        const runData: any = await runResponse.json()
        runId = runData.data.id
        console.log('[VideoProcessor] Started Apify run:', runId)
        
        // Save the apifyRunId to database
        await db.update(videoJob)
          .set({
            apifyRunId: runId,
            status: 'processing',
            updatedAt: new Date(),
          })
          .where(eq(videoJob.id, videoJobId))
      }
      
      // Check the current status of the Apify run
      console.log('[VideoProcessor] Checking Apify run status:', runId)
      const statusResponse = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${process.env.APIFY_API_TOKEN}`,
      )

      if (!statusResponse.ok) {
        throw new Error('Failed to check run status')
      }

      runStatus = await statusResponse.json()
      const status = runStatus.data.status
      console.log(`[VideoProcessor] Run status (attempt ${pollingAttempt + 1}): ${status}`)

      // Handle different status scenarios
      if (status === 'SUCCEEDED') {
        console.log('[VideoProcessor] Apify run completed successfully, processing results...')
        // Continue with video processing logic below
      } else if (status === 'FAILED' || status === 'ABORTED') {
        throw new Error(`Apify run failed with status: ${status}`)
      } else if (pollingAttempt < MAX_POLLING_ATTEMPTS) {
        // Job is still running, re-enqueue the check with QStash
        console.log('[VideoProcessor] Job still running, re-enqueueing status check...')
        
        await qstash.publishJSON({
          url: `${getBaseUrl()}/api/video/process`,
          body: { 
            videoJobId: videoJobId,
            pollingAttempt: pollingAttempt + 1 
          },
          delay: Math.min(10 + pollingAttempt * 2, 30), // Progressive delay: 10s, 12s, 14s... up to 30s
        })
        
        return NextResponse.json({ 
          message: 'Polling... check re-enqueued.',
          attempt: pollingAttempt + 1,
          maxAttempts: MAX_POLLING_ATTEMPTS 
        })
      } else {
        // Exceeded max attempts
        throw new Error(`Video download timed out after ${MAX_POLLING_ATTEMPTS} attempts`)
      }

      // Get video data
      const datasetId = runStatus.data.defaultDatasetId
      const itemsResponse = await fetch(
        `https://api.apify.com/v2/datasets/${datasetId}/items?token=${process.env.APIFY_API_TOKEN}`,
      )

      if (!itemsResponse.ok) {
        throw new Error('Failed to retrieve video data')
      }

      const result: any = await itemsResponse.json()
      const items = Array.isArray(result) ? result : (result.items || [])
      
      if (!items.length) {
        throw new Error('No video found at the provided URL')
      }

      const video = items[0]
      const mediaUrl = video.mediaUrl || video.video_url

      if (!mediaUrl) {
        throw new Error('Could not extract video URL from the response')
      }

      console.log('[VideoProcessor] Downloading video from:', mediaUrl)

      // Download the video
      const videoResponse = await fetch(mediaUrl)
      if (!videoResponse.ok) {
        throw new Error('Failed to download video file')
      }

      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer())
      
      // Upload to S3
      const s3Key = `tweet-media/${job.userId}/${nanoid()}.mp4`
      const uploadParams = {
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: videoBuffer,
        ContentType: 'video/mp4',
      }

      await s3Client.send(new PutObjectCommand(uploadParams))
      const publicUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/${s3Key}`
      
      console.log('[VideoProcessor] Video uploaded to S3:', publicUrl)
      
      // Upload to Twitter
      console.log('[VideoProcessor] Uploading video to Twitter...')
      
      // We need to upload the video to Twitter now to get the media_id for posting
      let twitterMediaId = null
      
      try {
        // Get user account for Twitter upload
        const { account: accountSchema } = await import('../../../../db/schema')
        
        // Find the user's Twitter account
        const account = await db.select()
          .from(accountSchema)
          .where(and(
            eq(accountSchema.userId, job.userId), 
            eq(accountSchema.providerId, 'twitter')
          ))
          .then(rows => rows[0])
        
        if (account?.accessToken && account?.accessSecret) {
          const { TwitterApi } = await import('twitter-api-v2')
          
          const client = new TwitterApi({
            appKey: process.env.TWITTER_CONSUMER_KEY as string,
            appSecret: process.env.TWITTER_CONSUMER_SECRET as string,
            accessToken: account.accessToken as string,
            accessSecret: account.accessSecret as string,
          })
          
          // Download video from S3 and upload to Twitter
          const videoUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/${s3Key}`
          const videoResponse = await fetch(videoUrl)
          
          if (videoResponse.ok) {
            const videoBuffer = Buffer.from(await videoResponse.arrayBuffer())
            console.log('[VideoProcessor] Uploading video to Twitter, size:', videoBuffer.length, 'bytes')
            
            // Use transcoding-enabled Twitter upload function with cost optimization
            const { uploadVideoToTwitterWithTranscoding } = await import('../../../../lib/video-transcode')
            const uploadResult = await uploadVideoToTwitterWithTranscoding(videoBuffer, client, {
              enableTranscoding: true,
              maxRetries: 2,
              originalFileName: `video-${job.id}.mp4`,
              userId: job.userId
            })
            
            if (uploadResult.success) {
              twitterMediaId = uploadResult.mediaId
              if (uploadResult.transcoded) {
                console.log('[VideoProcessor] 🎬 Video was successfully transcoded for Twitter compatibility')
              }
            } else {
              console.log('[VideoProcessor] Twitter upload failed:', uploadResult.error)
              if (uploadResult.error === 'UNSUPPORTED_FORMAT') {
                console.log('[VideoProcessor] Video format still incompatible even after transcoding attempt')
              } else if (uploadResult.error === 'TRANSCODING_FAILED') {
                console.log('[VideoProcessor] FFmpeg transcoding failed - video format conversion unsuccessful')
              }
              twitterMediaId = null
            }
          } else {
            console.error('[VideoProcessor] Failed to download video from S3 for Twitter upload')
          }
        } else {
          console.error('[VideoProcessor] No Twitter account found or missing tokens for user:', job.userId)
        }
      } catch (uploadError) {
        console.error('[VideoProcessor] Failed to upload video to Twitter:', uploadError)
        // Continue without Twitter upload - tweet will post without video
      }
      
                // Update job as completed with S3 key and Twitter media ID
          await db
            .update(videoJob)
            .set({
              status: 'completed',
              s3Key,
              twitterMediaId,
              videoMetadata: {
                duration: video.duration || video.durationSeconds,
                width: video.width,
                height: video.height,
                platform: video.platform || job.platform,
                title: video.title,
              },
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(videoJob.id, videoJobId))
      
      console.log('[VideoProcessor] Video job completed successfully:', videoJobId)
      
      // NOW CREATE AND POST THE TWEET WITH THE PROCESSED VIDEO
      if (job.tweetContent) {
        console.log('[VideoProcessor] Creating and posting tweet with processed video...')
        
        try {
          // Import the tweet posting function directly
          const { publishThreadById } = await import('../../../../server/routers/chat/utils')
          
          // Get user account for posting
          const { account: accountSchema } = await import('../../../../db/schema')
          
          // Find the user's Twitter account
          const account = await db.select()
            .from(accountSchema)
            .where(and(
              eq(accountSchema.userId, job.userId), 
              eq(accountSchema.providerId, 'twitter')
            ))
            .then(rows => rows[0])
          
          if (!account?.id) {
            console.error('[VideoProcessor] No Twitter account found for user:', job.userId)
            throw new Error('No Twitter account connected')
          }
          
          // Create a thread ID for the new tweets
          const threadId = crypto.randomUUID()
          
          // Prepare tweet content with the processed video
          const tweetContent = job.tweetContent as any
          const tweetsToCreate = tweetContent.tweets.map((tweet: any, index: number) => ({
            id: crypto.randomUUID(),
            accountId: account.id,
            userId: job.userId,
            content: tweet.content,
            media: [
              ...tweet.media || [], // Existing media
              ...(twitterMediaId ? [{
                s3Key,
                media_id: twitterMediaId,
                url: `https://${BUCKET_NAME}.s3.amazonaws.com/${s3Key}`,
                type: 'video' as const,
              }] : []), // Only add video if Twitter upload succeeded
            ],
            threadId,
            position: index,
            isThreadStart: index === 0,
            delayMs: tweet.delayMs || (index > 0 ? 1000 : 0),
            isScheduled: false,
            isPublished: false,
          }))
          
          console.log('[VideoProcessor] Creating tweets in database:', {
            tweetCount: tweetsToCreate.length,
            threadId,
            accountId: account.id,
          })
          
          // Insert tweets into database
          await db.insert(tweets).values(tweetsToCreate)
          
          // Now publish the thread
          const postResult = await publishThreadById({
            threadId,
            userId: job.userId,
            accountId: account.id,
            logPrefix: 'VideoProcessor',
          })
          
          console.log('[VideoProcessor] ✅ Tweet posted successfully with video:', postResult)
          
        } catch (postError) {
          console.error('[VideoProcessor] ❌ Failed to post tweet after video processing:', postError)
          // Don't fail the video job, just log the error
        }
      }
      
      return NextResponse.json({ 
        success: true, 
        videoJobId,
        s3Key,
        publicUrl,
      })
      
    } catch (error: any) {
      console.error('[VideoProcessor] Error processing video:', error)
      
      // Update job as failed
      await db
        .update(videoJob)
        .set({
          status: 'failed',
          errorMessage: error.message,
          retryCount: String(parseInt(job.retryCount || '0') + 1),
          updatedAt: new Date(),
        })
        .where(eq(videoJob.id, videoJobId))
      
      return NextResponse.json({ 
        error: 'Video processing failed',
        message: error.message,
      }, { status: 500 })
    }
    
  } catch (error: any) {
    console.error('[VideoProcessor] Webhook error:', error)
    return NextResponse.json({ 
      error: 'Internal server error',
      message: error.message,
    }, { status: 500 })
  }
}
