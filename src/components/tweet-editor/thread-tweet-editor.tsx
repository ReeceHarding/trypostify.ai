'use client'

import { cn } from '@/lib/utils'
import { HTMLAttributes, useState } from 'react'
import TweetEditor from './tweet-editor'
import ThreadTweet from './thread-tweet'
import { Plus } from 'lucide-react'
import { nanoid } from 'nanoid'

interface TweetEditorProps extends HTMLAttributes<HTMLDivElement> {
  id?: string | undefined
  initialContent?: string
  editMode?: boolean
  editTweetId?: string | null
}

interface TweetData {
  id: string
  content: string
}

export default function ThreadTweetEditor({
  id,
  initialContent,
  className,
  editMode = false,
  editTweetId,
  ...rest
}: TweetEditorProps) {
  const [isThreadMode, setIsThreadMode] = useState(false)
  const [tweets, setTweets] = useState<TweetData[]>([
    { id: nanoid(), content: '' },
    { id: nanoid(), content: '' }
  ])

  const addTweet = () => {
    setTweets([...tweets, { id: nanoid(), content: '' }])
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
      setTweets(newTweets)
    }
  }

  // When not in thread mode, just show the regular tweet editor
  if (!isThreadMode) {
    return (
      <div className={cn('relative z-10 w-full rounded-lg font-sans', className)} {...rest}>
        <div className="space-y-4 w-full">
          <TweetEditor editMode={editMode} editTweetId={editTweetId} />
          
          {/* Add to thread button */}
          <div className="flex items-center pl-9">
            <button
              onClick={() => setIsThreadMode(true)}
              className="font-semibold relative transition-transform active:translate-y-0.5 active:shadow-none focus:outline-none flex items-center justify-center bg-[#FFFFFF] border bg-clip-padding text-stone-800 border-b-2 border-[#E5E5E5] hover:bg-stone-100 shadow-[0_3px_0_#E5E5E5] focus:ring-[#E5E5E5] h-10 px-4 rounded-md gap-2"
            >
              <Plus className="size-4" />
              <span className="text-sm">Add to thread</span>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Thread mode - show multiple tweets
  return (
    <div className={cn('relative z-10 w-full rounded-lg font-sans max-w-2xl mx-auto', className)} {...rest}>
      <div className="space-y-0 w-full">
        {tweets.map((tweet, index) => (
          <div key={tweet.id} className="relative">
            {/* Visual connection line */}
            {index > 0 && (
              <div 
                className="absolute left-[48px] -top-6 h-6 w-[2px] bg-stone-300 z-0" 
                aria-hidden="true"
              />
            )}
            
            {/* Tweet */}
            <div className={cn(
              "relative z-10 bg-white",
              index > 0 && "pt-0"
            )}>
              <ThreadTweet
                isFirst={index === 0}
                placeholder={index === 0 ? "What's happening?" : "Add another tweet..."}
                onRemove={tweets.length > 2 ? () => removeTweet(index) : undefined}
                onChange={(content) => updateTweetContent(index, content)}
              />
            </div>

            {/* Add tweet button below the last tweet */}
            {index === tweets.length - 1 && (
              <div className="relative">
                <div 
                  className="absolute left-[48px] top-0 h-12 w-[2px] bg-stone-300 z-0" 
                  aria-hidden="true"
                />
                <div className="flex items-center pt-12 pl-9">
                  <button
                    onClick={addTweet}
                    className="font-semibold relative transition-transform active:translate-y-0.5 active:shadow-none focus:outline-none flex items-center justify-center bg-[#FFFFFF] border bg-clip-padding text-stone-800 border-b-2 border-[#E5E5E5] hover:bg-stone-100 shadow-[0_3px_0_#E5E5E5] focus:ring-[#E5E5E5] h-10 px-4 rounded-md gap-2"
                  >
                    <Plus className="size-4" />
                    <span className="text-sm">Add to thread</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
