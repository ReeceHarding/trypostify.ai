import { NextRequest, NextResponse } from 'next/server'
import { verifySignatureAppRouter } from '@upstash/qstash/dist/nextjs'
import { client } from '@/lib/client'

// Log when this module loads
console.log('[ProcessVideo Route] Module loaded at:', new Date().toISOString())

async function handler(request: NextRequest) {
  console.log('[ProcessVideo Route] Handler called:', {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers.entries()),
    timestamp: new Date().toISOString()
  })

  try {
    const body = await request.json()
    console.log('[ProcessVideo Route] Request body:', body)

    const { url, platform, tweetId, userId, autoPost } = body

    if (!url || !platform || !userId) {
      console.error('[ProcessVideo Route] Missing required fields:', { url, platform, userId })
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    console.log('[ProcessVideo Route] Processing video:', {
      url,
      platform,
      tweetId,
      userId,
      autoPost
    })

    // Call the video router to process the video
    const response = await client.video.processVideo.$post({
      url,
      platform,
      tweetId,
      userId,
      autoPost,
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('[ProcessVideo Route] Video processing failed:', error)
      return NextResponse.json(
        { error: 'Video processing failed' },
        { status: 500 }
      )
    }

    const result = await response.json()
    console.log('[ProcessVideo Route] Video processing completed:', result)

    return NextResponse.json(result)
  } catch (error) {
    console.error('[ProcessVideo Route] Error processing video:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Export verified handler for QStash
export const POST = process.env.QSTASH_CURRENT_SIGNING_KEY
  ? verifySignatureAppRouter(handler)
  : handler

// Also export GET for testing
export async function GET(request: NextRequest) {
  console.log('[ProcessVideo Route] GET request received')
  return NextResponse.json({ 
    message: 'Video processing webhook is active',
    timestamp: new Date().toISOString()
  })
}
