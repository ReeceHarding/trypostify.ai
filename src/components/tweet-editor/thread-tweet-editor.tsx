'use client'

import { cn } from '@/lib/utils'
import { HTMLAttributes, useState } from 'react'
import TweetEditor from './tweet-editor'
import { Plus, ImagePlus, Upload, Trash2 } from 'lucide-react'
import { AccountAvatar, AccountHandle, AccountName } from '@/hooks/account-ctx'
import { client } from '@/lib/client'
import { toast } from 'react-hot-toast'
import { useMutation } from '@tanstack/react-query'
import DuolingoButton from '@/components/ui/duolingo-button'
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

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

// Character counter component that matches the Tweet UI
function CharacterCounter({ count }: { count: number }) {
  const percentage = (count / 280) * 100
  const strokeDasharray = 62.83185307179586
  const strokeDashoffset = strokeDasharray - (strokeDasharray * Math.min(percentage, 100)) / 100
  
  return (
    <div className="relative flex items-center justify-center">
      <div className="h-8 w-8">
        <svg className="-ml-[5px] -rotate-90 w-full h-full">
          <circle
            className="text-stone-200"
            strokeWidth="2"
            stroke="currentColor"
            fill="transparent"
            r="10"
            cx="16"
            cy="16"
          />
          <circle
            className={cn(
              "transition-all duration-200",
              count > 280 ? "text-red-500" : count > 260 ? "text-yellow-500" : "text-blue-500"
            )}
            strokeWidth="2"
            strokeDasharray={strokeDasharray}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            stroke="currentColor"
            fill="transparent"
            r="10"
            cx="16"
            cy="16"
          />
        </svg>
      </div>
    </div>
  )
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
      const tweetsData = tweets.map(t => ({
        content: t.content,
        media: [],
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
      <>
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
      </>
    )
  }

  // Thread mode - just show multiple tweet cards
  return (
    <div className="space-y-0 w-full">
      {tweets.map((tweet, index) => (
        <div key={tweet.id} className="relative">
          {/* Connection line between tweets */}
          {index > 0 && (
            <div className="absolute left-[30px] -top-6 h-6 w-[2px] bg-stone-300 z-0" />
          )}
          
          {/* Tweet card - exactly matching the single tweet UI */}
          <div className="relative bg-white p-6 rounded-2xl w-full border border-opacity-[0.01] bg-clip-padding group isolate shadow-[0_1px_1px_rgba(0,0,0,0.05),0_4px_6px_rgba(34,42,53,0.04),0_24px_68px_rgba(47,48,55,0.05),0_2px_3px_rgba(0,0,0,0.04)] transition-colors">
            <div className="flex gap-3 relative z-10">
              <AccountAvatar className="size-12" />
              <div className="flex-1">
                <div className="flex items-center gap-1">
                  <AccountName className="font-semibold inline-flex items-center gap-1" />
                  <AccountHandle className="text-stone-400" />
                </div>
                <div className="text-stone-800 leading-relaxed">
                  <textarea
                    value={tweet.content}
                    onChange={(e) => updateTweetContent(index, e.target.value)}
                    placeholder={index === 0 ? "What's happening?" : "Add another tweet..."}
                    className="w-full !min-h-16 resize-none text-base/7 leading-relaxed text-stone-800 border-none p-0 focus-visible:ring-0 focus-visible:ring-offset-0 outline-none"
                    style={{ userSelect: 'text', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                  />
                </div>
                <div className="mt-3 pt-3 border-t border-stone-200 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 bg-stone-100 p-1.5 rounded-lg">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button className="font-semibold relative transition-transform active:translate-y-0.5 active:shadow-none focus:outline-none flex items-center justify-center bg-[#FFFFFF] border bg-clip-padding text-stone-800 border-b-2 border-[#E5E5E5] hover:bg-light-gray shadow-[0_3px_0_#E5E5E5] focus:ring-[#E5E5E5] h-10 w-10 rounded-md" type="button">
                            <Upload className="size-4" />
                            <span className="sr-only">Upload files</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Upload files</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button className="font-semibold relative transition-transform active:translate-y-0.5 active:shadow-none focus:outline-none flex items-center justify-center bg-[#FFFFFF] border bg-clip-padding text-stone-800 border-b-2 border-[#E5E5E5] hover:bg-light-gray shadow-[0_3px_0_#E5E5E5] focus:ring-[#E5E5E5] h-10 w-10 rounded-md">
                            <ImagePlus className="size-4" />
                            <span className="sr-only">Screenshot editor</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Screenshot editor</TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button 
                            className="font-semibold relative transition-transform active:translate-y-0.5 active:shadow-none focus:outline-none flex items-center justify-center bg-[#FFFFFF] border bg-clip-padding text-stone-800 border-b-2 border-[#E5E5E5] hover:bg-light-gray shadow-[0_3px_0_#E5E5E5] focus:ring-[#E5E5E5] h-10 w-10 rounded-md"
                            onClick={() => index > 0 && removeTweet(index)}
                            disabled={index === 0}
                          >
                            <Trash2 className="size-4" />
                            <span className="sr-only">Clear tweet</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{index === 0 ? 'Cannot remove first tweet' : 'Remove tweet'}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <div className="w-px h-4 bg-stone-300 mx-2" />
                    <CharacterCounter count={tweet.content.length} />
                  </div>
                  
                  {/* Only show Post/Queue buttons on the first tweet */}
                  {index === 0 && (
                    <div className="flex items-center gap-2">
                      <DuolingoButton
                        onClick={() => postThreadMutation.mutate()}
                        disabled={!tweets.some(t => t.content.trim()) || postThreadMutation.isPending}
                      >
                        <span className="text-sm">
                          {postThreadMutation.isPending ? 'Posting...' : 'Post Thread'}
                        </span>
                      </DuolingoButton>
                      <div className="flex">
                        <DuolingoButton
                          variant="primary"
                          className="rounded-r-none border-r-0"
                          disabled
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-clock size-4 mr-2">
                            <path d="M12 6v6l4 2"></path>
                            <circle cx="12" cy="12" r="10"></circle>
                          </svg>
                          <span className="text-sm">Queue</span>
                        </DuolingoButton>
                        <button 
                          className="font-semibold rounded-lg relative transition-transform active:translate-y-0.5 active:shadow-none focus:outline-none flex items-center justify-center bg-indigo-600 text-white border bg-clip-padding border-b-2 border-indigo-700 hover:bg-indigo-500 shadow-[0_3px_0_#3730a3] focus:ring-indigo-600 h-11 w-14 rounded-l-none border-l"
                          disabled
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-chevron-down size-4">
                            <path d="m6 9 6 6 6-6"></path>
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Add button after last tweet */}
          {index === tweets.length - 1 && (
            <div className="relative">
              <div className="absolute left-[30px] top-0 h-12 w-[2px] bg-stone-300 z-0" />
              <div className="flex items-center pt-12 pl-14">
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
      
      {/* Back to single tweet link */}
      <div className="mt-6 flex items-center justify-center">
        <button
          onClick={() => setShowThread(false)}
          className="text-stone-500 hover:text-stone-700 text-sm"
        >
          Back to single tweet
        </button>
      </div>
    </div>
  )
}
