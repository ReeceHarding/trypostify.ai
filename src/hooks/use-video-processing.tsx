'use client'

import React, { createContext, useContext, useState, useCallback } from 'react'

export interface ProcessingVideo {
  threadId: string
  url: string
  platform?: string
  progress: number
  status: 'downloading' | 'processing' | 'uploading' | 'completed' | 'error'
  message?: string
  startedAt: Date
}

interface VideoProcessingContextType {
  processingVideos: ProcessingVideo[]
  addProcessingVideo: (video: ProcessingVideo) => void
  updateProcessingVideo: (threadId: string, updates: Partial<ProcessingVideo>) => void
  removeProcessingVideo: (threadId: string) => void
  hasProcessingVideos: boolean
}

const VideoProcessingContext = createContext<VideoProcessingContextType | undefined>(undefined)

export function VideoProcessingProvider({ children }: { children: React.ReactNode }) {
  const [processingVideos, setProcessingVideos] = useState<ProcessingVideo[]>([])

  const addProcessingVideo = useCallback((video: ProcessingVideo) => {
    setProcessingVideos(prev => [...prev, video])
  }, [])

  const updateProcessingVideo = useCallback((threadId: string, updates: Partial<ProcessingVideo>) => {
    setProcessingVideos(prev => 
      prev.map(video => 
        video.threadId === threadId 
          ? { ...video, ...updates }
          : video
      )
    )
  }, [])

  const removeProcessingVideo = useCallback((threadId: string) => {
    setProcessingVideos(prev => prev.filter(video => video.threadId !== threadId))
  }, [])

  const hasProcessingVideos = processingVideos.length > 0

  return (
    <VideoProcessingContext.Provider value={{
      processingVideos,
      addProcessingVideo,
      updateProcessingVideo,
      removeProcessingVideo,
      hasProcessingVideos
    }}>
      {children}
    </VideoProcessingContext.Provider>
  )
}

export function useVideoProcessing() {
  const context = useContext(VideoProcessingContext)
  if (context === undefined) {
    throw new Error('useVideoProcessing must be used within a VideoProcessingProvider')
  }
  return context
}
