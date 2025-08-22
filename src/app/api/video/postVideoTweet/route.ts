import { NextRequest, NextResponse } from 'next/server'
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'
import { getAccount } from '@/server/routers/utils/get-account'
import { db } from '@/db'
import { user as userSchema } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { TwitterApi } from 'twitter-api-v2'

async function handler(req: NextRequest) {
  try {
    console.log('[PostVideoTweet] Webhook called at', new Date().toISOString())
    
    const body = await req.json()
    console.log('[PostVideoTweet] Webhook payload:', body)
    
    const { userId, s3Key, videoUrl, platform, title, description, author } = body
    
    if (!userId || !s3Key || !videoUrl) {
      console.error('[PostVideoTweet] Missing required fields:', { userId, s3Key, videoUrl })
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    
    // Get user from database
    const user = await db.query.user.findFirst({
      where: eq(userSchema.id, userId)
    })
    
    if (!user) {
      console.error('[PostVideoTweet] User not found:', userId)
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    
    console.log('[PostVideoTweet] Found user:', user.email)
    
    // Get user's Twitter account
    const account = await getAccount({ email: user.email })
    if (!account?.id) {
      console.error('[PostVideoTweet] No Twitter account found for user:', user.email)
      return NextResponse.json({ error: 'No Twitter account found' }, { status: 404 })
    }
    
    console.log('[PostVideoTweet] Found Twitter account:', account.username)
    
    // Upload video to Twitter
    console.log('[PostVideoTweet] Uploading video to Twitter...')
    
    const uploadResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/tweet/uploadMediaToTwitter`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        s3Key,
        mediaType: 'video',
        fileUrl: videoUrl,
      }),
    })
    
    if (!uploadResponse.ok) {
      const error = await uploadResponse.text()
      console.error('[PostVideoTweet] Failed to upload video to Twitter:', error)
      return NextResponse.json({ error: 'Failed to upload video to Twitter' }, { status: 500 })
    }
    
    const { media_id } = await uploadResponse.json()
    console.log('[PostVideoTweet] Video uploaded to Twitter, media_id:', media_id)
    
    // Post tweet with video
    console.log('[PostVideoTweet] Posting tweet with video...')
    
    const postResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/tweet/postThreadNow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tweets: [{
          content: `Video from ${platform}${title ? `: ${title}` : ''}`,
          media: [{ media_id, s3Key }],
          delayMs: 0
        }]
      }),
    })
    
    if (!postResponse.ok) {
      const error = await postResponse.text()
      console.error('[PostVideoTweet] Failed to post tweet:', error)
      return NextResponse.json({ error: 'Failed to post tweet' }, { status: 500 })
    }
    
    const result = await postResponse.json()
    console.log('[PostVideoTweet] Tweet posted successfully:', result)
    
    return NextResponse.json({ 
      success: true, 
      message: 'Video tweet posted successfully',
      threadId: result.threadId 
    })
    
  } catch (error) {
    console.error('[PostVideoTweet] Webhook error:', error)
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

export const POST = verifySignatureAppRouter(handler)
