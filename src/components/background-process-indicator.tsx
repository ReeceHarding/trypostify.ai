'use client'

import { useQuery } from '@tanstack/react-query'
import { client } from '@/lib/client'
import { Loader2, Video, Send, Clock } from 'lucide-react'
import { useState, useEffect } from 'react'

export default function BackgroundProcessIndicator() {
  const [isVisible, setIsVisible] = useState(false)

  // Check for background video processing
  const { data: processingVideos } = useQuery({
    queryKey: ['global-background-processes'],
    queryFn: async () => {
      try {
        const res = await client.videoJob.listVideoJobs.mutate({ 
          status: 'processing' as const, 
          limit: 50, 
          offset: 0 
        })
        return res.jobs || []
      } catch (error) {
        console.error('[BackgroundProcessIndicator] Error fetching video jobs:', error)
        return []
      }
    },
    refetchInterval: 3000, // Check every 3 seconds
    retry: false,
    staleTime: 0,
  })

  const activeProcessCount = processingVideos?.length || 0
  const hasActiveProcesses = activeProcessCount > 0

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

  // Determine process type and status
  const getProcessInfo = () => {
    const videoProcesses = processingVideos?.filter(job => job.status === 'processing') || []
    
    if (videoProcesses.length > 0) {
      return {
        icon: <Video className="w-4 h-4" />,
        text: videoProcesses.length === 1 ? 'Processing video' : `Processing ${videoProcesses.length} videos`,
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
