'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { AccountAvatar, AccountHandle, AccountName, useAccount } from '@/hooks/account-ctx'
import { client } from '@/lib/client'
import { useMutation } from '@tanstack/react-query'
import { HTTPException } from 'hono/http-exception'
import { toast } from 'react-hot-toast'
import { useRouter } from 'next/navigation'
import posthog from 'posthog-js'
import {
  ImagePlus,
  Trash2,
  Plus,
  X,
  Upload,
  Loader2,
  Check,
} from 'lucide-react'
import DuolingoButton from '../ui/duolingo-button'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import { Calendar20 as DatePicker } from './date-picker'
import TweetEditor from './tweet-editor'
import { useConfetti } from '@/hooks/use-confetti'

interface ThreadTweet {
  id: string
  content: string
  media: File[]
}

interface ThreadTweetEditorProps {
  className?: string
  editMode?: boolean
  editTweetId?: string | null
}

// Character counter component with circular progress
function CharacterCounter({ length, maxLength = 280 }: { length: number; maxLength?: number }) {
  const percentage = (length / maxLength) * 100
  const isWarning = length >= 260 && length < 280
  const isError = length >= 280

  return (
    <div className="relative w-8 h-8">
      <svg className="w-8 h-8 transform -rotate-90">
        <circle
          cx="16"
          cy="16"
          r="14"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          className="text-stone-200"
        />
        <circle
          cx="16"
          cy="16"
          r="14"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          strokeDasharray={`${2 * Math.PI * 14}`}
          strokeDashoffset={`${2 * Math.PI * 14 * (1 - percentage / 100)}`}
          className={cn(
            "transition-all duration-200",
            isError ? "text-red-500" : isWarning ? "text-yellow-500" : "text-blue-500"
          )}
        />
      </svg>
      {length > 260 && (
        <span className={cn(
          "absolute inset-0 flex items-center justify-center text-xs font-medium",
          isError ? "text-red-500" : "text-yellow-500"
        )}>
          {280 - length}
        </span>
      )}
    </div>
  )
}

export default function ThreadTweetEditor({
  className,
  editMode = false,
  editTweetId,
}: ThreadTweetEditorProps) {
  const [isThreadMode, setIsThreadMode] = useState(false)
  const [threadTweets, setThreadTweets] = useState<ThreadTweet[]>([
    { id: crypto.randomUUID(), content: '', media: [] },
    { id: crypto.randomUUID(), content: '', media: [] },
  ])
  const [isPosting, setIsPosting] = useState(false)
  const [showSchedulePopover, setShowSchedulePopover] = useState(false)
  const [copiedButtonId, setCopiedButtonId] = useState<string | null>(null)
  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({})
  const router = useRouter()
  const { fire } = useConfetti()
  const { account } = useAccount()

  console.log('[ThreadTweetEditor] Render - isThreadMode:', isThreadMode, 'tweets:', threadTweets.length)

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
    onSuccess: (data) => {
      console.log('[ThreadTweetEditor] Thread created successfully:', data)
      return data
    },
    onError: (error) => {
      console.error('[ThreadTweetEditor] Error creating thread:', error)
      toast.error(error.message || 'Failed to create thread')
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
      setThreadTweets([
        { id: crypto.randomUUID(), content: '', media: [] },
        { id: crypto.randomUUID(), content: '', media: [] },
      ])
      
      if (data.threadUrl) {
        window.open(data.threadUrl, '_blank')
      }
    },
    onError: (error) => {
      console.error('[ThreadTweetEditor] Error posting thread:', error)
      toast.error(error.message || 'Failed to post thread')
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
      setThreadTweets([
        { id: crypto.randomUUID(), content: '', media: [] },
        { id: crypto.randomUUID(), content: '', media: [] },
      ])
      
      router.push('/studio/scheduled')
    },
    onError: (error) => {
      console.error('[ThreadTweetEditor] Error scheduling thread:', error)
      toast.error(error.message || 'Failed to schedule thread')
    },
  })

  const handleToggleMode = () => {
    console.log('[ThreadTweetEditor] Toggling mode from:', isThreadMode, 'to:', !isThreadMode)
    setIsThreadMode(!isThreadMode)
    if (!isThreadMode) {
      // Entering thread mode - ensure we have at least 2 tweets
      if (threadTweets.length < 2) {
        setThreadTweets([
          { id: crypto.randomUUID(), content: '', media: [] },
          { id: crypto.randomUUID(), content: '', media: [] },
        ])
      }
    }
  }

  const handleAddTweet = () => {
    console.log('[ThreadTweetEditor] Adding new tweet to thread')
    setThreadTweets([...threadTweets, { id: crypto.randomUUID(), content: '', media: [] }])
  }

  const handleRemoveTweet = (id: string) => {
    console.log('[ThreadTweetEditor] Removing tweet:', id)
    setThreadTweets(threadTweets.filter(tweet => tweet.id !== id))
  }

  const handleTweetChange = (id: string, content: string) => {
    console.log('[ThreadTweetEditor] Tweet content changed:', id, 'length:', content.length)
    setThreadTweets(threadTweets.map(tweet =>
      tweet.id === id ? { ...tweet, content } : tweet
    ))
  }

  const handleMediaUpload = async (id: string, files: FileList) => {
    console.log('[ThreadTweetEditor] Media upload for tweet:', id, 'files:', files.length)
    const tweet = threadTweets.find(t => t.id === id)
    if (!tweet) return

    const newMedia = Array.from(files)
    setThreadTweets(threadTweets.map(t =>
      t.id === id ? { ...t, media: [...t.media, ...newMedia] } : t
    ))
  }

  const handleRemoveMedia = (tweetId: string, mediaIndex: number) => {
    console.log('[ThreadTweetEditor] Removing media:', tweetId, 'index:', mediaIndex)
    setThreadTweets(threadTweets.map(tweet =>
      tweet.id === tweetId
        ? { ...tweet, media: tweet.media.filter((_, i) => i !== mediaIndex) }
        : tweet
    ))
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

    setIsPosting(true)
    posthog.capture('thread_post_started', { tweet_count: threadTweets.length })

    try {
      // Create thread first
      const createResult = await createThreadMutation.mutateAsync(
        threadTweets.map((tweet, index) => ({
          content: tweet.content,
          media: [], // TODO: Implement media upload
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
    } finally {
      setIsPosting(false)
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

    setIsPosting(true)
    posthog.capture('thread_schedule_started', { tweet_count: threadTweets.length })

    try {
      // Create thread first
      const createResult = await createThreadMutation.mutateAsync(
        threadTweets.map((tweet, index) => ({
          content: tweet.content,
          media: [], // TODO: Implement media upload
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
    } finally {
      setIsPosting(false)
      setShowSchedulePopover(false)
    }
  }

  const handleCopyText = (tweetId: string, text: string) => {
    console.log('[ThreadTweetEditor] Copying text for tweet:', tweetId)
    navigator.clipboard.writeText(text)
    setCopiedButtonId(tweetId)
    toast.success('Copied to clipboard')
    
    setTimeout(() => {
      setCopiedButtonId(null)
    }, 1500)
  }

  // If not in thread mode, render the regular TweetEditor
  if (!isThreadMode) {
    return (
      <div className={cn('relative z-10 w-full rounded-lg font-sans', className)}>
        <TweetEditor editMode={editMode} editTweetId={editTweetId} />
        <div className="mt-4 text-center">
          <button
            onClick={handleToggleMode}
            className="text-sm text-blue-500 hover:text-blue-600 hover:underline transition-colors"
          >
            Create a thread instead
          </button>
        </div>
      </div>
    )
  }

  // Thread mode UI
  return (
    <div className={cn('relative z-10 w-full rounded-lg font-sans', className)}>
      <div className="space-y-4 w-full">
        {threadTweets.map((tweet, index) => (
          <div key={tweet.id} className="relative">
            {/* Connecting line between tweets */}
            {index < threadTweets.length - 1 && (
              <div
                className="absolute left-[30px] top-[60px] bottom-[-16px] w-[2px] bg-stone-300 z-0"
              />
            )}

            {/* Tweet card */}
            <div className="relative bg-white rounded-lg border border-stone-200 shadow-sm z-10">
              <div className="p-4">
                {/* Account info */}
                <div className="flex items-start gap-3">
                  <AccountAvatar className="flex-shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center gap-1 text-sm">
                      <AccountName className="font-semibold text-stone-900" />
                      <AccountHandle className="text-stone-500" />
                    </div>

                    {/* Textarea */}
                    <textarea
                      value={tweet.content}
                      onChange={(e) => handleTweetChange(tweet.id, e.target.value)}
                      placeholder={index === 0 ? "What's happening?" : "Add another tweet..."}
                      className="w-full mt-2 p-0 text-sm text-stone-900 placeholder-stone-500 border-none outline-none resize-none min-h-[80px]"
                      style={{ fontFamily: 'inherit' }}
                    />

                    {/* Media preview */}
                    {tweet.media.length > 0 && (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {tweet.media.map((file, mediaIndex) => (
                          <div key={mediaIndex} className="relative group">
                            <img
                              src={URL.createObjectURL(file)}
                              alt=""
                              className="w-full h-32 object-cover rounded-lg"
                            />
                            <button
                              onClick={() => handleRemoveMedia(tweet.id, mediaIndex)}
                              className="absolute top-1 right-1 p-1 bg-black bg-opacity-50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="w-4 h-4 text-white" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {/* Copy button */}
                        <button
                          onClick={() => handleCopyText(tweet.id, tweet.content)}
                          className="p-2 text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-all"
                          title="Copy text"
                        >
                          {copiedButtonId === tweet.id ? (
                            <Check className="w-4 h-4 text-green-500" />
                          ) : (
                            <Upload className="w-4 h-4" />
                          )}
                        </button>

                        {/* Media upload */}
                        <input
                          ref={(el) => {
                            if (el) fileInputRefs.current[tweet.id] = el
                          }}
                          type="file"
                          accept="image/*,video/*"
                          multiple
                          className="hidden"
                          onChange={(e) => e.target.files && handleMediaUpload(tweet.id, e.target.files)}
                        />
                        <button
                          onClick={() => fileInputRefs.current[tweet.id]?.click()}
                          className="p-2 text-stone-500 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-all"
                          title="Add media"
                        >
                          <ImagePlus className="w-4 h-4" />
                        </button>

                        {/* Delete tweet (not for first tweet) */}
                        {index > 0 && (
                          <button
                            onClick={() => handleRemoveTweet(tweet.id)}
                            className="p-2 text-stone-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                            title="Remove tweet"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      {/* Character counter */}
                      <CharacterCounter length={tweet.content.length} />
                    </div>

                    {/* Post/Schedule buttons (only on first tweet) */}
                    {index === 0 && (
                      <div className="mt-4 pt-4 border-t border-stone-200 flex items-center justify-between">
                        <div className="flex gap-2">
                          <DuolingoButton
                            onClick={handlePostThread}
                            disabled={isPosting || threadTweets.some(t => !t.content.trim())}
                            size="sm"
                          >
                            {isPosting ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Posting...
                              </>
                            ) : (
                              'Post Thread'
                            )}
                          </DuolingoButton>

                          <Popover open={showSchedulePopover} onOpenChange={setShowSchedulePopover}>
                            <PopoverTrigger asChild>
                              <DuolingoButton
                                variant="secondary"
                                size="sm"
                                disabled={isPosting || threadTweets.some(t => !t.content.trim())}
                              >
                                Queue
                              </DuolingoButton>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <DatePicker
                                onSchedule={(date: Date) => date && handleScheduleThread(date)}
                                disabled={isPosting}
                              />
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Add tweet button */}
        <button
          onClick={handleAddTweet}
          className="w-full p-3 border-2 border-dashed border-stone-300 hover:border-stone-400 rounded-lg flex items-center justify-center gap-2 text-stone-500 hover:text-stone-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span className="text-sm font-medium">Add to thread</span>
        </button>

        {/* Back to single tweet link */}
        <div className="text-center">
          <button
            onClick={handleToggleMode}
            className="text-sm text-blue-500 hover:text-blue-600 hover:underline transition-colors"
          >
            Back to single tweet
          </button>
        </div>
      </div>
    </div>
  )
}
