'use client'

import { cn } from '@/lib/utils'
import { HTMLAttributes, useState, useRef } from 'react'
import TweetEditor from './tweet-editor'
import { Plus, X, ImagePlus, Upload, Trash2 } from 'lucide-react'
import { AccountAvatar, AccountHandle, AccountName } from '@/hooks/account-ctx'
import { client } from '@/lib/client'
import { toast } from 'react-hot-toast'
import { useMutation } from '@tanstack/react-query'
import DuolingoButton from '@/components/ui/duolingo-button'

interface TweetEditorProps extends HTMLAttributes<HTMLDivElement> {
  id?: string | undefined
  initialContent?: string
  editMode?: boolean
  editTweetId?: string | null
}

interface ThreadTweet {
  id: string
  content: string
  media: File[]
}

export default function ThreadTweetEditor({
  id,
  initialContent,
  className,
  editMode = false,
  editTweetId,
  ...rest
}: TweetEditorProps) {
  const [showThread, setShowThread] = useState(false)
  const [tweets, setTweets] = useState<ThreadTweet[]>([
    { id: crypto.randomUUID(), content: '', media: [] },
    { id: crypto.randomUUID(), content: '', media: [] }
  ])

  const postThreadMutation = useMutation({
    mutationFn: async () => {
      // TODO: Upload media and create thread
      const tweetsData = tweets.map(t => ({
        content: t.content,
        media: [], // TODO: Handle media upload
        delayMs: 0
      }))
      
      const res = await client.thread.createThread.$post({ tweets: tweetsData })
      const data = await res.json()
      
      if (data.success) {
        const postRes = await client.thread.postThreadNow.$post({ threadId: data.threadId })
        return await postRes.json()
      }
      
      throw new Error('Failed to create thread')
    },
    onSuccess: () => {
      toast.success('Thread posted successfully!')
      setTweets([
        { id: crypto.randomUUID(), content: '', media: [] },
        { id: crypto.randomUUID(), content: '', media: [] }
      ])
      setShowThread(false)
    },
    onError: () => {
      toast.error('Failed to post thread')
    }
  })

  const addTweet = () => {
    setTweets([...tweets, { id: crypto.randomUUID(), content: '', media: [] }])
  }

  const removeTweet = (index: number) => {
    if (tweets.length > 2) {
      setTweets(tweets.filter((_, i) => i !== index))
    }
  }

  const updateTweetContent = (index: number, content: string) => {
    const newTweets = [...tweets]
    if (newTweets[index]) {
      newTweets[index] = { ...newTweets[index], content }
    }
    setTweets(newTweets)
  }

  if (!showThread) {
    return (
      <div className={cn('relative z-10 w-full rounded-lg font-sans', className)} {...rest}>
        <TweetEditor editMode={editMode} editTweetId={editTweetId} />
        <div className="mt-4 flex items-center justify-center">
          <button
            onClick={() => setShowThread(true)}
            className="text-indigo-600 hover:text-indigo-700 text-sm font-medium flex items-center gap-1"
          >
            <Plus className="size-4" />
            Create a thread instead
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('relative z-10 w-full rounded-lg font-sans max-w-2xl mx-auto', className)} {...rest}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Create Thread</h3>
        <button
          onClick={() => setShowThread(false)}
          className="text-stone-500 hover:text-stone-700"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="space-y-4">
        {tweets.map((tweet, index) => (
          <div key={tweet.id} className="relative">
            {/* Connection line */}
            {index > 0 && (
              <div className="absolute left-6 -top-4 h-4 w-0.5 bg-stone-300" />
            )}
            
            {/* Tweet card */}
            <div className="relative bg-white p-4 rounded-xl border border-stone-200 shadow-sm">
              <div className="flex gap-3">
                <AccountAvatar className="size-10 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 mb-2">
                    <AccountName className="font-semibold text-sm" />
                    <AccountHandle className="text-stone-500 text-sm" />
                    {tweets.length > 2 && (
                      <button
                        onClick={() => removeTweet(index)}
                        className="ml-auto p-1 hover:bg-stone-100 rounded-full"
                      >
                        <X className="size-4 text-stone-500" />
                      </button>
                    )}
                  </div>
                  
                  <textarea
                    value={tweet.content}
                    onChange={(e) => updateTweetContent(index, e.target.value)}
                    placeholder={index === 0 ? "What's happening?" : "Add another tweet..."}
                    className="w-full min-h-[80px] resize-none border-none outline-none placeholder:text-stone-400 text-sm"
                    maxLength={280}
                  />

                  <div className="mt-2 flex items-center justify-between text-xs">
                    <div className="flex gap-2">
                      <button className="text-stone-500 hover:text-stone-700">
                        <ImagePlus className="size-4" />
                      </button>
                    </div>
                    <span className={cn(
                      "text-stone-500",
                      tweet.content.length > 260 && "text-yellow-600",
                      tweet.content.length > 280 && "text-red-600"
                    )}>
                      {tweet.content.length}/280
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Add button after last tweet */}
            {index === tweets.length - 1 && (
              <div className="relative mt-4">
                <div className="absolute left-6 top-0 h-8 w-0.5 bg-stone-300" />
                <div className="pl-12 pt-8">
                  <button
                    onClick={addTweet}
                    className="text-indigo-600 hover:text-indigo-700 text-sm font-medium flex items-center gap-1"
                  >
                    <Plus className="size-4" />
                    Add to thread
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 flex gap-3 justify-end">
        <DuolingoButton
          variant="secondary"
          onClick={() => setShowThread(false)}
        >
          Cancel
        </DuolingoButton>
        <DuolingoButton
          onClick={() => postThreadMutation.mutate()}
          disabled={!tweets.some(t => t.content.trim()) || postThreadMutation.isPending}
        >
          {postThreadMutation.isPending ? 'Posting...' : 'Post Thread'}
        </DuolingoButton>
      </div>
    </div>
  )
}
