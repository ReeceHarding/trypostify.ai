'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import DuolingoButton from '@/components/ui/duolingo-button'
import DuolingoCheckbox from '@/components/ui/duolingo-checkbox'
import { useConfetti } from '@/hooks/use-confetti'
import { MediaFile, useTweets } from '@/hooks/use-tweets'
import PlaceholderPlugin from '@/lib/placeholder-plugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, $createParagraphNode, $createTextNode } from 'lexical'
import { initialConfig } from '@/hooks/use-tweets'
import { KeyboardShortcutsPlugin } from '@/lib/lexical-plugins/keyboard-shortcuts-plugin'
import MediaLibrary from '@/components/media-library'
import { SelectedMedia } from '@/types/media'

import { AccountAvatar, AccountHandle, AccountName } from '@/hooks/account-ctx'
import { useAttachments } from '@/hooks/use-attachments'
import { client } from '@/lib/client'
import MentionsPlugin from '@/lib/lexical-plugins/mention-plugin'
import { MentionTooltipPlugin } from '@/lib/lexical-plugins/mention-tooltip-plugin'
import ReactMentionsInput from './react-mentions-input'


import { useMutation } from '@tanstack/react-query'
import { HTTPException } from 'hono/http-exception'
import { toast } from 'react-hot-toast'
import {
  CalendarCog,
  ChevronDown,
  Clock,
  ImagePlus,
  Loader2,
  Pen,
  Trash2,
  Upload,
  X,
  Link2,
} from 'lucide-react'

import { PropsWithChildren } from 'react'
import { Icons } from '../icons'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '../ui/drawer'
import { Loader } from '../ui/loader'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover'
import ContentLengthIndicator from './content-length-indicator'
import { Calendar20 } from './date-picker'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { useHotkeyFeedback } from '../ui/hotkey-feedback'

interface ThreadTweetProps {
  isThread: boolean
  isFirstTweet: boolean
  isLastTweet: boolean
  canDelete: boolean
  editMode?: boolean
  hasBeenCleared?: boolean
  onClearComplete?: () => void
  onRemove?: () => void
  onPostThread?: () => void
  onQueueThread?: () => void
  onScheduleThread?: (date: Date) => void
  onUpdateThread?: () => void
  onCancelEdit?: () => void
  isPosting?: boolean
  onUpdate?: (content: string, media: Array<{ s3Key: string; media_id: string }>) => void
  initialContent?: string
  initialMedia?: Array<{ url: string; s3Key: string; media_id: string; type: 'image' | 'gif' | 'video' }>
  showFocusTooltip?: boolean
  focusShortcut?: string
  isDownloadingVideo?: boolean
  onDownloadingVideoChange?: (isDownloading: boolean) => void
  preScheduleTime?: Date | null
  mentionsInputRef?: React.RefObject<any>
}

// Twitter media type validation
const TWITTER_MEDIA_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  gif: ['image/gif'],
  video: ['video/mp4', 'video/quicktime', 'video/x-msvideo'],
} as const

const TWITTER_SIZE_LIMITS = {
  image: 5 * 1024 * 1024, // 5MB
  gif: 15 * 1024 * 1024, // 15MB
  video: 512 * 1024 * 1024, // 512MB
} as const

const MAX_MEDIA_COUNT = 4

function ThreadTweetContent({
  isThread,
  isFirstTweet,
  isLastTweet,
  canDelete,
  editMode = false,
  hasBeenCleared = false,
  onClearComplete,
  onRemove,
  onPostThread,
  onQueueThread,
  onScheduleThread,
  onUpdateThread,
  onCancelEdit,
  isPosting = false,
  onUpdate,
  initialContent = '',
  initialMedia = [],
  showFocusTooltip = false,
  focusShortcut,
  preScheduleTime = null,
  mentionsInputRef,
  isDownloadingVideo: externalIsDownloadingVideo,
  onDownloadingVideoChange,
}: ThreadTweetProps) {
  // State for react-mentions content
  const [mentionsContent, setMentionsContent] = useState(initialContent || '')
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([])
  const [charCount, setCharCount] = useState(0)
  // State for URL OG preview
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null)
  const [ogPreview, setOgPreview] = useState<{ url: string; title?: string; ogImage?: string } | null>(null)
  const [isLoadingOg, setIsLoadingOg] = useState(false)
  // State for video URL input
  const [videoUrl, setVideoUrl] = useState('')
  const [isDownloadingVideo, setIsDownloadingVideo] = useState(false)
  const [showVideoUrlInput, setShowVideoUrlInput] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)
  
  console.log('🎯 ThreadTweetContent rendering with mentionsContent:', mentionsContent)

  // URL detection regex
  const URL_REGEX = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/\/=]*)/g

  // Handler for react-mentions content changes
  const handleMentionsContentChange = useCallback((newContent: string) => {
    console.log('📝 Mentions content changed:', newContent)
    setMentionsContent(newContent)
    setCharCount(newContent.length)
    
    // Detect URLs in content
    const urls = newContent.match(URL_REGEX)
    const firstUrl = urls?.[0]
    
    // If we detected a new URL
    if (firstUrl && firstUrl !== detectedUrl) {
      setDetectedUrl(firstUrl)
      
      // Check if it's a supported video platform URL
      const videoPatterns = [
        /(?:instagram\.com|instagr\.am)\/(?:p|reel|tv)\//,
        /(?:tiktok\.com\/@[\w.-]+\/video\/|vm\.tiktok\.com\/)/,
        /(?:twitter\.com|x\.com)\/\w+\/status\//,
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)/,
      ]
      
      const isVideoUrl = videoPatterns.some(pattern => pattern.test(firstUrl))
      
      if (isVideoUrl && mediaFiles.length < MAX_MEDIA_COUNT) {
        // Automatically open the video URL dialog with the detected URL
        setVideoUrl(firstUrl)
        setShowVideoUrlInput(true)
        // Don't fetch OG preview for video URLs
      } else {
        // Otherwise fetch OG preview as before
        fetchOgData(firstUrl)
      }
    } else if (!firstUrl && detectedUrl) {
      // Clear preview if URL was removed
      setDetectedUrl(null)
      setOgPreview(null)
      setVideoUrl('')
    }
    
    // Notify parent component about the update
    if (onUpdate) {
      const filteredMedia = mediaFiles.filter(f => f.media_id && f.s3Key).map(f => ({
        s3Key: f.s3Key!,
        media_id: f.media_id!,
      }))
      onUpdate(newContent, filteredMedia)
    }
  }, [onUpdate, mediaFiles, detectedUrl])

  const [editor] = useLexicalComposerContext()
  const { currentTweet } = useTweets()
  const [isDragging, setIsDragging] = useState(false)
  const [showPostConfirmModal, setShowPostConfirmModal] = useState(false)
  const [skipPostConfirmation, setSkipPostConfirmation] = useState(false)
  const [open, setOpen] = useState(false)
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const [optimisticActionState, setOptimisticActionState] = useState<'post' | 'queue' | 'schedule' | null>(null)
  const { showAction } = useHotkeyFeedback()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortControllersRef = useRef(new Map<string, AbortController>())

  // Helper function to detect video files from URL even if type is wrong
  const isVideoFile = (mediaFile: MediaFile): boolean => {
    if (mediaFile.type === 'video') return true
    
    // Check file extension as fallback
    const url = mediaFile.url.toLowerCase()
    return url.includes('.mp4') || url.includes('.mov') || url.includes('.avi') || 
           url.includes('.webm') || url.includes('.mkv') || url.includes('.m4v')
  }

  // Render video with proper thumbnail preview
  const renderVideo = (mediaFile: MediaFile, className: string) => (
    <div className="relative">
      <video
        src={mediaFile.url}
        className={`${className}`}
        controls={false}
        preload="metadata"
        muted
        onLoadedMetadata={(e) => {
          // Set video to first frame to show as thumbnail
          const video = e.target as HTMLVideoElement
          video.currentTime = 0.1
        }}
      />
      {/* Play button overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 hover:bg-opacity-40 transition-colors cursor-pointer group"
           onClick={(e) => {
             e.preventDefault()
             const video = e.currentTarget.previousElementSibling as HTMLVideoElement
             if (video.paused) {
               video.play()
               video.setAttribute('controls', 'true')
               e.currentTarget.style.display = 'none'
             }
           }}>
        <div className="bg-white bg-opacity-90 rounded-full p-4 group-hover:bg-opacity-100 transition-colors">
          <svg className="w-8 h-8 text-neutral-800" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z"/>
          </svg>
        </div>
      </div>
    </div>
  )

  useEffect(() => {
    setSkipPostConfirmation(localStorage.getItem('skipPostConfirmation') === 'true')
  }, [])

  // Initialize content - only on first mount to avoid overwriting user input
  useEffect(() => {
    if (editor && initialContent) {
      editor.update(() => {
        const root = $getRoot()
        // Only set initial content if the editor is empty
        if (root.getTextContent() === '') {
          root.clear()
          const paragraph = $createParagraphNode()
          const text = $createTextNode(initialContent)
          paragraph.append(text)
          root.append(paragraph)
          // Also update char count
          setCharCount(initialContent.length)
        }
      }, { tag: 'initialization' })
    }
  }, [editor, initialContent])

  // Update editor when content is set from AI (only for first tweet)
  useEffect(() => {
    if (editor && isFirstTweet && currentTweet.content && !hasBeenCleared) {
      console.log('[ThreadTweet] AI content sync triggered:', {
        hasBeenCleared,
        currentTweetContent: currentTweet.content.substring(0, 50) + '...',
        timestamp: new Date().toISOString()
      })
      
      // Ensure the visible mentions input reflects AI content
      setMentionsContent(currentTweet.content)

      editor.update(() => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        const text = $createTextNode(currentTweet.content)
        paragraph.append(text)
        root.append(paragraph)
      })
      // Also notify the parent component about the update
      if (onUpdate) {
        onUpdate(currentTweet.content, mediaFiles.filter(m => m.s3Key).map(m => ({ 
          s3Key: m.s3Key!, 
          media_id: m.media_id || '' 
        })))
      }
    } else if (hasBeenCleared) {
      console.log('[ThreadTweet] Skipping AI content sync due to hasBeenCleared flag')
    }
  }, [editor, isFirstTweet, currentTweet.content, hasBeenCleared])

  // Reset the hasBeenCleared flag after we've handled it
  useEffect(() => {
    if (hasBeenCleared && onClearComplete) {
      console.log('[ThreadTweet] Calling onClearComplete to reset hasBeenCleared flag')
      onClearComplete()
    }
  }, [hasBeenCleared, onClearComplete])

  // Initialize media files when editing
  useEffect(() => {
    if (initialMedia && initialMedia.length > 0) {
      setMediaFiles(initialMedia.map(media => ({
        url: media.url,
        type: media.type,
        s3Key: media.s3Key,
        media_id: media.media_id,
        uploaded: true,
        uploading: false,
        file: null,
      })))
    }
  }, [initialMedia])

  // Character count is now handled in handleMentionsContentChange
  // Keep this effect for initial character count setup
  useEffect(() => {
    setCharCount(mentionsContent.length)
  }, [mentionsContent])

  // Upload mutations
  const uploadToS3Mutation = useMutation({
    mutationFn: async ({
      file,
      mediaType,
      fileUrl,
    }: {
      file: File
      mediaType: 'image' | 'gif' | 'video'
      fileUrl: string
    }) => {
      console.log('[ThreadTweet] Starting S3 upload for:', file.name)
      
      const controller = new AbortController()
      abortControllersRef.current.set(fileUrl, controller)

      const res = await client.file.uploadTweetMedia.$post({
        fileName: file.name,
        fileType: file.type,
      })

      if (!res.ok) {
        throw new Error('Failed to get upload URL')
      }

      const { url, fields, fileKey, sizeLimit } = await res.json()

      if (file.size > sizeLimit) {
        const sizeMB = (sizeLimit / 1024 / 1024).toFixed(0)
        throw new Error(`File size exceeds ${sizeMB}MB limit`)
      }

      const formData = new FormData()
      Object.entries(fields).forEach(([key, value]) => {
        formData.append(key, value as string)
      })
      formData.append('file', file)

      const uploadResponse = await fetch(url, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      if (!uploadResponse.ok) {
        throw new Error('Upload failed')
      }

      console.log('[ThreadTweet] S3 upload complete:', fileKey)
      return { fileKey, mediaType }
    },
  })

  const uploadToTwitterMutation = useMutation({
    mutationFn: async ({
      s3Key,
      mediaType,
    }: {
      s3Key: string
      mediaType: 'image' | 'gif' | 'video'
      fileUrl: string
    }) => {
      console.log('[ThreadTweet] Uploading to Twitter:', s3Key)
      
      const res = await client.tweet.uploadMediaToTwitter.$post({
        s3Key,
        mediaType,
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error((error as any).message || 'Twitter upload failed')
      }

      const data = await res.json()
      console.log('[ThreadTweet] Twitter upload complete:', data)
      return data
    },
  })

  const downloadVideoMutation = useMutation({
    mutationFn: async (input: { url: string; tweetContent?: string }) => {
      const res = await client.videoDownloader.downloadVideo.$post({
        url: input.url,
        tweetContent: input.tweetContent,
      })

      if (!res.ok) {
        const error = await res.text()
        throw new Error(error || 'Failed to download video')
      }

      const data = await res.json()
      return data
    },
  })

  // Fetch OG data for URL
  const fetchOgData = useCallback(async (url: string) => {
    if (!url || isLoadingOg) return
    
    console.log('[ThreadTweet] Fetching OG data for:', url)
    setIsLoadingOg(true)
    
    try {
      // Use the tweet router endpoint to fetch OG data
      const res = await client.tweet.fetchOgPreview.$post({
        url,
      })
      
      if (res.ok) {
        const data = await res.json()
        console.log('[ThreadTweet] OG data received:', data)
        setOgPreview({
          url: data.url,
          title: data.title || undefined,
          ogImage: data.ogImage || undefined,
        })
      } else {
        console.error('[ThreadTweet] Failed to fetch OG data')
        setOgPreview(null)
      }
    } catch (error) {
      console.error('[ThreadTweet] Error fetching OG data:', error)
      setOgPreview(null)
    } finally {
      setIsLoadingOg(false)
    }
  }, [isLoadingOg])

  const validateFile = (file: File): { valid: boolean; error?: string; type?: 'image' | 'gif' | 'video' } => {
    const fileType = file.type.toLowerCase()
    let mediaType: 'image' | 'gif' | 'video' | null = null

    if (TWITTER_MEDIA_TYPES.image.includes(fileType as any)) {
      mediaType = 'image'
    } else if (TWITTER_MEDIA_TYPES.gif.includes(fileType as any)) {
      mediaType = 'gif'
    } else if (TWITTER_MEDIA_TYPES.video.includes(fileType as any)) {
      mediaType = 'video'
    }

    if (!mediaType) {
      return {
        valid: false,
        error: `Unsupported file type. Twitter supports: JPG, PNG, WEBP, GIF, MP4`,
      }
    }

    const sizeLimit = TWITTER_SIZE_LIMITS[mediaType]
    if (file.size > sizeLimit) {
      const sizeMB = (sizeLimit / 1024 / 1024).toFixed(0)
      return {
        valid: false,
        error: `File size exceeds Twitter's ${sizeMB}MB limit for ${mediaType}s`,
      }
    }

    if (mediaFiles.length >= MAX_MEDIA_COUNT) {
      return {
        valid: false,
        error: `Maximum ${MAX_MEDIA_COUNT} media files allowed per tweet`,
      }
    }

    const hasVideo = mediaFiles.some((mf) => mf.type === 'video')
    const hasGif = mediaFiles.some((mf) => mf.type === 'gif')

    if ((hasVideo || hasGif) && mediaFiles.length > 0) {
      return {
        valid: false,
        error: 'Videos and GIFs cannot be combined with other media',
      }
    }

    if (mediaType === 'video' || mediaType === 'gif') {
      if (mediaFiles.length > 0) {
        return {
          valid: false,
          error: `${mediaType === 'video' ? 'Videos' : 'GIFs'} must be posted alone`,
        }
      }
    }

    return { valid: true, type: mediaType }
  }

  const handleFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files)

    for (const file of fileArray) {
      const validation = validateFile(file)

      if (!validation.valid) {
        toast.error(validation.error!)
        continue
      }

      const url = URL.createObjectURL(file)
      const mediaFile: MediaFile = {
        file,
        url,
        type: validation.type!,
        uploading: true,
        uploaded: false,
      }

      setMediaFiles((prev) => [...prev, mediaFile])

      try {
        // Upload to S3
        const s3Result = await uploadToS3Mutation.mutateAsync({
          file,
          mediaType: validation.type!,
          fileUrl: url,
        })

        // Upload to Twitter
        const twitterResult = await uploadToTwitterMutation.mutateAsync({
          s3Key: s3Result.fileKey,
          mediaType: s3Result.mediaType,
          fileUrl: url,
        })

        let nextFiles: MediaFile[] = []
        setMediaFiles((prev) => {
          nextFiles = prev.map((mf) =>
            mf.url === url
              ? {
                  ...mf,
                  uploading: false,
                  uploaded: true,
                  media_id: twitterResult.media_id,
                  media_key: twitterResult.media_key,
                  s3Key: s3Result.fileKey,
                }
              : mf,
          )
          return nextFiles
        })

        // Update parent with the freshly computed media list
        if (onUpdate) {
          const content = editor?.getEditorState().read(() => $getRoot().getTextContent()) || ''
          const parentMedia = nextFiles
            .filter((f) => f.media_id && f.s3Key)
            .map((f) => ({ s3Key: f.s3Key!, media_id: f.media_id! }))
          onUpdate(content, parentMedia)
        }
      } catch (error) {
        console.error('[ThreadTweet] Upload error:', error)
        setMediaFiles((prev) =>
          prev.map((mf) =>
            mf.url === url ? { ...mf, uploading: false, error: 'Upload failed' } : mf,
          ),
        )
      }
    }
  }

  const removeMediaFile = (index: number) => {
    const mediaFile = mediaFiles[index]
    if (mediaFile?.url) {
      URL.revokeObjectURL(mediaFile.url)
      const controller = abortControllersRef.current.get(mediaFile.url)
      if (controller) {
        controller.abort()
        abortControllersRef.current.delete(mediaFile.url)
      }
    }
    let nextFiles: MediaFile[] = []
    setMediaFiles((prev) => {
      nextFiles = prev.filter((_, i) => i !== index)
      return nextFiles
    })

    // Reflect removal in parent immediately
    if (onUpdate) {
      const content = editor?.getEditorState().read(() => $getRoot().getTextContent()) || ''
      const parentMedia = nextFiles
        .filter((f) => f.media_id && f.s3Key)
        .map((f) => ({ s3Key: f.s3Key!, media_id: f.media_id! }))
      onUpdate(content, parentMedia)
    }
  }

  const renderMediaOverlays = (mediaFile: MediaFile, index: number) => {
    return (
      <>
        {/* Remove button */}
        <button
          onClick={() => removeMediaFile(index)}
          className="absolute top-1 right-1 p-1.5 bg-neutral-900 bg-opacity-70 rounded-full transition-opacity hover:bg-opacity-90"
        >
          <X className="w-4 h-4 text-white" />
        </button>

        {/* Status overlays */}
        {mediaFile.uploading && (
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
            <Loader className="w-8 h-8 text-white animate-spin" />
          </div>
        )}

        {mediaFile.error && (
          <div className="absolute inset-0 bg-error-700 bg-opacity-80 flex items-center justify-center p-4">
            <p className="text-white text-sm text-center">{mediaFile.error}</p>
          </div>
        )}
      </>
    )
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    const imageFiles = files.filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/'))
    if (imageFiles.length > 0) {
      await handleFiles(imageFiles)
    }
  }

  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.clipboardData.items)
    const files: File[] = []

    for (const item of items) {
      if (item.type.startsWith('image/') || item.type.startsWith('video/')) {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }

    if (files.length > 0) {
      e.preventDefault()
      await handleFiles(files)
    }
  }

  const handleVideoUrlSubmit = async () => {
    if (!videoUrl.trim()) {
      toast.error('Please enter a video URL')
      return
    }

    // Check if we already have max media
    if (mediaFiles.length >= MAX_MEDIA_COUNT) {
      toast.error(`Maximum ${MAX_MEDIA_COUNT} media files allowed`)
      return
    }

    // Close dialog immediately and show progress
    setShowVideoUrlInput(false)
    setIsDownloadingVideo(true)
    setDownloadProgress(0)
    
    // Notify parent component about download state
    if (onDownloadingVideoChange) {
      onDownloadingVideoChange(true)
    }
    
    // Show initial toast with progress
    const toastId = toast.loading('Starting video download...', {
      duration: Infinity,
    })

    try {
      // Simulate progress updates during download (slower for pleasant surprise)
      let currentProgress = 0
      const progressInterval = setInterval(() => {
        // Much slower progress: 1-4% every 2 seconds, cap at 75%
        currentProgress = Math.min(currentProgress + Math.random() * 3 + 1, 75)
        setDownloadProgress(currentProgress)
        toast.loading(`Downloading video... ${Math.round(currentProgress)}%`, {
          id: toastId,
        })
      }, 2000)

      // Download video from URL with current tweet content
      const result = await downloadVideoMutation.mutateAsync({
        url: videoUrl,
        tweetContent: mentionsContent.trim() || undefined
      })
      
      clearInterval(progressInterval)
      
      // Quick finish animation - jump to 85%, then 95%, then 100%
      setDownloadProgress(85)
      toast.loading('Processing video...', { id: toastId })
      
      // Brief pause to show the jump
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // Create a media file object for the downloaded video
      const mediaFile: MediaFile = {
        file: null as any, // We don't have the actual File object, but we have the S3 key
        url: result.url,
        type: 'video',
        uploading: false,
        uploaded: true,
        s3Key: result.s3Key,
      }

      setDownloadProgress(95)
      
      // Upload to Twitter to get media_id
      const twitterResult = await uploadToTwitterMutation.mutateAsync({
        s3Key: result.s3Key,
        mediaType: 'video',
        fileUrl: result.url,
      })

      // Update media file with Twitter media_id
      mediaFile.media_id = twitterResult.media_id
      mediaFile.media_key = twitterResult.media_key

      // Add to media files
      setMediaFiles((prev) => [...prev, mediaFile])

      // Update parent with the new media
      if (onUpdate) {
        const content = mentionsContent
        const parentMedia = [...mediaFiles, mediaFile]
          .filter((f) => f.media_id && f.s3Key)
          .map((f) => ({ s3Key: f.s3Key!, media_id: f.media_id! }))
        onUpdate(content, parentMedia)
      }

      // Video is now ready and will be posted by background job
      console.log('[ThreadTweet] Video uploaded to Twitter successfully, media_id:', twitterResult.media_id)
      console.log('[ThreadTweet] Background job will post the video tweet automatically')

      // Final quick animation to 100%
      setDownloadProgress(100)
      await new Promise(resolve => setTimeout(resolve, 200))
      
      toast.success(`${result.orientation === 'portrait' ? '📱' : result.orientation === 'landscape' ? '🖥️' : '⬜'} Video from ${result.platform} added successfully!`, {
        id: toastId,
        duration: 3000,
      })
      setVideoUrl('')
    } catch (error) {
      console.error('[ThreadTweet] Video download error:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to download video', {
        id: toastId,
        duration: 5000,
      })
    } finally {
      setIsDownloadingVideo(false)
      setDownloadProgress(0)
      
      // Notify parent component download is complete
      if (onDownloadingVideoChange) {
        onDownloadingVideoChange(false)
      }
    }
  }

  const handleClearTweet = () => {
    // Abort all pending uploads
    abortControllersRef.current.forEach((controller) => {
      controller.abort('Tweet cleared')
    })

    // Clear all controllers
    abortControllersRef.current.clear()

    // Clear mentions input and all derived UI state
    setMentionsContent('')
    setCharCount(0)
    setDetectedUrl(null)
    setOgPreview(null)

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        root.append($createParagraphNode())
      },
      { tag: 'force-sync' },
    )

    setMediaFiles([])

    // Notify parent immediately
    if (onUpdate) {
      onUpdate('', [])
    }
  }

  // Detect OS for keyboard shortcuts
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0
  const metaKey = isMac ? 'Cmd' : 'Ctrl'

  // Keyboard shortcuts
  useEffect(() => {
    if (!isFirstTweet) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const actualMetaKey = isMac ? e.metaKey : e.ctrlKey

      if (editMode) {
        // Save: Cmd/Ctrl + Shift + S (avoids conflict with browser Save)
        if (actualMetaKey && e.shiftKey && e.key.toLowerCase() === 's' && onUpdateThread) {
          e.preventDefault()
          onUpdateThread()
        }
        // Cancel: Esc
        else if (e.key === 'Escape' && onCancelEdit) {
          e.preventDefault()
          onCancelEdit()
        }
      } else {
        // Post: Cmd/Ctrl + Enter
        if (actualMetaKey && e.key === 'Enter' && !e.shiftKey && onPostThread) {
          e.preventDefault()
          console.log(`[ThreadTweet] Post hotkey triggered at ${new Date().toISOString()}`)
          setOptimisticActionState('post')
          showAction('post')
          // Trigger post action immediately for instant UI feedback
          handlePostClick()
          // Clear optimistic state after brief feedback period
          setTimeout(() => setOptimisticActionState(null), 500)
        }
        // Queue: Cmd/Ctrl + E (for "Enqueue")
        else if (actualMetaKey && !e.shiftKey && e.key.toLowerCase() === 'e' && onQueueThread) {
          e.preventDefault()
          console.log(`[ThreadTweet] Queue hotkey triggered at ${new Date().toISOString()}`)
          setOptimisticActionState('queue')
          showAction('queue')
          // Trigger queue action immediately for instant UI feedback
          onQueueThread()
          // Clear optimistic state after brief feedback period
          setTimeout(() => setOptimisticActionState(null), 500)
        }
        // Schedule: Cmd/Ctrl + Shift + S (avoids conflict with browser Save)
        else if (actualMetaKey && e.shiftKey && e.key.toLowerCase() === 's' && onScheduleThread) {
          e.preventDefault()
          console.log(`[ThreadTweet] Schedule hotkey triggered at ${new Date().toISOString()}`)
          setOptimisticActionState('schedule')
          showAction('schedule')
          // Open schedule modal immediately for instant UI feedback
          setOpen(true)
          // Clear optimistic state after brief feedback period
          setTimeout(() => setOptimisticActionState(null), 500)
        }
      }

      // Common shortcuts for both modes
      // Upload: Cmd/Ctrl + Shift + U (avoids View Source conflicts)
      if (actualMetaKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'u') {
        e.preventDefault()
        console.log('[ThreadTweet] File upload shortcut triggered (Cmd+Shift+U) at', new Date().toISOString())
        fileInputRef.current?.click()
      }
      // Media Library: Ctrl + Shift + M (uses Control key to avoid minimize window conflicts)
      else if (e.ctrlKey && !e.metaKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        console.log('[ThreadTweet] Media library shortcut triggered (Ctrl+Shift+M) at', new Date().toISOString())
        setMediaLibraryOpen(true)
      }
      // Clear/Delete: Cmd/Ctrl + Shift + D (avoids conflict with browser Bookmark)
      else if (actualMetaKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        if (canDelete && onRemove) {
          onRemove()
        } else {
          handleClearTweet()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFirstTweet, editMode, isMac, onPostThread, onQueueThread, onScheduleThread, onUpdateThread, onCancelEdit, onRemove, canDelete])

  const handlePostClick = () => {
    console.log(`[ThreadTweet] Post button clicked at ${new Date().toISOString()}`)
    if (skipPostConfirmation) {
      if (onPostThread) {
        // Provide immediate optimistic feedback for direct posting
        setOptimisticActionState('post')
        onPostThread()
        setTimeout(() => setOptimisticActionState(null), 500)
      }
    } else {
      setShowPostConfirmModal(true)
    }
  }

  const handleConfirmPost = () => {
    console.log(`[ThreadTweet] Post confirmed via modal at ${new Date().toISOString()}`)
    setShowPostConfirmModal(false)
    if (onPostThread) {
      // Provide immediate optimistic feedback for confirmed posting
      setOptimisticActionState('post')
      onPostThread()
      setTimeout(() => setOptimisticActionState(null), 500)
    }
  }

  const toggleSkipConfirmation = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked
    setSkipPostConfirmation(checked)
    if (checked) {
      localStorage.setItem('skipPostConfirmation', 'true')
    } else {
      localStorage.removeItem('skipPostConfirmation')
    }
  }

  const handleMediaLibrarySelect = (selectedMedia: SelectedMedia[]) => {
    // Check if we can add more media
    const remainingSlots = MAX_MEDIA_COUNT - mediaFiles.length
    
    if (remainingSlots === 0) {
      toast.error(`Maximum ${MAX_MEDIA_COUNT} media files allowed per post`)
      return
    }
    
    // Check for media type mixing rules
    const hasVideo = mediaFiles.some((mf) => mf.type === 'video')
    const hasGif = mediaFiles.some((mf) => mf.type === 'gif')
    const hasImage = mediaFiles.some((mf) => mf.type === 'image')
    
    // Filter items that can be added based on mixing rules
    const validItemsToAdd = selectedMedia.filter(media => {
      if ((hasVideo || hasGif) && mediaFiles.length > 0) {
        toast.error('Videos and GIFs cannot be combined with other media')
        return false
      }
      
      if (media.type === 'video' || media.type === 'gif') {
        if (mediaFiles.length > 0) {
          toast.error(`${media.type === 'video' ? 'Videos' : 'GIFs'} must be posted alone`)
          return false
        }
      } else if (media.type === 'image') {
        if (hasVideo || hasGif) {
          toast.error('Cannot mix images with videos or GIFs')
          return false
        }
      }
      
      return true
    })
    
    const itemsToAdd = validItemsToAdd.slice(0, remainingSlots)

    if (itemsToAdd.length < selectedMedia.length) {
      if (itemsToAdd.length < validItemsToAdd.length) {
        toast.error(`Can only add ${remainingSlots} more media files`)
      }
    }

    const newMediaFiles: MediaFile[] = itemsToAdd.map(media => ({
      url: media.url,
      type: media.type,
      s3Key: media.s3Key,
      media_id: media.media_id,
      uploaded: true,
      uploading: false,
      file: null,
    }))
    
    setMediaFiles(prev => [...prev, ...newMediaFiles])
    
    // Update parent if exists
    if (onUpdate) {
      const content = editor?.getEditorState().read(() => $getRoot().getTextContent()) || ''
      const allMedia = [...mediaFiles, ...newMediaFiles].filter(f => f.media_id && f.s3Key).map(f => ({
        s3Key: f.s3Key!,
        media_id: f.media_id!,
      }))
      onUpdate(content, allMedia)
    }
    
    setOpen(false)
  }

  return (
    <>
      <Drawer modal={false} open={open} onOpenChange={setOpen}>
        <div
          className={cn(
            'relative bg-white p-6 rounded-2xl w-full border border-black border-opacity-[0.01] bg-clip-padding group isolate shadow-[var(--shadow-twitter)] transition-colors',
            isDragging && 'border-primary border-dashed',
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="flex gap-3 relative z-10">
            <AccountAvatar className="size-12" />

            <div className="flex-1">
              <div className="flex items-center gap-1">
                <AccountName />
                <AccountHandle />
              </div>

              <TooltipProvider>
                <Tooltip open={showFocusTooltip && showTooltip && !editor.getRootElement()?.matches(':focus-within')}>
                  <TooltipTrigger asChild>
                    <div 
                      className="text-neutral-800 leading-relaxed"
                      onMouseEnter={() => setShowTooltip(true)}
                      onMouseLeave={() => setShowTooltip(false)}
                    >
                      <ReactMentionsInput
                        ref={mentionsInputRef}
                        value={mentionsContent}
                        onChange={handleMentionsContentChange}
                        placeholder={isFirstTweet ? "What's happening?" : "Add another post..."}
                        onPaste={(e) => handlePaste(e as unknown as React.ClipboardEvent<HTMLDivElement>)}
                        className="w-full !min-h-16 resize-none text-base/7 leading-relaxed text-neutral-800 border-none p-0 focus-visible:ring-0 focus-visible:ring-offset-0 outline-none"
                      />
                      <KeyboardShortcutsPlugin 
                        onPost={handlePostClick}
                        onQueue={onQueueThread}
                        onActionTriggered={(action) => {
                          console.log(`[ThreadTweet] Hotkey triggered: ${action} at ${new Date().toISOString()}`)
                          // Immediate optimistic feedback
                          setOptimisticActionState(action)
                        }}
                        onActionComplete={() => {
                          console.log(`[ThreadTweet] Hotkey action completed at ${new Date().toISOString()}`)
                          // Clear optimistic state after brief delay
                          setTimeout(() => setOptimisticActionState(null), 300)
                        }}
                      />
                    </div>
                  </TooltipTrigger>
                  {focusShortcut && (
                    <TooltipContent>
                      <div className="space-y-1">
                        <p>Focus input</p>
                        <p className="text-xs text-neutral-400">{focusShortcut}</p>
                      </div>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>

              {/* Media Files Display */}
              {mediaFiles.length > 0 && (
                <div className="mt-3">
                  {mediaFiles.length === 1 && mediaFiles[0] && (
                    <div className="relative group">
                      <div className="relative overflow-hidden rounded-2xl border border-neutral-200">
                        {isVideoFile(mediaFiles[0]) ? (
                          renderVideo(mediaFiles[0], "w-full max-h-[510px] object-cover")
                        ) : (
                          <img
                            src={mediaFiles[0].url}
                            alt="Upload preview"
                            className="w-full max-h-[510px] object-cover"
                          />
                        )}
                        {renderMediaOverlays(mediaFiles[0], 0)}
                      </div>
                    </div>
                  )}

                  {mediaFiles.length === 2 && (
                    <div className="grid grid-cols-2 gap-0.5 rounded-2xl overflow-hidden border border-neutral-200">
                      {mediaFiles.map((mediaFile, index) => (
                        <div key={mediaFile.url} className="relative group">
                          <div className="relative overflow-hidden h-[254px]">
                            {isVideoFile(mediaFile) ? (
                              renderVideo(mediaFile, "w-full h-full object-cover")
                            ) : (
                              <img
                                src={mediaFile.url}
                                alt="Upload preview"
                                className="w-full h-full object-cover"
                              />
                            )}
                            {renderMediaOverlays(mediaFile, index)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {mediaFiles.length === 3 && mediaFiles[0] && (
                    <div className="grid grid-cols-2 gap-0.5 rounded-2xl overflow-hidden border border-neutral-200 h-[254px]">
                      <div className="relative group">
                        <div className="relative overflow-hidden h-full">
                          {isVideoFile(mediaFiles[0]) ? (
                            renderVideo(mediaFiles[0], "w-full h-full object-cover")
                          ) : (
                            <img
                              src={mediaFiles[0].url}
                              alt="Upload preview"
                              className="w-full h-full object-cover"
                            />
                          )}
                          {renderMediaOverlays(mediaFiles[0], 0)}
                        </div>
                      </div>
                      <div className="grid grid-rows-2 gap-0.5">
                        {mediaFiles.slice(1).map((mediaFile, index) => (
                          <div key={mediaFile.url} className="relative group">
                            <div className="relative overflow-hidden h-full">
                              {isVideoFile(mediaFile) ? (
                                renderVideo(mediaFile, "w-full h-full object-cover")
                              ) : (
                                <img
                                  src={mediaFile.url}
                                  alt="Upload preview"
                                  className="w-full h-full object-cover"
                                />
                              )}
                              {renderMediaOverlays(mediaFile, index + 1)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {mediaFiles.length === 4 && (
                    <div className="grid grid-cols-2 grid-rows-2 gap-0.5 rounded-2xl overflow-hidden border border-neutral-200 h-[254px]">
                      {mediaFiles.map((mediaFile, index) => (
                        <div key={mediaFile.url} className="relative group">
                          <div className="relative overflow-hidden h-full">
                            {isVideoFile(mediaFile) ? (
                              renderVideo(mediaFile, "w-full h-full object-cover")
                            ) : (
                              <img
                                src={mediaFile.url}
                                alt="Upload preview"
                                className="w-full h-full object-cover"
                              />
                            )}
                            {renderMediaOverlays(mediaFile, index)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* OG Preview Section */}
              {ogPreview && ogPreview.ogImage && (
                <div className="mt-3">
                  <div className="rounded-2xl overflow-hidden border border-neutral-200 relative group">
                    {isLoadingOg && (
                      <div className="absolute inset-0 bg-white bg-opacity-80 flex items-center justify-center z-10">
                        <Loader2 className="size-6 animate-spin text-primary" />
                      </div>
                    )}
                    <a 
                      href={ogPreview.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="block hover:opacity-90 transition-opacity"
                    >
                      <img
                        src={ogPreview.ogImage}
                        alt={ogPreview.title || 'Link preview'}
                        className="w-full object-cover"
                        onError={(e) => {
                          // Hide the preview if image fails to load
                          setOgPreview(null)
                        }}
                      />
                      {ogPreview.title && (
                        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-3">
                          <p className="text-white text-sm font-medium line-clamp-2">
                            {ogPreview.title}
                          </p>
                        </div>
                      )}
                    </a>
                    <button
                      onClick={() => setOgPreview(null)}
                      className="absolute top-2 right-2 bg-black bg-opacity-50 hover:bg-opacity-70 text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      type="button"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-neutral-200 flex items-center justify-between max-[320px]:flex-col max-[320px]:gap-3">
                <div
                  className={cn(
                    'flex items-center gap-1.5 bg-neutral-100 p-1.5 rounded-lg',
                  )}
                >
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DuolingoButton
                          variant="secondary"
                          size="icon"
                          className="rounded-md"
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Upload className="size-4" />
                          <span className="sr-only">Upload files</span>
                        </DuolingoButton>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="space-y-1">
                          <p>Upload media</p>
                          <p className="text-xs text-neutral-400">{metaKey} + {isMac ? 'Option' : 'Alt'} + U</p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <input
                    ref={fileInputRef}
                    id="media-upload"
                    type="file"
                    className="hidden"
                    accept="image/*,video/*"
                    multiple
                    onChange={(e) => {
                      if (e.target.files) {
                        handleFiles(e.target.files)
                      }
                    }}
                  />

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DuolingoButton
                          variant="secondary"
                          size="icon"
                          className="rounded-md"
                          onClick={() => setMediaLibraryOpen(true)}
                        >
                          <ImagePlus className="size-4" />
                          <span className="sr-only">Choose from library</span>
                        </DuolingoButton>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="space-y-1">
                          <p>Choose from library</p>
                          <p className="text-xs text-neutral-400">{metaKey} + {isMac ? 'Option' : 'Alt'} + M</p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DuolingoButton
                          variant="secondary"
                          size="icon"
                          className="rounded-md"
                          onClick={() => setShowVideoUrlInput(!showVideoUrlInput)}
                          disabled={mediaFiles.length >= MAX_MEDIA_COUNT || isDownloadingVideo}
                        >
                          <Link2 className="size-4" />
                          <span className="sr-only">Add video from URL</span>
                        </DuolingoButton>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="space-y-1">
                          <p>Add video from Instagram/TikTok</p>
                          <p className="text-xs text-neutral-400">Paste a link to download</p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  {/* Show delete/clear button */}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DuolingoButton
                          variant="secondary"
                          size="icon"
                          className="rounded-md"
                          onClick={canDelete ? onRemove : handleClearTweet}
                        >
                          <Trash2 className="size-4" />
                          <span className="sr-only">{canDelete ? 'Remove post' : 'Clear post'}</span>
                        </DuolingoButton>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="space-y-1">
                          <p>{canDelete ? 'Remove from thread' : 'Clear post'}</p>
                          <p className="text-xs text-neutral-400">{metaKey} + Shift + D</p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <div className="w-px h-4 bg-neutral-300 mx-2" />

                  <ContentLengthIndicator length={charCount} />
                </div>

                <div className="flex items-center gap-2 max-[320px]:flex-col max-[320px]:items-stretch max-[320px]:gap-3 max-[320px]:w-full">
                  {/* Show Post/Queue buttons only on first tweet or single tweet */}
                  {(!isThread || isFirstTweet) && (
                    <>
                      {editMode ? (
                        // Edit mode buttons
                        <div className="flex gap-2 max-[320px]:flex-col max-[320px]:gap-3 max-[320px]:w-full">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <DuolingoButton
                                  variant="secondary"
                                  className="h-11 px-6 max-[320px]:w-full"
                                  onClick={onCancelEdit}
                                  disabled={isPosting}
                                >
                                  Cancel
                                </DuolingoButton>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="space-y-1">
                                  <p>Cancel editing</p>
                                  <p className="text-xs text-neutral-400">Esc</p>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>

                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <DuolingoButton
                                  className="h-11 px-6 max-[320px]:w-full"
                                  onClick={onUpdateThread}
                                  disabled={isPosting || mediaFiles.some((f) => f.uploading)}
                                >
                                  <span className="text-sm">
                                    {isPosting ? 'Saving...' : 'Save'}
                                  </span>
                                </DuolingoButton>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="space-y-1">
                                  <p>Save changes</p>
                                  <p className="text-xs text-neutral-400">{metaKey} + Shift + S</p>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      ) : (
                        // Regular mode buttons
                        <div className="flex gap-2 max-[320px]:flex-col max-[320px]:gap-3 max-[320px]:w-full">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <DuolingoButton
                                  className="h-11 px-6 max-[320px]:w-full"
                                  variant="secondary"
                                  onClick={handlePostClick}
                                  disabled={isPosting || optimisticActionState === 'post' || mediaFiles.some((f) => f.uploading)}
                                  loading={isPosting || optimisticActionState === 'post'}
                                >
                                  <span className="text-sm">
                                    {isPosting || optimisticActionState === 'post' ? 'Posting...' : 'Post'}
                                  </span>
                                  <span className="sr-only">Post to Twitter</span>
                                </DuolingoButton>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="space-y-1">
                                  <p>
                                    {skipPostConfirmation
                                      ? 'The tweet will be posted immediately'
                                      : 'A confirmation modal will open'}
                                  </p>
                                  <p className="text-xs text-neutral-400">{metaKey} + Enter</p>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>

                          <div className="flex max-[320px]:w-full max-[320px]:flex-col max-[320px]:gap-3">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <DuolingoButton
                                    loading={isPosting || optimisticActionState === 'queue'}
                                    disabled={isPosting || optimisticActionState === 'queue' || mediaFiles.some((f) => f.uploading)}
                                    className="h-11 px-4 rounded-r-none border-r-0 max-[320px]:rounded-lg max-[320px]:border max-[320px]:w-full"
                                    onClick={() => {
                                      if (onQueueThread) {
                                        console.log(`[ThreadTweet] Queue button clicked at ${new Date().toISOString()}`)
                                        setOptimisticActionState('queue')
                                        showAction('queue')
                                        onQueueThread()
                                        // Clear optimistic state after feedback period
                                        setTimeout(() => setOptimisticActionState(null), 500)
                                      }
                                    }}
                                  >
                                    <Clock className="size-4 mr-2" />
                                    <span className="text-sm">Queue</span>
                                  </DuolingoButton>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div className="space-y-1">
                                    <p>Add to next queue slot</p>
                                    <p className="text-xs text-neutral-400">{metaKey} + E</p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <Popover open={open} onOpenChange={setOpen}>
                                  <TooltipTrigger asChild>
                                    <PopoverTrigger asChild>
                                      <DuolingoButton
                                        loading={isPosting || optimisticActionState === 'schedule'}
                                        disabled={isPosting || optimisticActionState === 'schedule' || mediaFiles.some((f) => f.uploading)}
                                        size="icon"
                                        className="h-11 w-14 rounded-l-none border-l max-[320px]:rounded-lg max-[320px]:border max-[320px]:w-full max-[320px]:justify-center"

                                      >
                                        <ChevronDown className="size-4" />
                                        <span className="sr-only max-[320px]:not-sr-only max-[320px]:ml-2">Schedule manually</span>
                                      </DuolingoButton>
                                    </PopoverTrigger>
                                  </TooltipTrigger>
                                  <PopoverContent 
                                    side="bottom"
                                    align="center"
                                    sideOffset={8}
                                    avoidCollisions
                                    collisionPadding={{ top: 16, bottom: 16, left: 8, right: 8 }}
                                    updatePositionStrategy="always"
                                    className="w-full max-w-[min(100dvw-1rem,28rem)] md:max-w-[min(100dvw-1rem,40rem)] max-h-[min(90dvh,calc(100dvh-4rem))] overflow-hidden p-0"

                                  >
                                    <Calendar20
                                      initialScheduledTime={preScheduleTime || undefined}
                                      onSchedule={(date, time) => {
                                        // Combine selected calendar date with the chosen HH:mm time
                                        try {
                                          const [hh, mm] = (time || '00:00').split(':').map((v) => Number(v))
                                          const scheduled = new Date(date)
                                          scheduled.setHours(hh || 0, mm || 0, 0, 0)
                                          // Debug log to trace scheduling values end-to-end
                                          console.log('[ThreadTweet] onSchedule selected', {
                                            rawDate: date?.toISOString?.(),
                                            time,
                                            combinedIso: scheduled.toISOString(),
                                          })
                                          if (onScheduleThread) {
                                            console.log(`[ThreadTweet] Schedule button clicked at ${new Date().toISOString()}`)
                                            setOptimisticActionState('schedule')
                                            showAction('schedule')
                                            onScheduleThread(scheduled)
                                            setOpen(false)
                                            // Clear optimistic state after feedback period
                                            setTimeout(() => setOptimisticActionState(null), 500)
                                          }
                                        } catch (e) {
                                          console.error('[ThreadTweet] onSchedule combine error', e)
                                          if (onScheduleThread) {
                                            console.log(`[ThreadTweet] Schedule fallback button clicked at ${new Date().toISOString()}`)
                                            setOptimisticActionState('schedule')
                                            showAction('schedule')
                                            onScheduleThread(date)
                                            setOpen(false)
                                            // Clear optimistic state after feedback period
                                            setTimeout(() => setOptimisticActionState(null), 500)
                                          }
                                        }
                                      }}
                                      isPending={isPosting || optimisticActionState === 'schedule'}
                                    />
                                  </PopoverContent>
                                </Popover>
                                <TooltipContent>
                                  <div className="space-y-1">
                                    <p>Schedule manually</p>
                                    <p className="text-xs text-neutral-400">{metaKey} + Shift + S</p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>

                            </TooltipProvider>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>


      </Drawer>

      {/* Media Library Popup */}
      <Dialog open={mediaLibraryOpen} onOpenChange={setMediaLibraryOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] p-0">
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle>Choose from library</DialogTitle>
          </DialogHeader>
          <div className="h-[calc(80vh-8rem)] px-6 pb-6 overflow-y-auto custom-scrollbar">
            <MediaLibrary
              onSelect={handleMediaLibrarySelect}
              maxSelection={MAX_MEDIA_COUNT - mediaFiles.length}
              selectedMedia={[]}
              onClose={() => setMediaLibraryOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Video URL Input Dialog */}
      <Dialog open={showVideoUrlInput} onOpenChange={setShowVideoUrlInput}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add video from URL</DialogTitle>
            <DialogDescription>
              Paste a link from Instagram, TikTok, Twitter/X, or YouTube to download and attach the video.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="video-url" className="text-sm font-medium">
                Video URL
              </label>
              <input
                id="video-url"
                type="url"
                placeholder="https://www.instagram.com/reel/..."
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isDownloadingVideo) {
                    handleVideoUrlSubmit()
                  }
                }}
                className="w-full px-3 py-2 border border-neutral-200 rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                disabled={isDownloadingVideo}
              />
            </div>
            <div className="text-xs text-neutral-500 space-y-1">
              <p>Supported platforms:</p>
              <ul className="list-disc list-inside space-y-0.5 ml-2">
                <li>Instagram (Posts, Reels, IGTV)</li>
                <li>TikTok</li>
                <li>Twitter/X</li>
                <li>YouTube (including Shorts)</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <DuolingoButton
              variant="secondary"
              className="px-4"
              onClick={() => {
                setShowVideoUrlInput(false)
                setVideoUrl('')
              }}
              disabled={isDownloadingVideo}
            >
              Cancel
            </DuolingoButton>
            <DuolingoButton
              className="px-4"
              onClick={handleVideoUrlSubmit}
              disabled={!videoUrl.trim() || isDownloadingVideo}
            >
              {isDownloadingVideo ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Downloading...
                </>
              ) : (
                'Download & Add'
              )}
            </DuolingoButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Post confirmation modal */}
      <Dialog open={showPostConfirmModal} onOpenChange={setShowPostConfirmModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Post?</DialogTitle>
            <DialogDescription>
              Are you sure you want to post this immediately?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <DuolingoCheckbox
                id="skip-confirmation"
                label=""
                checked={skipPostConfirmation}
                onChange={toggleSkipConfirmation}
              />
              <label
                htmlFor="skip-confirmation"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Don't ask me again
              </label>
            </div>
            <div className="flex gap-3 justify-end">
              <DuolingoButton
                variant="secondary"
                onClick={() => setShowPostConfirmModal(false)}
              >
                Cancel
              </DuolingoButton>
              <DuolingoButton onClick={handleConfirmPost}>
                Post
              </DuolingoButton>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

const ThreadTweetContentWithRef = React.forwardRef<any, ThreadTweetProps>((props, ref) => {
  const [editor] = useLexicalComposerContext()
  const mentionsInputRef = useRef<any>(null)
  
  React.useImperativeHandle(ref, () => ({
    focus: () => {
      if (mentionsInputRef.current) {
        mentionsInputRef.current.focus()
      }
    }
  }))
  
  return <ThreadTweetContent {...props} mentionsInputRef={mentionsInputRef} />
})

ThreadTweetContentWithRef.displayName = 'ThreadTweetContentWithRef'

const ThreadTweet = React.forwardRef<{ focus: () => void }, ThreadTweetProps>((props, ref) => {
  const editorRef = useRef<any>(null)

  React.useImperativeHandle(ref, () => ({
    focus: () => {
      if (editorRef.current) {
        editorRef.current.focus()
      }
    }
  }))

  return (
    <LexicalComposer initialConfig={{ ...initialConfig }}>
      <ThreadTweetContentWithRef {...props} ref={editorRef} />
    </LexicalComposer>
  )
})

ThreadTweet.displayName = 'ThreadTweet'

export default ThreadTweet
