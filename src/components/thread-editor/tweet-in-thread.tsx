'use client'

import { cn } from '@/lib/utils'
import { MediaFile } from '@/hooks/use-tweets'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { AccountAvatar, AccountHandle, AccountName } from '@/hooks/account-ctx'
import PlaceholderPlugin from '@/lib/placeholder-plugin'
import { $getRoot } from 'lexical'
import { ImagePlus, Trash2, Upload, X, Clock } from 'lucide-react'
import { useRef, useState, useEffect } from 'react'
import MediaDisplay from '../media-display'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import Tweet from '../tweet-editor/tweet'

interface TweetInThreadProps {
  isFirst: boolean
  position: number
  editor: any
  media: MediaFile[]
  delayMs: number
  onContentChange: (content: string) => void
  onMediaChange: (media: MediaFile[]) => void
  onDelayChange: (delay: number) => void
  onRemove?: () => void
}

export default function TweetInThread({
  isFirst,
  position,
  editor,
  media,
  delayMs,
  onContentChange,
  onMediaChange,
  onDelayChange,
  onRemove,
}: TweetInThreadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [charCount, setCharCount] = useState(0)

  useEffect(() => {
    // Listen for changes to update character count
    const unregister = editor.registerUpdateListener(() => {
      editor.read(() => {
        const text = $getRoot().getTextContent()
        setCharCount(text.length)
        onContentChange(text)
      })
    })

    return unregister
  }, [editor, onContentChange])

  const handleMediaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const newMediaFiles: MediaFile[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file) {
        newMediaFiles.push({
          file,
          type: file.type.startsWith('video/') ? 'video' : 'image',
          url: URL.createObjectURL(file),
          uploading: false,
          uploaded: false,
        })
      }
    }

    onMediaChange([...media, ...newMediaFiles])
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const removeMedia = (url: string) => {
    const mediaFile = media.find((m) => m.url === url)
    if (mediaFile?.url) {
      URL.revokeObjectURL(mediaFile.url)
    }
    onMediaChange(media.filter((m) => m.url !== url))
  }

  const handleClearTweet = () => {
    editor.update(() => {
      const root = $getRoot()
      root.clear()
    })
    onMediaChange([])
  }

  const delayOptions = [
    { value: 0, label: 'No delay' },
    { value: 2000, label: '2 seconds' },
    { value: 5000, label: '5 seconds' },
    { value: 10000, label: '10 seconds' },
    { value: 30000, label: '30 seconds' },
    { value: 60000, label: '1 minute' },
  ]

  // If it's the first tweet, render the full Tweet component
  if (isFirst) {
    return <Tweet />
  }

  // For subsequent tweets, use the provided template
  return (
    <div className="relative bg-white p-6 rounded-2xl w-full border border-opacity-[0.01] bg-clip-padding group isolate shadow-[0_1px_1px_rgba(0,0,0,0.05),0_4px_6px_rgba(34,42,53,0.04),0_24px_68px_rgba(47,48,55,0.05),0_2px_3px_rgba(0,0,0,0.04)] transition-colors">
      {/* Delay selector for non-first tweets */}
      {!isFirst && (
        <div className="absolute -top-10 left-12 flex items-center gap-2 text-sm text-stone-500">
          <Clock className="w-4 h-4" />
          <Select
            value={delayMs.toString()}
            onValueChange={(value) => onDelayChange(parseInt(value))}
          >
            <SelectTrigger className="h-7 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {delayOptions.map((option) => (
                <SelectItem key={option.value} value={option.value.toString()}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex gap-3 relative z-10">
        <AccountAvatar />
        <div className="flex-1">
          <div className="flex items-center gap-1">
            <AccountName />
            <AccountHandle />
          </div>
          
          <div className="text-stone-800 leading-relaxed">
            <PlainTextPlugin
              contentEditable={
                <ContentEditable
                  className="w-full !min-h-16 resize-none text-base/7 leading-relaxed text-stone-800 border-none p-0 focus-visible:ring-0 focus-visible:ring-offset-0 outline-none show-placeholder"
                  spellCheck={false}
                />
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin />
            <PlaceholderPlugin placeholder="Add another tweet..." />
          </div>

          {/* Media display */}
          {media.length > 0 && (
            <div className="mt-3">
              <MediaDisplay mediaFiles={media} removeMediaFile={removeMedia} />
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-stone-200 flex items-center justify-between">
            <div className="flex items-center gap-1.5 bg-stone-100 p-1.5 rounded-lg">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="font-semibold relative transition-transform active:translate-y-0.5 active:shadow-none focus:outline-none flex items-center justify-center bg-[#FFFFFF] border bg-clip-padding text-stone-800 border-b-2 border-[#E5E5E5] hover:bg-light-gray shadow-[0_3px_0_#E5E5E5] focus:ring-[#E5E5E5] h-10 w-10 rounded-md"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="size-4" />
                    <span className="sr-only">Upload files</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Upload files</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="font-semibold relative transition-transform active:translate-y-0.5 active:shadow-none focus:outline-none flex items-center justify-center bg-[#FFFFFF] border bg-clip-padding text-stone-800 border-b-2 border-[#E5E5E5] hover:bg-light-gray shadow-[0_3px_0_#E5E5E5] focus:ring-[#E5E5E5] h-10 w-10 rounded-md"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus className="size-4" />
                    <span className="sr-only">Add image</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Add image</TooltipContent>
              </Tooltip>

              <input
                ref={fileInputRef}
                id={`media-upload-${position}`}
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                multiple
                className="hidden"
                type="file"
                onChange={handleMediaUpload}
              />

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="font-semibold relative transition-transform active:translate-y-0.5 active:shadow-none focus:outline-none flex items-center justify-center bg-[#FFFFFF] border bg-clip-padding text-stone-800 border-b-2 border-[#E5E5E5] hover:bg-light-gray shadow-[0_3px_0_#E5E5E5] focus:ring-[#E5E5E5] h-10 w-10 rounded-md"
                    onClick={handleClearTweet}
                  >
                    <Trash2 className="size-4" />
                    <span className="sr-only">Clear tweet</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear tweet</TooltipContent>
              </Tooltip>

              <div className="w-px h-4 bg-stone-300 mx-2" />
              
              <div className="relative flex items-center justify-center">
                <div className="h-8 w-8">
                  <svg className="-ml-[5px] -rotate-90 w-full h-full">
                    <circle
                      className="text-stone-200"
                      strokeWidth="2"
                      stroke="currentColor"
                      fill="transparent"
                      r="10"
                      cx="16"
                      cy="16"
                    />
                    <circle
                      className={`${charCount > 280 ? 'text-red-500' : 'text-blue-500'} transition-all duration-200`}
                      strokeWidth="2"
                      strokeDasharray={2 * Math.PI * 10}
                      strokeDashoffset={2 * Math.PI * 10 - (Math.min(charCount / 280, 1) * 2 * Math.PI * 10)}
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="transparent"
                      r="10"
                      cx="16"
                      cy="16"
                    />
                  </svg>
                </div>
                {charCount > 260 && (
                  <div className={`absolute text-xs ${charCount > 280 ? 'text-red-500' : 'text-stone-600'}`}>
                    {280 - charCount}
                  </div>
                )}
              </div>
            </div>

            {onRemove && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-red-500 hover:text-red-700"
                    onClick={onRemove}
                  >
                    <X className="w-4 h-4" />
                    <span className="sr-only">Remove tweet</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Remove from thread</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
