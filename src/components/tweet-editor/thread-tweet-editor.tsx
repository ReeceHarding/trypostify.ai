'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { client } from '@/lib/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HTTPException } from 'hono/http-exception'
import { toast } from 'react-hot-toast'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import posthog from 'posthog-js'
import { useConfetti } from '@/hooks/use-confetti'
import ThreadTweet from './thread-tweet'
import { format } from 'date-fns'
import { useUser } from '@/hooks/use-tweets'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

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
function validateThreadTweets(tweets: ThreadTweetData[], characterLimit: number): { valid: boolean; error?: string } {
  // Check for empty tweets
  const emptyTweets = tweets.filter(t => !t.content.trim())
  if (emptyTweets.length > 0) {
    return { valid: false, error: 'All tweets in the thread must have content' }
  }

  // Check character limits
  const oversizedTweets = tweets.filter(t => t.content.length > characterLimit)
  if (oversizedTweets.length > 0) {
    return { valid: false, error: `All tweets must be ${characterLimit.toLocaleString()} characters or less` }
  }

  return { valid: true }
}

export default function ThreadTweetEditor({
  className,
  editMode = false,
  editTweetId,
}: ThreadTweetEditorProps) {
  
  const { getCharacterLimit } = useUser()
  const characterLimit = getCharacterLimit()
  
  const [threadTweets, setThreadTweets] = useState<ThreadTweetData[]>([
    { id: crypto.randomUUID(), content: '', media: [] },
  ])
  const [hasBeenCleared, setHasBeenCleared] = useState(false)
  const router = useRouter()
  const { fire } = useConfetti()
  const queryClient = useQueryClient()
  
  // Detect OS for keyboard shortcuts
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0
  const metaKey = isMac ? 'Cmd' : 'Ctrl'
  
  // Refs to focus tweets
  const tweetRefs = useRef<{ [key: string]: { focus: () => void } | null }>({})

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

  const handleAddTweet = () => {
    const newTweetId = crypto.randomUUID()
    setThreadTweets([...threadTweets, { id: newTweetId, content: '', media: [] }])
    
    // Focus the new tweet after it's added
    setTimeout(() => {
      const newTweetRef = tweetRefs.current[newTweetId]
      if (newTweetRef) {
        newTweetRef.focus()
      }
    }, 100)
  }

  // Helper function to find currently focused tweet
  const getCurrentlyFocusedTweetIndex = (): number => {
    if (!document.activeElement) return -1
    
    for (let i = 0; i < threadTweets.length; i++) {
      const tweet = threadTweets[i]
      if (!tweet) continue
      
      const tweetId = tweet.id
      // Look for the tweet container that contains the focused element
      const tweetContainer = document.querySelector(`[data-tweet-id="${tweetId}"]`)
      if (tweetContainer && tweetContainer.contains(document.activeElement)) {
        return i
      }
    }
    return -1
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const actualMetaKey = isMac ? e.metaKey : e.ctrlKey

      // Focus first tweet: Cmd/Ctrl + Shift + F (avoids conflict with browser search)
      if (actualMetaKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        const firstTweetId = threadTweets[0]?.id
        if (firstTweetId && tweetRefs.current[firstTweetId]) {
          tweetRefs.current[firstTweetId]?.focus()
        }
      }
      // Navigate to next tweet: Cmd/Ctrl + Down Arrow
      else if (actualMetaKey && e.key === 'ArrowDown') {
        e.preventDefault()
        const currentIndex = getCurrentlyFocusedTweetIndex()
        const nextIndex = currentIndex + 1
        if (nextIndex < threadTweets.length) {
          const nextTweetId = threadTweets[nextIndex]?.id
          if (nextTweetId && tweetRefs.current[nextTweetId]) {
            tweetRefs.current[nextTweetId].focus()
          }
        }
      }
      // Navigate to previous tweet: Cmd/Ctrl + Up Arrow
      else if (actualMetaKey && e.key === 'ArrowUp') {
        e.preventDefault()
        const currentIndex = getCurrentlyFocusedTweetIndex()
        const prevIndex = currentIndex - 1
        if (prevIndex >= 0) {
          const prevTweetId = threadTweets[prevIndex]?.id
          if (prevTweetId && tweetRefs.current[prevTweetId]) {
            tweetRefs.current[prevTweetId].focus()
          }
        }
      }
      // Add new tweet to thread: Cmd/Ctrl + Shift + Enter
      else if (actualMetaKey && e.shiftKey && e.key === 'Enter') {
        e.preventDefault()
        handleAddTweet()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isMac, threadTweets])

  // Reset state when switching from edit mode to create mode
  useEffect(() => {
    if (!editMode && !editTweetId) {
      console.log('[ThreadTweetEditor] Resetting to create mode')
      setThreadTweets([{ id: crypto.randomUUID(), content: '', media: [] }])
    }
  }, [editMode, editTweetId])

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
      toast.success(
        <div className="flex items-center gap-2">
          <p>Tweet posted!</p>
          {data.threadUrl && (
            <Link
              target="_blank"
              rel="noreferrer"
              href={data.threadUrl}
              className="text-base text-primary-600 decoration-2 underline-offset-2 flex items-center gap-1 underline shrink-0 bg-white/10 hover:bg-white/20 rounded py-0.5 transition-colors"
            >
              View here
            </Link>
          )}
        </div>
      )
      fire()
      
      // Clear the thread content only after successful posting
      setThreadTweets([{ id: crypto.randomUUID(), content: '', media: [] }])
      
      // Note: Twitter URL available in data.threadUrl if needed for future features
    },
    onError: (error: any) => {
      console.error('[postThreadMutation] Error:', error)
      
      // Check if it's a rate limit error (429)
      const errorMessage = error?.message || error?.data?.message || 'Failed to post thread'
      
      if (errorMessage.includes('429') || errorMessage.toLowerCase().includes('rate limit')) {
        toast.error('Rate limit reached. You\'ve posted too much content today. Please try again later.')
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
      // Clear the thread content only after successful scheduling
      setThreadTweets([{ id: crypto.randomUUID(), content: '', media: [] }])
      // Stay on current page instead of redirecting
      toast.success(
        <div className="flex items-center gap-2">
          <p>Thread scheduled!</p>
          <Link
            href="/studio/scheduled"
            className="text-base text-primary-600 decoration-2 underline-offset-2 flex items-center gap-1 underline shrink-0 bg-white/10 hover:bg-white/20 rounded py-0.5 transition-colors"
          >
            View here
          </Link>
        </div>
      )
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
      // Success handling is done in handleQueueThread to avoid duplicate toasts
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
      // Invalidate thread cache to ensure fresh data on next edit
      queryClient.invalidateQueries({ queryKey: ['thread'] })
      
      toast.success(
        <div className="flex items-center gap-2">
          <p>Thread updated!</p>
          <Link
            href="/studio/scheduled"
            className="text-base text-primary-600 decoration-2 underline-offset-2 flex items-center gap-1 underline shrink-0 bg-white/10 hover:bg-white/20 rounded py-0.5 transition-colors"
          >
            View here
          </Link>
        </div>
      )
      // Stay on current page instead of redirecting
    },
  })



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
    const validation = validateThreadTweets(threadTweets, characterLimit)
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
      
      // Clear content immediately after successful post
      setHasBeenCleared(true)
      setThreadTweets([{ id: crypto.randomUUID(), content: '', media: [] }])
      
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
    const validation = validateThreadTweets(threadTweets, characterLimit)
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
      await scheduleThreadMutation.mutateAsync({
        threadId,
        scheduledUnix: Math.floor(scheduledDate.getTime() / 1000),
      })
      
      posthog.capture('thread_scheduled', {
        tweet_count: threadTweets.length,
        thread_id: threadId,
        scheduled_for: scheduledDate.toISOString(),
      })
      
      // Display a user-localized friendly time using the user's timezone
      const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone
      const friendly = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: userTz,
      }).format(scheduledDate)
      toast.success(`Thread scheduled for ${friendly}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to schedule thread')
    }
  }

  const handleQueueThread = async () => {
    // Validate tweets
    const validation = validateThreadTweets(threadTweets, characterLimit)
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
      
      // Clear content immediately after successful queue
      setHasBeenCleared(true)
      setThreadTweets([{ id: crypto.randomUUID(), content: '', media: [] }])
      
      posthog.capture('thread_queued', {
        thread_id: threadId,
        tweet_count: threadTweets.length,
      })
      
      toast.success(
        <div className="flex items-center gap-2">
          <p>Thread queued!</p>
          <Link
            href="/studio/scheduled"
            className="text-base text-primary-600 decoration-2 underline-offset-2 flex items-center gap-1 underline shrink-0 bg-white/10 hover:bg-white/20 rounded py-0.5 transition-colors"
          >
            View here
          </Link>
        </div>
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to queue thread')
    }
  }

  const handleUpdateThread = async () => {

    
    // Validate all tweets have content
    const emptyTweets = threadTweets.filter(t => !t.content.trim())
    if (emptyTweets.length > 0) {
      toast.error('All posts in the thread must have content')
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
    // Reset to create mode by clearing edit params from URL
    const url = new URL(window.location.href)
    url.searchParams.delete('edit')
    url.searchParams.delete('tweetId')
    window.history.pushState({}, '', url.toString())
    
    // Reset the component state
    setThreadTweets([{ id: crypto.randomUUID(), content: '', media: [] }])
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
          <div key={tweet.id} className="relative" data-tweet-id={tweet.id}>
            {/* Connecting line between tweets */}
            {index < threadTweets.length - 1 && (
              <div
                className="absolute left-[30px] top-[72px] bottom-[-16px] w-[2px] bg-neutral-300 z-0"
              />
            )}
            
            <ThreadTweet
              key={tweet.id}
              ref={(el) => {
                if (el) {
                  tweetRefs.current[tweet.id] = el
                }
              }}
              isThread={threadTweets.length > 1}
              isFirstTweet={index === 0}
              isLastTweet={index === threadTweets.length - 1}
              canDelete={index > 0}
              editMode={editMode}
              hasBeenCleared={index === 0 ? hasBeenCleared : false}
              onClearComplete={index === 0 ? () => setHasBeenCleared(false) : undefined}
              onRemove={() => handleRemoveTweet(tweet.id)}

              onPostThread={!editMode ? handlePostThread : undefined}
              onQueueThread={!editMode ? handleQueueThread : undefined}
              onScheduleThread={!editMode ? handleScheduleThread : undefined}
              onUpdateThread={editMode ? handleUpdateThread : undefined}
              onCancelEdit={editMode ? handleCancelEdit : undefined}
              isPosting={isPosting}
              onUpdate={(content, media) => handleTweetUpdate(tweet.id, content, media)}
              initialContent={tweet.content}
              initialMedia={tweet.media?.map((m: any) => ({
                // Ensure a valid preview URL is always present. If the API didn't
                // enrich media with a URL, derive it from the S3 key using the
                // public bucket name so image/video previews render instead of alt text.
                url:
                  m.url ??
                  (process.env.NEXT_PUBLIC_S3_BUCKET_NAME && m.s3Key
                    ? `https://${process.env.NEXT_PUBLIC_S3_BUCKET_NAME}.s3.amazonaws.com/${m.s3Key}`
                    : ''),
                s3Key: m.s3Key,
                media_id: m.media_id,
                type: m.type || 'image'
              })) || []}
              showFocusTooltip={index === 0}
              focusShortcut={`${metaKey} + Shift + F`}
            />
          </div>
        ))}
        
        {/* Add tweet button - visible by default when there's exactly one tweet */}
        {threadTweets.length === 1 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleAddTweet}
                  className="w-full p-3 border-2 border-dashed border-neutral-300 hover:border-neutral-400 rounded-lg flex items-center justify-center gap-2 text-neutral-500 hover:text-neutral-700 transition-colors"
                >
                  <span className="text-sm font-medium">Add another post to this thread</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <div className="space-y-1">
                  <p>Add new tweet to thread</p>
                  <p className="text-xs text-neutral-400">{metaKey} + Shift + Enter</p>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        
        {/* Always show add button when multiple tweets */}
        {threadTweets.length > 1 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleAddTweet}
                  className="w-full p-3 border-2 border-dashed border-neutral-300 hover:border-neutral-400 rounded-lg flex items-center justify-center gap-2 text-neutral-500 hover:text-neutral-700 transition-colors"
                >
                  <span className="text-sm font-medium">Add another post to this thread</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <div className="space-y-1">
                  <p>Add new tweet to thread</p>
                  <p className="text-xs text-neutral-400">{metaKey} + Shift + Enter</p>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
    </div>
  )
}