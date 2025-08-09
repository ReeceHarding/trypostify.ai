'use client'

import { cn } from '@/lib/utils'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { AccountAvatar, AccountHandle, AccountName } from '@/hooks/account-ctx'
import { useState, useRef } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot } from 'lexical'
import { useEffect } from 'react'
import { ImagePlus, Upload, Trash2, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import PlaceholderPlugin from '@/lib/placeholder-plugin'

interface ThreadTweetProps {
  isFirst?: boolean
  placeholder?: string
  onRemove?: () => void
  onChange?: (content: string) => void
}

// Character counter component
function CharacterCounter() {
  const [editor] = useLexicalComposerContext()
  const [charCount, setCharCount] = useState(0)
  
  useEffect(() => {
    return editor.registerUpdateListener(() => {
      editor.getEditorState().read(() => {
        const text = $getRoot().getTextContent()
        setCharCount(text.length)
      })
    })
  }, [editor])

  const percentage = (charCount / 280) * 100
  const isOverLimit = charCount > 280
  const isNearLimit = charCount > 250

  return (
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
            className={cn(
              "transition-all duration-200",
              isOverLimit ? "text-red-500" : isNearLimit ? "text-yellow-500" : "text-blue-500"
            )}
            strokeWidth="2"
            strokeDasharray={62.83185307179586}
            strokeDashoffset={62.83185307179586 - (62.83185307179586 * Math.min(percentage, 100)) / 100}
            strokeLinecap="round"
            stroke="currentColor"
            fill="transparent"
            r="10"
            cx="16"
            cy="16"
          />
        </svg>
      </div>
      {isOverLimit && (
        <span className="absolute text-xs font-medium text-red-500">
          {charCount - 280}
        </span>
      )}
    </div>
  )
}

function TweetContent({ isFirst, placeholder, onRemove, onChange }: ThreadTweetProps) {
  const [mediaFiles, setMediaFiles] = useState<Array<{ id: string; url: string; file: File }>>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleMediaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const newFiles = Array.from(files).map(file => ({
      id: crypto.randomUUID(),
      url: URL.createObjectURL(file),
      file
    }))

    setMediaFiles(prev => [...prev, ...newFiles].slice(0, 4)) // Max 4 media files
  }

  const removeMedia = (id: string) => {
    setMediaFiles(prev => prev.filter(f => f.id !== id))
  }

  return (
    <div className="relative bg-white p-6 rounded-2xl w-full border border-opacity-[0.01] bg-clip-padding group isolate shadow-[0_1px_1px_rgba(0,0,0,0.05),0_4px_6px_rgba(34,42,53,0.04),0_24px_68px_rgba(47,48,55,0.05),0_2px_3px_rgba(0,0,0,0.04)] transition-colors">
      <div className="flex gap-3 relative z-10">
        <AccountAvatar className="size-12" />
        <div className="flex-1">
          <div className="flex items-center gap-1">
            <AccountName className="font-semibold inline-flex items-center gap-1" />
            <AccountHandle className="text-stone-400" />
            {onRemove && (
              <button
                onClick={onRemove}
                className="ml-auto p-1 hover:bg-stone-100 rounded-full transition-colors"
              >
                <X className="size-4 text-stone-500" />
              </button>
            )}
          </div>
          <div className="text-stone-800 leading-relaxed">
            <PlainTextPlugin
              contentEditable={
                <ContentEditable 
                  className="w-full !min-h-16 resize-none text-base/7 leading-relaxed text-stone-800 border-none p-0 focus-visible:ring-0 focus-visible:ring-offset-0 outline-none"
                />
              }
              placeholder={<PlaceholderPlugin placeholder={placeholder || "What's happening?"} />}
              ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin />
            <OnChangePlugin onChange={onChange} />
          </div>

          {/* Media display */}
          {mediaFiles.length > 0 && (
            <div className={cn(
              "mt-3 grid gap-2",
              mediaFiles.length === 1 ? "grid-cols-1" : 
              mediaFiles.length === 2 ? "grid-cols-2" : 
              mediaFiles.length === 3 ? "grid-cols-2" : "grid-cols-2"
            )}>
              {mediaFiles.map((file, index) => (
                <div 
                  key={file.id} 
                  className={cn(
                    "relative rounded-xl overflow-hidden bg-stone-100",
                    mediaFiles.length === 3 && index === 0 ? "col-span-2" : ""
                  )}
                >
                  <img 
                    src={file.url} 
                    alt="" 
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => removeMedia(file.id)}
                    className="absolute top-2 right-2 p-1.5 bg-black/70 hover:bg-black/80 rounded-full transition-colors"
                  >
                    <X className="size-4 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-stone-200 flex items-center justify-between">
            <div className="flex items-center gap-1.5 bg-stone-100 p-1.5 rounded-lg">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button 
                      className="font-semibold relative transition-transform active:translate-y-0.5 active:shadow-none focus:outline-none flex items-center justify-center bg-[#FFFFFF] border bg-clip-padding text-stone-800 border-b-2 border-[#E5E5E5] hover:bg-stone-100 shadow-[0_3px_0_#E5E5E5] focus:ring-[#E5E5E5] h-10 w-10 rounded-md"
                      type="button"
                    >
                      <Upload className="size-4" />
                      <span className="sr-only">Upload files</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Upload files</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="font-semibold relative transition-transform active:translate-y-0.5 active:shadow-none focus:outline-none flex items-center justify-center bg-[#FFFFFF] border bg-clip-padding text-stone-800 border-b-2 border-[#E5E5E5] hover:bg-stone-100 shadow-[0_3px_0_#E5E5E5] focus:ring-[#E5E5E5] h-10 w-10 rounded-md"
                    >
                      <ImagePlus className="size-4" />
                      <span className="sr-only">Add image</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Add image</TooltipContent>
                </Tooltip>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                  multiple
                  className="hidden"
                  onChange={handleMediaUpload}
                />

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="font-semibold relative transition-transform active:translate-y-0.5 active:shadow-none focus:outline-none flex items-center justify-center bg-[#FFFFFF] border bg-clip-padding text-stone-800 border-b-2 border-[#E5E5E5] hover:bg-stone-100 shadow-[0_3px_0_#E5E5E5] focus:ring-[#E5E5E5] h-10 w-10 rounded-md">
                      <Trash2 className="size-4" />
                      <span className="sr-only">Clear tweet</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Clear tweet</TooltipContent>
                </Tooltip>

                <div className="w-px h-4 bg-stone-300 mx-2" />
                <CharacterCounter />
              </TooltipProvider>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Plugin to track content changes
function OnChangePlugin({ onChange }: { onChange?: (content: string) => void }) {
  const [editor] = useLexicalComposerContext()
  
  useEffect(() => {
    if (!onChange) return
    
    return editor.registerUpdateListener(() => {
      editor.getEditorState().read(() => {
        const text = $getRoot().getTextContent()
        onChange(text)
      })
    })
  }, [editor, onChange])
  
  return null
}

const initialConfig = {
  namespace: 'ThreadTweet',
  theme: {
    text: {
      bold: 'text-bold',
      italic: 'text-italic', 
      underline: 'text-underline',
    },
  },
  onError: (error: Error) => {
    console.error('Lexical error:', error)
  },
}

export default function ThreadTweet(props: ThreadTweetProps) {
  return (
    <LexicalComposer initialConfig={initialConfig}>
      <TweetContent {...props} />
    </LexicalComposer>
  )
}
