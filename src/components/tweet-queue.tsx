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
import { Fragment, useEffect, useState } from 'react'
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
  const { data: scheduledData, isPending: isLoadingScheduled } = useQuery({
    queryKey: ['scheduled-and-published-tweets'],
    queryFn: async () => {
      const res = await client.tweet.getScheduledAndPublished.$get()
      const data = await res.json()
      console.log('[TweetQueue] scheduledData received:', data)
      console.log('[TweetQueue] scheduledData type:', typeof data)
      console.log('[TweetQueue] scheduledData keys:', data ? Object.keys(data) : 'null')
      // If data has a json property (superjson wrapper), unwrap it
      if (data && typeof data === 'object' && 'json' in data) {
        console.log('[TweetQueue] Unwrapping superjson data:', data.json)
        return data.json
      }
      return data
    },
  })

  const { mutate: deleteTweet } = useMutation({
    mutationFn: async (tweetId: string) => {
      const res = await client.tweet.delete.$post({ id: tweetId })
      return await res.json()
    },
    onSuccess: () => {
      toast.success('Tweet deleted & unscheduled')
      queryClient.invalidateQueries({ queryKey: ['queue-slots'] })
      queryClient.invalidateQueries({ queryKey: ['scheduled-and-published-tweets'] })
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
      queryClient.invalidateQueries({ queryKey: ['scheduled-and-published-tweets'] })

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
      console.error('Failed to post tweet:', error)
      toast.error('Failed to post tweet')
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
                    <Fragment key={tweet?.id || `${day}-${unix}-time`}>
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
                          <div className="space-y-2">
                            <p className="text-neutral-900 whitespace-pre-line text-sm leading-relaxed">
                              {tweet.content || 'No content'}
                            </p>
                            {tweet.media && tweet.media.length > 0 && (
                              <div className="text-xs text-neutral-500 flex items-center gap-1">
                                <Paperclip className="size-3" />
                                {tweet.media.length} media file
                                {tweet.media.length > 1 ? 's' : ''}
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
                                      shadowEditor.update(() => {
                                        const root = $getRoot()
                                        const p = $createParagraphNode()
                                        const text = $createTextNode(tweet.content)
                                        p.append(text)
                                        root.clear()
                                        root.append(p)
                                        root.selectEnd()
                                      })

                                      setMediaFiles(tweet.media || [])

                                      router.push(`/studio?edit=${tweet.id}`)
                                    }
                                  }}
                                >
                                  <Edit className="size-4 mr-1" />
                                  <div className="flex flex-col">
                                    <p>Edit</p>
                                    <p className="text-xs text-neutral-500">
                                      Open this tweet in the editor.
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
                                  onClick={() => deleteTweet(tweet!.id)}
                                >
                                  <Trash2 className="size-4 mr-1 text-error-600" />
                                  <div className="flex text-error-600  flex-col">
                                    <p>Delete</p>
                                    <p className="text-xs text-error-600">
                                      Delete this tweet from the queue.
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
                                  This tweet will be posted and removed from your queue
                                  immediately. Would you like to continue?
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
                                  loading={isPosting}
                                  size="sm"
                                  className="h-11"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    if (didTogglePostConfirmation) {
                                      toggleSkipConfirmation(true)
                                    }
                                    postImmediateFromQueue({ tweetId: tweet.id })
                                  }}
                                >
                                  <Icons.twitter className="size-4 mr-2" />
                                  {isPosting ? 'Posting...' : 'Post Now'}
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

      {/* Scheduled Threads Section */}
      {console.log('[TweetQueue] Rendering scheduled threads section:', {
        isLoadingScheduled,
        scheduledData,
        hasItems: scheduledData?.items,
        threadCount: scheduledData?.items?.filter(item => item.isThread).length,
        // Check if data is in a different structure
        rawData: scheduledData,
        json: scheduledData?.json,
      })}
      {isLoadingScheduled ? (
        <div className="mt-6 space-y-4">
          <h2 className="text-lg font-semibold text-neutral-900">Scheduled Threads</h2>
          <div className="flex items-center justify-center py-8">
            <Loader variant="classic" />
          </div>
        </div>
      ) : scheduledData?.items && scheduledData.items.filter(item => item.isThread).length > 0 ? (
        <div className="mt-6 space-y-4">
          <h2 className="text-lg font-semibold text-neutral-900">Scheduled Threads</h2>
          <div className="space-y-4">
            {scheduledData.items
              .filter(item => item.isThread)
              .map((thread) => (
                <Card key={thread.threadId} className="overflow-hidden">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="size-5 text-neutral-600" />
                        <CardTitle className="text-base">
                          Thread ({thread.tweets.length} tweets)
                        </CardTitle>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="size-4 text-neutral-500" />
                        <span className="text-sm text-neutral-600">
                          {thread.scheduledFor && format(new Date(thread.scheduledFor), 'MMM d, h:mm a')}
                        </span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {thread.tweets.map((tweet, index) => (
                      <div key={tweet.id} className="relative">
                        {/* Connect tweets with a line */}
                        {index < thread.tweets.length - 1 && (
                          <div className="absolute left-5 top-12 bottom-[-12px] w-[2px] bg-neutral-200" />
                        )}
                        
                        <div className="flex gap-3">
                          <div className="flex-shrink-0">
                            <div className="size-10 rounded-full bg-neutral-200 flex items-center justify-center text-sm font-medium text-neutral-700">
                              {index + 1}
                            </div>
                          </div>
                          
                          <div className="flex-1 bg-white rounded-lg border border-neutral-200 p-3">
                            <p className="text-sm text-neutral-900 whitespace-pre-line">
                              {tweet.content}
                            </p>
                            {tweet.media && tweet.media.length > 0 && (
                              <div className="mt-2 text-xs text-neutral-500 flex items-center gap-1">
                                <Paperclip className="size-3" />
                                {tweet.media.length} media file{tweet.media.length > 1 ? 's' : ''}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    
                    <div className="pt-3 flex items-center justify-end gap-2">
                      <DuolingoButton
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          // Navigate to edit thread
                          router.push(`/studio?edit=${thread.tweets[0]?.id}`)
                        }}
                      >
                        <Edit className="size-3 mr-1" />
                        Edit Thread
                      </DuolingoButton>
                      
                      <Dialog>
                        <DialogTrigger asChild>
                          <DuolingoButton
                            variant="secondary"
                            size="sm"
                          >
                            <Trash2 className="size-3 mr-1" />
                            Delete
                          </DuolingoButton>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Delete Thread</DialogTitle>
                            <DialogDescription>
                              Are you sure you want to delete this entire thread? This will remove all {thread.tweets.length} tweets.
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <DialogClose asChild>
                              <DuolingoButton variant="secondary">Cancel</DuolingoButton>
                            </DialogClose>
                            <DuolingoButton
                              onClick={() => {
                                // Delete all tweets in the thread
                                thread.tweets.forEach(tweet => {
                                  deleteTweet(tweet.id)
                                })
                              }}
                            >
                              Delete Thread
                            </DuolingoButton>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <h2 className="text-lg font-semibold text-neutral-900">Scheduled Threads</h2>
          <div className="text-center py-8 text-neutral-500">
            <MessageSquare className="size-12 mx-auto mb-3 text-neutral-300" />
            <p className="text-sm">No scheduled threads</p>
          </div>
        </div>
      )}
    </>
  )
}
