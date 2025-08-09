'use client'

import { cn } from '@/lib/utils'
import { HTMLAttributes, useState } from 'react'
import Tweet from './tweet'
import { initialConfig } from '@/hooks/use-tweets'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { Plus } from 'lucide-react'
import { nanoid } from 'nanoid'

interface TweetEditorProps extends HTMLAttributes<HTMLDivElement> {
  id?: string | undefined
  initialContent?: string
  editMode?: boolean
  editTweetId?: string | null
}

interface ThreadTweet {
  id: string
  isFirst?: boolean
}

export default function ThreadTweetEditor({
  id,
  initialContent,
  className,
  editMode = false,
  editTweetId,
  ...rest
}: TweetEditorProps) {
  const [tweets, setTweets] = useState<ThreadTweet[]>([
    {
      id: nanoid(),
      isFirst: true
    }
  ])

  const addTweet = () => {
    setTweets([...tweets, {
      id: nanoid(),
      isFirst: false
    }])
  }

  const removeTweet = (index: number) => {
    if (tweets.length > 1) {
      const newTweets = tweets.filter((_, i) => i !== index)
      // Update isFirst flag if needed
      if (index === 0 && newTweets.length > 0 && newTweets[0]) {
        newTweets[0] = { ...newTweets[0], isFirst: true }
      }
      setTweets(newTweets)
    }
  }

  // Only show as single tweet when there's one tweet
  const isThreadMode = tweets.length > 1

  return (
    <div className={cn('relative z-10 w-full rounded-lg font-sans max-w-2xl mx-auto', className)} {...rest}>
      <div className="space-y-0 w-full">
        {tweets.map((tweet, index) => (
          <div key={tweet.id} className="relative">
            {/* Visual connection line between tweets */}
            {index > 0 && (
              <div 
                className="absolute left-[48px] -top-4 h-4 w-[2px] bg-stone-300 z-0" 
                aria-hidden="true"
              />
            )}
            
            {/* Tweet wrapper with proper spacing */}
            <div className={cn(
              "relative z-10 bg-white",
              index > 0 && "mt-0"
            )}>
              <LexicalComposer key={tweet.id} initialConfig={{ ...initialConfig }}>
                <Tweet 
                  editMode={editMode && index === 0} 
                  editTweetId={editMode && index === 0 ? editTweetId : null}
                />
              </LexicalComposer>
            </div>

            {/* Add tweet button appears below the last tweet */}
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
