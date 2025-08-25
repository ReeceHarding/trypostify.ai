import { j, privateProcedure } from '../jstack'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { db } from '@/db'
import { videoJob, tweets } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { qstash } from '@/lib/qstash'

export const videoJobRouter = j.router({
  // Create a background video processing job
  createVideoJob: privateProcedure
    .input(
      z.object({
        videoUrl: z.string().url(),
        tweetId: z.string(),
        threadId: z.string(),
        platform: z.string(),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { videoUrl, tweetId, threadId, platform } = input
      
      console.log('[VideoJob] Creating background video job:', {
        videoUrl,
        tweetId,
        threadId,
        platform,
        userId: user.id,
      })
      
      // Verify the tweet exists and belongs to the user
      const tweet = await db.query.tweets.findFirst({
        where: and(
          eq(tweets.id, tweetId),
          eq(tweets.userId, user.id),
        ),
      })
      
      if (!tweet) {
        throw new HTTPException(404, {
          message: 'Tweet not found or does not belong to user',
        })
      }
      
      // Create video job record
      const jobId = nanoid()
      
      try {
        await db.insert(videoJob).values({
          id: jobId,
          userId: user.id,
          tweetId,
          threadId,
          videoUrl,
          platform,
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        
        console.log('[VideoJob] Created video job record:', jobId)
        
        // Schedule background processing with QStash
        const webhookUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/video/process`
        
        let qstashMessageId = null
        
        if (process.env.NODE_ENV === 'development' || !process.env.WEBHOOK_URL) {
          // In development, create a fake QStash ID and process immediately
          qstashMessageId = `local-video-${Date.now()}-${Math.random().toString(36).substring(7)}`
          console.log('[VideoJob] Development mode - processing video immediately')
          
          // Trigger processing in background (don't await)
          setTimeout(async () => {
            try {
              await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoJobId: jobId }),
              })
            } catch (error) {
              console.error('[VideoJob] Failed to process video in development:', error)
            }
          }, 1000) // Small delay to let response return first
          
        } else {
          // In production, use QStash for reliable background processing
          const qstashResponse = await qstash.publishJSON({
            url: webhookUrl,
            body: { videoJobId: jobId },
            delay: 2, // Process in 2 seconds
          })
          qstashMessageId = qstashResponse.messageId
        }
        
        // Update job with QStash ID
        await db
          .update(videoJob)
          .set({
            qstashId: qstashMessageId,
            updatedAt: new Date(),
          })
          .where(eq(videoJob.id, jobId))
        
        console.log('[VideoJob] Scheduled background processing:', {
          jobId,
          qstashMessageId,
        })
        
        return c.json({
          success: true,
          videoJobId: jobId,
          status: 'pending',
          message: 'Video processing started in background',
        })
        
      } catch (error: any) {
        console.error('[VideoJob] Failed to create video job:', error)
        throw new HTTPException(500, {
          message: 'Failed to create video processing job',
        })
      }
    }),

  // Check video job status
  getVideoJobStatus: privateProcedure
    .input(
      z.object({
        videoJobId: z.string(),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { videoJobId } = input
      
      const job = await db.query.videoJob.findFirst({
        where: and(
          eq(videoJob.id, videoJobId),
          eq(videoJob.userId, user.id),
        ),
      })
      
      if (!job) {
        throw new HTTPException(404, {
          message: 'Video job not found',
        })
      }
      
      return c.json({
        videoJobId: job.id,
        status: job.status,
        s3Key: job.s3Key,
        twitterMediaId: job.twitterMediaId,
        errorMessage: job.errorMessage,
        videoMetadata: job.videoMetadata,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
      })
    }),

  // List user's video jobs
  getUserVideoJobs: privateProcedure
    .input(
      z.object({
        limit: z.number().default(10),
        status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
      }),
    )
    .post(async ({ c, ctx, input }) => {
      const { user } = ctx
      const { limit, status } = input
      
      const whereClause = status 
        ? and(eq(videoJob.userId, user.id), eq(videoJob.status, status))
        : eq(videoJob.userId, user.id)
      
      const jobs = await db.query.videoJob.findMany({
        where: whereClause,
        limit,
        orderBy: (videoJob, { desc }) => [desc(videoJob.createdAt)],
      })
      
      return c.json({
        jobs: jobs.map(job => ({
          videoJobId: job.id,
          tweetId: job.tweetId,
          threadId: job.threadId,
          videoUrl: job.videoUrl,
          platform: job.platform,
          status: job.status,
          s3Key: job.s3Key,
          twitterMediaId: job.twitterMediaId,
          errorMessage: job.errorMessage,
          videoMetadata: job.videoMetadata,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          completedAt: job.completedAt,
        })),
      })
    }),
})
