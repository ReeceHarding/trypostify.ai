'use client'

import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/client'
import { Loader2, Video, Clock } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useUser } from '@/hooks/use-user'

export default function BackgroundProcessIndicator() {
  const [isVisible, setIsVisible] = useState(false)
  const { user, isLoading: userLoading } = useUser()
  
  // Debug logging
  useEffect(() => {
    console.log('[BackgroundProcessIndicator] Component mounted')
    return () => {
      console.log('[BackgroundProcessIndicator] Component unmounted')
    }
  }, [])

  // Use the same unified query as all other components - SINGLE SOURCE OF TRUTH
  const { data: activeJobs, isLoading, error } = useQuery({
    queryKey: ['active-video-jobs'], // Same key as other components
    queryFn: async () => {
      console.log('[BackgroundProcessIndicator] 🔍 Fetching active jobs from database...')
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
        
        console.log('[BackgroundProcessIndicator] ✅ Found', allActiveJobs.length, 'active jobs:', {
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
        console.error('[BackgroundProcessIndicator] ❌ Error fetching jobs:', error)
        
        // If unauthorized, user is not logged in - return empty array silently
        if (error instanceof Error && (error.message.includes('Unauthorized') || error.message.includes('401'))) {
          console.log('[BackgroundProcessIndicator] 🔒 User not authenticated - skipping video job polling')
          return []
        }
        
        // For other errors, still return empty array to prevent crash
        return []
      }
    },
    refetchInterval: (query) => {
      // Don't poll if there was an auth error
      if (query.state.error && query.state.error.message?.includes('Unauthorized')) {
        console.log('[BackgroundProcessIndicator] 🔒 Stopping polling due to auth error')
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
        console.log('[BackgroundProcessIndicator] 🔒 Not retrying unauthorized error')
        return false
      }
      // Retry other errors up to 3 times
      return failureCount < 3
    },
    enabled: !!user && !userLoading, // Only enabled when user is authenticated
  })

  // Use database state only - no client-side optimistic updates
  const hasActiveProcesses = activeJobs && activeJobs.length > 0
  const activeProcessCount = activeJobs?.length || 0

  console.log('[BackgroundProcessIndicator] Database-only status:', {
    activeJobsCount: activeProcessCount,
    hasActiveProcesses,
    isLoading,
    hasError: !!error,
    errorMessage: error?.message,
    isUnauthorized: error?.message?.includes('Unauthorized') || error?.message?.includes('401'),
    userAuthenticated: !!user,
    userLoading,
    queryEnabled: !!user && !userLoading
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

  // Determine process type and status from database data
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
                Updates every 5 seconds
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
