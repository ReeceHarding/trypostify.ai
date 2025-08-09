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

interface ThreadTweetData {
  id: string
  content: string
  media: Array<{
    s3Key: string
    media_id: string
  }>
}

interface ThreadTweetFromAPI {
  id: string
  content: string
  media: Array<{
    url: string
    s3Key: string
    media_id: string
    type: 'image' | 'gif' | 'video'
    uploaded: boolean
    uploading: boolean
    file: null
  }>
}

interface ThreadTweetEditorProps {
  className?: string
  editMode?: boolean
  editTweetId?: string | null
}

export default function ThreadTweetEditor({
  className,
  editMode = false,
  editTweetId,
}: ThreadTweetEditorProps) {
  const [isThreadMode, setIsThreadMode] = useState(false)
  const [threadTweets, setThreadTweets] = useState<ThreadTweetData[]>([
    { id: crypto.randomUUID(), content: '', media: [] },
  ])
  const [fullMediaData, setFullMediaData] = useState<Record<string, any[]>>({})
  const router = useRouter()
  const { fire } = useConfetti()

  console.log('[ThreadTweetEditor] Render - isThreadMode:', isThreadMode, 'tweets:', threadTweets.length, 'editMode:', editMode)

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
      console.log('[ThreadTweetEditor] Loading thread data:', threadData.tweets.length, 'tweets')
      setIsThreadMode(true)
      
      // Store full media data separately
      const mediaDataMap: Record<string, any[]> = {}
      threadData.tweets.forEach((tweet: any) => {
        if (tweet.media && tweet.media.length > 0) {
          mediaDataMap[tweet.id] = tweet.media
        }
      })
      setFullMediaData(mediaDataMap)
      
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

  // Create thread mutation
  const createThreadMutation = useMutation({
    mutationFn: async (tweets: Array<{ content: string; media: any[]; delayMs: number }>) => {
      console.log('[ThreadTweetEditor] Creating thread with tweets:', tweets)
      const res = await client.tweet.createThread.$post({
        tweets,
      })

      if (!res.ok) {
        const error = await res.json()
        throw new HTTPException(res.status as any, { message: (error as any).message })
      }

      return res.json()
    },
  })

  // Post thread immediately mutation
  const postThreadNowMutation = useMutation({
    mutationFn: async (threadId: string) => {
      console.log('[ThreadTweetEditor] Posting thread immediately:', threadId)
      const res = await client.tweet.postThreadNow.$post({
        threadId,
      })

      if (!res.ok) {
        const error = await res.json()
        throw new HTTPException(res.status as any, { message: (error as any).message })
      }

      return res.json()
    },
    onSuccess: (data) => {
      console.log('[ThreadTweetEditor] Thread posted successfully:', data)
      toast.success('Thread posted successfully!')
      fire()
      
      // Clear the thread
      setThreadTweets([{ id: crypto.randomUUID(), content: '', media: [] }])
      setIsThreadMode(false)
      
      if (data.threadUrl) {
        window.open(data.threadUrl, '_blank')
      }
    },
  })

  // Schedule thread mutation
  const scheduleThreadMutation = useMutation({
    mutationFn: async ({ threadId, scheduledUnix }: { threadId: string; scheduledUnix: number }) => {
      console.log('[ThreadTweetEditor] Scheduling thread:', threadId, 'for:', new Date(scheduledUnix * 1000))
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
      console.log('[ThreadTweetEditor] Thread scheduled successfully:', data)
      toast.success('Thread scheduled successfully!')
      
      // Clear the thread
      setThreadTweets([{ id: crypto.randomUUID(), content: '', media: [] }])
      setIsThreadMode(false)
      
      router.push('/studio/scheduled')
    },
  })

  // Enqueue thread mutation
  const enqueueThreadMutation = useMutation({
    mutationFn: async ({ threadId, userNow, timezone }: { threadId: string; userNow: Date; timezone: string }) => {
      console.log('[ThreadTweetEditor] Enqueueing thread:', threadId)
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
      console.log('[ThreadTweetEditor] Thread queued successfully:', data)
      toast.success(
        <div className="flex gap-1.5 items-center">
          <p>Thread queued!</p>
          <Link
            href="/studio/scheduled"
            className="text-base text-indigo-600 decoration-2 underline-offset-2 flex items-center gap-1 underline shrink-0 bg-white/10 hover:bg-white/20 rounded py-0.5 transition-colors"
          >
            See queue
          </Link>
        </div>
      )
      
      // Clear the thread
      setThreadTweets([{ id: crypto.randomUUID(), content: '', media: [] }])
      setIsThreadMode(false)
      
      router.push('/studio/scheduled')
    },
    onError: (error: HTTPException) => {
      console.error('[ThreadTweetEditor] Failed to queue thread:', error)
      toast.error(error.message || 'Failed to queue thread')
    },
  })

  // Update thread mutation (for edit mode)
  const updateThreadMutation = useMutation({
    mutationFn: async ({ tweets }: { tweets: ThreadTweetData[] }) => {
      if (!threadData?.threadId) throw new Error('No thread ID found')
      
      console.log('[ThreadTweetEditor] Updating thread:', threadData.threadId)
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
      console.log('[ThreadTweetEditor] Thread updated successfully')
      toast.success('Thread updated successfully!')
      router.push('/studio/scheduled')
    },
  })

  const handleToggleMode = () => {
    console.log('[ThreadTweetEditor] Toggling mode from:', isThreadMode, 'to:', !isThreadMode)
    if (!isThreadMode) {
      // Entering thread mode - add a second tweet
      setThreadTweets([
        { id: crypto.randomUUID(), content: '', media: [] },
        { id: crypto.randomUUID(), content: '', media: [] },
      ])
    } else {
      // Leaving thread mode - keep only first tweet
      setThreadTweets([threadTweets[0] || { id: crypto.randomUUID(), content: '', media: [] }])
    }
    setIsThreadMode(!isThreadMode)
  }

  const handleAddTweet = () => {
    console.log('[ThreadTweetEditor] Adding new tweet to thread')
    // Use a special prefix for new tweets in edit mode
    const newId = editMode ? `new-${crypto.randomUUID()}` : crypto.randomUUID()
    setThreadTweets([...threadTweets, { id: newId, content: '', media: [] }])
  }

  const handleRemoveTweet = (id: string) => {
    console.log('[ThreadTweetEditor] Removing tweet:', id)
    setThreadTweets(threadTweets.filter(tweet => tweet.id !== id))
  }

  const handleTweetUpdate = (id: string, content: string, media: Array<{ s3Key: string; media_id: string }>) => {
    console.log('[ThreadTweetEditor] Tweet updated:', id)
    setThreadTweets(prevTweets => {
      // Check if the tweet still exists in the array before updating
      const tweetExists = prevTweets.some(tweet => tweet.id === id)
      if (!tweetExists) {
        console.log('[ThreadTweetEditor] Ignoring update for removed tweet:', id)
        return prevTweets
      }
      return prevTweets.map(tweet =>
        tweet.id === id ? { ...tweet, content, media } : tweet
      )
    })
  }

  const handlePostThread = async () => {
    console.log('[ThreadTweetEditor] Starting thread post process')
    
    // Validate all tweets have content
    const emptyTweets = threadTweets.filter(t => !t.content.trim())
    if (emptyTweets.length > 0) {
      toast.error('All tweets in the thread must have content')
      return
    }

    // Check character limits
    const oversizedTweets = threadTweets.filter(t => t.content.length > 280)
    if (oversizedTweets.length > 0) {
      toast.error('All tweets must be 280 characters or less')
      return
    }

    posthog.capture('thread_post_started', { tweet_count: threadTweets.length })

    try {
      // Create thread first
      const createResult = await createThreadMutation.mutateAsync(
        threadTweets.map((tweet, index) => ({
          content: tweet.content,
          media: tweet.media,
          delayMs: index > 0 ? 1000 : 0, // 1 second delay between tweets
        }))
      )

      if (!createResult.threadId) {
        throw new Error('Failed to create thread')
      }

      // Post thread immediately
      await postThreadNowMutation.mutateAsync(createResult.threadId)
      
      posthog.capture('thread_posted', {
        tweet_count: threadTweets.length,
        thread_id: createResult.threadId,
      })
    } catch (error) {
      console.error('[ThreadTweetEditor] Error in post thread process:', error)
      toast.error('Failed to post thread')
    }
  }

  const handleScheduleThread = async (scheduledDate: Date) => {
    console.log('[ThreadTweetEditor] Scheduling thread for:', scheduledDate)
    
    // Validate all tweets have content
    const emptyTweets = threadTweets.filter(t => !t.content.trim())
    if (emptyTweets.length > 0) {
      toast.error('All tweets in the thread must have content')
      return
    }

    posthog.capture('thread_schedule_started', { tweet_count: threadTweets.length })

    try {
      // Create thread first
      const createResult = await createThreadMutation.mutateAsync(
        threadTweets.map((tweet, index) => ({
          content: tweet.content,
          media: tweet.media,
          delayMs: index > 0 ? 1000 : 0,
        }))
      )

      if (!createResult.threadId) {
        throw new Error('Failed to create thread')
      }

      // Schedule the thread
      await scheduleThreadMutation.mutateAsync({
        threadId: createResult.threadId,
        scheduledUnix: Math.floor(scheduledDate.getTime() / 1000),
      })
      
      posthog.capture('thread_scheduled', {
        tweet_count: threadTweets.length,
        thread_id: createResult.threadId,
        scheduled_for: scheduledDate.toISOString(),
      })
    } catch (error) {
      console.error('[ThreadTweetEditor] Error in schedule thread process:', error)
      toast.error('Failed to schedule thread')
    }
  }

  const handleQueueThread = async () => {
    console.log('[ThreadTweetEditor] Queueing thread')
    
    // Validate all tweets have content
    const emptyTweets = threadTweets.filter(t => !t.content.trim())
    if (emptyTweets.length > 0) {
      toast.error('All tweets in the thread must have content')
      return
    }

    // Check character limits
    const oversizedTweets = threadTweets.filter(t => t.content.length > 280)
    if (oversizedTweets.length > 0) {
      toast.error('All tweets must be 280 characters or less')
      return
    }

    posthog.capture('thread_queue_started', { tweet_count: threadTweets.length })

    try {
      // Create thread first
      const createResult = await createThreadMutation.mutateAsync(
        threadTweets.map((tweet, index) => ({
          content: tweet.content,
          media: tweet.media,
          delayMs: index > 0 ? 1000 : 0,
        }))
      )
      
      if (!createResult.threadId) {
        throw new Error('Failed to create thread')
      }

      // Get user's timezone
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      
      // Queue the thread
      await enqueueThreadMutation.mutateAsync({
        threadId: createResult.threadId,
        userNow: new Date(),
        timezone,
      })
      
      posthog.capture('thread_queued', {
        thread_id: createResult.threadId,
        tweet_count: threadTweets.length,
      })
    } catch (error) {
      console.error('[ThreadTweetEditor] Failed to queue thread:', error)
    }
  }

  const handleUpdateThread = async () => {
    console.log('[ThreadTweetEditor] Updating thread')
    
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
      console.error('[ThreadTweetEditor] Error updating thread:', error)
      toast.error('Failed to update thread')
    }
  }

  const handleCancelEdit = () => {
    router.push('/studio/scheduled')
  }

  const isPosting = createThreadMutation.isPending || postThreadNowMutation.isPending || scheduleThreadMutation.isPending || enqueueThreadMutation.isPending || updateThreadMutation.isPending

  // Show loading state while loading thread data
  if (loadingThread) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-stone-500">Loading thread...</div>
      </div>
    )
  }

  // Render the tweets
  return (
    <div className={cn('relative z-10 w-full rounded-lg font-sans', className)}>
      <div className="space-y-4 w-full">
        {isThreadMode ? (
          // Thread mode - render multiple tweets
          <>
            {threadTweets.map((tweet, index) => (
              <div key={tweet.id} className="relative">
                {/* Connecting line between tweets */}
                {index < threadTweets.length - 1 && (
                  <div
                    className="absolute left-[30px] top-[72px] bottom-[-16px] w-[2px] bg-stone-300 z-0"
                  />
                )}
                
                <ThreadTweet
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
                  initialMedia={fullMediaData[tweet.id] || []}
                />
              </div>
            ))}
            
            {/* Add tweet button */}
            <button
              onClick={handleAddTweet}
              className="w-full p-3 border-2 border-dashed border-stone-300 hover:border-stone-400 rounded-lg flex items-center justify-center gap-2 text-stone-500 hover:text-stone-700 transition-colors"
            >
              <span className="text-sm font-medium">Add another tweet to this thread</span>
            </button>

          </>
        ) : (
          // Single tweet mode
          <>
            <ThreadTweet
              isThread={false}
              isFirstTweet={true}
              isLastTweet={true}
              canDelete={false}
              editMode={editMode}
              isPosting={false}
              onUpdate={(content, media) => handleTweetUpdate(threadTweets[0]?.id || '', content, media)}
              initialContent={threadTweets[0]?.content || ''}
              initialMedia={fullMediaData[threadTweets[0]?.id || ''] || []}
            />
            
            {/* Create thread link - don't show in edit mode */}
            {!editMode && (
              <div className="text-center">
                <button
                  onClick={handleToggleMode}
                  className="text-sm text-blue-500 hover:text-blue-600 hover:underline transition-colors"
                >
                  Create a thread instead
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}