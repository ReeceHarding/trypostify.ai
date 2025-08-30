'use client'

import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/client'
import { Loader2, Video, Send, Clock } from 'lucide-react'
import { useState, useEffect } from 'react'

export default function BackgroundProcessIndicator() {
  const [isVisible, setIsVisible] = useState(false)
  const [recentJobCreated, setRecentJobCreated] = useState(false)
  
  // Debug logging
  useEffect(() => {
    console.log('[BackgroundProcessIndicator] Component mounted')
    return () => {
      console.log('[BackgroundProcessIndicator] Component unmounted')
    }
  }, [])

  // Listen for video job creation events via React Query mutation success
  const { data: recentMutations } = useQuery({
    queryKey: ['recent-video-mutations'],
    queryFn: () => {
      // This is just to trigger re-renders, the actual logic is below
      return Date.now()
    },
    refetchInterval: 1000, // Check every second for recent mutations
    retry: false,
    staleTime: 0,
  })

  // Check for recent successful video job mutations
  useEffect(() => {
    if (typeof window !== 'undefined' && window.queryClient) {
      const queryClient = window.queryClient
      const recentVideoJobMutations = queryClient.getMutationCache().getAll().filter(m => 
        m.options.mutationKey?.[0] === 'create-video-job' && 
        m.state.status === 'success' &&
        Date.now() - (m.state.dataUpdatedAt || 0) < 15000 // Last 15 seconds
      )
      
      const hasRecentMutation = recentVideoJobMutations.length > 0
      if (hasRecentMutation !== recentJobCreated) {
        console.log('[BackgroundProcessIndicator] Recent mutation state changed:', hasRecentMutation)
        setRecentJobCreated(hasRecentMutation)
      }
    }
  }, [recentMutations, recentJobCreated])

  // Simply query the actual backend for active video jobs
  const { data: activeJobs, isLoading } = useQuery({
    queryKey: ['active-video-jobs'],
    queryFn: async () => {
      try {
        // Check for processing jobs
        const processingRes = await client.videoJob.listVideoJobs.mutate({ 
          status: 'processing' as const, 
          limit: 50, 
          offset: 0 
        })
        
        // Check for pending jobs  
        const pendingRes = await client.videoJob.listVideoJobs.mutate({ 
          status: 'pending' as const, 
          limit: 50, 
          offset: 0 
        })
        
        const allActiveJobs = [...(processingRes.jobs || []), ...(pendingRes.jobs || [])]
        
        console.log('[BackgroundProcessIndicator] Real backend status:', {
          processingJobs: processingRes.jobs?.length || 0,
          pendingJobs: pendingRes.jobs?.length || 0,
          totalActiveJobs: allActiveJobs.length,
          jobs: allActiveJobs.map(j => ({
            id: j.id?.substring(0, 8),
            status: j.status,
            platform: j.platform,
            createdAt: j.createdAt
          }))
        })
        
        return allActiveJobs
      } catch (error) {
        console.error('[BackgroundProcessIndicator] Error fetching real backend status:', error)
        return []
      }
    },
    refetchInterval: 3000, // Check backend every 3 seconds
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    // Add small delay on first fetch to ensure DB transactions are committed
    refetchOnWindowFocus: true,
  })

  // Combine backend jobs + recent job creation for immediate feedback
  const backendJobCount = activeJobs?.length || 0
  const recentJobCount = recentJobCreated ? 1 : 0
  const totalActiveCount = backendJobCount + recentJobCount
  
  const hasActiveProcesses = totalActiveCount > 0
  const activeProcessCount = totalActiveCount

  console.log('[BackgroundProcessIndicator] Combined status:', {
    backendJobCount,
    recentJobCreated,
    totalActiveCount,
    hasActiveProcesses
  })



  // Show page title indicator when processes are running
  useEffect(() => {
    if (hasActiveProcesses) {
      document.title = `(${activeProcessCount}) Processing - Postify`
    } else if (document.title.includes('Processing')) {
      document.title = 'Postify'
    }
  }, [hasActiveProcesses, activeProcessCount])

  // Auto-hide after showing for a moment
  useEffect(() => {
    if (hasActiveProcesses) {
      setIsVisible(true)
      // Auto-hide after 10 seconds, but keep checking
      const timer = setTimeout(() => setIsVisible(false), 10000)
      return () => clearTimeout(timer)
    }
  }, [hasActiveProcesses])

  // Don't render if no active processes
  if (!hasActiveProcesses) return null

  // Determine process type and status from real backend data
  const getProcessInfo = () => {
    if (activeProcessCount > 0) {
      return {
        icon: <Video className="w-4 h-4" />,
        text: activeProcessCount === 1 ? 'Processing video' : `Processing ${activeProcessCount} videos`,
        description: 'Videos will be posted automatically when ready'
      }
    }

    return {
      icon: <Loader2 className="w-4 h-4 animate-spin" />,
      text: 'Background processing',
      description: 'Operations running in background'
    }
  }

  const processInfo = getProcessInfo()

  return (
    <>
      {/* Floating Mini Indicator (Always Visible) */}
      <div className="fixed top-4 right-4 z-50 bg-primary text-white px-2 py-1 rounded-full shadow-lg flex items-center gap-1 text-xs font-medium animate-pulse">
        <Loader2 className="w-3 h-3 animate-spin" />
        {activeProcessCount}
      </div>

      {/* Expandable Status Card (Auto-hides) */}
      {isVisible && (
        <div className="fixed top-4 right-16 z-40 bg-white border border-neutral-200 rounded-lg shadow-lg p-3 max-w-sm animate-in slide-in-from-right-2 duration-300">
          <div className="flex items-start gap-3">
            <div className="text-primary animate-pulse">
              {processInfo.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-neutral-900 text-sm">
                {processInfo.text}
              </div>
              <div className="text-xs text-neutral-600 mt-1">
                {processInfo.description}
              </div>
              <div className="flex items-center gap-1 mt-2 text-xs text-neutral-500">
                <Clock className="w-3 h-3" />
                Updates every 3 seconds
              </div>
            </div>
            <button
              onClick={() => setIsVisible(false)}
              className="text-neutral-400 hover:text-neutral-600 transition-colors"
              aria-label="Hide status"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  )
}
