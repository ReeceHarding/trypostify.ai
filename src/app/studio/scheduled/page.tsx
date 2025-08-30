"use client"

import TweetQueue from '@/components/tweet-queue'
import { AccountAvatar } from '@/hooks/account-ctx'
import { client } from '@/lib/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, Clock, CheckCircle, Loader2, Video, AlertCircle, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import * as React from 'react'
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
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import DuolingoBadge from '@/components/ui/duolingo-badge'

function BackgroundProcessStatus() {
  const queryClient = useQueryClient()
  
  // Clear cache on component mount to ensure fresh data
  React.useEffect(() => {
    console.log('[BackgroundProcessStatus] 🧹 Clearing cache on mount to ensure fresh data')
    queryClient.removeQueries({ queryKey: ['video-processing-status'] })
    queryClient.removeQueries({ queryKey: ['video-processing-status-v2'] })
    queryClient.invalidateQueries({ queryKey: ['video-processing-status'] })
    queryClient.invalidateQueries({ queryKey: ['video-processing-status-v2'] })
  }, [queryClient])
  
  // Mutation for fetching video processing status
  const fetchVideoJobsMutation = useMutation({
    mutationFn: async () => {
      console.log('[VideoProcessingStatus] 🔍 Fetching video jobs with status=processing...')
      
      // Get video jobs that are currently processing
      const requestBody = { status: 'processing' as const, limit: 50, offset: 0 }
      console.log('[VideoProcessingStatus] 📤 Sending request body:', JSON.stringify(requestBody))
      
      const res = await client.videoJob.listVideoJobs.mutate(requestBody)
      
      console.log('[VideoProcessingStatus] 📊 API Response:', {
        jobsCount: res.jobs?.length || 0,
        jobs: res.jobs?.map(j => ({ id: j.id?.substring(0, 8), status: j.status })) || []
      })
      
      const jobs = res.jobs || []
      
      // Additional safety check - filter to only truly processing jobs
      const actuallyProcessingJobs = jobs.filter(job => job.status === 'processing')
      
      console.log('[VideoProcessingStatus] ✅ Filtered processing jobs:', actuallyProcessingJobs.length)
      
      return actuallyProcessingJobs
    },
  })

  // Use query to manage the data and refetching
  const { data: processingVideos, isLoading, error } = useQuery({
    queryKey: ['video-processing-status-v3'],
    queryFn: () => fetchVideoJobsMutation.mutateAsync(),
    refetchInterval: 5000, // Refresh every 5 seconds for real-time updates
    retry: false, // Don't retry on error
    staleTime: 0, // Always consider data stale to force fresh fetches
    gcTime: 0, // Don't cache data in garbage collection
    refetchOnMount: 'always', // Always refetch when component mounts
    refetchOnWindowFocus: true, // Refetch when window gains focus
  })

  // Cleanup mutation (marks jobs as failed)
  const cleanupMutation = useMutation({
    mutationFn: async () => {
      const res = await client.videoJob.cleanupStuckJobs.$post()
      return res.json()
    },
    onSuccess: (data) => {
      console.log('[VideoProcessingStatus] ✅ Cleanup completed:', data)
      toast.success(`Cleaned up ${data.cleanedUp} stuck video jobs`, { duration: 3000 })
      // Aggressively clear cache and refetch
              queryClient.removeQueries({ queryKey: ['video-processing-status'] })
        queryClient.removeQueries({ queryKey: ['video-processing-status-v2'] })
        queryClient.invalidateQueries({ queryKey: ['video-processing-status'] })
        queryClient.invalidateQueries({ queryKey: ['video-processing-status-v2'] })
        queryClient.refetchQueries({ queryKey: ['video-processing-status'] })
        queryClient.refetchQueries({ queryKey: ['video-processing-status-v2'] })
    },
    onError: (error) => {
      console.error('Failed to cleanup stuck jobs:', error)
      toast.error('Failed to cleanup stuck jobs')
    },
  })

  // Delete all mutation (nuclear option - completely removes jobs)
  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      const res = await client.videoJob.deleteAllStuckJobs.$post()
      return res.json()
    },
    onSuccess: (data) => {
      console.log('[VideoProcessingStatus] ✅ Delete completed:', data)
      toast.success(`Deleted ${data.deleted} stuck video jobs`, { duration: 3000 })
      // Aggressively clear cache and refetch
              queryClient.removeQueries({ queryKey: ['video-processing-status'] })
        queryClient.removeQueries({ queryKey: ['video-processing-status-v2'] })
        queryClient.invalidateQueries({ queryKey: ['video-processing-status'] })
        queryClient.invalidateQueries({ queryKey: ['video-processing-status-v2'] })
        queryClient.refetchQueries({ queryKey: ['video-processing-status'] })
        queryClient.refetchQueries({ queryKey: ['video-processing-status-v2'] })
    },
    onError: (error) => {
      console.error('Failed to delete stuck jobs:', error)
      toast.error('Failed to delete stuck jobs')
    },
  })

  // Manual refresh mutation
  const refreshMutation = useMutation({
    mutationFn: async () => {
      console.log('[VideoProcessingStatus] 🔄 Force refreshing - clearing all cache entries')
      
      // Aggressively clear all video processing cache entries
      queryClient.removeQueries({ queryKey: ['video-processing-status'] })
      queryClient.removeQueries({ queryKey: ['video-processing-status-v2'] })
      queryClient.invalidateQueries({ queryKey: ['video-processing-status-v2'] })
      
      // Force a fresh fetch by refetching
      await queryClient.refetchQueries({ queryKey: ['video-processing-status-v2'] })
      
      return { message: 'Cache cleared and refreshed' }
    },
    onSuccess: () => {
      console.log('[VideoProcessingStatus] ✅ Successfully refreshed and cleared cache')
      toast.success('Refreshed video processing status', { duration: 2000 })
    },
    onError: (error) => {
      console.error('[VideoProcessingStatus] ❌ Failed to refresh:', error)
      toast.error('Failed to refresh status')
    },
  })

  // Add visual feedback for background processes
  const hasActiveProcesses = processingVideos && processingVideos.length > 0

  // Show page title indicator when processes are running
  React.useEffect(() => {
    if (hasActiveProcesses) {
      document.title = `(${processingVideos.length}) Processing - Postify`
    } else {
      document.title = 'Scheduled - Postify'
    }
    
    // Cleanup on unmount
    return () => {
      document.title = 'Postify'
    }
  }, [hasActiveProcesses, processingVideos?.length])

  // Don't show the component if there are no processing videos or if there's an error
  if (error || (!isLoading && (!processingVideos || processingVideos.length === 0))) {
    return null
  }

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
    <>
      {/* Floating Status Indicator */}
      {hasActiveProcesses && (
        <div className="fixed top-4 right-4 z-50 bg-primary text-white px-3 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-pulse">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm font-medium">{processingVideos.length} processing</span>
        </div>
      )}
      
      {/* Main Processing Status Card */}
          <Card className="border-neutral-200 bg-neutral-50">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Video className="w-5 h-5 text-primary animate-pulse" />
              Background Processing
              <div className="animate-pulse">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                  <div className="w-2 h-2 bg-primary rounded-full animate-bounce"></div>
                </div>
              </div>
              <DuolingoBadge variant="warning" className="text-xs animate-pulse">
                {processingVideos?.length || 0} active
              </DuolingoBadge>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="duolingo-sm"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                className="text-xs"
              >
                <RefreshCw className={`w-3 h-3 mr-1 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
                {refreshMutation.isPending ? 'Refreshing...' : 'Refresh'}
              </Button>
              <Button
                variant="duolingo-secondary"
                size="duolingo-sm"
                onClick={() => cleanupMutation.mutate()}
                disabled={cleanupMutation.isPending || deleteAllMutation.isPending || refreshMutation.isPending}
                className="text-xs"
              >
                {cleanupMutation.isPending ? 'Cleaning...' : 'Mark Failed'}
              </Button>
              <Button
                variant="duolingo-destructive"
                size="duolingo-sm"
                onClick={() => deleteAllMutation.mutate()}
                disabled={cleanupMutation.isPending || deleteAllMutation.isPending || refreshMutation.isPending}
                className="text-xs"
              >
                {deleteAllMutation.isPending ? 'Deleting...' : 'Delete All'}
              </Button>
            </div>
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
    </>
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
      toast.success(data.message || `Cleared ${data.deletedCount} queued posts`, { duration: 3000 })
      
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
            <Button
              variant="duolingo-secondary"
              size="duolingo-sm"
              className="ml-auto"
              onClick={() => {
                console.log('[ScheduledTweetsPage] Clear Queue button clicked at', new Date().toISOString())
                setIsDialogOpen(true)
              }}
            >
              <Trash2 className="size-4 mr-2" />
              Clear Queue
            </Button>
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
                <Button
                  variant="duolingo-secondary"
                  onClick={() => {
                    console.log('[ScheduledTweetsPage] Cancel button clicked at', new Date().toISOString())
                    setIsDialogOpen(false)
                  }}
                >
                  Cancel
                </Button>
              </DialogClose>
              
              <Button
                variant="duolingo-destructive"
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
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Video Processing Status Section */}
      <BackgroundProcessStatus />

      <TweetQueue />
    </div>
  )
}
