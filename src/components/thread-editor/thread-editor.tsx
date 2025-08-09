'use client'

import { cn } from '@/lib/utils'
import { $createParagraphNode, $getRoot } from 'lexical'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { nanoid } from 'nanoid'
import { useState, useCallback } from 'react'
import { Button } from '../ui/button'
import { Plus, Trash2, Clock } from 'lucide-react'
import TweetInThread from './tweet-in-thread'
import { toast } from 'react-hot-toast'
import { useMutation } from '@tanstack/react-query'
import { client } from '@/lib/client'
import { useRouter } from 'next/navigation'
import DuolingoButton from '../ui/duolingo-button'
import { createEditor, EditorState } from 'lexical'
import { MediaFile } from '@/hooks/use-tweets'

interface ThreadTweet {
  id: string
  content: string
  media: MediaFile[]
  delayMs: number
  editor: any // Lexical editor instance
}

interface ThreadEditorProps {
  className?: string
}

// Lexical config
const initialConfig = {
  namespace: 'TweetEditor',
  theme: {
    text: {
      bold: 'text-bold',
      italic: 'text-italic',
      underline: 'text-underline',
    },
  },
  onError: (error: Error) => {
    console.error('Lexical error:', error)
  },
}

export default function ThreadEditor({ className }: ThreadEditorProps) {
  const router = useRouter()
  const [tweets, setTweets] = useState<ThreadTweet[]>([
    {
      id: nanoid(),
      content: '',
      media: [],
      delayMs: 0,
      editor: createEditor({ ...initialConfig }),
    },
    {
      id: nanoid(),
      content: '',
      media: [],
      delayMs: 5000, // 5 seconds default
      editor: createEditor({ ...initialConfig }),
    },
  ])

  // Add a new tweet to the thread
  const addTweet = useCallback(() => {
    console.log('📝 [ThreadEditor] Adding new tweet to thread')
    const newTweet: ThreadTweet = {
      id: nanoid(),
      content: '',
      media: [],
      delayMs: 5000, // 5 seconds default
      editor: createEditor({ ...initialConfig }),
    }
    setTweets((prev) => [...prev, newTweet])
  }, [])

  // Remove a tweet from the thread
  const removeTweet = useCallback(
    (id: string) => {
      console.log(`🗑️ [ThreadEditor] Removing tweet ${id}`)
      if (tweets.length <= 2) {
        toast.error('A thread must have at least 2 tweets')
        return
      }
      setTweets((prev) => prev.filter((tweet) => tweet.id !== id))
    },
    [tweets.length],
  )

  // Update tweet content
  const updateTweetContent = useCallback((id: string, content: string) => {
    console.log(`✏️ [ThreadEditor] Updating content for tweet ${id}`)
    setTweets((prev) =>
      prev.map((tweet) => (tweet.id === id ? { ...tweet, content } : tweet)),
    )
  }, [])

  // Update tweet media
  const updateTweetMedia = useCallback((id: string, media: MediaFile[]) => {
    console.log(`🖼️ [ThreadEditor] Updating media for tweet ${id}`)
    setTweets((prev) =>
      prev.map((tweet) => (tweet.id === id ? { ...tweet, media } : tweet)),
    )
  }, [])

  // Update tweet delay
  const updateTweetDelay = useCallback((id: string, delayMs: number) => {
    console.log(`⏰ [ThreadEditor] Updating delay for tweet ${id}: ${delayMs}ms`)
    setTweets((prev) =>
      prev.map((tweet) => (tweet.id === id ? { ...tweet, delayMs } : tweet)),
    )
  }, [])

  // Create thread mutation
  const createThreadMutation = useMutation({
    mutationFn: async () => {
      console.log('🚀 [ThreadEditor] Creating thread')
      
      // Validate tweets
      const validTweets = tweets.filter((tweet) => {
        const content = tweet.editor.read(() => $getRoot().getTextContent())
        return content.trim().length > 0 || tweet.media.length > 0
      })

      if (validTweets.length < 2) {
        throw new Error('A thread must have at least 2 non-empty tweets')
      }

      // Prepare thread data
      const threadData = validTweets.map((tweet) => ({
        content: tweet.editor.read(() => $getRoot().getTextContent()),
        media: tweet.media
          .filter((m) => m.s3Key && m.media_id)
          .map((m) => ({
            s3Key: m.s3Key!,
            media_id: m.media_id!,
          })),
        delayMs: tweet.delayMs,
      }))

      const res = await client.thread.createThread.$post({
        tweets: threadData,
      })

      return await res.json()
    },
    onSuccess: (data) => {
      console.log('✅ [ThreadEditor] Thread created successfully:', data)
      toast.success('Thread created successfully!')
      router.push('/studio/scheduled')
    },
    onError: (error) => {
      console.error('❌ [ThreadEditor] Failed to create thread:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to create thread')
    },
  })

  // Post thread now mutation
  const postNowMutation = useMutation({
    mutationFn: async () => {
      console.log('🚀 [ThreadEditor] Posting thread immediately')
      
      // First create the thread
      const createRes = await createThreadMutation.mutateAsync()
      
      // Then post it immediately
      const postRes = await client.thread.postThreadNow.$post({
        threadId: createRes.threadId,
      })

      return await postRes.json()
    },
    onSuccess: (data) => {
      console.log('✅ [ThreadEditor] Thread posted successfully:', data)
      toast.success(
        <div className="flex items-center gap-2">
          <p>Thread posted!</p>
          <a
            target="_blank"
            rel="noreferrer"
            href={data.threadUrl}
            className="text-base text-indigo-600 decoration-2 underline-offset-2 flex items-center gap-1 underline shrink-0 bg-white/10 hover:bg-white/20 rounded py-0.5 transition-colors"
          >
            View thread
          </a>
        </div>,
      )
      router.push('/studio/posted')
    },
    onError: (error) => {
      console.error('❌ [ThreadEditor] Failed to post thread:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to post thread')
    },
  })

  const handlePostNow = () => {
    postNowMutation.mutate()
  }

  const handleSchedule = () => {
    // This will be implemented later with a scheduling modal
    toast('Thread scheduling coming soon!', { icon: '🔜' })
  }

  const handleAddToQueue = () => {
    createThreadMutation.mutate()
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Create Thread</h2>
        <Button
          onClick={addTweet}
          className="flex items-center gap-2"
          variant="ghost"
        >
          <Plus className="w-4 h-4" />
          Add Tweet
        </Button>
      </div>

      <div className="space-y-0">
        {tweets.map((tweet, index) => (
          <div key={tweet.id} className="relative">
            {/* Vertical connecting line */}
            {index < tweets.length - 1 && (
              <div
                className="absolute left-[43px] top-[72px] bottom-[-8px] w-[2px] bg-stone-300 z-0"
                aria-hidden="true"
              />
            )}

            <div className="relative z-10 bg-white">
              <LexicalComposer initialConfig={initialConfig}>
                <TweetInThread
                  isFirst={index === 0}
                  position={index}
                  editor={tweet.editor}
                  media={tweet.media}
                  delayMs={tweet.delayMs}
                  onContentChange={(content) => updateTweetContent(tweet.id, content)}
                  onMediaChange={(media) => updateTweetMedia(tweet.id, media)}
                  onDelayChange={(delay) => updateTweetDelay(tweet.id, delay)}
                  onRemove={tweets.length > 2 ? () => removeTweet(tweet.id) : undefined}
                />
              </LexicalComposer>
            </div>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-end gap-2 pt-6">
        <DuolingoButton
          onClick={handlePostNow}
          disabled={createThreadMutation.isPending || postNowMutation.isPending}
        >
          Post Now
        </DuolingoButton>
        
        <div className="flex">
          <DuolingoButton
            onClick={handleAddToQueue}
            disabled={createThreadMutation.isPending || postNowMutation.isPending}
            className="rounded-r-none border-r-0"
            variant="primary"
          >
            <Clock className="w-4 h-4 mr-2" />
            Add to Queue
          </DuolingoButton>
          <DuolingoButton
            onClick={handleSchedule}
            disabled={createThreadMutation.isPending || postNowMutation.isPending}
            className="rounded-l-none px-3"
            variant="primary"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-chevron-down size-4"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6"></path>
            </svg>
          </DuolingoButton>
        </div>
      </div>
    </div>
  )
}
