/**
 * Server-side video transcoding utilities using Coconut.io API
 * This file should only be imported in server-side code (API routes, server actions)
 */

/**
 * Transcodes video to H.264 format compatible with Twitter using Coconut.io API
 */
export async function transcodeVideoToH264(videoBuffer: Buffer, originalFileName: string = 'video.mp4'): Promise<string> {
  console.log('[VideoTranscode] Starting video transcoding with Coconut.io...')
  console.log('[VideoTranscode] Original video size:', videoBuffer.length, 'bytes')
  
  try {
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
    
    const coconutApiKey = process.env.COCONUT_API_KEY
    if (!coconutApiKey) {
      throw new Error('COCONUT_API_KEY environment variable is required')
    }
    
    console.log('[VideoTranscode] Creating Coconut.io transcoding job...')
    
    const jobConfig = {
      source: tempVideoUrl,
      webhook: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://trypostify.com'}/api/video/transcode-webhook`,
      outputs: {
        mp4: {
          path: outputUrl,
          video: {
            codec: 'h264',
            bitrate: '2000k',
            fps: 30,
            size: '1280x720'
          },
          audio: {
            codec: 'aac',
            bitrate: '128k'
          }
        }
      }
    }
    
    const response = await fetch('https://api.coconut.co/job', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${coconutApiKey}`
      },
      body: JSON.stringify(jobConfig)
    })
    
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Coconut.io API error: ${response.status} - ${errorText}`)
    }
    
    const result = await response.json()
    console.log('[VideoTranscode] ✅ Coconut.io job created:', result.id)
    
    // For now, return the expected output URL
    // In a real implementation, you'd poll for completion or use webhooks
    const finalUrl = `https://${process.env.NEXT_PUBLIC_S3_BUCKET_NAME}.s3.amazonaws.com/${outputKey}`
    console.log('[VideoTranscode] Expected output URL:', finalUrl)
    
    // TODO: Implement polling or webhook handling for job completion
    // For now, return the URL where the transcoded video will be available
    return finalUrl
    
  } catch (error: any) {
    console.error('[VideoTranscode] ❌ Coconut.io transcoding failed:', error.message)
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
  } = {}
): Promise<{ success: boolean; mediaId?: string; error?: string; transcoded?: boolean; costOptimized?: boolean }> {
  const { maxRetries = 2, enableTranscoding = true, originalFileName = '', userId } = options
  
  console.log('[TwitterUploadTranscode] Uploading video to Twitter, size:', videoBuffer.length, 'bytes')
  
  const fileSizeMB = videoBuffer.length / (1024 * 1024)
  let transcoded = false
  
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
      
      console.log('[TwitterUploadTranscode] 🔄 Video format incompatible - starting cost-optimized Coconut.io transcoding...')
      console.log('[TwitterUploadTranscode] 💰 Estimated cost: $' + (costOptimization.estimatedCost).toFixed(2))
      
      try {
        // Track transcoding usage
        await trackTranscodingUsage(userId, fileSizeMB, costOptimization.estimatedDuration)
        
        // Use Coconut.io for transcoding
        const transcodedUrl = await transcodeVideoToH264(videoBuffer, originalFileName)
        console.log('[TwitterUploadTranscode] 🎬 Transcoding initiated with Coconut.io')
        
        // Note: In a real implementation, you'd need to wait for Coconut.io webhook
        // or poll for completion before downloading the transcoded video
        // For now, we return an error indicating async transcoding is in progress
        return { 
          success: false, 
          error: 'TRANSCODING_IN_PROGRESS', 
          transcoded: true,
          costOptimized: true
        }
        
      } catch (transcodeError: any) {
        console.error('[TwitterUploadTranscode] ❌ Transcoding failed:', transcodeError.message)
        return { success: false, error: 'TRANSCODING_FAILED', transcoded: false, costOptimized: true }
      }
    }
    
    // For other errors or if cost optimization blocked transcoding
    console.log('[TwitterUploadTranscode] Upload failed - no transcoding attempted due to cost optimization')
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
