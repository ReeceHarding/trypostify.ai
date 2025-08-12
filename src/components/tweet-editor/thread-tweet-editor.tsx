'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { client } from '@/lib/client'
import { useMutation, useQuery } from '@tanstack/react-query'
import { HTTPException } from 'hono/http-exception'
import { toast } from 'react-hot-toast'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import posthog from 'posthog-js'
import { useConfetti } from '@/hooks/use-confetti'
import ThreadTweet from './thread-tweet'
import { format } from 'date-fns'

interface ThreadTweetData {
  id: string
  content: string
  media: Array<{
    s3Key: string
    media_id: string
  }>
}

interface ThreadTweetEditorProps {
  className?: string
  editMode?: boolean
  editTweetId?: string | null
}

// Validation helper
function validateThreadTweets(tweets: ThreadTweetData[]): { valid: boolean; error?: string } {
  // Check for empty tweets
  const emptyTweets = tweets.filter(t => !t.content.trim())
  if (emptyTweets.length > 0) {
    return { valid: false, error: 'All tweets in the thread must have content' }
  }

  // Check character limits
  const oversizedTweets = tweets.filter(t => t.content.length > 280)
  if (oversizedTweets.length > 0) {
    return { valid: false, error: 'All tweets must be 280 characters or less' }
  }

  return { valid: true }
}

export default function ThreadTweetEditor({
  className,
  editMode = false,
  editTweetId,
}: ThreadTweetEditorProps) {
  const [threadTweets, setThreadTweets] = useState<ThreadTweetData[]>([
    { id: crypto.randomUUID(), content: '', media: [] },
  ])
  const router = useRouter()
  const { fire } = useConfetti()

  // Load thread data if in edit mode
  const { data: threadData, isLoading: loadingThread } = useQuery({
    queryKey: ['thread', editTweetId],
    enabled: editMode && !!editTweetId,
    queryFn: async () => {
      if (!editTweetId) return null
      
      // First get the tweet to find its threadId
      const tweetRes = await client.tweet.getTweet.$get({ tweetId: editTweetId })
      if (!tweetRes.ok) throw new Error('Failed to load tweet')
      
      const { tweet } = await tweetRes.json()
      if (!tweet?.threadId) return null
      
      // Then get all tweets in the thread
      const threadRes = await client.tweet.getThread.$get({ threadId: tweet.threadId })
      if (!threadRes.ok) throw new Error('Failed to load thread')
      
      return threadRes.json()
    },
  })

  // Initialize thread data when loaded
  useEffect(() => {
    if (threadData?.tweets && threadData.tweets.length > 0) {
      setThreadTweets(threadData.tweets.map((tweet: any) => ({
        id: tweet.id,
        content: tweet.content,
        media: tweet.media?.map((m: any) => ({
          s3Key: m.s3Key,
          media_id: m.media_id,
        })) || [],
      })))
    }
  }, [threadData])

  // Post thread mutation - combines create and post
  const postThreadMutation = useMutation({
    mutationFn: async (tweets: Array<{ content: string; media: any[]; delayMs: number }>) => {
      const res = await client.tweet.postThreadNow.$post({
        tweets,
      })

      if (!res.ok) {
        const error = await res.json()
        throw new HTTPException(res.status as any, { message: (error as any).message })
      }

      return res.json()
    },
    onSuccess: (data) => {
      toast.success('Thread posted successfully!')
      fire()
      
      // Clear the thread
      setThreadTweets([{ id: crypto.randomUUID(), content: '', media: [] }])
      
      if (data.threadUrl) {
        window.open(data.threadUrl, '_blank')
      }
    },
    onError: (error: any) => {
      console.error('[postThreadMutation] Error:', error)
      
      // Check if it's a rate limit error (429)
      const errorMessage = error?.message || error?.data?.message || 'Failed to post thread'
      
      if (errorMessage.includes('429') || errorMessage.toLowerCase().includes('rate limit')) {
        toast.error('Twitter rate limit reached. You\'ve posted too many tweets today. Please try again later.')
      } else if (errorMessage.includes('reconnect')) {
        toast.error('Please reconnect your Twitter account')
      } else {
        toast.error(errorMessage)
      }
    },
  })

  // Schedule thread mutation
  const scheduleThreadMutation = useMutation({
    mutationFn: async ({ threadId, scheduledUnix }: { threadId: string; scheduledUnix: number }) => {

      const res = await client.tweet.scheduleThread.$post({
        threadId,
        scheduledUnix,
      })

      if (!res.ok) {
        const error = await res.json()
        throw new HTTPException(res.status as any, { message: (error as any).message })
      }

      return res.json()
    },
    onSuccess: (data) => {

      toast.success('Thread scheduled successfully!')
      
      // Clear the thread
      setThreadTweets([{ id: crypto.randomUUID(), content: '', media: [] }])

      
      router.push('/studio/scheduled')
    },
  })

  // Enqueue thread mutation
  const enqueueThreadMutation = useMutation({
    mutationFn: async ({ threadId, userNow, timezone }: { threadId: string; userNow: Date; timezone: string }) => {

      const res = await client.tweet.enqueueThread.$post({
        threadId,
        userNow,
        timezone,
      })
      
      if (!res.ok) {
        const error = await res.json()
        throw new HTTPException(res.status as any, { message: (error as any).message })
      }
      
      return res.json()
    },
    onSuccess: (data) => {

      toast.success(
        <div className="flex gap-1.5 items-center">
          <p>Thread queued!</p>
          <Link
            href="/studio/scheduled"
            className="text-base text-primary-600 decoration-2 underline-offset-2 flex items-center gap-1 underline shrink-0 bg-white/10 hover:bg-white/20 rounded py-0.5 transition-colors"
          >
            See queue
          </Link>
        </div>
      )
      
      // Clear the thread
      setThreadTweets([{ id: crypto.randomUUID(), content: '', media: [] }])

      
      router.push('/studio/scheduled')
    },
    onError: (error: HTTPException) => {
      // console.error('[ThreadTweetEditor] Failed to queue thread:', error)
      toast.error(error.message || 'Failed to queue thread')
    },
  })

  // Update thread mutation (for edit mode)
  const updateThreadMutation = useMutation({
    mutationFn: async ({ tweets }: { tweets: ThreadTweetData[] }) => {
      if (!threadData?.threadId) throw new Error('No thread ID found')
      

      const res = await client.tweet.updateThread.$post({
        threadId: threadData.threadId,
        tweets: tweets.map((tweet, index) => ({
          id: tweet.id.startsWith('new-') ? undefined : tweet.id,
          content: tweet.content,
          media: tweet.media,
          delayMs: index > 0 ? 1000 : 0,
        })),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new HTTPException(res.status as any, { message: (error as any).message })
      }

      return res.json()
    },
    onSuccess: () => {

      toast.success('Thread updated successfully!')
      router.push('/studio/scheduled')
    },
  })



  const handleAddTweet = () => {
    setThreadTweets([...threadTweets, { id: crypto.randomUUID(), content: '', media: [] }])
  }

  const handleRemoveTweet = (id: string) => {
    setThreadTweets(threadTweets.filter(tweet => tweet.id !== id))
  }

  const handleTweetUpdate = (id: string, content: string, media: Array<{ s3Key: string; media_id: string }>) => {
    setThreadTweets(prevTweets => 
      prevTweets.map(tweet =>
        tweet.id === id ? { ...tweet, content, media } : tweet
      )
    )
  }

  const handlePostThread = async () => {
    // Validate tweets
    const validation = validateThreadTweets(threadTweets)
    if (!validation.valid) {
      toast.error(validation.error!)
      return
    }

    posthog.capture('thread_post_started', { tweet_count: threadTweets.length })

    try {
      // Post thread immediately with combined mutation
      const result = await postThreadMutation.mutateAsync(
        threadTweets.map((tweet, index) => ({
          content: tweet.content,
          media: tweet.media,
          delayMs: index > 0 ? 1000 : 0, // 1 second delay between tweets
        }))
      )
      
      posthog.capture('thread_posted', {
        tweet_count: threadTweets.length,
        thread_id: result.threadId,
      })
    } catch (error) {
      // Already handled by mutation onError
    }
  }

  const handleScheduleThread = async (scheduledDate: Date) => {
    // Validate tweets
    const validation = validateThreadTweets(threadTweets)
    if (!validation.valid) {
      toast.error(validation.error!)
      return
    }

    posthog.capture('thread_schedule_started', { tweet_count: threadTweets.length })

    try {
      // First create the thread
      const createResult = await client.tweet.createThread.$post({
        tweets: threadTweets.map((tweet, index) => ({
          content: tweet.content,
          media: tweet.media,
          delayMs: index > 0 ? 1000 : 0,
        }))
      })

      if (!createResult.ok) {
        throw new Error('Failed to create thread')
      }
      
      const { threadId } = await createResult.json()

      // Schedule the thread
      console.log('[ThreadTweetEditor] scheduling thread', {
        threadId,
        scheduledIso: scheduledDate.toISOString(),
        scheduledUnix: Math.floor(scheduledDate.getTime() / 1000),
      })
      await scheduleThreadMutation.mutateAsync({
        threadId,
        scheduledUnix: Math.floor(scheduledDate.getTime() / 1000),
      })
      
      posthog.capture('thread_scheduled', {
        tweet_count: threadTweets.length,
        thread_id: threadId,
        scheduled_for: scheduledDate.toISOString(),
      })
      
      toast.success(`Thread scheduled for ${format(scheduledDate, 'MMM d at h:mm a')}`)
    } catch (error) {
      console.error('[ThreadTweetEditor] Error in schedule thread process:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to schedule thread')
    }
  }

  const handleQueueThread = async () => {
    // Validate tweets
    const validation = validateThreadTweets(threadTweets)
    if (!validation.valid) {
      toast.error(validation.error!)
      return
    }

    posthog.capture('thread_queue_started', { tweet_count: threadTweets.length })

    try {
      // Create thread first
      const createResult = await client.tweet.createThread.$post({
        tweets: threadTweets.map((tweet, index) => ({
          content: tweet.content,
          media: tweet.media,
          delayMs: index > 0 ? 1000 : 0,
        }))
      })
      
      if (!createResult.ok) {
        throw new Error('Failed to create thread')
      }
      
      const { threadId } = await createResult.json()

      // Get user's timezone
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      
      // Queue the thread
      await enqueueThreadMutation.mutateAsync({
        threadId,
        userNow: new Date(),
        timezone,
      })
      
      posthog.capture('thread_queued', {
        thread_id: threadId,
        tweet_count: threadTweets.length,
      })
      
      toast.success('Thread added to queue!')
    } catch (error) {
      console.error('[ThreadTweetEditor] Failed to queue thread:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to queue thread')
    }
  }

  const handleUpdateThread = async () => {

    
    // Validate all tweets have content
    const emptyTweets = threadTweets.filter(t => !t.content.trim())
    if (emptyTweets.length > 0) {
      toast.error('All tweets in the thread must have content')
      return
    }

    posthog.capture('thread_update_started', { tweet_count: threadTweets.length })

    try {
      await updateThreadMutation.mutateAsync({ tweets: threadTweets })
      
      posthog.capture('thread_updated', {
        tweet_count: threadTweets.length,
        thread_id: threadData?.threadId,
      })
    } catch (error) {
      // console.error('[ThreadTweetEditor] Error updating thread:', error)
      toast.error('Failed to update thread')
    }
  }

  const handleCancelEdit = () => {
    router.push('/studio/scheduled')
  }

  const isPosting = postThreadMutation.isPending || scheduleThreadMutation.isPending || enqueueThreadMutation.isPending || updateThreadMutation.isPending

  // Show loading state while loading thread data
  if (loadingThread) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-neutral-500">Loading thread...</div>
      </div>
    )
  }

  // Render the tweets
  return (
    <div className={cn('relative z-10 w-full rounded-lg font-sans', className)}>
      <div className="space-y-4 w-full">
        {threadTweets.map((tweet, index) => (
          <div key={tweet.id} className="relative">
            {/* Connecting line between tweets */}
            {index < threadTweets.length - 1 && (
              <div
                className="absolute left-[30px] top-[72px] bottom-[-16px] w-[2px] bg-neutral-300 z-0"
              />
            )}
            
            <ThreadTweet
              key={tweet.id}
              isThread={threadTweets.length > 1}
              isFirstTweet={index === 0}
              isLastTweet={index === threadTweets.length - 1}
              canDelete={index > 0}
              editMode={editMode}
              onRemove={() => handleRemoveTweet(tweet.id)}

              onPostThread={index === 0 && !editMode ? handlePostThread : undefined}
              onQueueThread={index === 0 && !editMode ? handleQueueThread : undefined}
              onScheduleThread={index === 0 && !editMode ? handleScheduleThread : undefined}
              onUpdateThread={index === 0 && editMode ? handleUpdateThread : undefined}
              onCancelEdit={index === 0 && editMode ? handleCancelEdit : undefined}
              isPosting={isPosting}
              onUpdate={(content, media) => handleTweetUpdate(tweet.id, content, media)}
              initialContent={tweet.content}
              initialMedia={[]}
            />
          </div>
        ))}
        
        {/* Add tweet button - visible by default when there's exactly one tweet */}
        {threadTweets.length === 1 && (
          <button
            onClick={handleAddTweet}
            className="w-full p-3 border-2 border-dashed border-neutral-300 hover:border-neutral-400 rounded-lg flex items-center justify-center gap-2 text-neutral-500 hover:text-neutral-700 transition-colors"
          >
            <span className="text-sm font-medium">Add another tweet to this thread</span>
          </button>
        )}
        
        {/* Always show add button when multiple tweets */}
        {threadTweets.length > 1 && (
          <button
            onClick={handleAddTweet}
            className="w-full p-3 border-2 border-dashed border-neutral-300 hover:border-neutral-400 rounded-lg flex items-center justify-center gap-2 text-neutral-500 hover:text-neutral-700 transition-colors"
          >
            <span className="text-sm font-medium">Add another tweet to this thread</span>
          </button>
        )}
      </div>
    </div>
  )
}