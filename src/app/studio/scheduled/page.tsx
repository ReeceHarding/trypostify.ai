"use client"

import TweetQueue from '@/components/tweet-queue'
import { AccountAvatar } from '@/hooks/account-ctx'
import { client } from '@/lib/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, Clock, CheckCircle, Loader2, Video, AlertCircle } from 'lucide-react'
import { useState } from 'react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import DuolingoButton from '@/components/ui/duolingo-button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import DuolingoBadge from '@/components/ui/duolingo-badge'

function VideoProcessingStatus() {
  // Query for video processing status
  const { data: processingVideos, isLoading } = useQuery({
    queryKey: ['video-processing-status'],
    queryFn: async () => {
      // Get tweets that have video processing status
      const res = await client.video.getProcessingVideos.$get()
      const result = await res.json()
      
      console.log('[VideoProcessingStatus] Processing videos:', result.tweets?.length || 0)
      
      // Also get scheduled tweets to check for completed videos
      const scheduledRes = await client.tweet.getScheduledAndPublished.$get()
      const scheduledResult = await scheduledRes.json()
      
      // Combine processing and scheduled videos
      const processingTweets = result.tweets || []
      const scheduledWithVideos = scheduledResult.data?.filter((item: any) => {
        return item.tweets?.some((tweet: any) => 
          tweet.pendingVideoUrl || 
          tweet.videoProcessingStatus || 
          (tweet.media?.some((media: any) => media.type === 'video'))
        )
      }) || []
      
      // Merge and deduplicate
      const allVideos = [...processingTweets, ...scheduledWithVideos.flatMap((item: any) => item.tweets || [])]
      const uniqueVideos = Array.from(new Map(allVideos.map(v => [v.id, v])).values())
      
      console.log('[VideoProcessingStatus] Total videos:', uniqueVideos.length)
      return uniqueVideos
    },
    refetchInterval: 5000, // Refresh every 5 seconds for real-time updates
  })

  if (isLoading) {
    return (
      <Card className="border-neutral-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Video className="w-5 h-5 text-primary" />
            Video Processing Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-neutral-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking video status...
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!processingVideos || processingVideos.length === 0) {
    return null // Don't show the section if no videos are processing/queued
  }

  return (
    <Card className="border-neutral-200 bg-neutral-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Video className="w-5 h-5 text-primary" />
          Video Processing Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {processingVideos.map((tweet: any) => {
          const videoMedia = tweet.media?.find((media: any) => media.type === 'video')
          const videoStatus = tweet.videoProcessingStatus
          const pendingUrl = tweet.pendingVideoUrl
          const errorMessage = tweet.videoErrorMessage
          const scheduledTime = tweet.scheduledFor ? new Date(tweet.scheduledFor) : null
          
          // Determine status and icon
          const getStatusDisplay = () => {
            if (errorMessage || videoStatus === 'failed') {
              return {
                icon: <AlertCircle className="w-5 h-5 text-error-500" />,
                text: errorMessage || 'Video processing failed',
                badge: 'error' as const,
                badgeText: 'Failed'
              }
            }
            
            if (videoStatus === 'complete' || videoMedia?.media_id) {
              return {
                icon: <CheckCircle className="w-5 h-5 text-success-600" />,
                text: `Video ready • ${scheduledTime ? `Queued for ${format(scheduledTime, 'MMM d, h:mm a')}` : 'Ready to post'}`,
                badge: 'success' as const,
                badgeText: 'Ready'
              }
            }
            
            if (videoStatus === 'uploading') {
              return {
                icon: <Video className="w-5 h-5 animate-pulse text-primary" />,
                text: 'Uploading video to Twitter...',
                badge: 'warning' as const,
                badgeText: 'Uploading'
              }
            }
            
            if (videoStatus === 'transcoding') {
              return {
                icon: <Loader2 className="w-5 h-5 animate-spin text-primary" />,
                text: 'Converting video for Twitter...',
                badge: 'warning' as const,
                badgeText: 'Converting'
              }
            }
            
            // Default: downloading or no status
            return {
              icon: <Loader2 className="w-5 h-5 animate-spin text-primary" />,
              text: 'Downloading video from source...',
              badge: 'warning' as const,
              badgeText: 'Processing'
            }
          }
          
          const status = getStatusDisplay()
          
          return (
            <div key={tweet.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-neutral-200">
              <div className="flex items-center gap-3">
                <div className="relative">
                  {status.icon}
                </div>
                
                <div>
                  <div className="font-medium text-neutral-900">
                    {tweet.content?.length > 50 
                      ? `${tweet.content.substring(0, 50)}...` 
                      : tweet.content || 'Video tweet'}
                  </div>
                  <div className="text-sm text-neutral-600">
                    {status.text}
                  </div>
                  {pendingUrl && (
                    <div className="text-xs text-neutral-500 mt-1">
                      Source: {pendingUrl.substring(0, 40)}...
                    </div>
                  )}
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <DuolingoBadge variant={status.badge} className="text-xs">
                  {status.badgeText}
                </DuolingoBadge>
                
                {scheduledTime && videoStatus === 'complete' && (
                  <div className="text-xs text-neutral-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {format(scheduledTime, 'h:mm a')}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

export default function ScheduledTweetsPage() {
  const queryClient = useQueryClient()
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  console.log('[ScheduledTweetsPage] Component rendered at', new Date().toISOString())

  // Clear queue mutation
  const { mutate: clearQueue, isPending: isClearingQueue } = useMutation({
    mutationFn: async () => {
      console.log('[ScheduledTweetsPage] Starting clearQueue mutation at', new Date().toISOString())
      const res = await client.tweet.clearQueue.$post()
      const result = await res.json()
      console.log('[ScheduledTweetsPage] clearQueue response:', result)
      return result
    },
    onSuccess: (data) => {
      console.log('[ScheduledTweetsPage] clearQueue success:', data)
      toast.success(data.message || `Cleared ${data.deletedCount} queued posts`)
      
      // Invalidate all relevant queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ['queue-slots'] })
      queryClient.invalidateQueries({ queryKey: ['threads-scheduled-published'] })
      queryClient.invalidateQueries({ queryKey: ['threads-queue'] })
      
      setIsDialogOpen(false)
    },
    onError: (error) => {
      console.error('[ScheduledTweetsPage] clearQueue error:', error)
      toast.error('Failed to clear queue. Please try again.')
    },
  })

  const handleClearQueue = () => {
    console.log('[ScheduledTweetsPage] handleClearQueue called at', new Date().toISOString())
    clearQueue()
  }

  return (
    <div className="space-y-6 relative z-10 w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AccountAvatar className="size-10 mb-1 mx-2" />
          <div className="flex flex-col">
            <h1 className="text-2xl font-semibold text-neutral-900">Queued Posts</h1>
            <p className="text-sm text-neutral-600">
              Your queue automatically publishes posts to peak activity times.
            </p>
          </div>
        </div>
        
        {/* Clear Queue Button with Confirmation Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <DuolingoButton
              variant="secondary"
              size="sm"
              className="ml-auto"
              onClick={() => {
                console.log('[ScheduledTweetsPage] Clear Queue button clicked at', new Date().toISOString())
                setIsDialogOpen(true)
              }}
            >
              <Trash2 className="size-4 mr-2" />
              Clear Queue
            </DuolingoButton>
          </DialogTrigger>
          
          <DialogContent className="max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Clear Entire Queue</DialogTitle>
              <DialogDescription>
                Are you sure you want to clear all queued posts? This action cannot be undone and will:
                <br />
                <br />
                • Delete all scheduled posts from your queue
                <br />
                • Cancel all pending scheduled posts
                <br />
                • Remove all posts that haven't been published yet
                <br />
                <br />
                Posts that have already been published will not be affected.
              </DialogDescription>
            </DialogHeader>
            
            <DialogFooter className="gap-2">
              <DialogClose asChild>
                <DuolingoButton
                  variant="secondary"
                  onClick={() => {
                    console.log('[ScheduledTweetsPage] Cancel button clicked at', new Date().toISOString())
                    setIsDialogOpen(false)
                  }}
                >
                  Cancel
                </DuolingoButton>
              </DialogClose>
              
              <DuolingoButton
                variant="destructive"
                onClick={handleClearQueue}
                disabled={isClearingQueue}
                className="bg-error-500 hover:bg-error-600 text-white"
              >
                {isClearingQueue ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Clearing...
                  </>
                ) : (
                  <>
                    <Trash2 className="size-4 mr-2" />
                    Clear Queue
                  </>
                )}
              </DuolingoButton>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Video Processing Status Section */}
      <VideoProcessingStatus />

      <TweetQueue />
    </div>
  )
}
