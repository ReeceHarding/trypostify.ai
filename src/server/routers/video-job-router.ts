import { j, privateProcedure } from '../jstack'
import { z } from 'zod'
import { db } from '../../db'
import { videoJob } from '../../db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { v4 as uuidv4 } from 'uuid'

export const videoJobRouter = j.router({
  
  // Create a new video processing job
  createVideoJob: privateProcedure
    .input(
      z.object({
        videoUrl: z.string().url('Video URL must be valid'),
        tweetId: z.string().optional(), // Optional for queued tweets
        threadId: z.string().min(1, 'Thread ID is required'),
        platform: z.string().min(1, 'Platform is required'),
        tweetContent: z.any().optional(), // Complete tweet data for posting when video is ready
      })
    )
    .mutation(async ({ c, input, ctx }) => {
      console.log('[VideoJobRouter] 🎬 Creating video job at', new Date().toISOString())
      console.log('[VideoJobRouter] 📋 Input data:', input)
      console.log('[VideoJobRouter] 👤 User ID:', ctx.user.id)
      
      try {
        // Create video job record
        const jobId = uuidv4()
        
        console.log('[VideoJobRouter] 💾 Inserting video job into database with ID:', jobId)
        
        const newJob = await db.insert(videoJob).values({
          id: jobId,
          userId: ctx.user.id,
          tweetId: input.tweetId || '',
          threadId: input.threadId,
          videoUrl: input.videoUrl,
          platform: input.platform,
          status: 'pending',
          tweetContent: input.tweetContent || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning()
        
        console.log('[VideoJobRouter] ✅ Video job created successfully:', newJob[0])
        
        // Process video job in background
        console.log('[VideoJobRouter] 🔄 Starting background video job processing')
        setImmediate(async () => {
          try {
            console.log('[VideoJobRouter] 📤 Processing video job:', jobId)
            
            // Call the webhook processor directly
            const webhookResponse = await fetch(process.env.WEBHOOK_URL || 'http://localhost:3000' + '/api/video/process', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ videoJobId: jobId }),
            })
            
            if (!webhookResponse.ok) {
              console.error('[VideoJobRouter] ❌ Video processing failed:', await webhookResponse.text())
            } else {
              console.log('[VideoJobRouter] ✅ Video processing completed successfully')
            }
          } catch (error) {
            console.error('[VideoJobRouter] ❌ Video processing error:', error)
          }
        })
        
        return c.json({
          success: true,
          jobId: newJob[0]?.id,
          status: newJob[0]?.status,
          message: 'Video job created successfully. Processing will begin shortly.',
        })
        
      } catch (error) {
        console.error('[VideoJobRouter] ❌ Failed to create video job:', error)
        console.error('[VideoJobRouter] ❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace')
        
        // Try returning an error response instead of throwing
        throw new HTTPException(500, {
          message: `Failed to create video job: ${error instanceof Error ? error.message : 'Unknown error'}`,
        })
      }
    }),

  // Get video job status
  getVideoJobStatus: privateProcedure
    .input(z.object({
      jobId: z.string().min(1, 'Job ID is required'),
    }))
    .query(async ({ c, input, ctx }) => {
      console.log('[VideoJobRouter] 📊 Getting video job status for ID:', input.jobId)
      
      try {
        const job = await db.select().from(videoJob).where(
          and(
            eq(videoJob.id, input.jobId),
            eq(videoJob.userId, ctx.user.id)
          )
        ).then(rows => rows[0])
        
        if (!job) {
          throw new HTTPException(404, { message: 'Video job not found' })
        }
        
        console.log('[VideoJobRouter] 📋 Video job status:', job.status)
        
        return c.json({
          id: job.id,
          status: job.status,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          completedAt: job.completedAt,
          errorMessage: job.errorMessage,
          s3Key: job.s3Key,
          twitterMediaId: job.twitterMediaId,
        })
        
      } catch (error) {
        console.error('[VideoJobRouter] ❌ Failed to get video job status:', error)
        
        if (error instanceof HTTPException) {
          throw error
        }
        
        throw new HTTPException(500, {
          message: `Failed to get video job status: ${error instanceof Error ? error.message : 'Unknown error'}`,
        })
      }
    }),

  // List all video jobs for user
  listVideoJobs: privateProcedure
    .input(z.object({
      status: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ c, input, ctx }) => {
      console.log('[VideoJobRouter] 📝 Listing video jobs for user:', ctx.user.id)
      console.log('[VideoJobRouter] 🔍 Filters:', input)
      
      try {
        const conditions = [eq(videoJob.userId, ctx.user.id)]
        
        if (input.status) {
          conditions.push(eq(videoJob.status, input.status))
        }

        const jobs = await db.select()
          .from(videoJob)
          .where(and(...conditions))
          .orderBy(desc(videoJob.createdAt))
          .limit(input.limit)
          .offset(input.offset)
        
        console.log('[VideoJobRouter] 📊 Found', jobs.length, 'video jobs')
        
        return c.json({
          jobs: jobs.map(job => ({
            id: job.id,
            tweetId: job.tweetId,
            threadId: job.threadId,
            videoUrl: job.videoUrl,
            platform: job.platform,
            status: job.status,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            completedAt: job.completedAt,
            errorMessage: job.errorMessage,
          })),
          total: jobs.length,
        })
        
      } catch (error) {
        console.error('[VideoJobRouter] ❌ Failed to list video jobs:', error)
        
        throw new HTTPException(500, {
          message: `Failed to list video jobs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        })
      }
    }),
})