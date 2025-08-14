'use client'

import DuolingoBadge from '@/components/ui/duolingo-badge'
import DuolingoButton from '@/components/ui/duolingo-button'
import DuolingoInput from '@/components/ui/duolingo-input'
import { Label } from '@/components/ui/label'
import { client } from '@/lib/client'
import { cn } from '@/lib/utils'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FileText, FolderOpen, Link, Upload, X } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import posthog from 'posthog-js'
import { useCallback, useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface UploadState {
  file: File
  localUrl?: string
  uploadProgress: number
  isUploadDone: boolean
  xhr?: XMLHttpRequest
}

interface MultiFile {
  file: File
  title: string
  localUrl?: string
}

export default function NewKnowledgePage() {
  const searchParams = useSearchParams()
  const type = searchParams.get('type') || 'manual'

  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [uploadState, setUploadState] = useState<UploadState | null>(null)
  const [multiFiles, setMultiFiles] = useState<MultiFile[]>([])
  
  // Refs for keyboard shortcuts
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  
  // Detect OS for keyboard shortcuts
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0
  const metaKey = isMac ? 'Cmd' : 'Ctrl'

  // Helper function to extract clean title from filename
  const extractTitleFromFilename = (filename: string): string => {
    // Remove file extension and clean up common patterns
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, '')
    // Replace underscores, hyphens, and dots with spaces
    const cleaned = nameWithoutExt.replace(/[_\-\.]/g, ' ')
    // Capitalize first letter of each word
    return cleaned.replace(/\b\w/g, l => l.toUpperCase())
  }

  // Initialize multiple files
  const initializeMultiFiles = (files: File[]) => {
    
    const multiFiles = files.map(file => ({
      file,
      title: extractTitleFromFilename(file.name),
      localUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
    }))

    setMultiFiles(multiFiles)
    setUploadState(null)
    setTitle('')
  }

  // Update title for a specific file
  const updateFileTitle = (index: number, newTitle: string) => {
    setMultiFiles(prev => prev.map((file, i) => 
      i === index ? { ...file, title: newTitle } : file
    ))
  }

  // Remove a file from multi-upload
  const removeFile = (index: number) => {
    setMultiFiles(prev => {
      const file = prev[index]
      if (file && file.localUrl) {
        URL.revokeObjectURL(file.localUrl)
      }
      return prev.filter((_, i) => i !== index)
    })
  }

  // Normalize a user-entered URL so that host-only inputs like "example.com"
  // become valid absolute URLs by adding an implicit https:// scheme.
  const normalizeUrlInput = (raw: string): string => {
    const value = (raw || '').trim()
    if (!value) return ''
    // If the user already provided a scheme, leave it as-is.
    if (/^https?:\/\//i.test(value)) return value
    // Prepend https:// to host-only or schemeless inputs.
    try {
      const normalized = `https://${value}`
      // Validate via URL constructor; if it throws, fall back to original with https://
      // This guards against obviously invalid inputs without breaking UX.
      // eslint-disable-next-line no-new
      new URL(normalized)
      return normalized
    } catch {
      return `https://${value}`
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const actualMetaKey = isMac ? e.metaKey : e.ctrlKey

      // Browse files: Cmd/Ctrl + Option + B (avoids conflict with Bookmarks)  
      if (actualMetaKey && (isMac ? e.altKey : e.altKey) && e.key.toLowerCase() === 'b' && type === 'upload') {
        e.preventDefault()
        fileInputRef.current?.click()
      }
      // Submit: Cmd/Ctrl + Enter
      else if (actualMetaKey && e.key === 'Enter') {
        e.preventDefault()
        handleSubmit(e as any)
      }
      // Back: Escape
      else if (e.key === 'Escape') {
        e.preventDefault()
        router.push('/studio/knowledge')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isMac, type, router])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (getDisabled()) return

    if (type === 'upload') {
      if (multiFiles.length > 0) {
        processMultipleFiles()
      } else if (data) {
        processFile({ ...data, title })
      }
    }
    if (type === 'url') {
      if (url) {
        const cleaned = normalizeUrlInput(url)
        setUrl(cleaned)
        importUrl(cleaned)
      }
    }
  }

  const { mutate: importUrl, isPending: isImporting } = useMutation({
    mutationFn: async (url: string) => {
      const res = await client.knowledge.importUrl.$post({ url })
      return res.json()
    },
    onSuccess: (data) => {
      posthog.capture('knowledge_imported', {
        source: 'url',
        url: data.url,
        title: data.title,
      })

      queryClient.refetchQueries({ queryKey: ['knowledge-documents'] })
      toast.success(`Successfully imported content from ${data.url}`)
      setTitle('')
      setUrl('')
      
      // Redirect to knowledge base after successful import
      router.push('/studio/knowledge')
    },
    onError: (error) => {
      console.error('Error importing URL:', error)
      toast.error('Failed to import URL. Please try again.')
    },
  })

  const queryClient = useQueryClient()

  const {
    mutate: upload,
    isPending: isUploading,
    data,
    reset,
  } = useMutation({
    mutationFn: async ({ file, title }: { file: File; title: string }) => {
      let localUrl: string | undefined = undefined

      if (file.type.startsWith('image/')) {
        localUrl = URL.createObjectURL(file)
      }

      const xhr = new XMLHttpRequest()

      setUploadState({
        file,
        localUrl,
        uploadProgress: 0,
        isUploadDone: false,
        xhr,
      })

      const res = await client.file.upload.$post({
        fileName: file.name,
        fileType: file.type,
        source: 'knowledge',
      })

      const { url, fields, fileKey, type } = await res.json()

      const formData = new FormData()

      Object.entries(fields).forEach(([key, value]) => {
        formData.append(key, value as string)
      })

      formData.append('file', file)

      await new Promise<void>((resolve, reject) => {
        xhr.open('POST', url, true)
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const uploadProgress = (event.loaded / event.total) * 100

            setUploadState((prev) => (prev ? { ...prev, uploadProgress } : null))
          }
        }
        xhr.onload = () => {
          if (xhr.status === 200 || xhr.status === 204) {
            setUploadState((prev) => (prev ? { ...prev, isUploadDone: true } : null))
            resolve()
          } else {
            toast.error(`Upload failed with status ${xhr.status}`)
            reject(new Error(`Upload failed with status ${xhr.status}`))
          }
        }
        xhr.onerror = () => {
          toast.error('Network error, please try again.')
          reject(new Error('Network error occurred during upload'))
        }
        xhr.onabort = () => {
          toast.success('Upload cancelled')
          reject(new Error('Upload aborted'))
        }
        xhr.send(formData)
      })

      return { fileKey, fileName: file.name, type }
    },
    onError: () => {
      setUploadState(null)
    },
  })

  interface ProcessFileArgs {
    fileKey: string
    fileName: string
    title: string
  }

  const {
    mutate: processFile,
    isPending: isProcessing,
    reset: resetProcessing,
  } = useMutation({
    mutationFn: async ({ fileKey, fileName, title }: ProcessFileArgs) => {
      const res = await client.file.promoteToKnowledgeDocument.$post({
        fileKey,
        fileName,
        title,
      })

      return await res.json()
    },
    onSuccess: (data, variables) => {
      posthog.capture('knowledge_imported', {
        source: 'upload',
        title: variables.title,
        fileKey: variables.fileKey,
      })

      toast.success('Knowledge added!')
      setUploadState(null)
      setTitle('')
      queryClient.refetchQueries({ queryKey: ['knowledge-documents'] })
      
      // Redirect to knowledge base after successful upload
      router.push('/studio/knowledge')
    },
  })

  // Simple sequential processing for multiple files
  const {
    mutate: processMultipleFiles,
    isPending: isMultiProcessing,
  } = useMutation({
    mutationFn: async () => {
      
      for (const multiFile of multiFiles) {
        // Upload to S3
        const uploadRes = await client.file.upload.$post({
          fileName: multiFile.file.name,
          fileType: multiFile.file.type,
          source: 'knowledge',
        })
        const { url, fields, fileKey } = await uploadRes.json()

        // Upload file
        const formData = new FormData()
        Object.entries(fields).forEach(([key, value]) => {
          formData.append(key, value as string)
        })
        formData.append('file', multiFile.file)
        
        await fetch(url, { method: 'POST', body: formData })

        // Process to knowledge document
        await client.file.promoteToKnowledgeDocument.$post({
          fileKey,
          fileName: multiFile.file.name,
          title: multiFile.title,
        })
      }
    },
    onSuccess: () => {
      posthog.capture('knowledge_bulk_imported', {
        source: 'multi_upload',
        fileCount: multiFiles.length,
      })

      toast.success(`Successfully added ${multiFiles.length} documents!`)
      setMultiFiles([])
      setUploadState(null)
      setTitle('')
      queryClient.refetchQueries({ queryKey: ['knowledge-documents'] })
      router.push('/studio/knowledge')
    },
    onError: () => {
      toast.error('Failed to upload files. Please try again.')
    },
  })

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const files = Array.from(e.dataTransfer.files)
    
    if (files.length === 0) return

    if (files.length === 1 && files[0]) {
      // Single file - use existing flow
      upload({ file: files[0], title })
    } else {
      // Multiple files
      initializeMultiFiles(files)
    }
  }, [title])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    
    if (files.length === 0) return

    if (files.length === 1 && files[0]) {
      upload({ file: files[0], title })
    } else {
      initializeMultiFiles(files)
    }
  }

  const renderFilePreview = () => {
    if (!uploadState) return null

    const { file, localUrl, uploadProgress, isUploadDone } = uploadState

    const isImage = file.type.startsWith('image/')

    return (
      <div className="relative border-2 border-neutral-200 shadow-[0_2px_0_hsl(var(--neutral-200))] rounded-2xl p-6 bg-white">
        <div className="flex items-center gap-4">
          {isImage && localUrl ? (
            <div className="relative size-16 rounded-lg overflow-hidden bg-neutral-100 flex-shrink-0">
              <img
                src={localUrl}
                alt={file.name}
                className="w-full h-full object-cover"
              />
              {!isUploadDone && (
                <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                  <div className="relative size-8">
                    <svg className="size-8 transform" viewBox="0 0 36 36">
                      <path
                        className="text-neutral-300"
                        stroke="currentColor"
                        strokeWidth="3"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path
                        className="text-white"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeDasharray={`${uploadProgress}, 100`}
                        strokeLinecap="round"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                    </svg>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="relative size-16 rounded-lg bg-neutral-100 flex items-center justify-center flex-shrink-0">
              <FileText className="size-8 text-neutral-400" />
              {!isUploadDone && (
                <div className="absolute inset-0 bg-black/10 flex items-center justify-center">
                  <div className="relative size-8">
                    <svg className="size-8 transform -rotate-90" viewBox="0 0 36 36">
                      <path
                        className="text-neutral-300"
                        stroke="currentColor"
                        strokeWidth="3"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path
                        className="text-primary-600"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeDasharray={`${uploadProgress}, 100`}
                        strokeLinecap="round"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                    </svg>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-lg font-semibold text-neutral-900 truncate">
                {file.name}
              </h3>
                              {isUploadDone && (
                  <DuolingoBadge variant="green" className="px-2 text-xs">
                    Uploaded
                  </DuolingoBadge>
                )}
            </div>
            <p className="text-sm text-neutral-600">
              {(file.size / 1024 / 1024).toFixed(2)} MB • {file.type}
            </p>
            {!isUploadDone && (
              <p className="text-sm text-primary-600 mt-1">
                Uploading... {Math.round(uploadProgress)}%
              </p>
            )}
          </div>
        </div>

        <DuolingoButton
          variant="destructive"
          size="icon"
          className="absolute size-8 top-2 right-2"
          onClick={() => {
            if (uploadState?.xhr && !uploadState.isUploadDone) {
              uploadState.xhr.abort()
            }
            if (uploadState?.localUrl) {
              URL.revokeObjectURL(uploadState.localUrl)
            }
            setUploadState(null)
            reset()
            resetProcessing()
            setTitle('')
          }}
        >
          <X className="size-4" />
        </DuolingoButton>
      </div>
    )
  }

  const renderMultiFileList = () => {
    if (multiFiles.length === 0) return null

    return (
      <div className="space-y-4">
        <div className="text-sm font-medium text-neutral-700">
          {multiFiles.length} files selected
        </div>
        
        {multiFiles.map((multiFile, index) => (
          <div key={index} className="relative border-2 border-neutral-200 shadow-[0_2px_0_hsl(var(--neutral-200))] rounded-2xl p-4 bg-white">
            <div className="flex items-center gap-4 mb-3">
              {multiFile.localUrl ? (
                <img src={multiFile.localUrl} alt={multiFile.file.name} className="size-12 rounded object-cover" />
              ) : (
                <div className="size-12 rounded bg-neutral-100 flex items-center justify-center">
                  <FileText className="size-6 text-neutral-400" />
                </div>
              )}
              
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-neutral-900 truncate">{multiFile.file.name}</h3>
                <p className="text-xs text-neutral-600">
                  {(multiFile.file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              
              <DuolingoButton
                variant="destructive"
                size="icon"
                className="size-8"
                onClick={() => removeFile(index)}
              >
                <X className="size-4" />
              </DuolingoButton>
            </div>
            
            <div className="space-y-1">
              <Label className="text-xs">Title</Label>
              <DuolingoInput
                value={multiFile.title}
                onChange={(e) => updateFileTitle(index, e.target.value)}
                fullWidth
                placeholder="Document title"
                className="text-sm"
              />
            </div>
          </div>
        ))}
      </div>
    )
  }

  const renderUploadView = () => (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        {multiFiles.length > 0 ? (
          renderMultiFileList()
        ) : uploadState ? (
          renderFilePreview()
        ) : (
          <div
            className={cn(
              'relative border-2 border-neutral-200 shadow-[0_2px_0_hsl(var(--neutral-200))] rounded-2xl p-12 text-center transition-all duration-200',
              { 'border-primary bg-primary/5 scale-[1.01]': isDragging },
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <FolderOpen className="mx-auto size-16 text-neutral-400 mb-4" />
            <h3 className="text-lg font-semibold text-neutral-900 mb-2">
              Drag n' drop or browse
            </h3>
            <p className="text-sm text-neutral-600 mb-4">
              pdf, docx, txt and images up to 10MB
            </p>
            <div className="w-full flex justify-center">
              <label htmlFor="file-upload" className="cursor-pointer">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DuolingoButton
                        variant="secondary"
                        size="sm"
                        className="w-auto pointer-events-none"
                      >
                        <Upload className="size-4 mr-2" />
                        Browse Files
                      </DuolingoButton>
                    </TooltipTrigger>
                    <TooltipContent>
                      <div className="space-y-1">
                        <p>Browse files</p>
                        <p className="text-xs text-neutral-400">{metaKey} + {isMac ? 'Option' : 'Alt'} + B</p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </label>
              <input
                ref={fileInputRef}
                id="file-upload"
                type="file"
                className="hidden"
                accept=".pdf,.docx,.txt,.md,.csv,.jpg,.jpeg,.png,.gif,.webp,.svg"
                onChange={handleFileSelect}
                disabled={isUploading || isProcessing}
                multiple
              />
            </div>
          </div>
        )}
      </div>

      {/* Only show title input for single file upload */}
      {multiFiles.length === 0 && (
        <div className="space-y-1">
          <Label>Title</Label>
          <DuolingoInput
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSubmit(e)
              }
            }}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fullWidth
            placeholder="My document title"
          />
        </div>
      )}
    </form>
  )

  const renderUrlView = () => (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-1">
        <Label>Link to website</Label>
        <DuolingoInput
          autoFocus
          fullWidth
          icon={<Link className="size-5 text-neutral-400" />}
          placeholder="https://example.com/article"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={(e) => setUrl(normalizeUrlInput(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleSubmit(e)
            }
          }}
          className="flex-1 w-full"
        />
        <p className="text-xs text-neutral-500 mt-2">
          The title will be automatically extracted from the website
        </p>
      </div>
    </form>
  )

  const getDisabled = () => {
    if (type === 'upload') {
      if (multiFiles.length > 0) {
        return multiFiles.some(f => f.title.trim().length === 0)
      }
      return !Boolean(title) || !Boolean(uploadState?.isUploadDone)
    }
    if (type === 'url') {
      return !Boolean(url)
    }
    return false
  }

  return (
    <div className="relative z-10 min-h-screen">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <DuolingoButton
          variant="secondary"
          className="w-fit mb-8"
          size="sm"
          onClick={() => router.push('/studio/knowledge')}
        >
          <ArrowLeft className="size-8 shrink-0 mr-2" />
          Back to Knowledge Base
        </DuolingoButton>

        <div className="bg-white p-6 space-y-4 rounded-3xl border-2 border-neutral-200 shadow-xl">
          <div>
            {type === 'upload' && renderUploadView()}
            {type === 'url' && renderUrlView()}
          </div>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <DuolingoButton
                  loading={isProcessing || isImporting || isMultiProcessing}
                  onClick={handleSubmit}
                  disabled={getDisabled()}
                >
                  {multiFiles.length > 0 
                    ? `Add ${multiFiles.length} Documents` 
                    : 'Add Knowledge'
                  }
                </DuolingoButton>
              </TooltipTrigger>
              <TooltipContent>
                <div className="space-y-1">
                  <p>Submit knowledge</p>
                  <p className="text-xs text-neutral-400">{metaKey} + Enter</p>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </div>
  )
}
