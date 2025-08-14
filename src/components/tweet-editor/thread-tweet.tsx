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
} from 'lucide-react'
import Link from 'next/link'
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
}: ThreadTweetProps) {

  const [editor] = useLexicalComposerContext()
  const { currentTweet } = useTweets()
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([])
  const [charCount, setCharCount] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [showPostConfirmModal, setShowPostConfirmModal] = useState(false)
  const [skipPostConfirmation, setSkipPostConfirmation] = useState(false)
  const [open, setOpen] = useState(false)
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortControllersRef = useRef(new Map<string, AbortController>())

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
      
      editor.update(() => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        const text = $createTextNode(currentTweet.content)
        paragraph.append(text)
        root.append(paragraph)
        setCharCount(currentTweet.content.length)
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

  // Update parent when content changes
  useEffect(() => {
    if (editor) {
      const unregister = editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const content = $getRoot().getTextContent()
          setCharCount(content.length)
          if (onUpdate) {
            onUpdate(content, mediaFiles.filter(f => f.media_id && f.s3Key).map(f => ({
              s3Key: f.s3Key!,
              media_id: f.media_id!,
            })))
          }
        })
      })
      return () => unregister()
    }
  }, [editor, onUpdate, mediaFiles])

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

  const handleClearTweet = () => {
    // Abort all pending uploads
    abortControllersRef.current.forEach((controller) => {
      controller.abort('Tweet cleared')
    })

    // Clear all controllers
    abortControllersRef.current.clear()

    editor.update(
      () => {
        const root = $getRoot()
        root.clear()
        root.append($createParagraphNode())
      },
      { tag: 'force-sync' },
    )

    setMediaFiles([])
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
          handlePostClick()
        }
        // Queue: Cmd/Ctrl + Q
        else if (actualMetaKey && e.key.toLowerCase() === 'q' && onQueueThread) {
          e.preventDefault()
          onQueueThread()
        }
        // Schedule: Cmd/Ctrl + Shift + S (avoids conflict with browser Save)
        else if (actualMetaKey && e.shiftKey && e.key.toLowerCase() === 's' && onScheduleThread) {
          e.preventDefault()
          setOpen(true)
        }
      }

      // Common shortcuts for both modes
      // Upload: Cmd/Ctrl + U
      if (actualMetaKey && e.key.toLowerCase() === 'u') {
        e.preventDefault()
        fileInputRef.current?.click()
      }
      // Media Library: Cmd/Ctrl + M
      else if (actualMetaKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
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
    if (skipPostConfirmation) {
      if (onPostThread) {
        onPostThread()
      }
    } else {
      setShowPostConfirmModal(true)
    }
  }

  const handleConfirmPost = () => {
    setShowPostConfirmModal(false)
    if (onPostThread) {
      onPostThread()
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
                      <PlainTextPlugin
                        contentEditable={
                          <ContentEditable
                            spellCheck={false}
                            onPaste={handlePaste}
                            className={cn(
                              'w-full !min-h-16 resize-none text-base/7 leading-relaxed text-neutral-800 border-none p-0 focus-visible:ring-0 focus-visible:ring-offset-0 outline-none',
                            )}
                          />
                        }
                        ErrorBoundary={LexicalErrorBoundary}
                      />
                      <PlaceholderPlugin placeholder={isFirstTweet ? "What's happening?" : "Add another post..."} />
                      <HistoryPlugin />
                      <MentionsPlugin />
                      <MentionTooltipPlugin />
                      <KeyboardShortcutsPlugin 
                        onPost={handlePostClick}
                        onQueue={onQueueThread}
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
                        {mediaFiles[0].type === 'video' ? (
                          <video
                            src={mediaFiles[0].url}
                            className="w-full max-h-[510px] object-cover"
                            controls={false}
                          />
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
                            {mediaFile.type === 'video' ? (
                              <video
                                src={mediaFile.url}
                                className="w-full h-full object-cover"
                                controls={false}
                              />
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
                          {mediaFiles[0].type === 'video' ? (
                            <video
                              src={mediaFiles[0].url}
                              className="w-full h-full object-cover"
                              controls={false}
                            />
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
                              {mediaFile.type === 'video' ? (
                                <video
                                  src={mediaFile.url}
                                  className="w-full h-full object-cover"
                                  controls={false}
                                />
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
                            {mediaFile.type === 'video' ? (
                              <video
                                src={mediaFile.url}
                                className="w-full h-full object-cover"
                                controls={false}
                              />
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

              <div className="mt-3 pt-3 border-t border-neutral-200 flex items-center justify-between">
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
                          <p className="text-xs text-neutral-400">{metaKey} + U</p>
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
                          <p className="text-xs text-neutral-400">{metaKey} + M</p>
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

                <div className="flex items-center gap-2">
                  {/* Show Post/Queue buttons only on first tweet or single tweet */}
                  {(!isThread || isFirstTweet) && (
                    <>
                      {editMode ? (
                        // Edit mode buttons
                        <>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <DuolingoButton
                                  variant="secondary"
                                  className="h-11"
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
                                  className="h-11"
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
                        </>
                      ) : (
                        // Regular mode buttons
                        <>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <DuolingoButton
                                  className="h-11"
                                  variant="secondary"
                                  onClick={handlePostClick}
                                  disabled={isPosting || mediaFiles.some((f) => f.uploading)}
                                >
                                  <span className="text-sm">
                                    {isPosting ? 'Posting...' : 'Post'}
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

                          <div className="flex">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <DuolingoButton
                                    loading={isPosting}
                                    disabled={mediaFiles.some((f) => f.uploading)}
                                    className="h-11 px-3 rounded-r-none border-r-0"
                                    onClick={() => {
                                      if (onQueueThread) {
                                        onQueueThread()
                                      }
                                    }}
                                  >
                                    <Clock className="size-4 mr-2" />
                                    <span className="text-sm">Queue</span>
                                  </DuolingoButton>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div className="space-y-1">
                                    <p>
                                      Add to next queue slot -{' '}
                                      <Link
                                        href="/studio/scheduled"
                                        className="underline decoration-2 underline-offset-2"
                                      >
                                        what is this?
                                      </Link>
                                    </p>
                                    <p className="text-xs text-neutral-400">{metaKey} + Q</p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>

                              <Tooltip>
                                <Popover>
                                  <TooltipTrigger asChild>
                                    <PopoverTrigger asChild>
                                      <DuolingoButton
                                        loading={isPosting}
                                        disabled={mediaFiles.some((f) => f.uploading)}
                                        size="icon"
                                        className="h-11 w-14 rounded-l-none border-l"
                                      >
                                        <ChevronDown className="size-4" />
                                        <span className="sr-only">Schedule manually</span>
                                      </DuolingoButton>
                                    </PopoverTrigger>
                                  </TooltipTrigger>
                                  <PopoverContent className="max-w-3xl w-full">
                                    <Calendar20
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
                                          if (onScheduleThread) onScheduleThread(scheduled)
                                        } catch (e) {
                                          console.error('[ThreadTweet] onSchedule combine error', e)
                                          if (onScheduleThread) onScheduleThread(date)
                                        }
                                      }}
                                      isPending={isPosting}
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
                        </>
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

      {/* Post confirmation modal */}
      <Dialog open={showPostConfirmModal} onOpenChange={setShowPostConfirmModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Post Now?</DialogTitle>
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
                Post Now
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
  
  React.useImperativeHandle(ref, () => ({
    focus: () => {
      editor.focus()
    }
  }))
  
  return <ThreadTweetContent {...props} />
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
