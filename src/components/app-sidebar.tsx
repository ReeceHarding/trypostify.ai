'use client'

import { ArrowUp, Globe, History, Paperclip, Plus, RotateCcw, Square, Upload, X } from 'lucide-react'
import { useCallback, useContext, useEffect, useMemo, useState, useRef } from 'react'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { useAttachments } from '@/hooks/use-attachments'
import { useChatContext } from '@/hooks/use-chat'
import { useTweets } from '@/hooks/use-tweets'
import { client } from '@/lib/client'
import { MultipleEditorStorePlugin } from '@/lib/lexical-plugins/multiple-editor-plugin'
import PlaceholderPlugin from '@/lib/placeholder-plugin'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { motion } from 'framer-motion'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
} from 'lexical'
import { useRouter, useSearchParams } from 'next/navigation'
import { AttachmentItem } from './attachment-item'
import { Messages } from './chat/messages'
import { KnowledgeSelector, SelectedKnowledgeDocument } from './knowledge-selector'
import DuolingoButton from './ui/duolingo-button'
import { FileUpload, FileUploadContext, FileUploadTrigger } from './ui/file-upload'
import { PromptSuggestion } from './ui/prompt-suggestion'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

const ChatInput = ({
  onSubmit,
  onStop,
  disabled,
  handleFilesAdded,
  knowledgeDocuments,
}: {
  onSubmit: (text: string, editorContent: string) => void
  onStop: () => void
  disabled: boolean
  handleFilesAdded: (files: File[]) => void
  knowledgeDocuments?: SelectedKnowledgeDocument[]
}) => {
  const [editor] = useLexicalComposerContext()
  const { isDragging } = useContext(FileUploadContext)
  const [showTooltip, setShowTooltip] = useState(false)
  
  // Detect OS for keyboard shortcuts
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0
  const metaKey = isMac ? 'Cmd' : 'Ctrl'

  const { attachments, removeAttachment, addKnowledgeAttachment, hasUploading } =
    useAttachments()

  const { shadowEditor } = useTweets()

  // File input ref for keyboard shortcut
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Basic "@/" mention support for knowledge documents
  const [isChooserOpen, setIsChooserOpen] = useState(false)
  const [chooserQuery, setChooserQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [showAddOptions, setShowAddOptions] = useState(false)

  // Register file input ref and keyboard shortcut
  useEffect(() => {
    // Find the file input element
    const timer = setTimeout(() => {
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      if (fileInput) {
        fileInputRef.current = fileInput
      }
    }, 100)

    const handleKeyDown = (e: KeyboardEvent) => {
      const actualMetaKey = isMac ? e.metaKey : e.ctrlKey
      
      // Attach files: Cmd/Ctrl + U (safe across all browsers and systems)
      if (actualMetaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'u') {
        e.preventDefault()
        console.log('[AppSidebar] File attach shortcut triggered (Cmd+U) at', new Date().toISOString())
        fileInputRef.current?.click()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      clearTimeout(timer)
    }
  }, [isMac])

  const filteredDocs = useMemo(() => {
    const docs = (knowledgeDocuments || []).filter((d) => !d.isDeleted)
    if (!chooserQuery.trim()) return docs.slice(0, 8)
    const q = chooserQuery.toLowerCase()
    return docs.filter((d) => d.title?.toLowerCase().includes(q)).slice(0, 8)
  }, [knowledgeDocuments, chooserQuery])

  useEffect(() => {
    const remove = editor.registerTextContentListener(() => {
      editor.getEditorState().read(() => {
        const content = $getRoot().getTextContent()
        const match = content.match(/@\/([^\s]*)$/)
        if (match) {
          setIsChooserOpen(true)
          setChooserQuery(match[1] || '')
          setActiveIndex(0)
        } else {
          setIsChooserOpen(false)
          setChooserQuery('')
          setShowAddOptions(false)
        }
      })
    })
    return () => remove()
  }, [editor])

  const commitSelection = useCallback(
    (doc: SelectedKnowledgeDocument) => {
      try {
        console.log(
          `[${new Date().toISOString()}] [ChatInput] commitSelection: docId=%s title=%s`,
          doc.id,
          doc.title,
        )
      } catch {}
      const exists = attachments.some((a: any) => a.id === doc.id)
      if (!exists) addKnowledgeAttachment(doc)
      setIsChooserOpen(false)
      setChooserQuery('')
      setShowAddOptions(false)
      // Remove the trailing "@/query" trigger text from the editor after selection
      editor.update(() => {
        const root = $getRoot()
        const textNodes = root.getAllTextNodes()
        const lastText = textNodes[textNodes.length - 1]
        if (lastText) {
          const current = lastText.getTextContent()
          // Replace the @/trigger with a plain-text @Title mention and a trailing space
          const cleaned = current.replace(/@\/([^\s]*)$/, '')
          const mentionText = `@${doc.title ?? ''}`.trimEnd()
          lastText.setTextContent(`${cleaned}${mentionText} `)
          // Place cursor at end so the user can continue typing
          root.selectEnd()
        }
      })
    },
    [attachments, addKnowledgeAttachment],
  )

  useEffect(() => {
    if (!isChooserOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isChooserOpen) return
      
      // Calculate total items including "Add new" button
      const totalItems = filteredDocs.length + 1
      
      if (showAddOptions) {
        // Handle navigation in add options submenu
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          setActiveIndex((i) => i === 0 ? 1 : 0)
        } else if (e.key === 'Enter') {
          e.preventDefault()
          const path = activeIndex === 0 ? '/studio/knowledge/new?type=upload' : '/studio/knowledge/new?type=url'
          window.location.href = path
          setIsChooserOpen(false)
          setChooserQuery('')
          setShowAddOptions(false)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setShowAddOptions(false)
          setActiveIndex(filteredDocs.length) // Back to "Add new" button
        }
      } else {
        // Handle navigation in main menu
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setActiveIndex((i) => (i + 1) % totalItems)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setActiveIndex((i) => (i - 1 + totalItems) % totalItems)
        } else if (e.key === 'Enter') {
          e.preventDefault()
          if (activeIndex < filteredDocs.length && filteredDocs[activeIndex]) {
            // Select a document
            commitSelection(filteredDocs[activeIndex])
          } else {
            // "Add new" button selected
            setShowAddOptions(true)
            setActiveIndex(0) // Start at first option in submenu
          }
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setIsChooserOpen(false)
          setChooserQuery('')
          setShowAddOptions(false)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [isChooserOpen, filteredDocs, activeIndex, commitSelection, showAddOptions])

  const handleSubmit = () => {
    const editorContent = shadowEditor.read(() => $getRoot().getTextContent().trim())

    const text = editor.read(() => $getRoot().getTextContent().trim())

    onSubmit(text, editorContent)

    editor.update(() => {
      const root = $getRoot()
      root.clear()
      root.append($createParagraphNode())
    })
  }

  useEffect(() => {
    const removeCommand = editor?.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        // If the chooser is open or another handler already prevented default, do not submit.
        if (event?.defaultPrevented || isChooserOpen) {
          try {
            console.log(
              `[${new Date().toISOString()}] [ChatInput] Enter prevented due to chooserOpen=%s defaultPrevented=%s`,
              isChooserOpen,
              Boolean(event?.defaultPrevented),
            )
          } catch {}
          event?.preventDefault()
          return true
        }

        if (event && !event.shiftKey) {
          event.preventDefault()

          const editorContent = shadowEditor.read(() =>
            $getRoot().getTextContent().trim(),
          )

          editor.update(() => {
            const root = $getRoot()
            const text = root.getTextContent().trim()
            if (!text) return

            onSubmit(text, editorContent)

            root.clear()
            const paragraph = $createParagraphNode()
            root.append(paragraph)
          })
        }

        return true
      },
      COMMAND_PRIORITY_HIGH,
    )

    return () => {
      removeCommand?.()
    }
  }, [editor, onSubmit])

  const handleAddKnowledgeDoc = useCallback(
    (doc: SelectedKnowledgeDocument) => {
      addKnowledgeAttachment(doc)
    },
    [addKnowledgeAttachment],
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      const files: File[] = []
      Array.from(items).forEach((item) => {
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) {
            files.push(file)
          }
        }
      })

      if (files.length > 0) {
        e.preventDefault()
        handleFilesAdded(files)
      }
    },
    [handleFilesAdded],
  )

  return (
    <div>
      <div className="mb-2 flex gap-2 items-center">
        {attachments.map((attachment, i) => {
          const onRemove = () => removeAttachment({ id: attachment.id })
          return (
            <motion.div
              key={attachment.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.2, delay: i * 0.1 }}
            >
              <AttachmentItem
                onRemove={onRemove}
                key={attachment.id}
                attachment={attachment}
              />
            </motion.div>
          )
        })}
      </div>

      <div className="space-y-3">
        <div
          className={`relative transition-all rounded-xl duration-300 ease-out ${
            isDragging ? 'ring-2 ring-indigo-500 ring-offset-2 ring-offset-gray-100' : ''
          }`}
        >
          {isDragging && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-indigo-50/90 to-blue-50/90 backdrop-blur-md rounded-xl z-20 border-2 border-dashed border-primary-300">
              <div className="flex items-center gap-2 text-primary-700">
                <Paperclip className="size-5" />
                <p className="font-medium">Drop files to attach</p>
              </div>
              <p className="text-sm text-primary-500 mt-1">
                Supports images, documents, and more
              </p>
            </div>
          )}
          <div className="relative">
            <div
              className={`rounded-xl bg-white border-2 shadow-[0_2px_0_hsl(var(--neutral-200))] font-medium transition-all duration-300 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-primary ${
                isDragging
                  ? 'border-primary/20 shadow-[var(--shadow-md)]'
                  : 'border-neutral-200'
              }`}
            >
              <TooltipProvider>
                <Tooltip open={showTooltip && !editor.getRootElement()?.matches(':focus-within')}>
                  <TooltipTrigger asChild>
                    <div 
                      onMouseEnter={() => setShowTooltip(true)}
                      onMouseLeave={() => setShowTooltip(false)}
                      className="relative"
                    >
                      <PlainTextPlugin
                        contentEditable={
                          <ContentEditable
                            autoFocus
                            className="w-full px-4 py-3 outline-none min-h-[4.5rem] text-base placeholder:text-neutral-400"
                            style={{ minHeight: '4.5rem' }}
                            onPaste={handlePaste}
                          />
                        }
                        ErrorBoundary={LexicalErrorBoundary}
                      />
                      <PlaceholderPlugin placeholder="Post about..." />
                      <HistoryPlugin />
                      <MultipleEditorStorePlugin id="app-sidebar" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="space-y-1">
                      <p>Focus chat input</p>
                      <p className="text-xs text-neutral-400">{metaKey} + /</p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <div className="flex items-center justify-between px-3 pb-3">
                <div className="flex gap-1.5 items-center">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <FileUploadTrigger asChild>
                          <DuolingoButton type="button" variant="secondary" size="icon">
                            <Paperclip className="text-neutral-600 size-5" />
                          </DuolingoButton>
                        </FileUploadTrigger>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="space-y-1">
                          <p>Attach files</p>
                          <p className="text-xs text-neutral-400">{metaKey} + Shift + A</p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <KnowledgeSelector onSelectDocument={handleAddKnowledgeDoc} />
                </div>

                {disabled ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DuolingoButton
                          onClick={onStop}
                          variant="icon"
                          size="icon"
                          aria-label="Stop message"
                        >
                          <Square className="size-3 fill-white" />
                        </DuolingoButton>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Stop generating</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DuolingoButton
                          disabled={hasUploading}
                          onClick={handleSubmit}
                          variant="icon"
                          size="icon"
                          aria-label="Send message"
                        >
                          <ArrowUp className="size-5" />
                        </DuolingoButton>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="space-y-1">
                          <p>Send message</p>
                          <p className="text-xs text-neutral-400">Enter</p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>

              {isChooserOpen ? (
                <div className="absolute bottom-16 left-3 right-3 z-50 bg-white border-2 border-neutral-200 rounded-xl shadow-[0_6px_0_hsl(var(--neutral-200))] p-1">
                  {showAddOptions ? (
                    // Add options submenu
                    <div className="p-2">
                      <p className="text-xs text-neutral-500 mb-2">Choose knowledge type:</p>
                      <button
                        type="button"
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm mb-1 flex items-center gap-2 ${
                          activeIndex === 0 ? 'bg-neutral-100' : 'hover:bg-neutral-100'
                        }`}
                        onMouseEnter={() => setActiveIndex(0)}
                        onClick={() => {
                          window.location.href = '/studio/knowledge/new?type=upload'
                          setIsChooserOpen(false)
                          setChooserQuery('')
                          setShowAddOptions(false)
                        }}
                      >
                        <Upload className="size-4" />
                        Upload Document
                      </button>
                      <button
                        type="button"
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${
                          activeIndex === 1 ? 'bg-neutral-100' : 'hover:bg-neutral-100'
                        }`}
                        onMouseEnter={() => setActiveIndex(1)}
                        onClick={() => {
                          window.location.href = '/studio/knowledge/new?type=url'
                          setIsChooserOpen(false)
                          setChooserQuery('')
                          setShowAddOptions(false)
                        }}
                      >
                        <Globe className="size-4" />
                        Add from Website
                      </button>
                    </div>
                  ) : (
                    // Main menu
                    <>
                      <div className="max-h-64 overflow-auto">
                        {filteredDocs.length > 0 ? (
                          <>
                            {filteredDocs.map((doc, idx) => (
                              <button
                                key={doc.id}
                                type="button"
                                className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                                  idx === activeIndex && !showAddOptions ? 'bg-neutral-100' : 'bg-white'
                                }`}
                                onMouseEnter={() => {
                                  setActiveIndex(idx)
                                  setShowAddOptions(false)
                                }}
                                onClick={() => commitSelection(doc)}
                              >
                                {doc.title}
                                <span className="ml-2 text-xs text-neutral-400">{doc.type}</span>
                              </button>
                            ))}
                          </>
                        ) : (
                          <div className="px-3 py-2 text-sm text-neutral-500">
                            No knowledge documents found
                          </div>
                        )}
                      </div>
                      <div className="border-t border-neutral-200 mt-1 pt-1">
                        <button
                          type="button"
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${
                            activeIndex === filteredDocs.length && !showAddOptions ? 'bg-neutral-100' : 'hover:bg-neutral-100'
                          }`}
                          onMouseEnter={() => {
                            setActiveIndex(filteredDocs.length)
                            setShowAddOptions(false)
                          }}
                          onClick={() => {
                            setShowAddOptions(true)
                            setActiveIndex(0)
                          }}
                        >
                          <Plus className="size-4" />
                          Add new knowledge document
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
          
          {/* Hint for @/ mentions */}
          <p className="text-xs text-neutral-400 mt-2 px-1">
            Tip: Type @/ to reference knowledge documents
          </p>
        </div>
      </div>
    </div>
  )
}

export function AppSidebar({ children }: { children: React.ReactNode }) {
  const { toggleSidebar } = useSidebar()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [editor] = useLexicalComposerContext()


  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  
  // Detect OS for keyboard shortcuts
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0
  const metaKey = isMac ? 'Cmd' : 'Ctrl'

  const { data: chatHistoryData, isPending: isHistoryPending } = useQuery({
    queryKey: ['chat-history', isHistoryOpen],
    queryFn: async () => {
      const res = await client.chat.history.$get()
      return await res.json()
    },
    enabled: isHistoryOpen,
  })

  const { messages, status, sendMessage, startNewChat, id, stop } = useChatContext()
  const { attachments, removeAttachment, addChatAttachment } =
    useAttachments()

  const updateURL = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(window.location.search)
      params.set(key, value)
      router.replace(`${window.location.pathname}?${params.toString()}`, {
        scroll: false,
      })
    },
    [router],
  )

  const handleSubmit = useCallback(
    async (text: string, editorContent: string) => {
      if (!text.trim()) return

      if (!Boolean(searchParams.get('chatId'))) {
        updateURL('chatId', id)
      }

      sendMessage({ text, metadata: { attachments, editorContent, userMessage: text } })

      if (attachments.length > 0) {
        requestAnimationFrame(() => {
          attachments.forEach((a) => {
            removeAttachment({ id: a.id })
          })
        })
      }
    },
    [searchParams, updateURL, id, sendMessage, attachments, removeAttachment],
  )

  const handleNewChat = useCallback(() => {
    startNewChat()
  }, [startNewChat])

  const handleFilesAdded = useCallback(
    (files: File[]) => {
      files.forEach(addChatAttachment)
    },
    [addChatAttachment],
  )

  // Keyboard shortcut for New Chat and custom event for toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const actualMetaKey = isMac ? e.metaKey : e.ctrlKey

      // New Chat: Cmd/Ctrl + N (standard new document shortcut, safe across all platforms)
      if (actualMetaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        console.log('[AppSidebar] New Chat shortcut triggered (Cmd+N) at', new Date().toISOString())
        handleNewChat()
      }
      // Focus chat input: Cmd/Ctrl + /
      else if (actualMetaKey && e.key === '/') {
        e.preventDefault()
        editor.focus()
      }
      // History: Cmd/Ctrl + Shift + H (avoids conflict with Hide App)
      else if (actualMetaKey && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault()
        setIsHistoryOpen(true)
      }
      // Close sidebar: Cmd/Ctrl + \ (backslash - standard sidebar toggle, safe across all platforms)
      else if (actualMetaKey && !e.shiftKey && !e.altKey && e.key === '\\') {
        e.preventDefault()
        console.log('[AppSidebar] Close sidebar shortcut triggered (Cmd+\\) at', new Date().toISOString())
        toggleSidebar()
      }
    }

    // Custom event listener for toggle from main content header
    const handleToggleFromMainHeader = () => {
      console.log('[AppSidebar] Received toggle event from main content header at', new Date().toISOString())
      toggleSidebar()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('toggleRightSidebar', handleToggleFromMainHeader)
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('toggleRightSidebar', handleToggleFromMainHeader)
    }
  }, [isMac, handleNewChat, editor, toggleSidebar])

  const { setId } = useChatContext()

  const handleChatSelect = async (chatId: string) => {
    setIsHistoryOpen(false)
    setId(chatId)
  }

  const { data: knowledgeData } = useQuery({
    queryKey: ['knowledge-documents'],
    queryFn: async () => {
      const res = await client.knowledge.list.$get()
      return await res.json()
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  })

  const exampleDocuments = knowledgeData?.documents?.filter((doc) => doc.isExample) || []

  return (
    <>
      {children}

      <Sidebar side="right" collapsible="offcanvas">
        <SidebarHeader className="flex flex-col border-b border-neutral-200 bg-neutral-100 items-center justify-end gap-2 px-4 py-2">
          <div className="w-full flex items-center min-h-[2.5rem]">
            {/* Hide label on small screens to save space */}
            <p className="text-sm/6 font-medium flex-shrink-0 hidden sm:block">Assistant</p>
            <div className="flex gap-2 flex-shrink-0 ml-auto">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DuolingoButton
                      onClick={handleNewChat}
                      size="sm"
                      variant="secondary"
                      className="inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <Plus className="size-4" />
                      <p className="text-sm">New Chat</p>
                    </DuolingoButton>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="space-y-1">
                      <p>Start a new conversation</p>
                      <p className="text-xs text-neutral-400">{metaKey} + N</p>
                    </div>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <DuolingoButton
                      onClick={() => setIsHistoryOpen(true)}
                      size="icon"
                      variant="secondary"
                      className="aspect-square"
                    >
                      <History className="size-4" />
                    </DuolingoButton>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="space-y-1">
                      <p>Open chat history</p>
                      <p className="text-xs text-neutral-400">{metaKey} + Shift + H</p>
                    </div>
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <DuolingoButton
                      onClick={toggleSidebar}
                      variant="secondary"
                      className="aspect-square"
                      size="icon"
                    >
                      <X className="size-4" />
                    </DuolingoButton>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="space-y-1">
                      <p>Close sidebar</p>
                      <p className="text-xs text-neutral-400">{metaKey} + \</p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent className="relative h-full py-0 bg-neutral-50 bg-opacity-25">
          {messages.length === 0 ? (
            <div className="absolute z-10 p-3 pb-5 inset-x-0 bottom-0">
              <p className="text-sm text-neutral-500 mb-2">Examples</p>
              <div className="space-y-2 max-[480px]:space-y-2 max-[480px]:px-1">
                <PromptSuggestion
                  onClick={() => {
                    attachments.forEach((attachment) => {
                      removeAttachment({ id: attachment.id })
                    })

                    const blogDoc = exampleDocuments.find(
                      (doc) => doc.title?.includes('Zod') || doc.type === 'url',
                    )

                    editor.update(() => {
                      const root = $getRoot()
                      const paragraph = $createParagraphNode()
                      const text = $createTextNode(
                        'Suggest a tweet about the Zod 4.0 release: https://zod.dev/v4',
                      )
                      root.clear()
                      paragraph.append(text)
                      paragraph.selectEnd()
                      root.append(paragraph)
                    })

                    editor.focus()
                  }}
                >
                  Suggest a tweet about the Zod 4.0 release
                </PromptSuggestion>

                <PromptSuggestion
                  onClick={() => {
                    attachments.forEach((attachment) => {
                      removeAttachment({ id: attachment.id })
                    })

                    editor.update(() => {
                      const root = $getRoot()
                      const paragraph = $createParagraphNode()
                      const text = $createTextNode(
                        'Draft 2 tweets about imposter syndrome in tech',
                      )
                      root.clear()
                      paragraph.append(text)
                      paragraph.selectEnd()
                      root.append(paragraph)
                    })

                    editor.focus()
                  }}
                >
                  Draft 2 tweets about imposter syndrome in tech
                </PromptSuggestion>

                <PromptSuggestion
                  onClick={() => {
                    attachments.forEach((attachment) => {
                      removeAttachment({ id: attachment.id })
                    })

                    editor.update(() => {
                      const root = $getRoot()
                      const paragraph = $createParagraphNode()
                      const text = $createTextNode(
                        'Draft a tweet about 3 productivity tips for remote devs',
                      )
                      root.clear()
                      paragraph.append(text)
                      paragraph.selectEnd()
                      root.append(paragraph)
                    })

                    editor.focus()
                  }}
                >
                  Draft a tweet about 3 productivity tips for remote devs
                </PromptSuggestion>

                <PromptSuggestion
                  onClick={() => {
                    attachments.forEach((attachment) => {
                      removeAttachment({ id: attachment.id })
                    })

                    editor.update(() => {
                      const root = $getRoot()
                      const paragraph = $createParagraphNode()
                      const text = $createTextNode(
                        'Tweet about a complex programming concept in simple terms',
                      )
                      root.clear()
                      paragraph.append(text)
                      paragraph.selectEnd()
                      root.append(paragraph)
                    })

                    editor.focus()
                  }}
                >
                  Tweet about a complex programming concept in simple terms
                </PromptSuggestion>
              </div>
            </div>
          ) : null}

          <SidebarGroup className="h-full py-0 px-0">
            <div className="h-full space-y-6 min-h-[20rem] flex flex-col">
              <Messages status={status} messages={messages} />
            </div>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="relative p-3 border-t border-t-neutral-300 bg-neutral-100">
          {/* <Improvements /> */}

          <FileUpload onFilesAdded={handleFilesAdded}>
            <ChatInput
              onStop={stop}
              onSubmit={handleSubmit}
              handleFilesAdded={handleFilesAdded}
              disabled={status === 'submitted' || status === 'streaming'}
              knowledgeDocuments={knowledgeData?.documents}
            />
          </FileUpload>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
        <DialogContent className="bg-white rounded-2xl p-6 max-w-2xl max-h-[80vh] overflow-hidden">
          <div className="size-12 bg-neutral-100 rounded-full flex items-center justify-center">
            <History className="size-6" />
          </div>
          <DialogHeader className="py-2">
            <DialogTitle className="text-lg font-semibold leading-6">
              Chat History
            </DialogTitle>
            <DialogDescription className="leading-none">
              {isHistoryPending
                ? 'Loading...'
                : chatHistoryData?.chatHistory?.length
                  ? `Showing ${chatHistoryData?.chatHistory?.length} most recent chats`
                  : 'No chat history yet'}
            </DialogDescription>
          </DialogHeader>

          {
            <div className="overflow-y-auto max-h-[60vh] -mx-2 px-2">
              <div className="space-y-2">
                {chatHistoryData?.chatHistory?.length ? (
                  chatHistoryData.chatHistory.map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => handleChatSelect(chat.id)}
                      className="w-full text-left p-4 rounded-lg border border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-sm text-neutral-900 truncate">
                            {chat.title}
                          </h3>
                        </div>
                        <span className="text-xs text-neutral-400 whitespace-nowrap">
                          {formatDistanceToNow(new Date(chat.lastUpdated), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="text-center py-8 text-neutral-500">
                    <p className="text-sm">No chat history yet</p>
                    <p className="text-xs mt-1">Start a conversation to see it here</p>
                  </div>
                )}
              </div>
            </div>
          }
        </DialogContent>
      </Dialog>
    </>
  )
}
