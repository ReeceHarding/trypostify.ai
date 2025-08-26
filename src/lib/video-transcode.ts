/**
 * Server-side video transcoding utilities using FFmpeg
 * This file should only be imported in server-side code (API routes, server actions)
 */

/**
 * Transcodes video to H.264 format compatible with Twitter
 */
export async function transcodeVideoToH264(videoBuffer: Buffer): Promise<Buffer> {
  const ffmpeg = (await import('fluent-ffmpeg')).default
  const { Readable, PassThrough } = await import('stream')
  
  console.log('[VideoTranscode] Starting video transcoding to H.264...')
  console.log('[VideoTranscode] Original video size:', videoBuffer.length, 'bytes')
  
  return new Promise((resolve, reject) => {
    const inputStream = new Readable()
    inputStream.push(videoBuffer)
    inputStream.push(null)
    
    const outputStream = new PassThrough()
    const chunks: Buffer[] = []
    
    outputStream.on('data', (chunk) => chunks.push(chunk))
    outputStream.on('end', () => {
      const transcodedBuffer = Buffer.concat(chunks)
      console.log('[VideoTranscode] ✅ Transcoding completed, new size:', transcodedBuffer.length, 'bytes')
      const compressionRatio = ((videoBuffer.length - transcodedBuffer.length) / videoBuffer.length * 100).toFixed(1)
      console.log('[VideoTranscode] Size change:', compressionRatio + '%', compressionRatio.startsWith('-') ? 'larger' : 'smaller')
      resolve(transcodedBuffer)
    })
    outputStream.on('error', reject)
    
    ffmpeg(inputStream)
      .videoCodec('libx264')
      .audioCodec('aac')
      .format('mp4')
      .outputOptions([
        '-preset fast',           // Fast encoding preset
        '-crf 23',               // Constant Rate Factor (23 is good quality)
        '-movflags +faststart',  // Enable fast start for web playback
        '-pix_fmt yuv420p',      // Pixel format compatible with most players
        '-profile:v baseline',   // H.264 baseline profile for maximum compatibility
        '-level 3.0',            // H.264 level 3.0 for Twitter compatibility
        '-maxrate 25M',          // Maximum bitrate for Twitter (25 Mbps)
        '-bufsize 50M'           // Buffer size
      ])
      .on('start', (commandLine) => {
        console.log('[VideoTranscode] FFmpeg command:', commandLine)
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log('[VideoTranscode] Progress:', Math.round(progress.percent) + '%')
        }
      })
      .on('error', (err) => {
        console.error('[VideoTranscode] ❌ Transcoding failed:', err.message)
        reject(err)
      })
      .pipe(outputStream)
  })
}

/**
 * Enhanced video upload to Twitter with automatic transcoding fallback
 * Only use this in server-side code where FFmpeg is available
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
  
  let currentBuffer = videoBuffer
  let transcoded = false
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mediaId = await twitterClient.v1.uploadMedia(currentBuffer, { mimeType: 'video/mp4' })
      console.log('[TwitterUploadTranscode] ✅ Video uploaded successfully with media_id:', mediaId)
      if (transcoded) {
        console.log('[TwitterUploadTranscode] 🎬 Transcoding was successful - Instagram video converted to Twitter-compatible format')
      }
      return { success: true, mediaId, transcoded }
    } catch (error: any) {
      console.log(`[TwitterUploadTranscode] ❌ Upload attempt ${attempt} failed:`, error.message)
      
      // If it's a format error and we haven't tried transcoding yet
      if ((error.message?.includes('InvalidMedia') || error.message?.includes('Invalid or Unsupported media')) 
          && enableTranscoding && !transcoded) {
        console.log('[TwitterUploadTranscode] 🔄 Video format incompatible - attempting transcoding to H.264...')
        
        try {
          currentBuffer = await transcodeVideoToH264(videoBuffer)
          transcoded = true
          console.log('[TwitterUploadTranscode] 🎬 Transcoding completed, retrying upload...')
          continue // Retry with transcoded video
        } catch (transcodeError: any) {
          console.error('[TwitterUploadTranscode] ❌ Transcoding failed:', transcodeError.message)
          return { success: false, error: 'TRANSCODING_FAILED', transcoded: false }
        }
      }
      
      // If format error and transcoding already tried or disabled
      if (error.message?.includes('InvalidMedia') || error.message?.includes('Invalid or Unsupported media')) {
        console.log('[TwitterUploadTranscode] Video format still not supported after transcoding attempt')
        return { success: false, error: 'UNSUPPORTED_FORMAT', transcoded }
      }
      
      // For other errors, retry if we have attempts left
      if (attempt === maxRetries) {
        console.log('[TwitterUploadTranscode] All upload attempts failed')
        return { success: false, error: error.message, transcoded }
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
    }
  }
  
  return { success: false, error: 'MAX_RETRIES_EXCEEDED', transcoded }
}
