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
      webhook: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://trypostify.ai'}/api/video/transcode-webhook`,
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
 * Enhanced video upload to Twitter with automatic transcoding fallback using Coconut.io
 * Only use this in server-side code
 */
export async function uploadVideoToTwitterWithTranscoding(
  videoBuffer: Buffer,
  twitterClient: any,
  options: {
    maxRetries?: number
    enableTranscoding?: boolean
  } = {}
): Promise<{ success: boolean; mediaId?: string; error?: string; transcoded?: boolean }> {
  const { maxRetries = 2, enableTranscoding = true } = options
  
  console.log('[TwitterUploadTranscode] Uploading video to Twitter, size:', videoBuffer.length, 'bytes')
  
  let transcoded = false
  
  // First, try uploading the original video
  try {
    const mediaId = await twitterClient.v1.uploadMedia(videoBuffer, { mimeType: 'video/mp4' })
    console.log('[TwitterUploadTranscode] ✅ Video uploaded successfully with media_id:', mediaId)
    return { success: true, mediaId, transcoded: false }
  } catch (error: any) {
    console.log('[TwitterUploadTranscode] ❌ Initial upload failed:', error.message)
    
    // If it's a format error and transcoding is enabled
    if ((error.message?.includes('InvalidMedia') || error.message?.includes('Invalid or Unsupported media')) 
        && enableTranscoding) {
      console.log('[TwitterUploadTranscode] 🔄 Video format incompatible - starting Coconut.io transcoding...')
      
      try {
        // Use Coconut.io for transcoding
        const transcodedUrl = await transcodeVideoToH264(videoBuffer)
        console.log('[TwitterUploadTranscode] 🎬 Transcoding initiated with Coconut.io')
        
        // Note: In a real implementation, you'd need to wait for Coconut.io webhook
        // or poll for completion before downloading the transcoded video
        // For now, we return an error indicating async transcoding is in progress
        return { 
          success: false, 
          error: 'TRANSCODING_IN_PROGRESS', 
          transcoded: true 
        }
        
      } catch (transcodeError: any) {
        console.error('[TwitterUploadTranscode] ❌ Transcoding failed:', transcodeError.message)
        return { success: false, error: 'TRANSCODING_FAILED', transcoded: false }
      }
    }
    
    // For other errors, return the error
    console.log('[TwitterUploadTranscode] Upload failed with non-format error')
    return { success: false, error: error.message, transcoded: false }
  }
}
