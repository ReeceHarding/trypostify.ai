'use client'

import { useState, useEffect, Fragment } from 'react'
import Link from 'next/link'
import {
  format,
  isAfter,
  isPast,
  isToday,
  isTomorrow,
  isYesterday,
  isThisWeek,
  differenceInDays,
} from 'date-fns'
import {
  Calendar,
  Clock,
  Trash2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Eye,
  MessageSquare,
  BarChart3,
  Heart,
  Repeat2,
  MessageCircle,
  TrendingUp,
  RefreshCw,
  Edit,
} from 'lucide-react'
import DuolingoButton from '@/components/ui/duolingo-button'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { client } from '@/lib/client'
import { cn } from '@/lib/utils'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import MediaDisplay from '@/components/media-display'
import DuolingoBadge from '@/components/ui/duolingo-badge'
import {
  AccountAvatar,
  AccountName,
  AccountHandle,
  useAccount,
} from '@/hooks/account-ctx'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { initialConfig } from '@/hooks/use-tweets'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useRouter } from 'next/navigation'
import { InferOutput } from '@/server'

function InitialContentPlugin({ content }: { content: string }) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    editor.update(() => {
      const root = $getRoot()
      const p = $createParagraphNode()
      const text = $createTextNode(content)
      p.append(text)
      root.clear()
      root.append(p)
    })
  }, [editor, content])

  return null
}



interface TweetListProps {
  mode: 'scheduled' | 'posted'
  title: string
  emptyStateTitle: string
  emptyStateDescription: string
  emptyStateIcon: React.ReactNode
}

export default function TweetList({
  mode,
  title,
  emptyStateTitle,
  emptyStateDescription,
  emptyStateIcon,
}: TweetListProps) {
  const queryClient = useQueryClient()
  const { account } = useAccount()
  const router = useRouter()

  const { data: postedData, isLoading } = useQuery({
    queryKey: ['threads-posted', account?.username],
    queryFn: async () => {
      const res = await client.tweet.getPosted.$get()
      return await res.json()
    },
  })

  const {
    mutate: deleteTweet,
    isPending: isDeleting,
    variables,
  } = useMutation({
    mutationFn: async ({ tweetId }: { tweetId: string }) => {
      // For single tweets without threadId, we need to get the tweet first
      // to determine if it has a threadId
      // For now, we'll use deleteThread with the tweetId as threadId
      await client.tweet.deleteThread.$post({ threadId: tweetId })
    },
    onSuccess: () => {
      toast.success('Post deleted and unscheduled')
      queryClient.invalidateQueries({
        queryKey: ['threads-posted', account?.username],
      })
    },
    onError: () => {
      toast.error('Failed to delete post')
    },
  })

  const handleDeleteScheduled = (id: string) => {
    deleteTweet({ tweetId: id })
  }

  // Fetch metrics mutation
  const {
    mutate: fetchMetrics,
    isPending: isFetchingMetrics,
  } = useMutation({
    mutationFn: async ({ tweetIds }: { tweetIds: string[] }) => {
      const res = await client.tweet.fetchTweetMetrics.$post({ tweetIds })
      return await res.json()
    },
    onSuccess: (data) => {
      toast.success(`Updated metrics for ${data.updatedCount} posts`)
      queryClient.invalidateQueries({
        queryKey: ['threads-posted', account?.username],
      })
    },
    onError: () => {
      toast.error('Failed to fetch post metrics')
    },
  })

  // Group items by date
  const groupedItems = (postedData?.items || []).reduce(
    (groups, item) => {
      let date: string

      if (mode === 'posted') {
        date = format(new Date(item.updatedAt || item.tweets[0]?.updatedAt || item.tweets[0]?.createdAt || new Date()), 'yyyy-MM-dd')
      } else if (item.tweets[0]?.scheduledFor) {
        date = format(new Date(item.tweets[0].scheduledFor || new Date()), 'yyyy-MM-dd')
      } else {
        date = format(new Date(item.tweets[0]?.createdAt || new Date()), 'yyyy-MM-dd')
      }

      if (!groups[date]) {
        groups[date] = []
      }
      groups[date]?.push(item)

      return groups
    },
    {} as Record<string, any[]>,
  )

  // Sort items within each date group
  Object.keys(groupedItems).forEach((date) => {
    groupedItems[date]?.sort((a, b) => {
      if (mode === 'posted') {
        const timeA = new Date(a.updatedAt || a.tweets[0]?.updatedAt || a.tweets[0]?.createdAt || new Date())
        const timeB = new Date(b.updatedAt || b.tweets[0]?.updatedAt || b.tweets[0]?.createdAt || new Date())
        return timeB.getTime() - timeA.getTime()
      } else {
        const timeA = new Date(a.tweets[0]?.scheduledFor || a.tweets[0]?.createdAt || new Date())
        const timeB = new Date(b.tweets[0]?.scheduledFor || b.tweets[0]?.createdAt || new Date())
        return timeA.getTime() - timeB.getTime()
      }
    })
  })

  const getDateLabel = (dateString: string) => {
    const date = new Date(dateString)

    if (isToday(date)) {
      return 'Today'
    }

    if (isTomorrow(date)) {
      return 'Tomorrow'
    }

    if (isYesterday(date)) {
      return 'Yesterday'
    }

    if (isThisWeek(date)) {
      return format(date, 'EEEE')
    }

    return format(date, 'MMMM d')
  }

  const sortedDateEntries = Object.entries(groupedItems).sort((a, b) => {
    const dateA = new Date(a[0])
    const dateB = new Date(b[0])

    if (mode === 'posted') {
      return dateB.getTime() - dateA.getTime()
    }

    const todayDate = new Date()
    todayDate.setHours(0, 0, 0, 0)

    const isDateAToday = isToday(dateA)
    const isDateBToday = isToday(dateB)

    if (isDateAToday && !isDateBToday) return -1
    if (!isDateAToday && isDateBToday) return 1

    return dateA.getTime() - dateB.getTime()
  })

  const totalTweets = Object.keys(groupedItems).reduce(
    (acc, key) => acc + (groupedItems[key]?.length || 0),
    0,
  )

  const getLastScheduledDate = () => {
    if (mode === 'posted') return null

    const scheduled = (postedData?.tweets || [])
      .filter((tweet) => !tweet.isPublished && tweet.scheduledFor)
      .sort(
        (a, b) =>
          new Date(b.scheduledFor!).getTime() - new Date(a.scheduledFor!).getTime(),
      )

    if (scheduled.length > 0 && scheduled[0]?.scheduledFor) {
      return format(new Date(scheduled[0].scheduledFor), 'EEEE MMMM do')
    }
    return null
  }

  const scheduledCount =
    mode === 'scheduled'
      ? (postedData?.tweets || []).filter((tweet) => !tweet.isPublished).length
      : 0

  if (isLoading) {
    return (
      <div className="container max-w-4xl mx-auto p-6">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-neutral-800">{title}</h1>
          </div>
          <div className="animate-pulse bg-neutral-100 h-16 rounded-lg" />
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="animate-pulse bg-neutral-100 h-16 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative z-10 p-2">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-neutral-800">{title}</h1>
        </div>

        {mode === 'scheduled' && scheduledCount > 0 && getLastScheduledDate() && (
          <div className="bg-success-50 border border-emerald-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-success-800">
              <CheckCircle2 className="size-4" />
              <span className="text-sm">
                You have {scheduledCount} tweets scheduled. The last one will be published
                on {getLastScheduledDate()}.
              </span>
            </div>
          </div>
        )}

        {Object.keys(groupedItems).length === 0 ? (
          <Card className="p-12 text-center">
            <div className="flex flex-col gap-4">
              {emptyStateIcon}
              <h3 className="text-lg font-medium text-neutral-800">{emptyStateTitle}</h3>
              <p className="text-neutral-600">{emptyStateDescription}</p>
              <DuolingoButton
                onClick={() => router.push('/studio')}
                className="w-fit mx-auto"
              >
                <Edit className="size-4 mr-1" />
                Start creating
              </DuolingoButton>
            </div>
          </Card>
        ) : (
          <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden">
            {sortedDateEntries.map(([date, items]) => (
              <div key={date}>
                <div className="px-4 py-3 border-b border-neutral-200 bg-neutral-50/50">
                  <h2 className="text-[19px] font-bold text-neutral-900">
                    {(() => {
                      const relativeLabel = getDateLabel(date)
                      const absoluteDate = format(new Date(date), 'MMMM d')
                      return relativeLabel === absoluteDate
                        ? relativeLabel
                        : `${relativeLabel} · ${absoluteDate}`
                    })()}
                  </h2>
                </div>
                <div>
                    {items.map((item) => (
                      <div key={item.threadId || item.tweets[0]?.id}>
                        {item.tweets.length > 1 ? (
                          // Exact Twitter thread rendering
                          <div>
                            {item.tweets.map((tweet: any, index: number) => (
                              <div key={tweet.id} className="relative px-4 pt-3 hover:bg-neutral-50 transition-colors cursor-pointer">
                                <div className="flex gap-3">
                                  {/* Avatar column with line */}
                                  <div className="flex flex-col items-center">
                                    <AccountAvatar className="size-12 ring-1 ring-neutral-100" />
                                    {index < item.tweets.length - 1 && (
                                      <div className="w-0.5 grow mt-1 bg-neutral-300" />
                                    )}
                                  </div>
                                  {/* Content */}
                                  <div className="flex-1 pb-3">
                                    <div className="flex items-start justify-between">
                                      <div className="flex items-center">
                                        <AccountName className="font-bold text-[15px] text-neutral-900 hover:underline" />
                                        <AccountHandle className="text-[15px] text-neutral-500 ml-1" />
                                        <span className="mx-1 text-neutral-500">·</span>
                                        <time className="text-[15px] text-neutral-500 hover:underline">
                                          {tweet.postedAt ? format(new Date(tweet.postedAt), 'MMM d') : ''}
                                        </time>
                                      </div>
                                      <div className="flex items-center -mr-2">
                                        {tweet.twitterId && account?.username && (
                                          <Link
                                            className="p-2 rounded-full hover:bg-neutral-100 transition-colors"
                                            href={`https://x.com/${account.username}/status/${tweet.twitterId}`}
                                            target="_blank"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <ExternalLink className="size-4 text-neutral-500" />
                                          </Link>
                                        )}
                                      </div>
                                    </div>
                                    <div className="mt-0.5 text-[15px] leading-5 text-neutral-900 whitespace-pre-wrap break-words">
                                      <LexicalComposer initialConfig={{ ...initialConfig, editable: false }}>
                                        <PlainTextPlugin
                                          contentEditable={<ContentEditable className="outline-none" />}
                                          ErrorBoundary={LexicalErrorBoundary}
                                        />
                                        <InitialContentPlugin content={tweet.content} />
                                      </LexicalComposer>
                                    </div>
                                    {tweet.media && tweet.media.length > 0 && (
                                      <div className="mt-3 -mx-1">
                                        <MediaDisplay
                                          mediaFiles={tweet.media.map((media: any) => ({
                                            ...media,
                                            uploading: false,
                                            media_id: media.media_id,
                                            s3Key: media.s3Key,
                                            type: media.type as 'image' | 'gif' | 'video',
                                          }))}
                                          removeMediaFile={() => {}}
                                        />
                                      </div>
                                    )}
                                    {tweet.twitterId && (
                                      <div className="mt-3 flex items-center justify-between max-w-md">
                                        <button className="flex items-center group">
                                          <div className="p-2 -ml-2 rounded-full group-hover:bg-blue-50 transition-colors">
                                            <MessageCircle className="size-[18px] text-neutral-500 group-hover:text-blue-500" />
                                          </div>
                                          <span className="text-[13px] text-neutral-500 group-hover:text-blue-500 ml-1">{tweet.replies || ''}</span>
                                        </button>
                                        <button className="flex items-center group">
                                          <div className="p-2 rounded-full group-hover:bg-green-50 transition-colors">
                                            <Repeat2 className="size-[18px] text-neutral-500 group-hover:text-green-500" />
                                          </div>
                                          <span className="text-[13px] text-neutral-500 group-hover:text-green-500 ml-1">{tweet.retweets || ''}</span>
                                        </button>
                                        <button className="flex items-center group">
                                          <div className="p-2 rounded-full group-hover:bg-red-50 transition-colors">
                                            <Heart className="size-[18px] text-neutral-500 group-hover:text-red-500" />
                                          </div>
                                          <span className="text-[13px] text-neutral-500 group-hover:text-red-500 ml-1">{tweet.likes || ''}</span>
                                        </button>
                                        <button className="flex items-center group">
                                          <div className="p-2 rounded-full group-hover:bg-blue-50 transition-colors">
                                            <BarChart3 className="size-[18px] text-neutral-500 group-hover:text-blue-500" />
                                          </div>
                                          <span className="text-[13px] text-neutral-500 group-hover:text-blue-500 ml-1">{tweet.impressions || ''}</span>
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                            {/* Thread actions */}
                            <div className="px-4 py-3 border-t border-neutral-100 bg-neutral-50/50">
                              <div className="flex items-center justify-between">
                                <span className="text-sm text-neutral-600">
                                  Thread · {item.tweets.length} posts
                                </span>
                                <DuolingoButton
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => {
                                    const tweetIds = item.tweets.filter((t: any) => t.twitterId).map((t: any) => t.id)
                                    if (tweetIds.length > 0) fetchMetrics({ tweetIds })
                                  }}
                                  disabled={isFetchingMetrics}
                                >
                                  <RefreshCw className={cn('size-3.5 mr-1.5', isFetchingMetrics && 'animate-spin')} />
                                  Update metrics
                                </DuolingoButton>
                              </div>
                            </div>
                            <div className="h-px bg-neutral-200" />
                          </div>
                        ) : (
                          // Exact Twitter single tweet
                          item.tweets.map((tweet: any) => (
                            <div key={tweet.id} className="hover:bg-neutral-50 transition-colors cursor-pointer">
                              <div className="px-4 py-3">
                              <div className="flex gap-3">
                                <AccountAvatar className="size-12 ring-1 ring-neutral-100" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between">
                                    <div className="flex items-center">
                                      <AccountName className="font-bold text-[15px] text-neutral-900 hover:underline" />
                                      <AccountHandle className="text-[15px] text-neutral-500 ml-1" />
                                      <span className="mx-1 text-neutral-500">·</span>
                                      <time className="text-[15px] text-neutral-500 hover:underline">
                                        {tweet.postedAt ? format(new Date(tweet.postedAt), 'MMM d') : ''}
                                      </time>
                                    </div>
                                    <div className="flex items-center -mr-2">
                                      {tweet.twitterId && account?.username && (
                                        <Link
                                          className="p-2 rounded-full hover:bg-neutral-100 transition-colors"
                                          href={`https://x.com/${account.username}/status/${tweet.twitterId}`}
                                          target="_blank"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <ExternalLink className="size-4 text-neutral-500" />
                                        </Link>
                                      )}
                                      <button
                                        className="p-2 rounded-full hover:bg-neutral-100 transition-colors"
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          fetchMetrics({ tweetIds: [tweet.id] })
                                        }}
                                        disabled={isFetchingMetrics}
                                      >
                                        <RefreshCw className={cn('size-4 text-neutral-500', isFetchingMetrics && 'animate-spin')} />
                                      </button>
                                    </div>
                                  </div>
                                  <div className="mt-0.5 text-[15px] leading-5 text-neutral-900 whitespace-pre-wrap break-words">
                                    <LexicalComposer initialConfig={{ ...initialConfig, editable: false }}>
                                      <PlainTextPlugin
                                        contentEditable={<ContentEditable className="outline-none" />}
                                        ErrorBoundary={LexicalErrorBoundary}
                                      />
                                      <InitialContentPlugin content={tweet.content} />
                                    </LexicalComposer>
                                  </div>
                                  {tweet.media && tweet.media.length > 0 && (
                                    <div className="mt-3 -mx-1">
                                      <MediaDisplay
                                        mediaFiles={tweet.media.map((media: any) => ({
                                          ...media,
                                          uploading: false,
                                          media_id: media.media_id,
                                          s3Key: media.s3Key,
                                          type: media.type as 'image' | 'gif' | 'video',
                                        }))}
                                        removeMediaFile={() => {}}
                                      />
                                    </div>
                                  )}
                                  {tweet.twitterId && (
                                    <div className="mt-3 flex items-center justify-between max-w-md">
                                      <button className="flex items-center group">
                                        <div className="p-2 -ml-2 rounded-full group-hover:bg-blue-50 transition-colors">
                                          <MessageCircle className="size-[18px] text-neutral-500 group-hover:text-blue-500" />
                                        </div>
                                        <span className="text-[13px] text-neutral-500 group-hover:text-blue-500 ml-1">{tweet.replies || ''}</span>
                                      </button>
                                      <button className="flex items-center group">
                                        <div className="p-2 rounded-full group-hover:bg-green-50 transition-colors">
                                          <Repeat2 className="size-[18px] text-neutral-500 group-hover:text-green-500" />
                                        </div>
                                        <span className="text-[13px] text-neutral-500 group-hover:text-green-500 ml-1">{tweet.retweets || ''}</span>
                                      </button>
                                      <button className="flex items-center group">
                                        <div className="p-2 rounded-full group-hover:bg-red-50 transition-colors">
                                          <Heart className="size-[18px] text-neutral-500 group-hover:text-red-500" />
                                        </div>
                                        <span className="text-[13px] text-neutral-500 group-hover:text-red-500 ml-1">{tweet.likes || ''}</span>
                                      </button>
                                      <button className="flex items-center group">
                                        <div className="p-2 rounded-full group-hover:bg-blue-50 transition-colors">
                                          <BarChart3 className="size-[18px] text-neutral-500 group-hover:text-blue-500" />
                                        </div>
                                        <span className="text-[13px] text-neutral-500 group-hover:text-blue-500 ml-1">{tweet.impressions || ''}</span>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                              </div>
                              <div className="h-px bg-neutral-200" />
                            </div>
                          ))
                        )}
                        </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
