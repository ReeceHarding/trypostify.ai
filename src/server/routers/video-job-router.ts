import { j, privateProcedure } from '../jstack'
import { z } from 'zod'
import { db } from '../../db'
import { videoJob } from '../../db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { HTTPException } from 'hono/http-exception'
import { v4 as uuidv4 } from 'uuid'
import { qstash } from '../../lib/qstash'
import { getBaseUrl } from '../../constants/base-url'

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
        
        // Enqueue video job processing with QStash for serverless reliability
        console.log('[VideoJobRouter] 🔄 Enqueueing video job with QStash for job ID:', jobId)
        
        try {
          const webhookUrl = `${getBaseUrl()}/api/video/process`
          console.log('[VideoJobRouter] 📤 QStash webhook URL:', webhookUrl)
          
          const qstashResponse = await qstash.publishJSON({
            url: webhookUrl,
            body: { 
              videoJobId: jobId,
              pollingAttempt: 0  // Start with first polling attempt
            },
            retries: 3, // Retry failed webhook calls up to 3 times
          })
          
          console.log('[VideoJobRouter] ✅ Video job enqueued successfully with QStash message ID:', qstashResponse.messageId)
          
          // Update job with QStash ID for tracking
          await db.update(videoJob)
            .set({
              qstashId: qstashResponse.messageId,
              updatedAt: new Date(),
            })
            .where(eq(videoJob.id, jobId))
            
        } catch (qstashError) {
          console.error('[VideoJobRouter] ❌ Failed to enqueue with QStash:', qstashError)
          // Mark job as failed if we can't even enqueue it
          await db.update(videoJob)
            .set({
              status: 'failed',
              errorMessage: `Failed to enqueue job: ${qstashError instanceof Error ? qstashError.message : 'Unknown QStash error'}`,
              updatedAt: new Date(),
            })
            .where(eq(videoJob.id, jobId))
            
          throw new HTTPException(500, {
            message: 'Failed to enqueue video processing job. Please try again.'
          })
        }
        
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
    .post(async ({ c, input, ctx }) => {
      console.log('[VideoJobRouter] 📝 Listing video jobs for user:', ctx.user.id)
      console.log('[VideoJobRouter] 🔍 Raw input:', JSON.stringify(input))
      console.log('[VideoJobRouter] 🔍 Status filter:', input.status)
      console.log('[VideoJobRouter] 🔍 Has status filter:', !!input.status)
      
      try {
        const conditions = [eq(videoJob.userId, ctx.user.id)]
        
        if (input.status) {
          console.log('[VideoJobRouter] ➕ Adding status condition:', input.status)
          conditions.push(eq(videoJob.status, input.status))
        } else {
          console.log('[VideoJobRouter] ⚠️ No status filter applied - will return all jobs')
        }

        const jobs = await db.select()
          .from(videoJob)
          .where(and(...conditions))
          .orderBy(desc(videoJob.createdAt))
          .limit(input.limit)
          .offset(input.offset)
        
        console.log('[VideoJobRouter] 📊 Found', jobs.length, 'video jobs')
        console.log('[VideoJobRouter] 📋 Job statuses:', jobs.map(j => ({ id: j.id.substring(0, 8), status: j.status })))
        
        const mappedJobs = jobs.map(job => ({
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
        }))
        
        console.log('[VideoJobRouter] 📤 Returning jobs with statuses:', mappedJobs.map(j => ({ id: j.id.substring(0, 8), status: j.status })))
        
        return c.json({
          jobs: mappedJobs,
          total: jobs.length,
        })
        
      } catch (error) {
        console.error('[VideoJobRouter] ❌ Failed to list video jobs:', error)
        
        throw new HTTPException(500, {
          message: `Failed to list video jobs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        })
      }
    }),

  // Clean up stuck video jobs
  cleanupStuckJobs: privateProcedure
    .mutation(async ({ c, ctx }) => {
      console.log('[VideoJobRouter] 🧹 Cleaning up stuck video jobs for user:', ctx.user.id)
      
      try {
        // Find jobs that are stuck in processing or pending for more than 10 minutes (much more aggressive)
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000)
        
        const stuckJobs = await db.select()
          .from(videoJob)
          .where(and(
            eq(videoJob.userId, ctx.user.id),
            // Look for both processing and pending jobs that are stuck
            // In production, video processing should complete within 5-10 minutes max
          ))
        
        // Filter jobs older than 10 minutes that are still processing or pending
        const jobsToCleanup = stuckJobs.filter(job => 
          job.updatedAt && 
          job.updatedAt < tenMinutesAgo && 
          (job.status === 'processing' || job.status === 'pending')
        )
        
        console.log('[VideoJobRouter] 📊 Found', jobsToCleanup.length, 'stuck jobs to cleanup')
        console.log('[VideoJobRouter] 🔍 All jobs found:', stuckJobs.map(j => ({
          id: j.id.substring(0, 8),
          status: j.status,
          updatedAt: j.updatedAt,
          ageMinutes: j.updatedAt ? Math.floor((Date.now() - j.updatedAt.getTime()) / (1000 * 60)) : 'unknown'
        })))
        
        if (jobsToCleanup.length === 0) {
          return c.json({
            message: 'No stuck jobs found',
            cleanedUp: 0,
          })
        }
        
        // Update all stuck jobs to failed status
        for (const job of jobsToCleanup) {
          console.log('[VideoJobRouter] 🗑️ Cleaning up job:', job.id, 'status:', job.status, 'age:', job.updatedAt)
          await db.update(videoJob)
            .set({
              status: 'failed',
              errorMessage: 'Job timed out after 10+ minutes - cleaned up automatically',
              updatedAt: new Date(),
            })
            .where(eq(videoJob.id, job.id))
        }
        
        console.log('[VideoJobRouter] ✅ Cleaned up', jobsToCleanup.length, 'stuck video jobs')
        
        return c.json({
          message: `Successfully cleaned up ${jobsToCleanup.length} stuck video jobs`,
          cleanedUp: jobsToCleanup.length,
        })
        
      } catch (error) {
        console.error('[VideoJobRouter] ❌ Failed to cleanup stuck jobs:', error)
        
        throw new HTTPException(500, {
          message: `Failed to cleanup stuck jobs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        })
      }
    }),

  // Delete all stuck video jobs (nuclear option)
  deleteAllStuckJobs: privateProcedure
    .mutation(async ({ c, ctx }) => {
      console.log('[VideoJobRouter] 💥 NUCLEAR: Deleting ALL stuck video jobs for user:', ctx.user.id)
      
      try {
        // Find all jobs that are not completed
        const stuckJobs = await db.select()
          .from(videoJob)
          .where(and(
            eq(videoJob.userId, ctx.user.id),
            // Delete anything that's not completed (pending, processing, failed)
          ))
        
        // Filter out only completed jobs - delete everything else
        const jobsToDelete = stuckJobs.filter(job => 
          job.status !== 'completed'
        )
        
        console.log('[VideoJobRouter] 💥 Found', jobsToDelete.length, 'jobs to delete')
        console.log('[VideoJobRouter] 🔍 Jobs to delete:', jobsToDelete.map(j => ({
          id: j.id.substring(0, 8),
          status: j.status,
          updatedAt: j.updatedAt,
          ageMinutes: j.updatedAt ? Math.floor((Date.now() - j.updatedAt.getTime()) / (1000 * 60)) : 'unknown'
        })))
        
        if (jobsToDelete.length === 0) {
          return c.json({
            message: 'No jobs to delete',
            deleted: 0,
          })
        }
        
        // Delete all stuck jobs completely
        for (const job of jobsToDelete) {
          console.log('[VideoJobRouter] 🗑️ DELETING job:', job.id, 'status:', job.status)
          await db.delete(videoJob)
            .where(eq(videoJob.id, job.id))
        }
        
        console.log('[VideoJobRouter] ✅ DELETED', jobsToDelete.length, 'stuck video jobs')
        
        return c.json({
          message: `Successfully deleted ${jobsToDelete.length} stuck video jobs`,
          deleted: jobsToDelete.length,
        })
        
      } catch (error) {
        console.error('[VideoJobRouter] ❌ Failed to delete stuck jobs:', error)
        
        throw new HTTPException(500, {
          message: `Failed to delete stuck jobs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        })
      }
    }),
})