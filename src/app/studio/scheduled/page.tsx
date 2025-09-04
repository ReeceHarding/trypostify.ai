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
import { useThreadEditorStore } from '@/stores/thread-editor-store'
import { authClient } from '@/lib/auth-client'
import { cn } from '@/lib/utils'

// Unified hook for fetching active video jobs - SINGLE SOURCE OF TRUTH
function useActiveVideoJobs() {
  return useQuery({
    queryKey: ['active-video-jobs'], // Unified key used by all components
    queryFn: async () => {
      console.log('[useActiveVideoJobs] 🔍 Fetching active jobs from database...')
      try {
        // Check for processing jobs
        const processingRes = await client.videoJob.listVideoJobs.$post({ 
          status: 'processing' as const, 
          limit: 50, 
          offset: 0 
        })
        
        // Check for pending jobs  
        const pendingRes = await client.videoJob.listVideoJobs.$post({ 
          status: 'pending' as const, 
          limit: 50, 
          offset: 0 
        })
        
        const processingData = await processingRes.json()
        const pendingData = await pendingRes.json()
        
        const allActiveJobs = [...(processingData.jobs || []), ...(pendingData.jobs || [])]
        
        console.log('[useActiveVideoJobs] ✅ Found', allActiveJobs.length, 'active jobs:', {
          processingJobs: processingData.jobs?.length || 0,
          pendingJobs: pendingData.jobs?.length || 0,
          jobs: allActiveJobs.map(j => ({
            id: j.id?.substring(0, 8),
            status: j.status,
            platform: j.platform,
            createdAt: j.createdAt
          }))
        })
        
        return allActiveJobs
      } catch (error) {
        console.error('[useActiveVideoJobs] ❌ Error fetching jobs:', error)
        
        // If unauthorized, user is not logged in - return empty array silently
        if (error instanceof Error && (error.message.includes('Unauthorized') || error.message.includes('401'))) {
          console.log('[useActiveVideoJobs] 🔒 User not authenticated - skipping video job polling')
          return []
        }
        
        // For other errors, still return empty array to prevent crash
        return []
      }
    },
    refetchInterval: (query) => {
      // Don't poll if there was an auth error
      if (query.state.error && query.state.error.message?.includes('Unauthorized')) {
        console.log('[useActiveVideoJobs] 🔒 Stopping polling due to auth error')
        return false
      }
      
      // Poll every 5 seconds if there are active jobs, otherwise stop polling
      const data = query.state.data
      return data && Array.isArray(data) && data.length > 0 ? 5000 : false
    },
    staleTime: 0, // Always fetch fresh data
    refetchOnMount: 'always', // Always fetch when component mounts
    refetchOnWindowFocus: true, // Fetch when user returns to tab
    retry: (failureCount, error) => {
      // Don't retry unauthorized errors
      if (error instanceof Error && (error.message.includes('Unauthorized') || error.message.includes('401'))) {
        console.log('[useActiveVideoJobs] 🔒 Not retrying unauthorized error')
        return false
      }
      // Retry other errors up to 3 times
      return failureCount < 3
    },
    enabled: true, // Always enabled - will show real database state
  })
}

function BackgroundProcessStatus() {
  const queryClient = useQueryClient()
  const { data: activeJobs, isLoading, error, refetch } = useActiveVideoJobs()

  const hasActiveProcesses = activeJobs && activeJobs.length > 0
  const activeProcessCount = activeJobs?.length || 0
  
  // Use real backend data only
  const processingVideos = activeJobs || []

  // Cleanup mutation (marks jobs as failed)
  const cleanupMutation = useMutation({
    mutationFn: async () => {
      const res = await client.videoJob.cleanupStuckJobs.$post()
      return res.json()
    },
    onSuccess: (data) => {
      console.log('[BackgroundProcessStatus] ✅ Cleanup completed:', data)
      toast.success(`Cleaned up ${data.cleanedUp} stuck video jobs`, { duration: 3000 })
      // Invalidate the unified query key to refresh all components
      queryClient.invalidateQueries({ queryKey: ['active-video-jobs'] })
    },
    onError: (error) => {
      console.error('[BackgroundProcessStatus] ❌ Failed to cleanup stuck jobs:', error)
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
      console.log('[BackgroundProcessStatus] ✅ Delete completed:', data)
      toast.success(`Deleted ${data.deleted} stuck video jobs`, { duration: 3000 })
      // Invalidate the unified query key to refresh all components
      queryClient.invalidateQueries({ queryKey: ['active-video-jobs'] })
    },
    onError: (error) => {
      console.error('[BackgroundProcessStatus] ❌ Failed to delete stuck jobs:', error)
      toast.error('Failed to delete stuck jobs')
    },
  })

  // Manual refresh mutation
  const refreshMutation = useMutation({
    mutationFn: async () => {
      console.log('[BackgroundProcessStatus] 🔄 Force refreshing active video jobs...')
      
      // Clear and refetch the unified query
      queryClient.removeQueries({ queryKey: ['active-video-jobs'] })
      await queryClient.refetchQueries({ queryKey: ['active-video-jobs'] })
      
      return { message: 'Active video jobs refreshed' }
    },
    onSuccess: () => {
      console.log('[BackgroundProcessStatus] ✅ Successfully refreshed active video jobs')
      toast.success('Refreshed video processing status', { duration: 2000 })
    },
    onError: (error) => {
      console.error('[BackgroundProcessStatus] ❌ Failed to refresh:', error)
      toast.error('Failed to refresh status')
    },
  })

  // Page title updates are now handled by the simple logic above

  // Handle errors gracefully but still show the section
  if (error) {
    return (
      <Card className="border-error-200 bg-error-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Video className="w-5 h-5 text-error-500" />
            Background Processing
            <DuolingoBadge variant="notification" className="text-xs">
              Error
            </DuolingoBadge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-error-600 text-center py-4">
            Error loading background process status. Please refresh the page.
          </div>
        </CardContent>
      </Card>
    )
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

  // Always show the section if there might be background processes
  // This ensures users can see the status even when jobs complete quickly
  const shouldShowSection = hasActiveProcesses
  
  if (!shouldShowSection) {
    // Show a minimal status section when no active processes
    return (
      <Card className="border-neutral-200 bg-neutral-50">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Video className="w-5 h-5 text-neutral-400" />
              Background Processing
              <span className="font-semibold inline-flex items-center justify-center relative h-7 min-w-7 px-1.5 rounded-full text-xs">No active jobs</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  console.log('[BackgroundProcessStatus] Manual refresh triggered')
                  refetch()
                }}
                disabled={isLoading}
                className="text-xs"
              >
                <RefreshCw className={cn("w-3 h-3 mr-1", isLoading && "animate-spin")} />
                Refresh
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-neutral-600 text-center py-4">
            No background processes currently running. Video jobs will appear here when active.
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      {/* Floating Status Indicator */}
      {hasActiveProcesses && (
        <div className="fixed top-4 right-4 z-50 bg-primary text-white px-3 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-pulse">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm font-medium">{activeProcessCount} processing</span>
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
              <DuolingoBadge variant="amber" className="text-xs animate-pulse">
                {activeProcessCount} active
              </DuolingoBadge>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  console.log('[BackgroundProcessStatus] Manual refresh triggered')
                  refetch()
                }}
                disabled={isLoading}
                className="text-xs"
              >
                <RefreshCw className={cn("w-3 h-3 mr-1", isLoading && "animate-spin")} />
                Refresh
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
        {processingVideos.map((job: any) => {
          const status = {
            icon: job.status === 'processing' ? 
              <Loader2 className="w-5 h-5 animate-spin text-primary" /> :
              <Video className="w-5 h-5 animate-pulse text-primary" />,
            text: job.status === 'processing' ? 
              'Video processing in progress...' : 
              'Video job queued for processing',
            badge: 'warning' as const,
            badgeText: job.status === 'processing' ? 'Processing' : 'Pending'
          }
          
          return (
            <div key={job.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-neutral-200">
              <div className="flex items-center gap-3">
                <div className="relative">
                  {status.icon}
                </div>
                
                <div>
                  <div className="font-medium text-neutral-900">
                    Video from {job.platform || 'social media'}
                  </div>
                  <div className="text-sm text-neutral-600">
                    {status.text}
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">
                    Job ID: {job.id?.substring(0, 8)}... • Status: {job.status}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <DuolingoBadge variant="amber" className="text-xs">
                  {status.badgeText}
                </DuolingoBadge>
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
