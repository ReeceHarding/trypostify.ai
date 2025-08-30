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
import { useBackgroundProcessStore } from '@/stores/background-process-store'

function BackgroundProcessStatus() {
  const { getActiveProcesses } = useBackgroundProcessStore()
  
  // Simple and reliable: Use the background process store
  const activeProcesses = getActiveProcesses()
  const hasActiveProcesses = activeProcesses.length > 0
  const activeProcessCount = activeProcesses.length
  
  console.log('[BackgroundProcessStatus] Store-based detection:', {
    activeProcessCount,
    hasActiveProcesses,
    processes: activeProcesses.map(p => ({
      id: p.id.substring(0, 8),
      type: p.type,
      description: p.description,
      age: Math.round((Date.now() - p.startedAt) / 1000) + 's'
    }))
  })
  
  // Create process data based on store processes
  const processingVideos = activeProcesses.map((process) => ({
    id: process.id,
    content: process.description,
    status: process.type,
    type: process.type,
    startedAt: process.startedAt
  }))
  
  const isLoading = false
  const error = null

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

  // Page title updates are now handled by the simple logic above

  // Handle errors gracefully but still show the section
  if (error) {
    return (
      <Card className="border-error-200 bg-error-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Video className="w-5 h-5 text-error-500" />
            Background Processing
            <DuolingoBadge variant="error" className="text-xs">
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
              <DuolingoBadge variant="success" className="text-xs">
                No active jobs
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
              <DuolingoBadge variant="warning" className="text-xs animate-pulse">
                {activeProcessCount} active
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
        {processingVideos.map((process: any) => {
          const status = {
            icon: <Loader2 className="w-5 h-5 animate-spin text-primary" />,
            text: `Active operation: ${process.mutationKey?.[0] || 'unknown'}`,
            badge: 'warning' as const,
            badgeText: 'Processing'
          }
          
          return (
            <div key={process.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-neutral-200">
              <div className="flex items-center gap-3">
                <div className="relative">
                  {status.icon}
                </div>
                
                <div>
                  <div className="font-medium text-neutral-900">
                    {process.content}
                  </div>
                  <div className="text-sm text-neutral-600">
                    {status.text}
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">
                    Status: {process.mutationStatus}
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <DuolingoBadge variant={status.badge} className="text-xs">
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
