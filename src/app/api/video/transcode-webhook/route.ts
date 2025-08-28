import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db'
import { videoJob, tweets } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { publishThreadById } from '@/server/routers/chat/utils'
import crypto from 'crypto'

const s3Client = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId: process.env.AWS_GENERAL_ACCESS_KEY!,
    secretAccessKey: process.env.AWS_GENERAL_SECRET_KEY!,
  },
})

const BUCKET_NAME = process.env.NEXT_PUBLIC_S3_BUCKET_NAME!

/**
 * Webhook endpoint for Coconut.io transcoding completion
 * This receives notifications when video transcoding is complete
 */
export async function POST(req: NextRequest) {
  try {
    console.log('[TranscodeWebhook] Received webhook from Coconut.io')
    
    // Parse the webhook payload
    const body = await req.json()
    console.log('[TranscodeWebhook] Webhook payload:', JSON.stringify(body, null, 2))
    
    // Coconut.io webhook payload structure
    // The webhook sends data about the job completion
    const jobId = body.id || body.job_id
    const status = body.status || (body.event === 'job.completed' ? 'completed' : 'processing')
    const progress = body.progress || body.percent
    const errors = body.errors || []
    const outputs = body.outputs || []
    
    // Extract metadata - Coconut.io stores it in the input object
    const source_metadata = body.input?.metadata || body.metadata || {}
    
    if (!jobId) {
      console.error('[TranscodeWebhook] No job ID in webhook payload')
      return NextResponse.json({ error: 'Missing job ID' }, { status: 400 })
    }
    
    console.log(`[TranscodeWebhook] Job ${jobId} status: ${status}`)
    
    // Extract video job ID from source metadata (we'll store it there)
    const videoJobId = source_metadata?.video_job_id
    if (!videoJobId) {
      console.error('[TranscodeWebhook] No video job ID in source metadata')
      return NextResponse.json({ error: 'Missing video job ID' }, { status: 400 })
    }
    
    // Get the video job from database
    const job = await db.select().from(videoJob).where(eq(videoJob.id, videoJobId)).then(rows => rows[0])
    
    if (!job) {
      console.error('[TranscodeWebhook] Video job not found:', videoJobId)
      return NextResponse.json({ error: 'Video job not found' }, { status: 404 })
    }
    
    // Handle different transcoding statuses
    if (status === 'completed' && outputs && outputs.length > 0) {
      console.log('[TranscodeWebhook] Transcoding completed successfully')
      
      // Get the transcoded video URL from S3
      const transcodedOutput = outputs[0]
      const s3Key = transcodedOutput.key || transcodedOutput.path?.replace(`s3://${BUCKET_NAME}/`, '')
      
      if (!s3Key) {
        throw new Error('No output key found in transcoding result')
      }
      
      console.log('[TranscodeWebhook] Transcoded video S3 key:', s3Key)
      
      // Download the transcoded video from S3
      const getObjectParams = {
        Bucket: BUCKET_NAME,
        Key: s3Key,
      }
      
      const s3Response = await s3Client.send(new GetObjectCommand(getObjectParams))
      const videoBuffer = Buffer.from(await s3Response.Body!.transformToByteArray())
      
      console.log('[TranscodeWebhook] Downloaded transcoded video, size:', videoBuffer.length)
      
      // Now upload to Twitter
      const { account: accountSchema } = await import('@/db/schema')
      
      // Find the user's Twitter account
      const account = await db.select()
        .from(accountSchema)
        .where(and(
          eq(accountSchema.userId, job.userId), 
          eq(accountSchema.providerId, 'twitter')
        ))
        .then(rows => rows[0])
      
      if (!account?.accessToken || !account?.accessSecret) {
        throw new Error('No Twitter account found for user')
      }
      
      // Upload to Twitter
      const { TwitterApi } = await import('twitter-api-v2')
      
      const client = new TwitterApi({
        appKey: process.env.TWITTER_CONSUMER_KEY as string,
        appSecret: process.env.TWITTER_CONSUMER_SECRET as string,
        accessToken: account.accessToken as string,
        accessSecret: account.accessSecret as string,
      })
      
      console.log('[TranscodeWebhook] Uploading transcoded video to Twitter...')
      
      let twitterMediaId = null
      try {
        twitterMediaId = await client.v1.uploadMedia(videoBuffer, { mimeType: 'video/mp4' })
        console.log('[TranscodeWebhook] ✅ Video uploaded to Twitter with media_id:', twitterMediaId)
      } catch (uploadError: any) {
        console.error('[TranscodeWebhook] Failed to upload to Twitter:', uploadError)
        throw uploadError
      }
      
      // Update the video job with success
      await db
        .update(videoJob)
        .set({
          status: 'completed',
          twitterMediaId,
          transcodedS3Key: s3Key,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(videoJob.id, videoJobId))
      
      // Now post the tweet if there's content waiting
      if (job.tweetContent && twitterMediaId) {
        console.log('[TranscodeWebhook] Posting tweet with transcoded video...')
        
        try {
          const tweetContent = job.tweetContent as any
          const threadId = crypto.randomUUID()
          
          // Create tweets with the transcoded video
          const tweetsToCreate = tweetContent.tweets.map((tweet: any, index: number) => ({
            id: crypto.randomUUID(),
            accountId: account.id,
            userId: job.userId,
            content: tweet.content,
            media: [
              ...tweet.media || [],
              {
                s3Key,
                media_id: twitterMediaId,
                url: `https://${BUCKET_NAME}.s3.amazonaws.com/${s3Key}`,
                type: 'video' as const,
              }
            ],
            threadId,
            position: index,
            isThreadStart: index === 0,
            delayMs: tweet.delayMs || (index > 0 ? 1000 : 0),
            isScheduled: false,
            isPublished: false,
          }))
          
          // Insert tweets into database
          await db.insert(tweets).values(tweetsToCreate)
          
          // Publish the thread
          const postResult = await publishThreadById({
            threadId,
            userId: job.userId,
            accountId: account.id,
            logPrefix: 'TranscodeWebhook',
          })
          
          console.log('[TranscodeWebhook] ✅ Tweet posted successfully with transcoded video')
          
        } catch (postError) {
          console.error('[TranscodeWebhook] Failed to post tweet:', postError)
        }
      }
      
      return NextResponse.json({ 
        success: true, 
        message: 'Transcoding completed and video processed',
        videoJobId,
        twitterMediaId
      })
      
    } else if (status === 'failed' || errors?.length > 0) {
      console.error('[TranscodeWebhook] Transcoding failed:', errors)
      
      // Update job as failed
      await db
        .update(videoJob)
        .set({
          status: 'failed',
          errorMessage: errors?.join(', ') || 'Transcoding failed',
          updatedAt: new Date(),
        })
        .where(eq(videoJob.id, videoJobId))
      
      return NextResponse.json({ 
        success: false, 
        message: 'Transcoding failed',
        errors 
      })
      
    } else {
      // Job is still processing
      console.log(`[TranscodeWebhook] Job still processing: ${status} (${progress}%)`)
      
      return NextResponse.json({ 
        success: true, 
        message: 'Processing update received',
        status,
        progress 
      })
    }
    
  } catch (error: any) {
    console.error('[TranscodeWebhook] Webhook error:', error)
    return NextResponse.json({ 
      error: 'Internal server error',
      message: error.message 
    }, { status: 500 })
  }
}
