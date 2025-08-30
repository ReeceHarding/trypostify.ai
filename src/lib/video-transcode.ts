/**
 * Server-side video transcoding utilities using Coconut.io API
 * This file should only be imported in server-side code (API routes, server actions)
 */

// Import FFmpeg for local transcoding fallback
import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFileSync, unlinkSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const execAsync = promisify(exec)

// Check if FFmpeg is available
async function checkFFmpegAvailable(): Promise<boolean> {
  try {
    await execAsync('which ffmpeg')
    return true
  } catch {
    // Check if we're on Vercel
    if (process.env.VERCEL) {
      // Try to use the installed FFmpeg binary
      try {
        await execAsync('/vercel/path/to/ffmpeg -version')
        return true
      } catch {
        return false
      }
    }
    return false
  }
}

/**
 * Transcodes video to H.264 format compatible with Twitter using Coconut.io API
 * Falls back to local FFmpeg if Coconut.io is unavailable
 */
export async function transcodeVideoToH264(
  videoBuffer: Buffer, 
  originalFileName: string = 'video.mp4',
  videoJobId?: string
): Promise<{ url: string; jobId?: string; isLocal?: boolean }> {
  console.log('[VideoTranscode] Starting video transcoding...')
  console.log('[VideoTranscode] Original video size:', videoBuffer.length, 'bytes')
  
  // First, try Coconut.io if API key is available
  const coconutApiKey = process.env.COCONUT_API_KEY
  
  console.log('[VideoTranscode] Coconut API key check:', {
    hasKey: !!coconutApiKey,
    keyLength: coconutApiKey?.length || 0,
    keyPreview: coconutApiKey ? `${coconutApiKey.substring(0, 4)}...${coconutApiKey.slice(-4)}` : 'none'
  })
  
  if (coconutApiKey && coconutApiKey !== 'your_coconut_api_key_here') {
    try {
      console.log('[VideoTranscode] Attempting Coconut.io transcoding...')
      
      // Upload video to temporary storage first (using existing S3)
      const { s3Client } = await import('@/lib/s3')
      const { PutObjectCommand } = await import('@aws-sdk/client-s3')
      const { nanoid } = await import('nanoid')
      
      const tempKey = `temp-videos/${nanoid()}-${originalFileName}`
      const uploadParams = {
        Bucket: process.env.NEXT_PUBLIC_S3_BUCKET_NAME!,
        Key: tempKey,
        Body: videoBuffer,
        ContentType: 'video/mp4',
      }
      
      await s3Client.send(new PutObjectCommand(uploadParams))
      const tempVideoUrl = `https://${process.env.NEXT_PUBLIC_S3_BUCKET_NAME}.s3.amazonaws.com/${tempKey}`
      
      console.log('[VideoTranscode] Uploaded temp video to S3:', tempVideoUrl)
      
      // Create Coconut.io transcoding job
      const outputKey = `transcoded-videos/${nanoid()}-twitter.mp4`
      const outputUrl = `s3://${process.env.NEXT_PUBLIC_S3_BUCKET_NAME}/${outputKey}`
      
      // Configure S3 credentials for Coconut.io
      const storage = {
        service: 's3',
        bucket: process.env.NEXT_PUBLIC_S3_BUCKET_NAME,
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          access_key_id: process.env.AWS_GENERAL_ACCESS_KEY,
          secret_access_key: process.env.AWS_GENERAL_SECRET_KEY
        }
      }
      
      const jobConfig = {
        input: { url: tempVideoUrl },
        storage,
        notification: {
          type: 'http',
          url: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://trypostify.com'}/api/video/transcode-webhook`
        },
        outputs: {
          'mp4:720p': outputUrl
        }
      }
      
      // Add video job ID to metadata if provided
      if (videoJobId) {
        jobConfig.input.metadata = { video_job_id: videoJobId }
      }
      
      console.log('[VideoTranscode] Coconut.io job config:', JSON.stringify(jobConfig, null, 2))
      
      // Use the correct Coconut.io API endpoint with Basic authentication
      const response = await fetch('https://api.coconut.co/v2/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${Buffer.from(`${coconutApiKey}:`).toString('base64')}`
        },
        body: JSON.stringify(jobConfig)
      })
      
      if (!response.ok) {
        const errorText = await response.text()
        console.error('[VideoTranscode] Coconut.io API response:', errorText)
        throw new Error(`Coconut.io API error: ${response.status} - ${errorText}`)
      }
      
      const result = await response.json()
      console.log('[VideoTranscode] ✅ Coconut.io job created:', result)
      
      // Return the job info
      return {
        url: `https://${process.env.NEXT_PUBLIC_S3_BUCKET_NAME}.s3.amazonaws.com/${outputKey}`,
        jobId: result.id || result.job_id,
        isLocal: false
      }
      
    } catch (error: any) {
      console.error('[VideoTranscode] ❌ Coconut.io transcoding failed:', error.message)
      console.log('[VideoTranscode] Falling back to local FFmpeg transcoding...')
      // Fall through to FFmpeg fallback
    }
  } else {
    console.log('[VideoTranscode] No Coconut.io API key configured, using local FFmpeg...')
  }
  
  // Check if FFmpeg is available before attempting local transcoding
  const ffmpegAvailable = await checkFFmpegAvailable()
  
  if (!ffmpegAvailable) {
    console.log('[VideoTranscode] FFmpeg not available in this environment')
    
    // If we're on Vercel without FFmpeg, we must rely on Coconut.io
    if (process.env.VERCEL) {
      throw new Error('Video transcoding requires Coconut.io API key on Vercel deployment')
    }
    
    throw new Error('FFmpeg not available for video transcoding')
  }
  
  // FFmpeg fallback for local transcoding
  try {
    const { nanoid } = await import('nanoid')
    
    // Create temporary files
    const tempInputPath = join(tmpdir(), `input-${nanoid()}.mp4`)
    const tempOutputPath = join(tmpdir(), `output-${nanoid()}.mp4`)
    
    // Write input video to temp file
    writeFileSync(tempInputPath, videoBuffer)
    
    console.log('[VideoTranscode] Starting FFmpeg transcoding...')
    
    // FFmpeg command optimized for Twitter
    const ffmpegCommand = `ffmpeg -i "${tempInputPath}" -y -c:v libx264 -preset fast -crf 23 -vf "scale='min(1280,iw)':min'(720,ih)':force_original_aspect_ratio=decrease,pad=ceil(iw/2)*2:ceil(ih/2)*2" -c:a aac -b:a 128k -movflags +faststart -max_muxing_queue_size 1024 "${tempOutputPath}"`
    
    console.log('[VideoTranscode] FFmpeg command:', ffmpegCommand)
    
    // Execute FFmpeg
    const { stdout, stderr } = await execAsync(ffmpegCommand)
    
    if (stderr && stderr.includes('error')) {
      throw new Error(`FFmpeg error: ${stderr}`)
    }
    
    console.log('[VideoTranscode] FFmpeg transcoding completed')
    
    // Read the transcoded video
    const transcodedBuffer = readFileSync(tempOutputPath)
    
    // Clean up temp files
    try {
      unlinkSync(tempInputPath)
      unlinkSync(tempOutputPath)
    } catch (e) {
      console.warn('[VideoTranscode] Failed to clean up temp files:', e)
    }
    
    // Upload transcoded video to S3
    const { s3Client } = await import('@/lib/s3')
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    
    const outputKey = `transcoded-videos/${nanoid()}-twitter.mp4`
    const uploadParams = {
      Bucket: process.env.NEXT_PUBLIC_S3_BUCKET_NAME!,
      Key: outputKey,
      Body: transcodedBuffer,
      ContentType: 'video/mp4',
    }
    
    await s3Client.send(new PutObjectCommand(uploadParams))
    const finalUrl = `https://${process.env.NEXT_PUBLIC_S3_BUCKET_NAME}.s3.amazonaws.com/${outputKey}`
    
    console.log('[VideoTranscode] ✅ FFmpeg transcoding complete, uploaded to:', finalUrl)
    
    return {
      url: finalUrl,
      isLocal: true
    }
    
  } catch (error: any) {
    console.error('[VideoTranscode] ❌ FFmpeg transcoding failed:', error.message)
    throw new Error(`Transcoding failed: ${error.message}`)
  }
}

/**
 * Cost optimization settings for video transcoding
 */
const TRANSCODING_LIMITS = {
  MAX_FILE_SIZE_MB: 100, // Don't transcode files over 100MB
  MAX_DURATION_MINUTES: 10, // Don't transcode videos over 10 minutes  
  MAX_MONTHLY_TRANSCODES: 100, // Safety limit per user per month
  COMPATIBLE_FORMATS: ['mp4', 'mov'], // Formats likely to work with Twitter
  COST_PER_MINUTE: 0.05 // Track costs
}

/**
 * Enhanced video upload to Twitter with smart cost-optimized transcoding
 * Only use this in server-side code
 */
export async function uploadVideoToTwitterWithTranscoding(
  videoBuffer: Buffer,
  twitterClient: any,
  options: {
    maxRetries?: number
    enableTranscoding?: boolean
    originalFileName?: string
    userId?: string
    videoJobId?: string
  } = {}
): Promise<{ success: boolean; mediaId?: string; error?: string; transcoded?: boolean; costOptimized?: boolean; transcodingJobId?: string }> {
  const { maxRetries = 2, enableTranscoding = true, originalFileName = '', userId, videoJobId } = options
  
  console.log('[TwitterUploadTranscode] Uploading video to Twitter, size:', videoBuffer.length, 'bytes')
  
  const fileSizeMB = videoBuffer.length / (1024 * 1024)
  const transcoded = false
  
  // COST OPTIMIZATION: Pre-flight checks before any processing
  const costOptimization = await performCostOptimizationChecks(videoBuffer, originalFileName, userId)
  if (!costOptimization.shouldProceed) {
    console.log('[TwitterUploadTranscode] 🚫 Cost optimization blocked transcoding:', costOptimization.reason)
    return { 
      success: false, 
      error: costOptimization.reason, 
      transcoded: false,
      costOptimized: true 
    }
  }
  
  // First, try uploading the original video
  try {
    const mediaId = await twitterClient.v1.uploadMedia(videoBuffer, { mimeType: 'video/mp4' })
    console.log('[TwitterUploadTranscode] ✅ Video uploaded successfully with media_id:', mediaId)
    return { success: true, mediaId, transcoded: false, costOptimized: false }
  } catch (error: any) {
    console.log('[TwitterUploadTranscode] ❌ Initial upload failed:', error.message)
    
    // SMART TRANSCODING: Only if it's a format error AND passes cost checks
    if ((error.message?.includes('InvalidMedia') || error.message?.includes('Invalid or Unsupported media')) 
        && enableTranscoding && costOptimization.shouldTranscode) {
      
      console.log('[TwitterUploadTranscode] 🔄 Video format incompatible - starting transcoding...')
      console.log('[TwitterUploadTranscode] 💰 Estimated cost: $' + (costOptimization.estimatedCost).toFixed(2))
      
      try {
        // Track transcoding usage
        await trackTranscodingUsage(userId, fileSizeMB, costOptimization.estimatedDuration)
        
        // Transcode the video
        const transcodingResult = await transcodeVideoToH264(videoBuffer, originalFileName, videoJobId)
        
        if (transcodingResult.isLocal) {
          // Local FFmpeg transcoding completed immediately
          console.log('[TwitterUploadTranscode] 🎬 Local FFmpeg transcoding completed')
          
          // Download the transcoded video from S3
          const { s3Client } = await import('@/lib/s3')
          const { GetObjectCommand } = await import('@aws-sdk/client-s3')
          
          const s3Key = transcodingResult.url.split('.amazonaws.com/')[1]
          const getObjectParams = {
            Bucket: process.env.NEXT_PUBLIC_S3_BUCKET_NAME!,
            Key: s3Key,
          }
          
          const s3Response = await s3Client.send(new GetObjectCommand(getObjectParams))
          const transcodedBuffer = Buffer.from(await s3Response.Body!.transformToByteArray())
          
          // Try uploading the transcoded video to Twitter
          try {
            const mediaId = await twitterClient.v1.uploadMedia(transcodedBuffer, { mimeType: 'video/mp4' })
            console.log('[TwitterUploadTranscode] ✅ Transcoded video uploaded successfully with media_id:', mediaId)
            return { 
              success: true, 
              mediaId, 
              transcoded: true, 
              costOptimized: true 
            }
          } catch (uploadError: any) {
            console.error('[TwitterUploadTranscode] ❌ Transcoded video upload failed:', uploadError.message)
            return { 
              success: false, 
              error: 'TRANSCODED_UPLOAD_FAILED', 
              transcoded: true, 
              costOptimized: true 
            }
          }
        } else {
          // Coconut.io async transcoding initiated
          console.log('[TwitterUploadTranscode] 🎬 Coconut.io transcoding initiated, job ID:', transcodingResult.jobId)
          
          return { 
            success: false, 
            error: 'TRANSCODING_IN_PROGRESS', 
            transcoded: true,
            costOptimized: true,
            transcodingJobId: transcodingResult.jobId
          }
        }
        
      } catch (transcodeError: any) {
        console.error('[TwitterUploadTranscode] ❌ Transcoding failed:', transcodeError.message)
        return { success: false, error: 'TRANSCODING_FAILED', transcoded: false, costOptimized: true }
      }
    }
    
    // For other errors or if cost optimization blocked transcoding
    console.log('[TwitterUploadTranscode] Upload failed - no transcoding attempted')
    return { 
      success: false, 
      error: error.message, 
      transcoded: false,
      costOptimized: true 
    }
  }
}

/**
 * Performs comprehensive cost optimization checks before transcoding
 */
async function performCostOptimizationChecks(
  videoBuffer: Buffer, 
  originalFileName: string, 
  userId?: string
): Promise<{
  shouldProceed: boolean
  shouldTranscode: boolean
  reason?: string
  estimatedCost: number
  estimatedDuration: number
}> {
  const fileSizeMB = videoBuffer.length / (1024 * 1024)
  
  console.log('[CostOptimization] 🔍 Analyzing video for cost optimization...')
  console.log('[CostOptimization] File size:', fileSizeMB.toFixed(2), 'MB')
  console.log('[CostOptimization] File name:', originalFileName)
  
  // 1. FILE SIZE CHECK: Block huge files
  if (fileSizeMB > TRANSCODING_LIMITS.MAX_FILE_SIZE_MB) {
    return {
      shouldProceed: false,
      shouldTranscode: false,
      reason: `Video too large (${fileSizeMB.toFixed(1)}MB). Maximum size for transcoding is ${TRANSCODING_LIMITS.MAX_FILE_SIZE_MB}MB to control costs.`,
      estimatedCost: 0,
      estimatedDuration: 0
    }
  }
  
  // 2. FORMAT PRE-CHECK: Skip transcoding for likely compatible formats
  const fileExtension = originalFileName.toLowerCase().split('.').pop() || ''
  const isLikelyCompatible = TRANSCODING_LIMITS.COMPATIBLE_FORMATS.includes(fileExtension)
  
  if (isLikelyCompatible && fileSizeMB < 25) { // Twitter's limit is 512MB, but smaller files are more likely to work
    console.log('[CostOptimization] ✅ File appears Twitter-compatible (.mp4/.mov, <25MB) - attempting direct upload first')
  }
  
  // 3. ESTIMATE DURATION AND COST
  // Rough estimation: 1MB = ~10 seconds for typical video
  const estimatedDurationMinutes = Math.max(0.5, fileSizeMB * 0.167) // 10 seconds per MB
  const estimatedCost = estimatedDurationMinutes * TRANSCODING_LIMITS.COST_PER_MINUTE
  
  console.log('[CostOptimization] 💰 Estimated transcoding cost: $' + estimatedCost.toFixed(2))
  console.log('[CostOptimization] ⏱️ Estimated duration: ' + estimatedDurationMinutes.toFixed(1) + ' minutes')
  
  // 4. DURATION CHECK: Block very long videos
  if (estimatedDurationMinutes > TRANSCODING_LIMITS.MAX_DURATION_MINUTES) {
    return {
      shouldProceed: false,
      shouldTranscode: false,
      reason: `Video too long (~${estimatedDurationMinutes.toFixed(1)} minutes). Maximum duration for transcoding is ${TRANSCODING_LIMITS.MAX_DURATION_MINUTES} minutes to control costs.`,
      estimatedCost,
      estimatedDuration: estimatedDurationMinutes
    }
  }
  
  // 5. USER MONTHLY LIMIT CHECK
  if (userId) {
    const monthlyUsage = await getMonthlyTranscodingUsage(userId)
    if (monthlyUsage >= TRANSCODING_LIMITS.MAX_MONTHLY_TRANSCODES) {
      return {
        shouldProceed: false,
        shouldTranscode: false,
        reason: `Monthly transcoding limit reached (${monthlyUsage}/${TRANSCODING_LIMITS.MAX_MONTHLY_TRANSCODES}). This helps control costs.`,
        estimatedCost,
        estimatedDuration: estimatedDurationMinutes
      }
    }
    console.log('[CostOptimization] 📊 Monthly usage: ' + monthlyUsage + '/' + TRANSCODING_LIMITS.MAX_MONTHLY_TRANSCODES)
  }
  
  // 6. COST THRESHOLD CHECK: Warn about expensive transcoding
  if (estimatedCost > 0.50) { // More than 50 cents
    console.log('[CostOptimization] ⚠️ HIGH COST TRANSCODING: $' + estimatedCost.toFixed(2))
    // Could add admin notification here
  }
  
  return {
    shouldProceed: true,
    shouldTranscode: true,
    estimatedCost,
    estimatedDuration: estimatedDurationMinutes
  }
}

/**
 * Track transcoding usage for cost monitoring
 */
async function trackTranscodingUsage(userId?: string, fileSizeMB?: number, durationMinutes?: number): Promise<void> {
  if (!userId) return
  
  try {
    // In a real implementation, you'd save this to your database
    console.log('[CostTracking] 📝 Recording transcoding usage:', {
      userId,
      fileSizeMB: fileSizeMB?.toFixed(2),
      durationMinutes: durationMinutes?.toFixed(1),
      estimatedCost: ((durationMinutes || 0) * TRANSCODING_LIMITS.COST_PER_MINUTE).toFixed(2),
      timestamp: new Date().toISOString()
    })
    
    // TODO: Save to database table like 'transcoding_usage'
    // await db.insert(transcodingUsage).values({
    //   userId,
    //   fileSizeMB,
    //   durationMinutes, 
    //   estimatedCost: durationMinutes * TRANSCODING_LIMITS.COST_PER_MINUTE,
    //   createdAt: new Date()
    // })
    
  } catch (error) {
    console.error('[CostTracking] Failed to track usage:', error)
    // Don't throw - tracking is not critical
  }
}

/**
 * Get monthly transcoding usage for a user
 */
async function getMonthlyTranscodingUsage(userId: string): Promise<number> {
  try {
    // In a real implementation, you'd query your database
    // const startOfMonth = new Date()
    // startOfMonth.setDate(1)
    // startOfMonth.setHours(0, 0, 0, 0)
    
    // const usage = await db.select({ count: count() })
    //   .from(transcodingUsage)
    //   .where(and(
    //     eq(transcodingUsage.userId, userId),
    //     gte(transcodingUsage.createdAt, startOfMonth)
    //   ))
    
    // return usage[0]?.count || 0
    
    // For now, return 0 (no usage tracking yet)
    return 0
  } catch (error) {
    console.error('[CostTracking] Failed to get monthly usage:', error)
    return 0 // Fail safe - allow transcoding if we can't check usage
  }
}
