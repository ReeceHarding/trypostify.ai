'use client'

import { client } from '@/lib/client'
import { cn } from '@/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, isThisWeek, isToday, isTomorrow } from 'date-fns'
import { Clock, Edit, MoreHorizontal, Send, Trash2, MessageSquare, Paperclip } from 'lucide-react'

import { useConfetti } from '@/hooks/use-confetti'
import { useTweets } from '@/hooks/use-tweets'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import posthog from 'posthog-js'
import React, { Fragment, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Icons } from './icons'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import DuolingoBadge from './ui/duolingo-badge'
import DuolingoButton from './ui/duolingo-button'
import DuolingoCheckbox from './ui/duolingo-checkbox'
import { Loader } from './ui/loader'
import { Separator } from './ui/separator'

export default function TweetQueue() {
  const queryClient = useQueryClient()
  const { fire } = useConfetti()
  const [pendingPostId, setPendingPostId] = useState<string | null>(null)

  const { shadowEditor, setMediaFiles } = useTweets()
  const router = useRouter()

  const userNow = new Date()
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  
  // Get chatId from URL params
  const searchParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
  const chatId = searchParams.get('chatId') || undefined

  const [skipPostConfirmation, setSkipPostConfirmation] = useState(false)
  const [didTogglePostConfirmation, setDidTogglePostConfirmation] = useState(false)

  useEffect(() => {
    setSkipPostConfirmation(localStorage.getItem('skipPostConfirmation') === 'true')
  }, [])

  const { data, isPending } = useQuery({
    queryKey: ['queue-slots'],
    queryFn: async () => {
      const res = await client.tweet.get_queue.$get({ timezone, userNow })
      return await res.json()
    },
  })

  // Fetch scheduled threads and tweets
  const { data: rawScheduledData, isPending: isLoadingScheduled } = useQuery({
    queryKey: ['threads-scheduled-published'],
    queryFn: async () => {
      const res = await client.tweet.getScheduledAndPublished.$get()
      const data = await res.json()
      console.log('[TweetQueue] Raw response:', data)
      return data
    },
  })

  // Handle potential superjson wrapper
  const scheduledData = React.useMemo(() => {
    if (!rawScheduledData) return null
    
    // Check if this is a superjson response with a json property
    if ((rawScheduledData as any).json) {
      console.log('[TweetQueue] Unwrapped superjson data:', (rawScheduledData as any).json)
      return (rawScheduledData as any).json
    }
    
    // Otherwise use the data as-is
    console.log('[TweetQueue] Using data as-is:', rawScheduledData)
    return rawScheduledData
  }, [rawScheduledData])

  const { mutate: deleteTweet } = useMutation({
    mutationFn: async (tweetId: string) => {
      const res = await client.tweet.deleteThread.$post({ threadId: tweetId })
      return await res.json()
    },
    onSuccess: () => {
      toast.success('Post deleted & unscheduled')
      queryClient.invalidateQueries({ queryKey: ['queue-slots'] })
      queryClient.invalidateQueries({ queryKey: ['threads-scheduled-published'] })
    },
  })
  
  const { mutate: postThreadNow, isPending: isPostingThread } = useMutation({
    mutationFn: async (threadTweets: any[]) => {
      const tweets = threadTweets.map(tweet => ({
        content: tweet.content,
        media: tweet.media || [],
        delayMs: 0,
      }))
      
      const res = await client.tweet.postThreadNow.$post({
        tweets,
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error((error as any).message || 'Failed to post thread')
      }

      return await res.json()
    },
    onSuccess: (data) => {
      toast.success('Thread posted successfully!')
      queryClient.invalidateQueries({ queryKey: ['queue-slots'] })
      queryClient.invalidateQueries({ queryKey: ['threads-scheduled-published'] })
      
      if (data.threadUrl) {
        window.open(data.threadUrl, '_blank')
      }
    },
    onError: (error: any) => {
      const errorMessage = error?.message || 'Failed to post thread'
      if (errorMessage.includes('429') || errorMessage.toLowerCase().includes('rate limit')) {
        toast.error('Rate limit reached. Please try again later.')
      } else {
        toast.error(errorMessage)
      }
    },
  })

  const { mutate: postImmediateFromQueue, isPending: isPosting } = useMutation({
    mutationFn: async ({ tweetId }: { tweetId: string }) => {
      const res = await client.tweet.postImmediateFromQueue.$post({ tweetId })
      const data = await res.json()
      return data
    },
    onSuccess: (data) => {
      setPendingPostId(null)

      queryClient.invalidateQueries({ queryKey: ['queue-slots'] })
      queryClient.invalidateQueries({ queryKey: ['threads-scheduled-published'] })

      toast.success(
        <div className="flex items-center gap-2">
          <p>Tweet posted!</p>
          <Link
            target="_blank"
            rel="noreferrer"
            href={`https://x.com/${data.accountUsername}/status/${data.tweetId}`}
            className="text-base text-primary-600 decoration-2 underline-offset-2 flex items-center gap-1 underline shrink-0 bg-white/10 hover:bg-white/20 rounded py-0.5 transition-colors"
          >
            See tweet
          </Link>
        </div>,
      )

      posthog.capture('tweet_posted', {
        tweetId: data.tweetId,
        accountId: data.accountId,
        accountName: data.accountName,
      })

      fire({ 
        particleCount: 200, 
        spread: 160
      })
    },
    onError: (error) => {
      console.error('Failed to post content:', error)
      toast.error('Failed to post content')
    },
  })

  if (isPending) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center justify-center text-center py-12">
          <Loader variant="classic" />
          <p className="text-sm text-neutral-600 mt-4">Loading queue...</p>
        </div>
      </div>
    )
  }

  const renderDay = (unix: number) => {
    if (isToday(unix)) return `Today | ${format(unix, 'MMM d')}`
    if (isTomorrow(unix)) return `Tomorrow | ${format(unix, 'MMM d')}`
    if (isThisWeek(unix)) return `${format(unix, 'EEEE')} | ${format(unix, 'MMM d')}`
    return format(unix, 'MMM d')
  }

  const toggleSkipConfirmation = (checked: boolean) => {
    setSkipPostConfirmation(checked)
    if (checked) {
      localStorage.setItem('skipPostConfirmation', 'true')
    } else {
      localStorage.removeItem('skipPostConfirmation')
    }
  }

  return (
    <>
      <div className="space-y-2">
        {data?.results.map((result) => {
          const [day, tweets] = Object.entries(result)[0]!

          if (tweets.length === 0) return null

          return (
            <Card key={day} className={cn('overflow-hidden')}>
              <CardHeader className="">
                <CardTitle className="flex items-center gap-2 text-lg">
                  {renderDay(Number(day))}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: 'auto 1fr auto' }}
                >
                  {tweets.map(({ unix, tweet, isQueued }) => (
                    <Fragment key={`${day}-${unix}-${tweet?.id || 'no-id'}`}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2 mt-2">
                          <div className="flex items-center gap-2 w-[100px]">
                            <Clock className="size-4 text-neutral-500" />
                            <span className="font-medium text-sm text-neutral-700">
                              {format(unix, "hh:mmaaaaa'm'")}
                            </span>
                          </div>
                          <div className="flex w-[65px] items-start justify-center gap-2">
                            {isQueued ? (
                              <DuolingoBadge
                                variant={tweet ? 'achievement' : 'gray'}
                                className="text-xs"
                              >
                                {tweet ? 'Queued' : 'Empty'}
                              </DuolingoBadge>
                            ) : tweet ? (
                              <DuolingoBadge variant="amber" className="text-xs">
                                Manual
                              </DuolingoBadge>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div
                        className={cn(
                          'px-4 py-3 rounded-lg border',
                          tweet
                            ? 'bg-white border-neutral-200 shadow-sm'
                            : 'bg-neutral-50 border-dashed border-neutral-300',
                        )}
                      >
                        {tweet ? (
                          // Always render as thread (single posts are just threads with one item)
                          <div className="space-y-2">
                            {/* Show thread indicator if more than one post */}
                            {tweet.tweets && tweet.tweets.length > 1 && (
                              <div className="flex items-center gap-2 mb-2">
                                <MessageSquare className="size-4 text-neutral-600" />
                                <span className="font-medium text-sm text-neutral-900">
                                  Thread ({tweet.tweets.length} posts)
                                </span>
                              </div>
                            )}
                            
                            {/* Render tweets in the thread */}
                            {tweet.tweets ? (
                              // If we have tweets array, use it
                              <>
                                {tweet.tweets.slice(0, 2).map((t: any, idx: number) => (
                                  <div key={t.id} className={tweet.tweets.length > 1 ? "pl-6 border-l-2 border-neutral-200" : ""}>
                                    <p className="text-xs text-neutral-700 line-clamp-2">
                                      {tweet.tweets.length > 1 && `${idx + 1}. `}{t.content}
                                    </p>
                                    {t.media && t.media.length > 0 && (
                                      <div className="text-xs text-neutral-500 flex items-center gap-1 mt-1">
                                        <Paperclip className="size-3" />
                                        {t.media.length} media file{t.media.length > 1 ? 's' : ''}
                                      </div>
                                    )}
                                  </div>
                                ))}
                                {tweet.tweets.length > 2 && (
                                  <p className="pl-6 text-xs text-neutral-500">
                                    ... and {tweet.tweets.length - 2} more posts
                                  </p>
                                )}
                              </>
                            ) : (
                              // Fallback for single tweet structure (legacy)
                              <div>
                                <p className="text-neutral-900 whitespace-pre-line text-sm leading-relaxed">
                                  {tweet.content || 'No content'}
                                </p>
                                {tweet.media && tweet.media.length > 0 && (
                                  <div className="text-xs text-neutral-500 flex items-center gap-1 mt-1">
                                    <Paperclip className="size-3" />
                                    {tweet.media.length} media file{tweet.media.length > 1 ? 's' : ''}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-neutral-500">
                            <span className="text-sm">Empty slot</span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center">
                        {tweet && (
                          <Dialog
                            open={pendingPostId === tweet.id}
                            onOpenChange={(open) => {
                              setPendingPostId(open ? tweet.id : null)
                              
                              if (!open) {
                                setDidTogglePostConfirmation(false)
                              }
                            }}
                          >
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <DuolingoButton
                                  variant="secondary"
                                  size="icon"
                                  className="h-8 w-8"
                                >
                                  <MoreHorizontal className="size-4" />
                                  <span className="sr-only">Tweet options</span>
                                </DuolingoButton>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  className="mb-1 w-full"
                                  onClick={() => {
                                    if (tweet) {
                                      // Always route to editor with first tweet id
                                      const firstId = tweet.tweets?.[0]?.id || tweet.id
                                      
                                      console.log('[TweetQueue] Edit click', {
                                        firstId,
                                        threadId: tweet.threadId,
                                        tweetsCount: tweet.tweets?.length || 1,
                                      })
                                      
                                      if (firstId) {
                                        router.push(`/studio?edit=${firstId}`)
                                      } else {
                                        console.warn('[TweetQueue] No id found for editing', tweet)
                                      }
                                    }
                                  }}
                                >
                                  <Edit className="size-4 mr-1" />
                                  <div className="flex flex-col">
                                    <p>Edit</p>
                                    <p className="text-xs text-neutral-500">
                                      Open this {tweet?.isThread ? 'thread' : 'tweet'} in the editor.
                                    </p>
                                  </div>
                                </DropdownMenuItem>

                                <Separator />

                                <DropdownMenuItem asChild className="my-1 w-full">
                                  <DialogTrigger>
                                    <Send className="size-4 mr-1" />
                                    <div className="flex items-start flex-col">
                                      <p>Post Now</p>
                                      <p className="text-xs text-neutral-500">
                                        {skipPostConfirmation
                                          ? 'Tweet will be posted immediately'
                                          : 'A confirmation model will open.'}
                                      </p>
                                    </div>
                                  </DialogTrigger>
                                </DropdownMenuItem>

                                <Separator />

                                <DropdownMenuItem
                                  variant="destructive"
                                  className="mt-1 w-full"
                                  onClick={() => {
                                    if (tweet!.isThread && tweet!.tweets) {
                                      // Delete all tweets in the thread
                                      tweet!.tweets.forEach((t: any) => {
                                        deleteTweet(t.id)
                                      })
                                    } else {
                                      deleteTweet(tweet!.id)
                                    }
                                  }}
                                >
                                  <Trash2 className="size-4 mr-1 text-error-600" />
                                  <div className="flex text-error-600  flex-col">
                                    <p>Delete</p>
                                    <p className="text-xs text-error-600">
                                      Delete this {tweet?.isThread ? 'thread' : 'tweet'} from the queue.
                                    </p>
                                  </div>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>

                            <DialogContent className="bg-white rounded-2xl p-6">
                              <div className="size-12 bg-neutral-100 rounded-full flex items-center justify-center">
                                <Icons.twitter className="size-6" />
                              </div>
                              <DialogHeader className="py-2">
                                <DialogTitle className="text-lg font-semibold">
                                  Post to Twitter
                                </DialogTitle>
                                <DialogDescription>
                                  {tweet.isThread 
                                    ? `This thread (${tweet.tweets?.length || 0} posts) will be posted and removed from your queue immediately. Would you like to continue?`
                                    : 'This post will be posted and removed from your queue immediately. Would you like to continue?'
                                  }
                                </DialogDescription>
                                <div className="flex justify-center sm:justify-start pt-4">
                                  <DuolingoCheckbox
                                    className=""
                                    id="skip-post-confirmation"
                                    label="Don't show this again"
                                    checked={didTogglePostConfirmation}
                                    onChange={(e) =>
                                      setDidTogglePostConfirmation(e.target.checked)
                                    }
                                  />
                                </div>
                              </DialogHeader>

                              <DialogFooter>
                                <DialogClose asChild>
                                  <DuolingoButton
                                    variant="secondary"
                                    size="sm"
                                    className="h-11"
                                    onClick={() => {
                                      setDidTogglePostConfirmation(false)
                                    }}
                                  >
                                    Cancel
                                  </DuolingoButton>
                                </DialogClose>
                                <DuolingoButton
                                  loading={isPosting || isPostingThread}
                                  size="sm"
                                  className="h-11"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    if (didTogglePostConfirmation) {
                                      toggleSkipConfirmation(true)
                                    }
                                    
                                    if (tweet.tweets && tweet.tweets.length > 0) {
                                      // Post as thread (works for single posts too)
                                      postThreadNow(tweet.tweets)
                                    } else {
                                      // Fallback for legacy single tweet structure
                                      postImmediateFromQueue({ tweetId: tweet.id })
                                    }
                                  }}
                                >
                                  <Icons.twitter className="size-4 mr-2" />
                                  {isPosting || isPostingThread ? 'Posting...' : 'Post Now'}
                                </DuolingoButton>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        )}
                      </div>
                    </Fragment>
                  ))}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>


    </>
  )
}
